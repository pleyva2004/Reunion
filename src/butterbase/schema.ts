/**
 * Butterbase schema for the poll orchestration flow (trips, polls, votes).
 * Applied once on startup when Butterbase credentials are configured.
 *
 * Note: the live schema API does not accept `primary` on columns (use unique
 * indexes instead). ensurePollFlowSchema merges these tables into the current
 * app schema so existing tables are not dropped.
 */

export const POLL_FLOW_TABLES = {
  trips: {
    columns: {
      id: { type: "text", nullable: false },
      chat_guid: { type: "text", nullable: false, unique: true },
      destination: { type: "text" },
      timeframe: { type: "text" },
      created_at: { type: "text", nullable: false },
    },
    indexes: {
      trips_id_idx: { columns: ["id"], unique: true },
    },
  },
  polls: {
    columns: {
      id: { type: "text", nullable: false },
      trip_id: { type: "text", nullable: false },
      chat_guid: { type: "text", nullable: false },
      kind: { type: "text", nullable: false },
      title: { type: "text", nullable: false },
      options: { type: "text", nullable: false },
      trigger_message_id: { type: "text", nullable: false, unique: true },
      external_poll_guid: { type: "text" },
      participant_snapshot: { type: "text" },
      status: { type: "text", nullable: false },
      closed_at: { type: "text" },
      closed_reason: { type: "text" },
      created_at: { type: "text", nullable: false },
    },
    indexes: {
      polls_id_idx: { columns: ["id"], unique: true },
      polls_chat_kind_idx: { columns: ["chat_guid", "kind"] },
      polls_external_guid_idx: {
        columns: ["external_poll_guid"],
        unique: true,
      },
    },
  },
  poll_votes: {
    columns: {
      poll_id: { type: "text", nullable: false },
      participant_handle: { type: "text", nullable: false },
      option_identifier: { type: "text", nullable: false },
      option_text: { type: "text", nullable: false },
      voted_at: { type: "text", nullable: false },
    },
    indexes: {
      poll_votes_pk: {
        columns: ["poll_id", "participant_handle"],
        unique: true,
      },
    },
  },
  chat_groups: {
    columns: {
      chat_guid: { type: "text", nullable: false, unique: true },
      participants: { type: "text", nullable: false },
      created_at: { type: "text", nullable: false },
      updated_at: { type: "text", nullable: false },
    },
  },
  trip_participants: {
    columns: {
      trip_id: { type: "text", nullable: false },
      handle: { type: "text", nullable: false },
      status: { type: "text", nullable: false },
    },
    indexes: {
      trip_participants_pk: {
        columns: ["trip_id", "handle"],
        unique: true,
      },
    },
  },
} as const;

/** @deprecated use POLL_FLOW_TABLES; kept for tests referencing the migration name */
export const POLL_FLOW_MIGRATION = {
  schema: { tables: POLL_FLOW_TABLES },
  name: "create_poll_flow_tables",
  dry_run: false,
} as const;
