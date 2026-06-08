export async function probeImessageServer(serverUrl: string): Promise<boolean> {
  try {
    const res = await fetch(serverUrl, { signal: AbortSignal.timeout(2000) });
    return res.ok || res.status < 500;
  } catch {
    return false;
  }
}

export function pollSendBlockedMessage(serverUrl: string): string {
  return (
    `Cannot send native iMessage polls — no reachable iMessage server at ${serverUrl}.\n\n` +
    "Native polls require one of:\n" +
    "  1. Local Advanced iMessage Server on IMESSAGE_SERVER_URL (default http://localhost:1234)\n" +
    "  2. gRPC credentials: IMESSAGE_GRPC_ADDRESS + IMESSAGE_GRPC_TOKEN\n" +
    "  3. Photon cloud: PROJECT_ID + PROJECT_SECRET (then use spectrum cloud inbound)\n\n" +
    "Run `npm run setup:photon` to check prerequisites."
  );
}
