import { redirect } from 'next/navigation';
import { type NextRequest } from 'next/server';
import { config } from '@/lib/config';
import { exchangeCode } from '@/lib/google';
import { InvalidStateError, verifyState } from '@/lib/state';
import { getParticipantById, putTokens, updateParticipantEmail } from '@/lib/storage';

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const code = sp.get('code');
  const stateParam = sp.get('state');
  const oauthError = sp.get('error');

  if (oauthError) {
    return errorPage(`Google returned error: ${oauthError}`, 400);
  }
  if (!code || !stateParam) {
    return errorPage('missing code or state', 400);
  }

  let state;
  try {
    state = verifyState(stateParam);
  } catch (e) {
    if (e instanceof InvalidStateError) return errorPage(e.message, 400);
    throw e;
  }

  const participant = await getParticipantById(state.participantId);
  if (!participant) {
    return errorPage(`unknown participantId: ${state.participantId}`, 400);
  }

  let result;
  try {
    result = await exchangeCode(code);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return errorPage(`code exchange failed: ${msg}`, 502);
  }

  if (!config.allowedTestEmails.has(result.email.toLowerCase())) {
    return errorPage(
      `email ${result.email} is not on the test-user allowlist. Add it to ALLOWED_TEST_EMAILS.`,
      403,
    );
  }

  await updateParticipantEmail(participant.id, result.email);
  await putTokens({
    participant_id: participant.id,
    access_token: result.access_token,
    refresh_token: result.refresh_token,
    expires_at: result.expires_at,
    scope: result.scope,
    updated_at: new Date().toISOString(),
  });

  redirect('/oauth/done');
}

function errorPage(message: string, status: number): Response {
  const html = `<!doctype html><meta charset="utf-8"><title>Connect failed</title>
<body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem">
<h1>Couldn't connect calendar</h1>
<p>${escapeHtml(message)}</p>
</body>`;
  return new Response(html, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
