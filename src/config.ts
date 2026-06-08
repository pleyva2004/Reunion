import "dotenv/config";

function num(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export type PhotonMode = "mock" | "real";

/** How inbound group-chat messages reach PhotonConnector. */
export type InboundMode =
  | "disabled"
  | "spectrum-local"
  | "spectrum-cloud"
  | "webhook";

export function resolveInboundMode(
  env: NodeJS.ProcessEnv = process.env,
): InboundMode {
  const raw = env.INBOUND_MODE?.trim().toLowerCase();
  if (raw === "disabled" || raw === "off" || raw === "none") return "disabled";
  if (raw === "spectrum-local" || raw === "local") return "spectrum-local";
  if (raw === "spectrum-cloud" || raw === "cloud") return "spectrum-cloud";
  if (raw === "webhook") return "webhook";

  if (env.SPECTRUM_SIGNING_SECRET) return "webhook";
  if (env.PHOTON_MODE === "real") {
    if (env.PROJECT_ID && env.PROJECT_SECRET) return "spectrum-cloud";
    return "spectrum-local";
  }
  return "disabled";
}

export interface AppConfig {
  port: number;
  photonMode: PhotonMode;
  inboundMode: InboundMode;
  imessage: {
    serverUrl: string;
    apiKey: string | undefined;
    grpcAddress: string | undefined;
    grpcToken: string | undefined;
    grpcTls: boolean;
    devChatGuid: string | undefined;
  };
  spectrum: {
    signingSecret: string | undefined;
    projectId: string | undefined;
    projectSecret: string | undefined;
  };
  intentConfidenceThreshold: number;
  completionTimeoutMs: number;
  butterbase: {
    appId: string | undefined;
    apiKey: string | undefined;
    baseUrl: string | undefined;
  };
}

export const config: AppConfig = {
  port: num(process.env.PORT, 3000),
  photonMode: process.env.PHOTON_MODE === "real" ? "real" : "mock",
  inboundMode: resolveInboundMode(),
  imessage: {
    serverUrl: process.env.IMESSAGE_SERVER_URL ?? "http://localhost:1234",
    apiKey: process.env.IMESSAGE_API_KEY || undefined,
    grpcAddress: process.env.IMESSAGE_GRPC_ADDRESS || undefined,
    grpcToken: process.env.IMESSAGE_GRPC_TOKEN || undefined,
    grpcTls: process.env.IMESSAGE_GRPC_TLS === "true",
    devChatGuid: process.env.DEV_CHAT_GUID || undefined,
  },
  spectrum: {
    signingSecret: process.env.SPECTRUM_SIGNING_SECRET || undefined,
    projectId: process.env.PROJECT_ID || undefined,
    projectSecret: process.env.PROJECT_SECRET || undefined,
  },
  intentConfidenceThreshold: num(process.env.INTENT_CONFIDENCE_THRESHOLD, 0.6),
  completionTimeoutMs: num(process.env.COMPLETION_TIMEOUT_MS, 24 * 60 * 60 * 1000),
  butterbase: {
    appId: process.env.BUTTERBASE_APP_ID || undefined,
    apiKey: process.env.BUTTERBASE_API_KEY || undefined,
    baseUrl: process.env.BUTTERBASE_BASE_URL || undefined,
  },
};

export const SPECTRUM_SIGNATURE_TOLERANCE_SEC = 5 * 60;
