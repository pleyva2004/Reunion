import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from './config';

export interface StatePayload {
  tripId: string;
  participantId: string;
  exp: number; // epoch ms
}

const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 minutes — covers the round-trip through Google

function b64urlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

function sign(payload: string): string {
  return b64urlEncode(createHmac('sha256', config.stateSigningKey).update(payload).digest());
}

export function signState(input: { tripId: string; participantId: string; ttlMs?: number }): string {
  const payload: StatePayload = {
    tripId: input.tripId,
    participantId: input.participantId,
    exp: Date.now() + (input.ttlMs ?? DEFAULT_TTL_MS),
  };
  const body = b64urlEncode(Buffer.from(JSON.stringify(payload)));
  return `${body}.${sign(body)}`;
}

export class InvalidStateError extends Error {
  constructor(reason: string) {
    super(`invalid state: ${reason}`);
  }
}

export function verifyState(token: string): StatePayload {
  const parts = token.split('.');
  if (parts.length !== 2) throw new InvalidStateError('malformed');
  const [body, sig] = parts;

  const expected = sign(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new InvalidStateError('bad signature');
  }

  let payload: StatePayload;
  try {
    payload = JSON.parse(b64urlDecode(body).toString('utf8'));
  } catch {
    throw new InvalidStateError('bad payload');
  }

  if (
    typeof payload.tripId !== 'string' ||
    typeof payload.participantId !== 'string' ||
    typeof payload.exp !== 'number'
  ) {
    throw new InvalidStateError('bad shape');
  }
  if (Date.now() > payload.exp) throw new InvalidStateError('expired');
  return payload;
}
