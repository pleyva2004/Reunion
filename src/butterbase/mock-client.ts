type Row = Record<string, unknown>;

const TABLE_PRIMARY_KEY: Record<string, string> = {
  trips: "id",
  polls: "id",
  chat_groups: "chat_guid",
};

import type { ButterbaseDataClient } from "./api.js";

/**
 * In-memory Butterbase REST stand-in for integration tests.
 * Implements the subset of ButterbaseClient used by ButterbaseStore.
 */
export class MockButterbaseClient implements ButterbaseDataClient {
  private readonly tables = new Map<string, Row[]>();

  readonly appliedMigrations: unknown[] = [];

  async ensurePollFlowSchema(): Promise<void> {
    for (const table of [
      "trips",
      "polls",
      "poll_votes",
      "chat_groups",
      "trip_participants",
    ]) {
      if (!this.tables.has(table)) this.tables.set(table, []);
    }
    this.appliedMigrations.push({ name: "create_poll_flow_tables" });
  }

  async list(table: string, query?: Record<string, string>): Promise<Row[]> {
    const rows = this.tables.get(table) ?? [];
    if (!query || Object.keys(query).length === 0) return [...rows];
    return rows.filter((row) =>
      Object.entries(query).every(([col, filter]) => matchFilter(row[col], filter)),
    );
  }

  async insert(table: string, row: Row): Promise<Row> {
    const rows = this.tables.get(table) ?? [];
    this.tables.set(table, rows);
    rows.push({ ...row });
    return row;
  }

  async patch(table: string, id: string, partial: Row): Promise<void> {
    const pk = TABLE_PRIMARY_KEY[table] ?? "id";
    const rows = this.tables.get(table) ?? [];
    const row = rows.find((r) => String(r[pk]) === id);
    if (!row) throw new Error(`row not found: ${table}/${id}`);
    Object.assign(row, partial);
  }

  async patchWhere(
    table: string,
    query: Record<string, string>,
    partial: Row,
  ): Promise<void> {
    const rows = this.tables.get(table) ?? [];
    for (const row of rows) {
      if (Object.entries(query).every(([col, filter]) => matchFilter(row[col], filter))) {
        Object.assign(row, partial);
      }
    }
  }

  /** Test helper: read raw table rows. */
  snapshot(table: string): Row[] {
    return [...(this.tables.get(table) ?? [])];
  }
}

function matchFilter(value: unknown, filter: string): boolean {
  if (!filter.startsWith("eq.")) return String(value) === filter;
  return String(value) === filter.slice(3);
}
