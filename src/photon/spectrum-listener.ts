import type { InboundMode } from "../config.js";
import type { InboundMessage } from "../contracts/types.js";
import { logger } from "../observability/logger.js";
import { toInboundMessage } from "./inbound-message.js";

export interface SpectrumListenerOptions {
  mode: "spectrum-local" | "spectrum-cloud";
  projectId?: string;
  projectSecret?: string;
  onInbound: (message: InboundMessage) => void | Promise<void>;
}

export interface InboundHandle {
  stop(): Promise<void>;
}

/**
 * Long-lived Spectrum message loop for local or cloud iMessage inbound.
 *
 * Local mode reads the macOS Messages database directly (no Photon cloud account).
 * Cloud mode requires PROJECT_ID + PROJECT_SECRET from app.photon.codes.
 */
export class SpectrumListener implements InboundHandle {
  private abort = new AbortController();
  private loopPromise: Promise<void> | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private app: any = null;

  private constructor(
    private readonly options: SpectrumListenerOptions,
    app: unknown,
  ) {
    this.app = app;
  }

  static async create(options: SpectrumListenerOptions): Promise<SpectrumListener> {
    const spectrum = (await import(/* @vite-ignore */ "spectrum-ts")) as {
      Spectrum: (opts: unknown) => Promise<unknown>;
    };
    const { imessage } = (await import(
      /* @vite-ignore */ "spectrum-ts/providers/imessage"
    )) as { imessage: { config: (opts?: unknown) => unknown } };

    let app: unknown;
    if (options.mode === "spectrum-local") {
      const { terminal } = (await import(
        /* @vite-ignore */ "spectrum-ts/providers/terminal"
      )) as { terminal: { config: () => unknown } };
      app = await spectrum.Spectrum({
        providers: [imessage.config({ local: true }), terminal.config()],
      });
      logger.info("Spectrum listener: local iMessage mode (Messages.app DB)");
    } else {
      if (!options.projectId || !options.projectSecret) {
        throw new Error(
          "spectrum-cloud inbound requires PROJECT_ID and PROJECT_SECRET",
        );
      }
      app = await spectrum.Spectrum({
        projectId: options.projectId,
        projectSecret: options.projectSecret,
        providers: [imessage.config()],
      });
      logger.info("Spectrum listener: cloud iMessage mode");
    }

    return new SpectrumListener(options, app);
  }

  async start(): Promise<void> {
    if (this.loopPromise) return;
    this.loopPromise = this.runLoop();
  }

  private async runLoop(): Promise<void> {
    const messages = this.app?.messages;
    if (!messages || typeof messages[Symbol.asyncIterator] !== "function") {
      throw new Error("Spectrum app.messages async iterator unavailable");
    }

    logger.info("Spectrum listener: watching for inbound group messages");

    try {
      for await (const entry of messages) {
        if (this.abort.signal.aborted) break;
        const tuple = Array.isArray(entry) ? entry : null;
        if (!tuple || tuple.length < 2) continue;
        const [space, message] = tuple;
        const inbound = toInboundMessage(space, message);
        if (!inbound) continue;

        logger.info(
          { chat_guid: inbound.chatGuid, message_id: inbound.messageId },
          "inbound iMessage text",
        );
        void Promise.resolve(this.options.onInbound(inbound)).catch((err) =>
          logger.error({ err, chat_guid: inbound.chatGuid }, "inbound handler failed"),
        );
      }
    } catch (err) {
      if (!this.abort.signal.aborted) {
        logger.error(
          { err },
          "Spectrum listener stopped — grant Full Disk Access to your terminal if using local mode",
        );
        throw err;
      }
    }
  }

  async stop(): Promise<void> {
    this.abort.abort();
    if (this.loopPromise) {
      await this.loopPromise.catch(() => undefined);
      this.loopPromise = null;
    }
    if (typeof this.app?.close === "function") {
      await this.app.close();
    }
  }
}

export async function startSpectrumInbound(
  mode: InboundMode,
  onInbound: (message: InboundMessage) => void | Promise<void>,
  creds: { projectId?: string; projectSecret?: string },
): Promise<InboundHandle | null> {
  if (mode !== "spectrum-local" && mode !== "spectrum-cloud") return null;
  const listener = await SpectrumListener.create({
    mode,
    projectId: creds.projectId,
    projectSecret: creds.projectSecret,
    onInbound,
  });
  await listener.start();
  return listener;
}
