/**
 * Usage:
 *   pnpm tsx scripts/seed-connect-link.ts <tripId> <phone>
 *
 * Creates (or reuses) a participant for the phone, then prints a signed connect link.
 * Use this to walk a fresh test user through the OAuth flow during M1 verification.
 */
import { buildConnectLink } from '../lib/connect-link';
import { getOrCreateParticipantByPhone } from '../lib/storage';

const [, , tripId, phone] = process.argv;
if (!tripId || !phone) {
  console.error('Usage: pnpm tsx scripts/seed-connect-link.ts <tripId> <phone>');
  process.exit(1);
}

async function main() {
  const p = await getOrCreateParticipantByPhone(phone);
  console.log(`participantId: ${p.id}`);
  console.log(`connect URL:   ${buildConnectLink(tripId, p.id)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
