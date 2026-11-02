import fs from "node:fs";

export interface Cue {
  start: number;
  end: number;
  text: string;
}

const ID = {
  SEGMENT: 0x18538067,
  INFO: 0x1549a966,
  TIMESTAMP_SCALE: 0x2ad7b1,
  TRACKS: 0x1654ae6b,
  TRACK_ENTRY: 0xae,
  TRACK_NUMBER: 0xd7,
  TRACK_TYPE: 0x83,
  CODEC_ID: 0x86,
  LANGUAGE: 0x22b59c,
  LANGUAGE_BCP47: 0x22b59d,
  CLUSTER: 0x1f43b675,
  CLUSTER_TIMESTAMP: 0xe7,
  SIMPLE_BLOCK: 0xa3,
  BLOCK_GROUP: 0xa0,
  BLOCK: 0xa1,
  BLOCK_DURATION: 0x9b,
};

const SUBTITLE_TRACK_TYPE = 0x11;
const TEXT_CODECS = new Set(["S_TEXT/UTF8", "S_TEXT/ASS", "S_TEXT/SSA"]);
const FALLBACK_CUE_SECONDS = 5;

/** Reads from a file through a small cache, since most reads are tiny and nearby. */
class Reader {
  private cache = Buffer.alloc(0);
  private cacheStart = 0;

  constructor(
    private readonly fd: number,
    readonly size: number,
  ) {}

  read(position: number, length: number): Buffer {
    const offset = position - this.cacheStart;
    if (offset < 0 || offset + length > this.cache.length) {
      const buffer = Buffer.alloc(Math.max(length, 64 * 1024));
      const bytes = fs.readSync(this.fd, buffer, 0, buffer.length, position);
      this.cache = buffer.subarray(0, bytes);
      this.cacheStart = position;
      return this.cache.subarray(0, length);
    }
    return this.cache.subarray(offset, offset + length);
  }
}

function vintLength(first: number): number {
  for (let length = 1; length <= 8; length++) {
    if (first & (0x80 >> (length - 1))) return length;
  }
  return 0;
}

function readUint(bytes: Buffer): number {
  return bytes.reduce((value, byte) => value * 256 + byte, 0);
}

/** Walks the EBML elements in [start, end), calling `visit` with each one's payload range. */
function walk(
  reader: Reader,
  start: number,
  end: number,
  visit: (id: number, dataStart: number, dataEnd: number) => boolean | void,
): void {
  let position = start;
  while (position < end) {
    const idLength = vintLength(reader.read(position, 1)[0] ?? 0);
    if (idLength === 0 || idLength > 4) return;
    const id = readUint(reader.read(position, idLength));
    position += idLength;

    const first = reader.read(position, 1)[0] ?? 0;
    const sizeLength = vintLength(first);
    if (sizeLength === 0) return;
    const sizeBytes = Buffer.from(reader.read(position, sizeLength));
    position += sizeLength;
    sizeBytes[0] = first & (0xff >> sizeLength);
    const unknownSize =
      sizeBytes[0] === 0xff >> sizeLength && sizeBytes.subarray(1).every((b) => b === 0xff);
    const dataEnd = unknownSize ? end : Math.min(end, position + readUint(sizeBytes));

    // Returning true stops the walk early.
    if (visit(id, position, dataEnd)) return;
    position = dataEnd;
  }
}

/** Removes ASS's leading fields and its styling overrides, leaving only the text. */
function assText(payload: string): string {
  const fields = payload.split(",");
  return fields
    .slice(8)
    .join(",")
    .replace(/\{[^}]*\}/g, "")
    .replace(/\\[Nn]/g, "\n")
    .trim();
}

interface Track {
  number: number;
  codec: string;
  language: string;
  isSubtitle: boolean;
}

/**
 * Extracts the first Japanese text subtitle track from a Matroska file, or returns
 * null if it has none. Only headers are read for other tracks, so this stays quick
 * on multi-gigabyte files.
 */
