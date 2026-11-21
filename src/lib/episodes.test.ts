import { describe, expect, it } from "vitest";
import { episodeLabel, groupShows } from "./episodes";

describe("episodeLabel", () => {
  it("reads the number and title from a named release", () => {
    expect(episodeLabel("Yuru Camp S01E03 - Mount Fuji and Relaxed Hot Pot Camp", 1)).toEqual({
      number: "3",
      title: "Mount Fuji and Relaxed Hot Pot Camp",
    });
  });

  it("reads the number from a dotted release with no title", () => {
    expect(episodeLabel("You.and.I.Are.Polar.Opposites.S01E12.1080p.BluRay", 1)).toEqual({ number: "12", title: null });
  });

  it("falls back to the position", () => {
    expect(episodeLabel("opening", 4)).toEqual({ number: "4", title: null });
  });
});

describe("groupShows", () => {
  const ep = (show: string, folder: string, name: string) => ({ id: name, show, folder, name });

  it("labels seasons only when a show has more than one folder", () => {
    const shows = groupShows([
      ep("A", "A", "a1"),
      ep("B", "B\\Season 1", "b1"),
      ep("B", "B\\Season 2", "b2"),
    ]);
    expect(shows.map((s) => s.name)).toEqual(["A", "B"]);
    expect(shows[0]!.seasons.map((s) => s.label)).toEqual([null]);
    expect(shows[1]!.seasons.map((s) => s.label)).toEqual(["Season 1", "Season 2"]);
  });
});
