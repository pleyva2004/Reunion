import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { SPECTRUM_SIGNATURE_TOLERANCE_SEC } from "../config.js";
import type { InboundMessage } from "../contracts/types.js";
import { PLATFORM } from "../contracts/types.js";
import { logger } from "../observability/logger.js";

/**
 * Spectrum inbound webhook (inbound text only).
 *
 * Photon/Spectrum delivers inbound iMessage events over HTTP. We verify the
 * HMAC signature, map `payload.space.id` -> chat_guid, and hand the message to
 * PhotonConnector for on-device classification.
 *
 * See docs/connections/photon-spectrum.md. Poll votes do NOT come through here;
 * they arrive via advanced-imessage-kit (see imessage-adapter.real.ts).
 */

const SIGNATURE_HEADER = "x-spectrum-signature";
const TIMESTAMP_HEADER = "x-spectrum-timestamp";

export function verifySignature(
  rawBody: string,
  timestamp: string | undefined,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!timestamp || !signature) return false;
  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(age) || age > SPECTRUM_SIGNATURE_TOLERANCE_SEC) {
    return false;
  }
  const expected =
    "v0=" +
    createHmac("sha256", secret).update(`v0:${timestamp}:${rawBody}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

interface SpectrumPayload {
  event?: string;
  message?: {
    id?: string;
    content?: { type?: string; text?: string };
  };
  space?: { id?: string };
}

export interface WebhookOptions {
  /** When set, every request must carry a valid HMAC signature. */
  signingSecret?: string;
  /** Called once per inbound text message (the classifier entry point). */
  onInbound: (message: InboundMessage) => void | Promise<void>;
  path?: string;
}

export function registerSpectrumWebhook(
  app: FastifyInstance,
  opts: WebhookOptions,
): void {
  const path = opts.path ?? "/spectrum-webhook";

  // Capture the raw body so HMAC verification matches exactly what was signed.
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_req, body, done) => {
      done(null, { raw: body as string });
    },
  );

  app.post(path, async (request: FastifyRequest, reply) => {
    const raw = (request.body as { raw?: string } | undefined)?.raw ?? "";

    if (opts.signingSecret) {
      const ok = verifySignature(
        raw,
        header(request, TIMESTAMP_HEADER),
        header(request, SIGNATURE_HEADER),
        opts.signingSecret,
      );
      if (!ok) {
        logger.warn("spectrum webhook: bad signature");
        return reply.code(401).send("bad signature");
      }
    }

    let payload: SpectrumPayload;
    try {
      payload = raw ? (JSON.parse(raw) as SpectrumPayload) : {};
    } catch {
      // Always return 2xx-ish handling, but a parse failure is a 400.
      return reply.code(400).send("invalid json");
    }

    if (
      payload.event === "messages" &&
      payload.message?.content?.type === "text" &&
      payload.message.content.text &&
      payload.message.id &&
      payload.space?.id
    ) {
      const inbound: InboundMessage = {
        messageId: payload.message.id,
        chatGuid: payload.space.id, // space.id -> chat_guid
        text: payload.message.content.text,
        platform: PLATFORM,
      };
      // Fire-and-forget so we can return 2xx quickly (prevents Spectrum retries).
      void Promise.resolve(opts.onInbound(inbound)).catch((err) =>
        logger.error({ err }, "onInbound handler failed"),
      );
    }

    // Must return 2xx to prevent webhook retries.
    return reply.code(200).send("ok");
  });
}

function header(req: FastifyRequest, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}
