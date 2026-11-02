import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listEpisodes, resolveEpisode, subtitlesFor } from "./library";

let root: string;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "hitaru-library-"));
  const season = path.join(root, "Yuru Camp△ (Laid-Back Camp)", "Season 1");
  fs.mkdirSync(season, { recursive: true });
  for (const name of ["E10.mp4", "E2.mp4", "notes.txt"]) fs.writeFileSync(path.join(season, name), "");
  fs.writeFileSync(path.join(season, "E2.ja.srt"), "1\n00:00:01,000 --> 00:00:02,000\nはい\n");
  fs.writeFileSync(path.join(root, "secret.txt"), "");
});

afterAll(() => fs.rmSync(root, { recursive: true }));

describe("listEpisodes", () => {
  it("finds videos in natural order and cleans up the show name", () => {
    const episodes = listEpisodes(root);
    expect(episodes.map((e) => e.name)).toEqual(["E2", "E10"]);
    expect(episodes[0]!.show).toBe("Yuru Camp△");
  });

  it("returns nothing when the folder doesn't exist", () => {
    expect(listEpisodes(path.join(root, "missing"))).toEqual([]);
  });
});

describe("resolveEpisode", () => {
  const id = (relative: string) => Buffer.from(relative, "utf8").toString("base64url");

  it("round-trips ids from the listing", () => {
    const [episode] = listEpisodes(root);
    expect(resolveEpisode(episode!.id, root)).toMatch(/E2\.mp4$/);
  });

  it("refuses paths outside the library and non-video files", () => {
    expect(resolveEpisode(id("../../../Windows/win.ini"), root)).toBeNull();
    expect(resolveEpisode(id("../outside.mp4"), root)).toBeNull();
    expect(resolveEpisode(id(path.resolve(os.tmpdir(), "x.mp4")), root)).toBeNull();
    expect(resolveEpisode(id("secret.txt"), root)).toBeNull();
    expect(resolveEpisode(id("missing.mp4"), root)).toBeNull();
  });
});

describe("subtitlesFor", () => {
  it("falls back to a matching .srt, or reports none", () => {
    const [withSrt, without] = listEpisodes(root);
    expect(subtitlesFor(resolveEpisode(withSrt!.id, root)!)).toMatchObject({
      source: "E2.ja.srt",
      cues: [{ text: "はい" }],
    });
    expect(subtitlesFor(resolveEpisode(without!.id, root)!)).toEqual({ source: null, cues: [] });
  });
});
