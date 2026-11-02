import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DataStore, isLogData } from "./store";

const log = (minutes: number) => JSON.stringify({ sessions: [{ minutes }] });

describe("DataStore", () => {
  let dir: string;
  let store: DataStore;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "hitaru-store-"));
    store = new DataStore(path.join(dir, "nested"));
  });

  afterEach(() => fs.rmSync(dir, { recursive: true }));

  function saved(revision: string, text: string, now?: Date): string {
    const result = store.write(revision, text, now);
    if (!result.saved) throw new Error("expected the write to be saved");
    return result.revision;
  }

  it("reads as empty until the first write creates the file", () => {
    expect(store.read()).toMatchObject({ revision: "", text: null });
    const revision = saved("", log(1));
    expect(store.read()).toMatchObject({ revision, text: log(1) });
  });

  it("refuses a write based on an old revision and returns what's there", () => {
    const first = saved("", log(1));
    saved(first, log(2));
    const result = store.write(first, log(3));
    expect(result).toMatchObject({ saved: false, current: { text: log(2) } });
    expect(store.read().text).toBe(log(2));
  });

  it("keeps a revision across restarts", () => {
    const revision = saved("", log(1));
    expect(new DataStore(path.dirname(store.file)).write(revision, log(2)).saved).toBe(true);
  });

  it("backs up the log as it stood before each day's first change", () => {
    const backups = path.join(path.dirname(store.file), "backups");
    let revision = saved("", log(1), new Date(2026, 10, 2));
    expect(fs.existsSync(backups)).toBe(false);
    revision = saved(revision, log(2), new Date(2026, 10, 2));
    saved(revision, log(3), new Date(2026, 10, 2));
    expect(fs.readFileSync(path.join(backups, "hitaru-2026-11-02.json"), "utf8")).toBe(log(1));
  });

  it("keeps only the newest 30 backups", () => {
    let revision = saved("", log(0));
    for (let day = 1; day <= 32; day++) revision = saved(revision, log(day), new Date(2026, 0, day));
    const names = fs.readdirSync(path.join(path.dirname(store.file), "backups")).sort();
    expect(names).toHaveLength(30);
    expect(names[0]).toBe("hitaru-2026-01-03.json");
  });
});

describe("isLogData", () => {
  it("accepts only JSON with a sessions list", () => {
    expect(isLogData(log(1))).toBe(true);
    expect(isLogData("{}")).toBe(false);
    expect(isLogData("not json")).toBe(false);
  });
});
