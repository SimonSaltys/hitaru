import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { defaultDataDir } from "./store.ts";
import { toHiragana } from "./tokens.ts";

const RELEASES = "https://api.github.com/repos/scriptin/jmdict-simplified/releases/latest";
const SENSES_KEPT = 3;
const GLOSSES_KEPT = 3;

export interface DictionaryEntry {
  written: string[];
  readings: string[];
  common: boolean;
  meaning: string;
}

interface JmdictWord {
  kanji: { text: string; common: boolean }[];
  kana: { text: string; common: boolean }[];
  sense: { gloss: { text: string }[] }[];
}

export function compactEntry(word: JmdictWord): DictionaryEntry {
  return {
    written: word.kanji.map((k) => k.text),
    readings: word.kana.map((k) => k.text),
    common: [...word.kanji, ...word.kana].some((form) => form.common),
    meaning: word.sense
      .slice(0, SENSES_KEPT)
      .map((sense) => sense.gloss.slice(0, GLOSSES_KEPT).map((gloss) => gloss.text).join(", "))
      .join("; "),
  };
}

/** The entry for a word as spelled, using its reading to tell apart words spelled the same way. */
export function pickEntry(
  entries: DictionaryEntry[],
  word: string,
  reading: string,
): { entry: DictionaryEntry; reading: string } | null {
  let best: DictionaryEntry | null = null;
  let bestScore = -1;
  for (const entry of entries) {
    if (!entry.written.includes(word) && !entry.readings.includes(word)) continue;
    const sounds = entry.readings.some((r) => toHiragana(r) === toHiragana(reading));
    const score = (sounds ? 2 : 0) + (entry.common ? 1 : 0);
    if (score > bestScore) {
      best = entry;
      bestScore = score;
    }
  }
  if (!best) return null;
  const matching = best.readings.find((r) => toHiragana(r) === toHiragana(reading));
  return { entry: best, reading: matching ?? best.readings[0] ?? reading };
}

/** Pulls one file out of a tar archive by name suffix. */
export function fileFromTar(tar: Buffer, suffix: string): Buffer | null {
  let position = 0;
  while (position + 512 <= tar.length && tar[position] !== 0) {
    const field = (from: number, length: number) =>
      tar.toString("latin1", position + from, position + from + length).replace(/\0.*$/s, "").trim();
    const size = parseInt(field(124, 12), 8);
    if (field(0, 100).endsWith(suffix)) return tar.subarray(position + 512, position + 512 + size);
    position += 512 + Math.ceil(size / 512) * 512;
  }
  return null;
}

async function download(): Promise<DictionaryEntry[]> {
  const release = (await (await fetch(RELEASES, { headers: { "User-Agent": "hitaru" } })).json()) as {
    assets?: { name: string; browser_download_url: string }[];
  };
  const asset = release.assets?.find((a) => /^jmdict-eng-\d.*\.json\.tgz$/.test(a.name));
  if (!asset) throw new Error("Couldn't find the dictionary download");
  const response = await fetch(asset.browser_download_url);
  if (!response.ok) throw new Error(`Couldn't download the dictionary (${response.status})`);
  const json = fileFromTar(gunzipSync(Buffer.from(await response.arrayBuffer())), ".json");
  if (!json) throw new Error("The dictionary download was missing its data");
  const { words } = JSON.parse(json.toString("utf8")) as { words: JmdictWord[] };
  return words.map(compactEntry);
}

async function loadEntries(): Promise<Map<string, DictionaryEntry[]>> {
  const file = path.join(defaultDataDir(), "jmdict.json");
  let entries: DictionaryEntry[];
  if (fs.existsSync(file)) {
    entries = JSON.parse(fs.readFileSync(file, "utf8")) as DictionaryEntry[];
  } else {
    entries = await download();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(entries));
    fs.renameSync(temporary, file);
  }
  const byForm = new Map<string, DictionaryEntry[]>();
  for (const entry of entries) {
    for (const form of new Set([...entry.written, ...entry.readings])) {
      byForm.set(form, [...(byForm.get(form) ?? []), entry]);
    }
  }
  return byForm;
}

let dictionary: Promise<Map<string, DictionaryEntry[]>> | null = null;

/** Downloads JMdict the first time it's needed, and works offline after that. */
export async function lookUp(word: string, reading: string) {
  dictionary ??= loadEntries().catch((error: unknown) => {
    // So the next card can try the download again.
    dictionary = null;
    throw error;
  });
  return pickEntry((await dictionary).get(word) ?? [], word, reading);
}
