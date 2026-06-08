import { describe, it, expect } from "vitest";
import { toInboundMessage } from "./inbound-message.js";

describe("toInboundMessage", () => {
  const space = { id: "iMessage;+;chat123456" };

  it("maps inbound text messages", () => {
    const result = toInboundMessage(space, {
      id: "msg-1",
      direction: "inbound",
      content: { type: "text", text: "Let's plan a trip to Tahoe" },
    });
    expect(result).toEqual({
      messageId: "msg-1",
      chatGuid: "iMessage;+;chat123456",
      text: "Let's plan a trip to Tahoe",
      platform: "imessage",
    });
  });

  it("ignores outbound messages", () => {
    expect(
      toInboundMessage(space, {
        id: "msg-2",
        direction: "outbound",
        content: { type: "text", text: "hi" },
      }),
    ).toBeNull();
  });

  it("ignores non-text content", () => {
    expect(
      toInboundMessage(space, {
        id: "msg-3",
        direction: "inbound",
        content: { type: "attachment" },
      }),
    ).toBeNull();
  });

  it("ignores empty text", () => {
    expect(
      toInboundMessage(space, {
        id: "msg-4",
        direction: "inbound",
        content: { type: "text", text: "   " },
      }),
    ).toBeNull();
  });
});
