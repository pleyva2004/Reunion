/**
 * Check Photon / iMessage prerequisites and print next steps.
 *
 * Usage: npm run setup:photon
 */
import "dotenv/config";
import { execSync } from "node:child_process";
import { config, resolveInboundMode } from "../src/config.js";

function check(label: string, ok: boolean, hint: string): void {
  const mark = ok ? "✓" : "✗";
  console.log(`  ${mark} ${label}`);
  if (!ok) console.log(`      → ${hint}`);
}

async function probeUrl(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return res.ok || res.status < 500;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  console.log("\n=== Reunion Photon setup check ===\n");

  const isMac = process.platform === "darwin";
  check("macOS host", isMac, "iMessage requires macOS");

  let photonCli = false;
  try {
    execSync("photon --version", { stdio: "pipe" });
    photonCli = true;
  } catch {
    photonCli = false;
  }
  check(
    "Photon CLI installed",
    photonCli,
    "npm install -g @photon-ai/cli",
  );

  let photonAuth = false;
  if (photonCli) {
    try {
      execSync("photon whoami", { stdio: "pipe" });
      photonAuth = true;
    } catch {
      photonAuth = false;
    }
  }
  check(
    "Photon CLI authenticated",
    photonAuth,
    "photon login (for cloud Spectrum + webhook)",
  );

  check(
    "Butterbase configured",
    Boolean(config.butterbase.appId && config.butterbase.apiKey),
    "Set BUTTERBASE_APP_ID and BUTTERBASE_API_KEY in .env",
  );

  check(
    "PHOTON_MODE=real",
    config.photonMode === "real",
    "Set PHOTON_MODE=real in .env for live iMessage polls",
  );

  const hasGrpc =
    Boolean(config.imessage.grpcAddress) && Boolean(config.imessage.grpcToken);
  check(
    "gRPC iMessage credentials",
    hasGrpc,
    "Set IMESSAGE_GRPC_ADDRESS + IMESSAGE_GRPC_TOKEN for dedicated server polls",
  );

  const imessageServer = await probeUrl(`${config.imessage.serverUrl}/`);
  check(
    `iMessage server (${config.imessage.serverUrl})`,
    imessageServer || hasGrpc,
    "Start the Photon iMessage server for native polls (advanced-imessage-kit), or set gRPC creds",
  );

  check(
    "Spectrum cloud credentials",
    Boolean(config.spectrum.projectId && config.spectrum.projectSecret),
    "Set PROJECT_ID + PROJECT_SECRET, or use local inbound (no cloud needed)",
  );

  check(
    "Spectrum webhook secret",
    Boolean(config.spectrum.signingSecret),
    "Run npm run register:webhook after exposing /spectrum-webhook via ngrok",
  );

  const inbound = resolveInboundMode();
  console.log(`\n  Resolved inbound mode: ${inbound}`);

  console.log("\n=== Quick start (local, no Photon cloud) ===\n");
  console.log("  1. Grant Full Disk Access to Terminal/Cursor");
  console.log("  2. Add to .env:");
  console.log("       PHOTON_MODE=real");
  console.log("       INBOUND_MODE=spectrum-local");
  console.log("  3. npm run list:chats          # find your group chatGuid");
  console.log("  4. npm run send-poll:dev       # send a poll to the Dev group");
  console.log("  5. npm run dev:live            # listen + classify + poll");
  console.log("\n=== Cloud webhook path ===\n");
  console.log("  1. photon login");
  console.log("  2. photon projects create --name Reunion --spectrum");
  console.log("  3. Add PROJECT_ID + PROJECT_SECRET to .env");
  console.log("  4. ngrok http 3001");
  console.log("  5. WEBHOOK_URL=https://... npm run register:webhook");
  console.log("  6. INBOUND_MODE=webhook npm run dev");
  console.log();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
