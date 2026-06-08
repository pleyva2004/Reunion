import { POLL_FLOW_TABLES } from "./schema.js";

export interface ButterbaseConfig {
  appId: string;
  apiKey: string;
  baseUrl: string;
}

type Row = Record<string, unknown>;

/** Subset of Butterbase REST operations used by ButterbaseStore. */
export interface ButterbaseDataClient {
  list(table: string, query?: Record<string, string>): Promise<Row[]>;
  insert(table: string, row: Row): Promise<Row>;
  patch(table: string, id: string, partial: Row): Promise<void>;
  patchWhere(table: string, query: Record<string, string>, partial: Row): Promise<void>;
}

export class ButterbaseClient implements ButterbaseDataClient {
  constructor(private readonly config: ButterbaseConfig) {}

  async ensurePollFlowSchema(): Promise<void> {
    const current = await this.getSchema();
    const existingTables =
      (current.schema as { tables?: Record<string, unknown> } | undefined)?.tables ?? {};
    const body = {
      schema: {
        tables: {
          ...existingTables,
          ...POLL_FLOW_TABLES,
        },
      },
      name: "create_poll_flow_tables",
      dry_run: false,
    };
    const res = await this.request("POST", "/schema/apply", body);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Butterbase schema apply failed (${res.status}): ${text}`);
    }
  }

  async getRealtimeConfig(): Promise<{
    tables: string[];
    websocket_url: string;
    active_connection: boolean;
  }> {
    const res = await this.request("GET", "/realtime/config");
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Butterbase get realtime config failed (${res.status}): ${body}`);
    }
    const data = (await res.json()) as {
      tables?: Array<string | { table_name: string; enabled?: boolean }>;
      websocket_url?: string;
      active_connection?: boolean;
    };
    const tableNames = (data.tables ?? []).map((t) =>
      typeof t === "string" ? t : t.table_name,
    );
    return {
      tables: tableNames,
      websocket_url: data.websocket_url ?? `${this.config.baseUrl.replace(/\/$/, "")}/realtime`,
      active_connection: data.active_connection ?? false,
    };
  }

  /**
   * Best-effort: ensure intent_events is in realtime config.
   * Full configure requires Butterbase MCP `configure_realtime` when REST is unavailable.
   */
  async ensureIntentEventsRealtime(): Promise<{ enabled: boolean; tables: string[] }> {
    const config = await this.getRealtimeConfig();
    if (config.tables.includes("intent_events")) {
      return { enabled: true, tables: config.tables };
    }

    const attempts: Array<{ method: string; path: string; body: unknown }> = [
      { method: "POST", path: "/realtime/configure", body: { tables: ["intent_events"] } },
      { method: "PUT", path: "/realtime/config", body: { tables: ["intent_events"] } },
    ];

    for (const attempt of attempts) {
      const res = await this.request(attempt.method, attempt.path, attempt.body);
      if (res.ok) {
        const updated = await this.getRealtimeConfig();
        return {
          enabled: updated.tables.includes("intent_events"),
          tables: updated.tables,
        };
      }
    }

    return { enabled: false, tables: config.tables };
  }

  async listIntentEvents(query?: Record<string, string>): Promise<Row[]> {
    return this.list("intent_events", query);
  }

  async getSchema(): Promise<{ schema?: { tables?: Record<string, unknown> } }> {
    const res = await this.request("GET", "/schema");
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Butterbase get schema failed (${res.status}): ${body}`);
    }
    return (await res.json()) as { schema?: { tables?: Record<string, unknown> } };
  }

  async list(table: string, query?: Record<string, string>): Promise<Row[]> {
    const qs = query ? `?${new URLSearchParams(query).toString()}` : "";
    const res = await this.request("GET", `/${table}${qs}`);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Butterbase list ${table} failed (${res.status}): ${body}`);
    }
    const data = (await res.json()) as Row[] | { data?: Row[] };
    return Array.isArray(data) ? data : (data.data ?? []);
  }

  async insert(table: string, row: Row): Promise<Row> {
    const res = await this.request("POST", `/${table}`, row);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Butterbase insert ${table} failed (${res.status}): ${body}`);
    }
    const data = (await res.json()) as Row | Row[];
    return Array.isArray(data) ? (data[0] ?? row) : data;
  }

  async patch(table: string, id: string, partial: Row): Promise<void> {
    const res = await this.request("PATCH", `/${table}/${encodeURIComponent(id)}`, partial);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Butterbase patch ${table}/${id} failed (${res.status}): ${body}`);
    }
  }

  async patchWhere(table: string, query: Record<string, string>, partial: Row): Promise<void> {
    const qs = new URLSearchParams(query).toString();
    const res = await this.request("PATCH", `/${table}?${qs}`, partial);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Butterbase patch ${table} failed (${res.status}): ${body}`);
    }
  }

  async delete(table: string, id: string): Promise<void> {
    const res = await this.request("DELETE", `/${table}/${encodeURIComponent(id)}`);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Butterbase delete ${table}/${id} failed (${res.status}): ${body}`);
    }
  }

  async deleteWhere(table: string, query: Record<string, string>): Promise<void> {
    const qs = new URLSearchParams(query).toString();
    const res = await this.request("DELETE", `/${table}?${qs}`);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Butterbase delete ${table} failed (${res.status}): ${body}`);
    }
  }

  private request(method: string, path: string, body?: unknown): Promise<Response> {
    const url = `${this.config.baseUrl.replace(/\/$/, "")}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.config.apiKey}`,
    };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    return fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }
}
