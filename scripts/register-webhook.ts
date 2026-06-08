/**
 * Register the Reunion /spectrum-webhook endpoint with Spectrum Cloud.
 *
 * Prerequisites:
 *   - PROJECT_ID and PROJECT_SECRET in .env (from app.photon.codes or `photon projects create`)
 *   - A public HTTPS URL (e.g. ngrok: ngrok http 3001)
 *
 * Usage:
 *   WEBHOOK_URL=https://abcd.ngrok-free.app npm run register:webhook
 */
import "dotenv/config";

const projectId = process.env.PROJECT_ID;
const projectSecret = process.env.PROJECT_SECRET;
const webhookUrl =
  process.env.WEBHOOK_URL ??
  (process.argv[2] ? `${process.argv[2].replace(/\/$/, "")}/spectrum-webhook` : undefined);

async function main(): Promise<void> {
  if (!projectId || !projectSecret) {
    console.error(
      "Missing PROJECT_ID or PROJECT_SECRET.\n" +
        "  Create a project: photon login && photon projects create --name Reunion --spectrum\n" +
        "  Or sign up at https://app.photon.codes\n",
    );
    process.exit(1);
  }
  if (!webhookUrl) {
    console.error(
      "Usage: WEBHOOK_URL=https://your-host npm run register:webhook\n" +
        "   or: npm run register:webhook -- https://your-host\n",
    );
    process.exit(1);
  }

  const url = webhookUrl.endsWith("/spectrum-webhook")
    ? webhookUrl
    : `${webhookUrl.replace(/\/$/, "")}/spectrum-webhook`;

  const auth = Buffer.from(`${projectId}:${projectSecret}`).toString("base64");
  const res = await fetch(
    `https://spectrum.photon.codes/projects/${projectId}/webhooks/`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ webhookUrl: url }),
    },
  );

  const body = await res.text();
  if (!res.ok) {
    console.error(`Registration failed (${res.status}): ${body}`);
    process.exit(1);
  }

  let parsed: { signingSecret?: string; id?: string } = {};
  try {
    parsed = JSON.parse(body) as typeof parsed;
  } catch {
    console.log(body);
  }

  console.log("\nWebhook registered:", url);
  if (parsed.signingSecret) {
    console.log("\nAdd to .env (shown once — save it now):\n");
    console.log(`SPECTRUM_SIGNING_SECRET=${parsed.signingSecret}`);
    console.log(`INBOUND_MODE=webhook`);
  }
  if (parsed.id) {
    console.log(`\nWebhook id: ${parsed.id}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
