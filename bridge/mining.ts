import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { addNote, canAddNote, createDeck, storeMedia } from "./anki.ts";
import { lookUp } from "./dictionary.ts";
import type { Cue } from "./subtitles.ts";
import { readableText, toHiragana, type CueToken } from "./tokens.ts";

export const MINING_DECK = "Hitaru Mining";
// Kaishi's own note type, so these cards look and review the same as that deck's.
const NOTE_TYPE = "Kaishi 1.5k";
const CLIP_PADDING_SECONDS = 0.15;
const SCREENSHOT_WIDTH = 640;
const HAN = /\p{Script=Han}/u;
const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}ー]/u;

const run = promisify(execFile);
const ALIGNER_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "aligner");

/** A failure worth showing as written, as opposed to an unexpected one. */
export class CardError extends Error {}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Anki's furigana syntax, with the reading only over the kanji: 食[た]べる. The space ends
 * whatever came before, since Anki would otherwise put the reading over all of it.
 */
export function furigana(word: string, reading: string): string {
  if (!HAN.test(word)) return word;
  const sound = toHiragana(reading);
  let start = 0;
  while (start < word.length && KANA.test(word[start]!) && toHiragana(word[start]!) === sound[start]) start++;
  let end = 0;
  while (
    end < word.length - start &&
    end < sound.length - start &&
    KANA.test(word[word.length - 1 - end]!) &&
    toHiragana(word[word.length - 1 - end]!) === sound[sound.length - 1 - end]
  ) end++;
  const stem = word.slice(start, word.length - end);
  const stemReading = sound.slice(start, sound.length - end);
  return `${word.slice(0, start)} ${stem}[${stemReading}]${word.slice(word.length - end)}`;
}

/** The spoken text with the mined word in bold, plain and with furigana. */
export function sentenceFields(text: string, tokens: CueToken[], lemma: string): { sentence: string; withFurigana: string } {
  const readable = readableText(text);
  const byStart = new Map(tokens.map((token) => [token.from, token]));
  let sentence = "";
  let withFurigana = "";
  for (let i = 0; i < readable.text.length; i++) {
    const token = byStart.get(readable.offsets[i]!);
    if (!token || !readable.text.startsWith(token.surface, i)) {
      const character = escapeHtml(/\s/.test(readable.text[i]!) ? " " : readable.text[i]!);
      sentence += character;
      withFurigana += character;
      continue;
    }
    const bold = token.lemma === lemma;
    const wrap = (inner: string) => (bold ? `<b>${inner}</b>` : inner);
    sentence += wrap(escapeHtml(token.surface));
    withFurigana += wrap(furigana(escapeHtml(token.surface), token.reading));
    i += token.surface.length - 1;
  }
  return { sentence: sentence.trim(), withFurigana: withFurigana.trim() };
}

function findFfmpeg(): string {
  if (process.env.HITARU_FFMPEG) return process.env.HITARU_FFMPEG;
  const venv = path.join(ALIGNER_DIR, ".venv");
  const candidates = [path.join(venv, "Lib", "site-packages")];
  const lib = path.join(venv, "lib");
  if (fs.existsSync(lib)) {
    candidates.push(...fs.readdirSync(lib).map((version) => path.join(lib, version, "site-packages")));
  }
  for (const packages of candidates) {
    const binaries = path.join(packages, "imageio_ffmpeg", "binaries");
    const binary = fs.existsSync(binaries) ? fs.readdirSync(binaries).find((name) => name.startsWith("ffmpeg")) : null;
    if (binary) return path.join(binaries, binary);
  }
  throw new CardError("ffmpeg wasn't found. Set HITARU_FFMPEG, or set up the aligner, which includes it.");
}

/** A file's first audio track can be a dub. */
async function japaneseAudio(ffmpeg: string, video: string): Promise<string> {
  // ffmpeg reports "no output file" as a failure, but still prints the streams.
  const stderr = await run(ffmpeg, ["-hide_banner", "-i", video]).then(
    (result) => result.stderr,
    (error: { stderr?: string }) => error.stderr ?? "",
  );
  const match = stderr.match(/Stream #0:(\d+)\((?:jpn|ja)\): Audio/);
  return match ? `0:${match[1]}` : "0:a:0";
}

async function extractMedia(video: string, start: number, end: number) {
  const ffmpeg = findFfmpeg();
  const from = Math.max(0, start - CLIP_PADDING_SECONDS);
  const duration = end + CLIP_PADDING_SECONDS - from;
  const stream = await japaneseAudio(ffmpeg, video);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "hitaru-card-"));
  try {
    const audio = path.join(directory, "line.mp3");
    const picture = path.join(directory, "line.jpg");
    const seek = String(from);
    await run(ffmpeg, [
      "-nostdin", "-v", "error", "-ss", seek, "-t", String(duration), "-i", video,
      "-map", stream, "-vn", "-c:a", "libmp3lame", "-q:a", "4", audio,
    ]);
    await run(ffmpeg, [
      "-nostdin", "-v", "error", "-ss", String((start + end) / 2), "-i", video,
      "-map", "0:v:0", "-frames:v", "1", "-vf", `scale=${SCREENSHOT_WIDTH}:-2`, "-q:v", "4", picture,
    ]);
    return { audio: fs.readFileSync(audio), picture: fs.readFileSync(picture) };
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

export interface CardRequest {
  video: string;
  label: string;
  cue: Cue;
  tokens: CueToken[];
  lemma: string;
  /** Lemma's reading from the analyzer, which picks between words spelled alike. */
  reading: string;
  /** Seconds added to subtitle times to line them up with this video. */
  offset: number;
}

export async function createCard({ video, label, cue, tokens, lemma, reading, offset }: CardRequest) {
  const found = await lookUp(lemma, reading);
  if (!found) throw new CardError(`${lemma} isn't in the dictionary`);

  const { sentence, withFurigana } = sentenceFields(cue.text, tokens, lemma);
  const start = cue.start + offset;
  const end = cue.end + offset;
  const fields: Record<string, string> = {
    Word: escapeHtml(lemma),
    "Word Reading": escapeHtml(found.reading),
    "Word Meaning": escapeHtml(found.entry.meaning),
    "Word Furigana": furigana(escapeHtml(lemma), found.reading).trim(),
    Sentence: sentence,
    "Sentence Furigana": withFurigana,
    Notes: escapeHtml(label),
  };
  const note = (extra: Record<string, string>) => ({
    deckName: MINING_DECK,
    modelName: NOTE_TYPE,
    fields: { ...fields, ...extra },
    tags: ["hitaru"],
  });

  await createDeck(MINING_DECK);
  // Checked first, so a word that's already in Anki doesn't leave unused media behind.
  if (!(await canAddNote(note({})))) throw new CardError(`${lemma} is already in Anki`);

  const { audio, picture } = await extractMedia(video, start, end);
  const name = `hitaru_${createHash("sha1").update(`${video}:${start}`).digest("hex").slice(0, 16)}`;
  await storeMedia(`${name}.mp3`, audio);
  await storeMedia(`${name}.jpg`, picture);
  await addNote(note({
    "Sentence Audio": `[sound:${name}.mp3]`,
    Picture: `<img src="${name}.jpg">`,
  }));
  return { word: lemma, reading: found.reading, meaning: found.entry.meaning };
}
