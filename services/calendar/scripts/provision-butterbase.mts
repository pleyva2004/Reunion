/**
 * Provision `participants` and `oauth_tokens` tables in Butterbase.
 *
 * Usage:
 *   pnpm tsx --env-file-if-exists=.env --env-file-if-exists=.env.local scripts/provision-butterbase.ts
 *
 * Add --dry-run to preview SQL without applying.
 */
import { createPatchedClient } from '../lib/butterbase';

const required = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
};

const bb = createPatchedClient({
  appId: required('BUTTERBASE_APP_ID'),
  apiUrl: process.env.BUTTERBASE_BASE_URL ?? 'https://api.butterbase.ai',
  apiKey: required('BUTTERBASE_API_KEY'),
});

const schema = {
  tables: {
    participants: {
      columns: {
        id: { type: 'text' },
        phone: { type: 'text', unique: true },
        google_email: { type: 'text', nullable: true },
        created_at: { type: 'text' },
        updated_at: { type: 'text' },
      },
      indexes: {
        participants_phone_idx: { columns: ['phone'], unique: true },
      },
    },
    oauth_tokens: {
      columns: {
        participant_id: { type: 'text', unique: true },
        access_token: { type: 'text' },
        refresh_token: { type: 'text', nullable: true },
        expires_at: { type: 'bigint' },
        scope: { type: 'text' },
        updated_at: { type: 'text' },
      },
      indexes: {
        oauth_tokens_pid_idx: { columns: ['participant_id'], unique: true },
      },
    },
  },
  // Clean up the throwaway _probe table created during endpoint discovery.
  _drop: ['_probe'],
};

const dryRun = process.argv.includes('--dry-run');

async function main() {
  const op = dryRun
    ? await bb.admin.schema.dryRun(schema)
    : await bb.admin.schema.apply(schema, { name: 'create_participants_and_oauth_tokens' });

  if (op.error) {
    console.error('Schema operation failed:', op.error);
    process.exit(1);
  }

  console.log(dryRun ? 'Dry-run preview:' : 'Migration applied:');
  console.log(JSON.stringify(op.data, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
