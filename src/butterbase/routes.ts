import type { FastifyInstance } from "fastify";
import {
  CreateAvailabilityPollResponseSchema,
  IntentClassificationResultSchema,
  PollVoteEventSchema,
} from "../contracts/types.js";
import type { ButterbaseIngress } from "./ingress-client.js";
import { STAGES, stage } from "../observability/logger.js";

/**
 * HTTP ingress routes for Butterbase poll creation and vote persistence.
 *
 * Photon POSTs classified messages here in a split deployment; the monolithic
 * server also registers these routes for contract testing.
 */
export function registerButterbaseRoutes(
  app: FastifyInstance,
  ingress: ButterbaseIngress,
): void {
  app.post("/butterbase/intent-classified", async (request, reply) => {
    const body = request.body as {
      classification?: unknown;
      participant_handles?: unknown;
      poll_title?: string;
    };
    const parsed = IntentClassificationResultSchema.safeParse(body.classification);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid classification" });
    }
    if (!Array.isArray(body.participant_handles)) {
      return reply.code(400).send({ error: "participant_handles required" });
    }
    const handles = body.participant_handles.filter(
      (h): h is string => typeof h === "string",
    );

    stage(STAGES.INTENT_FORWARDED, {
      message_id: parsed.data.message_id,
      chat_guid: parsed.data.chat_guid,
    });

    const outcome = await ingress.acceptClassification({
      classification: parsed.data,
      participant_handles: handles,
      poll_title: body.poll_title,
    });
    return reply.code(outcome.status === "created" ? 201 : 200).send(outcome);
  });

  app.post("/butterbase/poll-sent", async (request, reply) => {
    const parsed = CreateAvailabilityPollResponseSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid poll-sent payload" });
    }
    await ingress.recordPollSent(parsed.data);
    return reply.code(200).send({ ok: true });
  });

  app.post("/butterbase/poll-votes", async (request, reply) => {
    const parsed = PollVoteEventSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid poll vote event" });
    }
    const normalized = await ingress.recordVote(parsed.data);
    return reply.code(200).send({ votes: normalized });
  });
}
