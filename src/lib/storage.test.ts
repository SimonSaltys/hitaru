import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addNewSessions, loadData, mergeSessions, parseData, saveData, SaveConflict, updateData } from "./storage";
import type { Session } from "./types";

describe("saving to the server", () => {
  const session = (id: string): Session => ({
    id, date: "2026-11-02", minutes: 10, category: "YouTube", title: "", comprehension: null,
  });
  const log = (...ids: string[]) => JSON.stringify({ sessions: ids.map(session) });

  let disk: { revision: string; text: string | null };
  let browser: Map<string, string>;
  let beforeNextWrite: (() => void) | null;

  beforeEach(() => {
    disk = { revision: "", text: null };
    browser = new Map();
    beforeNextWrite = null;
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => browser.get(key) ?? null,
      setItem: (key: string, value: string) => browser.set(key, value),
    });
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (init?.method !== "PUT") return Response.json({ ...disk, path: "log.json" });
      beforeNextWrite?.();
      beforeNextWrite = null;
      const sent = new URL(url, "http://localhost").searchParams.get("revision");
      if (sent !== disk.revision) return Response.json({ saved: false, current: { ...disk, path: "log.json" } }, { status: 409 });
      disk = { revision: `${Number(disk.revision) + 1}`, text: init.body as string };
      return Response.json({ saved: true, revision: disk.revision });
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  const idsOnDisk = () => parseData(disk.text!).sessions.map((s) => s.id);

  it("merges a browser's old log once, keeping what's on disk", async () => {
    disk = { revision: "7", text: log("a") };
    browser.set("hitaru.data.v1", log("a", "b"));
    await loadData();
    expect(idsOnDisk()).toEqual(["a", "b"]);

    disk = { revision: "8", text: log("a") };
    await loadData();
    expect(idsOnDisk()).toEqual(["a"]);
  });

  it("takes settings from the browser only when there's no file yet", async () => {
    browser.set("hitaru.data.v1", JSON.stringify({ sessions: [], settings: { weeklyGoalHours: 3, priorHours: 5 } }));
    const { settings } = await loadData();
    expect(settings).toEqual({ weeklyGoalHours: 3, priorHours: 5 });
  });

  it("leaves a damaged file alone", async () => {
    disk = { revision: "1", text: "{broken" };
    await expect(loadData()).rejects.toThrow();
    expect(disk.text).toBe("{broken");
  });

  it("reports a conflict rather than overwriting another tab's save", async () => {
    disk = { revision: "1", text: log("a") };
    const data = await loadData();
    disk = { revision: "2", text: log("a", "other") };
    await expect(saveData({ ...data, sessions: [] })).rejects.toBeInstanceOf(SaveConflict);
    expect(idsOnDisk()).toEqual(["a", "other"]);
  });

  it("retries an update on the newer log after losing a race", async () => {
    disk = { revision: "1", text: log("a") };
    beforeNextWrite = () => {
      disk = { revision: "2", text: log("a", "other") };
    };
    await updateData((latest) => ({ ...latest, sessions: addNewSessions(latest.sessions, [session("mine")]) }));
    expect(idsOnDisk()).toEqual(["a", "other", "mine"]);
  });

  it("saves one after another, so a quick second save isn't a conflict", async () => {
    disk = { revision: "1", text: log("a") };
    const data = await loadData();
    await Promise.all([
      saveData({ ...data, sessions: [session("b")] }),
      saveData({ ...data, sessions: [session("c")] }),
    ]);
    expect(idsOnDisk()).toEqual(["c"]);
  });
});

describe("addNewSessions", () => {
  const rated: Session = { id: "a", date: "2026-11-02", minutes: 10, category: "YouTube", title: "x", comprehension: 4 };

  it("skips a repeat delivery, keeping the rating given since", () => {
    expect(addNewSessions([rated], [{ ...rated, comprehension: null }])).toEqual([rated]);
  });

  it("adds new sessions and drops invalid ones", () => {
    const merged = addNewSessions([], [{ ...rated, id: "b" }, { id: "c", date: "soon", minutes: 5 }]);
    expect(merged.map((s) => s.id)).toEqual(["b"]);
  });
});

describe("parseData", () => {
  it("rejects files that aren't backups", () => {
    expect(() => parseData("{}")).toThrow();
    expect(() => parseData("not json")).toThrow();
  });

  it("drops invalid sessions and normalises fields", () => {
    const { sessions, settings } = parseData(
      JSON.stringify({
        sessions: [
          { id: "a", date: "2026-10-28", minutes: 30, category: "Unknown", comprehension: 9 },
          { id: "b", date: "yesterday", minutes: 30 },
          { id: "c", date: "2026-10-28", minutes: -5 },
        ],
      }),
    );
    expect(sessions).toEqual([
      { id: "a", date: "2026-10-28", minutes: 30, category: "Other", title: "", comprehension: null },
    ]);
    expect(settings.weeklyGoalHours).toBe(7);
  });
});

describe("mergeSessions", () => {
  it("keeps both sides and lets imports win on id", () => {
    const base: Session = {
      id: "a",
      date: "2026-10-28",
      minutes: 30,
      category: "Reading",
      title: "",
      comprehension: null,
    };
    const merged = mergeSessions([base], [{ ...base, minutes: 45 }, { ...base, id: "b" }]);
    expect(merged.map((s) => [s.id, s.minutes])).toEqual([
      ["a", 45],
      ["b", 30],
    ]);
  });
});
