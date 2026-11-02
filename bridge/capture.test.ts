import { describe, expect, it } from "vitest";
import { Capture, type CaptureEvent } from "./capture";

function setup() {
  let time = 0;
  const events: CaptureEvent[] = [];
  const capture = new Capture((e) => events.push(e), () => time);
  const send = (name: string, data: unknown) =>
    capture.handleMessage(JSON.stringify({ event: "property-change", name, data }));
  return { capture, events, send, advance: (ms: number) => (time += ms) };
}

describe("Capture", () => {
  it("only counts time while actually playing", () => {
    const { capture, send, advance } = setup();
    advance(5000);
    send("core-idle", false);
    advance(1000);
    send("core-idle", true);
    advance(9000);
    send("core-idle", false);
    advance(500);
    expect(capture.snapshot().activeMs).toBe(1500);
    expect(capture.snapshot().playing).toBe(true);
  });

  it("stops counting when mpv disconnects", () => {
    const { capture, send, advance } = setup();
    capture.setConnected(true);
    send("core-idle", false);
    advance(1000);
    capture.setConnected(false);
    advance(1000);
    expect(capture.snapshot()).toMatchObject({ activeMs: 1000, playing: false, connected: false });
  });

  it("drops blank and consecutive duplicate lines and joins multi-line subs", () => {
    const { capture, send } = setup();
    send("sub-text", "こんにちは\n世界");
    send("sub-text", "");
    send("sub-text", "こんにちは 世界");
    send("sub-text", null);
    send("sub-text", "またね");
    expect(capture.snapshot().lines.map((l) => l.text)).toEqual(["こんにちは 世界", "またね"]);
  });

  it("keeps the last title when mpv reports none", () => {
    const { capture, send } = setup();
    send("media-title", "Frieren 03");
    send("media-title", null);
    expect(capture.snapshot().title).toBe("Frieren 03");
  });

  it("resets time and lines but keeps counting if still playing", () => {
    const { capture, send, advance } = setup();
    send("core-idle", false);
    send("sub-text", "一");
    advance(1000);
    capture.reset();
    advance(200);
    expect(capture.snapshot()).toMatchObject({ activeMs: 200, lines: [], playing: true });
  });

  it("removes a single line by id, and ids are not reused", () => {
    const { capture, send } = setup();
    send("sub-text", "一");
    send("sub-text", "二");
    capture.removeLine(1);
    send("sub-text", "三");
    expect(capture.snapshot().lines).toEqual([{ id: 2, text: "二" }, { id: 3, text: "三" }]);
  });

  it("ignores malformed and unrelated messages", () => {
    const { capture, events } = setup();
    capture.handleMessage("not json");
    capture.handleMessage(JSON.stringify({ request_id: 0, error: "success" }));
    expect(events).toEqual([]);
    expect(capture.snapshot().lines).toEqual([]);
  });
});
