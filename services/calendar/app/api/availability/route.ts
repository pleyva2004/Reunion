import { type NextRequest } from 'next/server';
import { config } from '@/lib/config';
import { buildConnectLink } from '@/lib/connect-link';
import {
  intersectFree,
  normalizeWindow,
  subtractBusy,
  type DateWindow,
  type Interval,
} from '@/lib/availability';
import { queryFreebusy, TokenRevokedError } from '@/lib/google';
import { getOrCreateParticipantByPhone } from '@/lib/storage';

interface InputParticipant {
  phone: string;
  plaintext?: unknown; // shape TBD with teammates
}

interface AvailabilityRequest {
  trip_id: string;
  window: DateWindow;
  participants: InputParticipant[];
}

interface OutputParticipant {
  phone: string;
  resolved: boolean;
  source: 'freebusy' | 'plaintext' | null;
  busy: Interval[];
  free: Interval[];
  needs_connect_link?: boolean;
  connect_url?: string;
}

export async function POST(request: NextRequest) {
  if (request.headers.get('x-internal-key') !== config.internalApiKey) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: AvailabilityRequest;
  try {
    body = (await request.json()) as AvailabilityRequest;
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  if (
    !body?.trip_id ||
    !body?.window?.start ||
    !body?.window?.end ||
    !Array.isArray(body?.participants)
  ) {
    return Response.json(
      { error: 'request must include trip_id, window.{start,end}, and participants[]' },
      { status: 400 },
    );
  }

  let isoWindow;
  try {
    isoWindow = normalizeWindow(body.window);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }

  const outputs = await Promise.all(
    body.participants.map((p) => resolveParticipant(p, body.trip_id, body.window, isoWindow)),
  );

  const common_free = intersectFree(outputs.filter((o) => o.resolved).map((o) => o.free));

  return Response.json({
    trip_id: body.trip_id,
    window: body.window,
    participants: outputs,
    common_free,
  });
}

async function resolveParticipant(
  input: InputParticipant,
  tripId: string,
  window: DateWindow,
  isoWindow: { startIso: string; endIso: string },
): Promise<OutputParticipant> {
  // Plaintext fallback — shape TBD with teammates. Currently a stub: presence of `plaintext`
  // marks the participant as resolved with empty busy (treat the entire window as free).
  if (input.plaintext) {
    return {
      phone: input.phone,
      resolved: true,
      source: 'plaintext',
      busy: [],
      free: subtractBusy(window, []),
    };
  }

  const participant = await getOrCreateParticipantByPhone(input.phone);

  try {
    const busy = await queryFreebusy(participant.id, {
      start: isoWindow.startIso,
      end: isoWindow.endIso,
    });
    return {
      phone: input.phone,
      resolved: true,
      source: 'freebusy',
      busy,
      free: subtractBusy(window, busy),
    };
  } catch (e) {
    if (e instanceof TokenRevokedError) {
      return {
        phone: input.phone,
        resolved: false,
        source: null,
        busy: [],
        free: [],
        needs_connect_link: true,
        connect_url: buildConnectLink(tripId, participant.id),
      };
    }
    throw e;
  }
}
