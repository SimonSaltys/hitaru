import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { alignmentFile, readAlignment, shiftCues } from "./alignment.ts";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hitaru-alignment-"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const cues = [
  { start: 1, end: 2, text: "はい" },
  { start: 3, end: 4, text: "いいえ" },
];
const words = [{ from: 0, to: 2, start: 1.6, end: 1.9 }];

describe("shiftCues", () => {
  it("moves every line by the timing adjustment", () => {
    expect(shiftCues(cues, 0.5)).toEqual([
      { start: 1.5, end: 2.5, text: "はい" },
      { start: 3.5, end: 4.5, text: "いいえ" },
    ]);
    expect(shiftCues(cues, -1)[0]).toMatchObject({ start: 0, end: 1 });
  });

  it("leaves the lines alone with no adjustment", () => {
    expect(shiftCues(cues, 0)).toBe(cues);
  });
});

describe("readAlignment", () => {
  it("returns the timing the words were made with", () => {
    const video = path.join(dir, "E1.mkv");
    fs.writeFileSync(
      alignmentFile(video),
      JSON.stringify({
        offset: 0.5,
        cues: [
          { text: "はい", status: "aligned", words },
          { text: "いいえ", status: "failed", words: [] },
        ],
      }),
    );
    expect(readAlignment(video, cues)).toEqual({ cues: [words, null], offset: 0.5 });
  });

  it("treats files from before the timing was saved as made at 0", () => {
    const video = path.join(dir, "E2.mkv");
    fs.writeFileSync(alignmentFile(video), JSON.stringify({ cues: [{ text: "はい", status: "aligned", words }] }));
    expect(readAlignment(video, cues)).toEqual({ cues: [words, null], offset: 0 });
  });

  it("reports nothing when there's no file", () => {
    expect(readAlignment(path.join(dir, "missing.mkv"), cues)).toBeNull();
  });
});
