import { redirect } from 'next/navigation';
import { type NextRequest } from 'next/server';
import { buildConsentUrl } from '@/lib/google';
import { InvalidStateError, verifyState } from '@/lib/state';

export async function GET(request: NextRequest) {
  const signed = request.nextUrl.searchParams.get('s');
  if (!signed) {
    return new Response('missing state token', { status: 400 });
  }

  try {
    verifyState(signed);
  } catch (e) {
    if (e instanceof InvalidStateError) {
      return new Response(e.message, { status: 400 });
    }
    throw e;
  }

  // Echo the same signed token back through Google's state param so we can
  // re-verify it (and recover tripId + participantId) at /oauth/callback.
  redirect(buildConsentUrl(signed));
}
