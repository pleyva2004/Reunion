import { google } from 'googleapis';
import { config, GOOGLE_FREEBUSY_SCOPE } from './config';
import { deleteTokens, getTokens, putTokens, type OAuthTokens } from './storage';

export class TokenRevokedError extends Error {
  constructor(message = 'token revoked') {
    super(message);
    this.name = 'TokenRevokedError';
  }
}

function newClient() {
  return new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    config.google.redirectUri,
  );
}

export function buildConsentUrl(state: string): string {
  return newClient().generateAuthUrl({
    access_type: 'offline',
    scope: [GOOGLE_FREEBUSY_SCOPE, 'openid', 'email'],
    prompt: 'consent',
    state,
    include_granted_scopes: true,
  });
}

export interface ExchangeResult {
  access_token: string;
  refresh_token: string | null;
  expires_at: number;
  scope: string;
  email: string;
}

export async function exchangeCode(code: string): Promise<ExchangeResult> {
  const c = newClient();
  const { tokens } = await c.getToken(code);
  if (!tokens.access_token) throw new Error('no access_token in code exchange');
  if (!tokens.id_token) throw new Error('no id_token (request openid scope)');

  const ticket = await c.verifyIdToken({
    idToken: tokens.id_token,
    audience: config.google.clientId,
  });
  const email = ticket.getPayload()?.email;
  if (!email) throw new Error('id_token has no email claim');

  return {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token ?? null,
    expires_at: tokens.expiry_date ?? Date.now() + 3600_000,
    scope: tokens.scope ?? '',
    email,
  };
}

export interface FreeBusyInterval {
  start: string;
  end: string;
}

export async function queryFreebusy(
  participantId: string,
  window: { start: string; end: string },
): Promise<FreeBusyInterval[]> {
  const stored = await getTokens(participantId);
  if (!stored) throw new TokenRevokedError('no tokens stored');

  const c = newClient();
  c.setCredentials({
    access_token: stored.access_token,
    refresh_token: stored.refresh_token ?? undefined,
    expiry_date: stored.expires_at,
    scope: stored.scope,
  });

  // Refresh if expired (60s buffer)
  if (stored.expires_at - 60_000 < Date.now()) {
    try {
      const { credentials } = await c.refreshAccessToken();
      const updated: OAuthTokens = {
        participant_id: stored.participant_id,
        access_token: credentials.access_token ?? stored.access_token,
        refresh_token: credentials.refresh_token ?? stored.refresh_token,
        expires_at: credentials.expiry_date ?? Date.now() + 3600_000,
        scope: credentials.scope ?? stored.scope,
        updated_at: new Date().toISOString(),
      };
      await putTokens(updated);
      c.setCredentials({
        access_token: updated.access_token,
        refresh_token: updated.refresh_token ?? undefined,
        expiry_date: updated.expires_at,
        scope: updated.scope,
      });
    } catch (e) {
      if (isInvalidGrant(e)) {
        await deleteTokens(participantId);
        throw new TokenRevokedError('refresh returned invalid_grant');
      }
      throw e;
    }
  }

  const cal = google.calendar({ version: 'v3', auth: c });
  const res = await cal.freebusy.query({
    requestBody: {
      timeMin: window.start,
      timeMax: window.end,
      items: [{ id: 'primary' }],
    },
  });
  const errors = res.data.calendars?.primary?.errors;
  if (errors && errors.length > 0) {
    // e.g. authError, notFound — surface as revoked so the engine emits a connect link
    throw new TokenRevokedError(`freebusy returned errors: ${JSON.stringify(errors)}`);
  }
  const busy = res.data.calendars?.primary?.busy ?? [];
  return busy
    .filter((b): b is { start: string; end: string } => !!b.start && !!b.end)
    .map((b) => ({ start: b.start, end: b.end }));
}

function isInvalidGrant(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const anyE = e as { message?: unknown; response?: { data?: { error?: unknown } } };
  if (typeof anyE.message === 'string' && anyE.message.includes('invalid_grant')) return true;
  if (anyE.response?.data?.error === 'invalid_grant') return true;
  return false;
}
