import { PLATFORM, type InboundMessage } from "../contracts/types.js";

/** Minimal Spectrum message shape for inbound mapping (avoids importing spectrum-ts in tests). */
export interface SpectrumInboundLike {
  id: string;
  direction: "inbound" | "outbound";
  content: { type: string; text?: string };
}

export interface SpectrumSpaceLike {
  id: string;
}

/** Map a Spectrum SDK message to the contract inbound shape. */
export function toInboundMessage(
  space: SpectrumSpaceLike,
  message: SpectrumInboundLike,
): InboundMessage | null {
  if (message.direction !== "inbound") return null;
  if (message.content.type !== "text" || !message.content.text?.trim()) return null;
  return {
    messageId: message.id,
    chatGuid: space.id,
    text: message.content.text,
    platform: PLATFORM,
  };
}
