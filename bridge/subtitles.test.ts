import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseSrt, readMkvJapaneseCues } from "./subtitles";

/** Encodes one EBML element with an 8-byte size, or an unknown size when asked. */
function el(id: number, payload: Buffer | string | number, unknownSize = false): Buffer {
  const idHex = id.toString(16);
  const idBytes = Buffer.from(idHex.length % 2 ? `0${idHex}` : idHex, "hex");
  const body =
    typeof payload === "number"
      ? Buffer.from([payload])
      : typeof payload === "string"
        ? Buffer.from(payload, "utf8")
        : payload;
  const size = Buffer.alloc(8);
  if (unknownSize) size.fill(0xff);
  else size.writeBigUInt64BE(BigInt(body.length));
  size[0] = unknownSize ? 0x01 : (size[0] ?? 0) | 0x01;
  if (unknownSize) size[0] = 0x01;
  return Buffer.concat([idBytes, size, body]);
}

function block(track: number, relativeMs: number, text: string): Buffer {
  const head = Buffer.alloc(4);
  head[0] = 0x80 | track;
  head.writeInt16BE(relativeMs, 1);
  return Buffer.concat([head, Buffer.from(text, "utf8")]);
}

function track(number: number, type: number, codec: string, language: string): Buffer {
  return el(
    0xae,
    Buffer.concat([el(0xd7, number), el(0x83, type), el(0x86, codec), el(0x22b59c, language)]),
  );
}

function subtitleGroup(trackNumber: number, relativeMs: number, durationMs: number, text: string): Buffer {
  return el(0xa0, Buffer.concat([el(0xa1, block(trackNumber, relativeMs, text)), el(0x9b, durationMs)]));
}

const tempFiles: string[] = [];

function writeMkv(tracks: Buffer[], clusters: Buffer[], unknownSizes = false): string {
  const file = path.join(os.tmpdir(), `hitaru-test-${process.pid}-${tempFiles.length}.mkv`);
  tempFiles.push(file);
  const segment = Buffer.concat([
    el(0x1549a966, el(0x2ad7b1, Buffer.from([0x0f, 0x42, 0x40]))),
    el(0x1654ae6b, Buffer.concat(tracks)),
    ...clusters,
  ]);
  fs.writeFileSync(
    file,
    Buffer.concat([el(0x1a45dfa3, Buffer.alloc(4)), el(0x18538067, segment, unknownSizes)]),
  );
  return file;
}

afterEach(() => {
  while (tempFiles.length) fs.rmSync(tempFiles.pop()!);
});

describe("readMkvJapaneseCues", () => {
  const tracks = [
    track(1, 1, "V_AV1", "ja"),
    track(2, 0x11, "S_TEXT/ASS", "en"),
    track(3, 0x11, "S_TEXT/UTF8", "ja-JP"),
  ];

  it("reads only the Japanese track, with times from cluster and block offsets", () => {
    const file = writeMkv(tracks, [
      el(
        0x1f43b675,
        Buffer.concat([
          el(0xe7, 100),
          el(0xa3, block(1, 0, "video frame")),
          subtitleGroup(2, 0, 200, "0,0,Default,,0,0,0,,English"),
          subtitleGroup(3, 100, 200, "こんにちは\r\n世界"),
        ]),
      ),
    ]);
    const cues = readMkvJapaneseCues(file);
    expect(cues).toHaveLength(1);
    expect(cues![0]!.start).toBeCloseTo(0.2);
    expect(cues![0]!.end).toBeCloseTo(0.4);
    expect(cues![0]!.text).toBe("こんにちは\n世界");
  });

  it("strips ASS fields and styling, keeping commas in the text", () => {
    const file = writeMkv([track(2, 0x11, "S_TEXT/ASS", "jpn")], [
      el(0x1f43b675, Buffer.concat([el(0xe7, 0), subtitleGroup(2, 0, 100, "0,0,Default,,0,0,0,,{\\i1}はい、\\Nそう")])),
    ]);
    expect(readMkvJapaneseCues(file)![0]!.text).toBe("はい、\nそう");
  });

  it("handles a segment of unknown size", () => {
    const file = writeMkv(
      tracks,
      [el(0x1f43b675, Buffer.concat([el(0xe7, 0), subtitleGroup(3, 0, 100, "一")]))],
      true,
    );
    expect(readMkvJapaneseCues(file)!.map((c) => c.text)).toEqual(["一"]);
  });

  it("returns null without a Japanese text track", () => {
    const file = writeMkv([track(2, 0x11, "S_TEXT/ASS", "en"), track(4, 0x11, "S_HDMV/PGS", "ja")], [
      el(0x1f43b675, el(0xe7, 0)),
    ]);
    expect(readMkvJapaneseCues(file)).toBeNull();
  });

  it("does not throw on a truncated file", () => {
    const file = writeMkv(tracks, [
      el(0x1f43b675, Buffer.concat([el(0xe7, 0), subtitleGroup(3, 0, 100, "一")])),
    ]);
    fs.truncateSync(file, fs.statSync(file).size - 5);
    expect(() => readMkvJapaneseCues(file)).not.toThrow();
  });
});

describe("parseSrt", () => {
  it("parses CRLF, a BOM, multi-line text, and tags", () => {
    const cues = parseSrt(
      "﻿1\r\n00:00:03,044 --> 00:00:05,463\r\n（なでしこ）\r\n<i>はあ</i>\r\n\r\n2\r\n01:00:00.500 --> 01:00:01.000\r\nまた\r\n",
    );
    expect(cues).toEqual([
      { start: 3.044, end: 5.463, text: "（なでしこ）\nはあ" },
      { start: 3600.5, end: 3601, text: "また" },
    ]);
  });

  it("ignores malformed blocks and empty cues", () => {
    expect(parseSrt("garbage\n\n1\n00:00:01,000 --> 00:00:02,000\n\n")).toEqual([]);
  });
});
