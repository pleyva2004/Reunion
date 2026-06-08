import type { UserRoster } from "../contracts/types.js";
import { STAGES, stage } from "../observability/logger.js";

/**
 * XTrace: durable group-chat knowledge layer.
 *
 * Receives the terminal artifact (UserRoster) plus group context. This is the
 * knowledge handoff at the end of the flow; transactional state lives in
 * Butterbase. The interface is the seam to swap in the real XTrace client.
 */

export interface GroupContext {
  chatGuid: string;
  destination: string | null;
  timeframe: string | null;
  participants: string[];
}

export interface KnowledgeRecord {
  roster: UserRoster;
  context: GroupContext;
  writtenAt: string;
}

export interface Knowledge {
  writeRoster(roster: UserRoster, context: GroupContext): Promise<void>;
}

export class InMemoryKnowledge implements Knowledge {
  readonly records: KnowledgeRecord[] = [];

  async writeRoster(roster: UserRoster, context: GroupContext): Promise<void> {
    this.records.push({
      roster,
      context,
      writtenAt: new Date().toISOString(),
    });
    stage(STAGES.KNOWLEDGE_WRITTEN, {
      poll_id: roster.poll_id,
      trip_id: roster.trip_id,
      chat_guid: context.chatGuid,
      users: roster.users.length,
      complete: roster.complete,
    });
  }
}
