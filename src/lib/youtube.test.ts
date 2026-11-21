import { describe, expect, it } from "vitest";
import { addRecent, parseVideoId } from "./youtube";

describe("parseVideoId", () => {
  it.each([
    ["dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/watch?list=PL1&v=dQw4w9WgXcQ&t=42s", "dQw4w9WgXcQ"],
    ["youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://m.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ?si=abc", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/live/dQw4w9WgXcQ?feature=share", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["  https://youtu.be/dQw4w9WgXcQ  ", "dQw4w9WgXcQ"],
  ])("reads %s", (input, id) => {
    expect(parseVideoId(input)).toBe(id);
  });

  it.each([
    "",
    "hello",
    "https://www.youtube.com/",
    "https://www.youtube.com/watch?v=short",
    "https://www.youtube.com/@channel",
    "https://example.com/watch?v=dQw4w9WgXcQ",
  ])("rejects %s", (input) => {
    expect(parseVideoId(input)).toBeNull();
  });
});

describe("addRecent", () => {
  it("moves a repeat to the front and keeps its title if the new one is blank", () => {
    const list = [{ id: "a", title: "A" }, { id: "b", title: "B" }];
    expect(addRecent(list, { id: "b", title: "" })).toEqual([{ id: "b", title: "B" }, { id: "a", title: "A" }]);
  });

  it("keeps at most eight", () => {
    const list = Array.from({ length: 8 }, (_, i) => ({ id: String(i), title: "" }));
    expect(addRecent(list, { id: "new", title: "" })).toHaveLength(8);
  });
});