export function readMkvJapaneseCues(path: string): Cue[] | null {
  const fd = fs.openSync(path, "r");
  try {
    const reader = new Reader(fd, fs.fstatSync(fd).size);
    let timestampScale = 1_000_000;
    let selected: Track | null = null;
    let tracksRead = false;
    const cues: Cue[] = [];

    const addBlock = (blockStart: number, blockEnd: number, clusterMs: number, duration: number | null) => {
      const trackLength = vintLength(reader.read(blockStart, 1)[0] ?? 0);
      if (trackLength === 0) return;
      const head = Buffer.from(reader.read(blockStart, trackLength + 2));
      const trackBytes = Buffer.from(head.subarray(0, trackLength));
      trackBytes[0] = (trackBytes[0] ?? 0) & (0xff >> trackLength);
      if (readUint(trackBytes) !== selected?.number) return;

      const payloadStart = blockStart + trackLength + 3;
      const raw = Buffer.from(reader.read(payloadStart, blockEnd - payloadStart))
        .toString("utf8")
        .replace(/\r\n?/g, "\n");
      const text = selected.codec === "S_TEXT/UTF8" ? raw.trim() : assText(raw);
      if (!text) return;
      const start = ((clusterMs + head.readInt16BE(trackLength)) * timestampScale) / 1e9;
      const seconds = duration === null ? FALLBACK_CUE_SECONDS : (duration * timestampScale) / 1e9;
      cues.push({ start, end: start + seconds, text });
    };

    walk(reader, 0, reader.size, (id, segmentStart, segmentEnd) => {
      if (id !== ID.SEGMENT) return;
      walk(reader, segmentStart, segmentEnd, (childId, start, end) => {
        if (childId === ID.INFO) {
          walk(reader, start, end, (infoId, s, e) => {
            if (infoId === ID.TIMESTAMP_SCALE) timestampScale = readUint(reader.read(s, e - s));
          });
        } else if (childId === ID.TRACKS) {
          tracksRead = true;
          walk(reader, start, end, (entryId, entryStart, entryEnd) => {
            if (entryId !== ID.TRACK_ENTRY || selected) return;
            const track: Track = { number: 0, codec: "", language: "eng", isSubtitle: false };
            let bcp47 = "";
            walk(reader, entryStart, entryEnd, (field, s, e) => {
              const bytes = reader.read(s, e - s);
              if (field === ID.TRACK_NUMBER) track.number = readUint(bytes);
              else if (field === ID.TRACK_TYPE) track.isSubtitle = readUint(bytes) === SUBTITLE_TRACK_TYPE;
              else if (field === ID.CODEC_ID) track.codec = bytes.toString("latin1").replace(/\0+$/, "");
              else if (field === ID.LANGUAGE) track.language = bytes.toString("latin1").replace(/\0+$/, "");
              else if (field === ID.LANGUAGE_BCP47) bcp47 = bytes.toString("latin1").replace(/\0+$/, "");
            });
            const language = bcp47 || track.language;
            if (track.isSubtitle && TEXT_CODECS.has(track.codec) && /^(ja|jpn)\b/i.test(language)) {
              selected = track;
            }
          });
        } else if (childId === ID.CLUSTER) {
          // No Japanese track means there's no reason to scan the whole file.
          if (tracksRead && !selected) return true;
          let clusterMs = 0;
          walk(reader, start, end, (blockId, s, e) => {
            if (blockId === ID.CLUSTER_TIMESTAMP) clusterMs = readUint(reader.read(s, e - s));
            else if (blockId === ID.SIMPLE_BLOCK) addBlock(s, e, clusterMs, null);
            else if (blockId === ID.BLOCK_GROUP) {
              let block: [number, number] | null = null;
              let duration: number | null = null;
              walk(reader, s, e, (groupId, gs, ge) => {
                if (groupId === ID.BLOCK) block = [gs, ge];
                else if (groupId === ID.BLOCK_DURATION) duration = readUint(reader.read(gs, ge - gs));
              });
              if (block) addBlock(block[0], block[1], clusterMs, duration);
            }
          });
        }
      });
      return true;
    });

    return selected ? cues.sort((a, b) => a.start - b.start) : null;
  } finally {
    fs.closeSync(fd);
  }
}

function srtSeconds(h: string, m: string, s: string, ms: string): number {
  return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;
}

export function parseSrt(content: string): Cue[] {
  const cues: Cue[] = [];
  const blocks = content.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split(/\n{2,}/);
  for (const block of blocks) {
    const match = block.match(
      /(\d+):(\d\d):(\d\d)[,.](\d{1,3})\s*-->\s*(\d+):(\d\d):(\d\d)[,.](\d{1,3})[^\n]*\n([\s\S]*)/,
    );
    if (!match) continue;
    const [, h1, m1, s1, ms1, h2, m2, s2, ms2, body] = match as unknown as string[];
    const text = body!.replace(/<[^>]+>/g, "").trim();
    if (text) {
      cues.push({
        start: srtSeconds(h1!, m1!, s1!, ms1!.padEnd(3, "0")),
        end: srtSeconds(h2!, m2!, s2!, ms2!.padEnd(3, "0")),
        text,
      });
    }
  }
  return cues.sort((a, b) => a.start - b.start);
}
