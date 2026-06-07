import { config } from './config';
import { signState } from './state';

export function buildConnectLink(tripId: string, participantId: string): string {
  const s = signState({ tripId, participantId });
  return `${config.appUrl}/connect?s=${encodeURIComponent(s)}`;
}
