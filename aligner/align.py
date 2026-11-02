"""Times each subtitle's words against an episode's Japanese audio.

Reads the cues Hitaru already parsed, aligns each one inside its own time window so a
bad line can't throw off the rest, and writes the timings to a JSON file. Progress goes
to stdout as one JSON object per line.
"""

import argparse
import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

SAMPLE_RATE = 16_000
# Subtitle timing is loose, so listen a little beyond each cue.
WINDOW_PADDING_SECONDS = 0.3
# Measured on S01E01: keeps 72% of lines, and 1% of the same lines paired with the wrong audio.
MIN_CONFIDENCE = 0.4

_HIDDEN = re.compile(r"（[^（）]*(?:\([^()]*\)[^（）]*)*）|\([^()]*\)|～?♪～?")
_SPEECH = re.compile(r"[ぁ-ゖァ-ヺ㐀-鿿A-Za-z0-9０-９Ａ-Ｚａ-ｚ]")


@dataclass
class SpokenText:
    """The speakable part of a cue, and where each of its characters sits in the original."""

    text: str
    offsets: list[int]


@dataclass
class Fragment:
    """A piece of a word as Whisper timed it, located by index in the spoken text."""

    from_char: int
    to_char: int
    start: float
    end: float
    probability: float


def spoken_text(cue_text: str) -> SpokenText:
    """Drops speaker labels, sound descriptions, furigana and music marks."""
    chars: list[str] = []
    offsets: list[int] = []
    position = 0
    for hidden in [*_HIDDEN.finditer(cue_text), None]:
        end = hidden.start() if hidden else len(cue_text)
        for i in range(position, end):
            chars.append(cue_text[i])
            offsets.append(i)
        position = hidden.end() if hidden else len(cue_text)
    text = "".join(chars)
    if not _SPEECH.search(text):
        return SpokenText("", [])
    return SpokenText(text, offsets)


def map_fragments(spoken: SpokenText, fragments: list[tuple[str, float, float, float]]) -> list[Fragment] | None:
    """Finds each of Whisper's fragments in the spoken text, or None if they don't match it."""
    placed: list[Fragment] = []
    cursor = 0
    for text, start, end, probability in fragments:
        first = last = None
        for char in text:
            if char.isspace():
                continue
            while cursor < len(spoken.text) and spoken.text[cursor].isspace():
                cursor += 1
            if cursor >= len(spoken.text) or spoken.text[cursor] != char:
                return None
            if first is None:
                first = cursor
            last = cursor
            cursor += 1
        if first is not None and last is not None:
            placed.append(Fragment(first, last + 1, start, end, probability))
    return None if spoken.text[cursor:].strip() else placed


def word_ends(text: str, surfaces: list[str]) -> set[int]:
    """Where words end in `text`, leaving trailing punctuation attached to its word."""
    ends: set[int] = set()
    cursor = 0
    for surface in surfaces:
        found = text.find(surface, cursor)
        if found < 0:
            continue
        cursor = found + len(surface)
        if _SPEECH.search(surface) or not ends:
            ends.add(cursor)
        else:
            ends.discard(found)
            ends.add(cursor)
    return ends


def group_words(spoken: SpokenText, fragments: list[Fragment], ends: set[int]) -> list[dict]:
    """Joins fragments into words. A word spanning `from` to `to` of the original cue keeps
    any furigana inside it."""
    words: list[dict] = []
    group: list[Fragment] = []
    for i, fragment in enumerate(fragments):
        group.append(fragment)
        if fragment.to_char not in ends and i < len(fragments) - 1:
            continue
        characters = sum(f.to_char - f.from_char for f in group)
        words.append({
            "from": spoken.offsets[group[0].from_char],
            "to": spoken.offsets[group[-1].to_char - 1] + 1,
            "start": round(group[0].start, 3),
            "end": round(group[-1].end, 3),
            "probability": round(sum(f.probability * (f.to_char - f.from_char) for f in group) / characters, 3),
        })
        group = []
    return words


def cue_confidence(words: list[dict]) -> float:
    weight = sum(w["to"] - w["from"] for w in words)
    return round(sum(w["probability"] * (w["to"] - w["from"]) for w in words) / weight, 3) if weight else 0.0


def find_ffmpeg() -> str:
    import imageio_ffmpeg

    return imageio_ffmpeg.get_ffmpeg_exe()


def japanese_audio_stream(ffmpeg: str, video: Path) -> str:
    """Finds the Japanese audio, since a file's first audio track can be a dub."""
    probe = subprocess.run([ffmpeg, "-hide_banner", "-i", str(video)], capture_output=True, encoding="utf-8", errors="replace")
    match = re.search(r"Stream #0:(\d+)\((?:jpn|ja)\): Audio", probe.stderr)
    return f"0:{match.group(1)}" if match else "0:a:0"


def load_audio(video: Path):
    import numpy as np

    ffmpeg = find_ffmpeg()
    command = [
        ffmpeg, "-nostdin", "-v", "error", "-i", str(video), "-map", japanese_audio_stream(ffmpeg, video),
        "-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "f32le", "-",
    ]
    result = subprocess.run(command, capture_output=True, check=True)
    return np.frombuffer(result.stdout, dtype=np.float32).copy()


def emit(**event) -> None:
    print(json.dumps(event, ensure_ascii=False), flush=True)


def align_cue(model, tagger, audio, cue: dict, language: str) -> dict:
    spoken = spoken_text(cue["text"])
    if not spoken.text:
        return {"status": "silent", "words": []}

    window_start = max(0.0, cue["start"] - WINDOW_PADDING_SECONDS)
    window_end = cue["end"] + WINDOW_PADDING_SECONDS
    clip = audio[int(window_start * SAMPLE_RATE):int(window_end * SAMPLE_RATE)]
    if clip.size == 0:
        return {"status": "failed", "words": []}

    result = model.align(clip, spoken.text.replace("\n", " "), language=language, verbose=None, regroup=False)
    if result is None:
        return {"status": "failed", "words": []}
    placed = map_fragments(spoken, [
        (w.word, window_start + w.start, window_start + w.end, w.probability)
        for segment in result.segments for w in segment.words
    ])
    if not placed:
        return {"status": "failed", "words": []}
    words = group_words(spoken, placed, word_ends(spoken.text, [w.surface for w in tagger(spoken.text)]))
    confidence = cue_confidence(words)
    status = "aligned" if confidence >= MIN_CONFIDENCE else "uncertain"
    return {"status": status, "confidence": confidence, "words": words}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--video", type=Path, required=True)
    parser.add_argument("--cues", type=Path, required=True, help="JSON array of {start, end, text}")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--model", default="large-v3")
    parser.add_argument("--language", default="ja")
    parser.add_argument("--limit", type=int, help="Only align this many cues, for testing")
    args = parser.parse_args()

    cues = json.loads(args.cues.read_text(encoding="utf-8"))
    if args.limit:
        cues = cues[:args.limit]

    import fugashi
    import stable_whisper
    import torch

    tagger = fugashi.Tagger()

    device = "cuda" if torch.cuda.is_available() else "cpu"
    emit(type="status", message=f"Loading {args.model} on {device}")
    model = stable_whisper.load_model(args.model, device=device)
    emit(type="status", message="Reading audio")
    audio = load_audio(args.video)

    aligned = []
    for index, cue in enumerate(cues):
        try:
            outcome = align_cue(model, tagger, audio, cue, args.language)
        except Exception as error:  # One unusable line shouldn't cost the whole episode.
            emit(type="warning", cue=index, message=str(error))
            outcome = {"status": "failed", "words": []}
        aligned.append({"text": cue["text"], **outcome})
        emit(type="progress", done=index + 1, total=len(cues))

    temporary = args.out.with_name(args.out.name + ".tmp")
    temporary.write_text(
        json.dumps({"version": 1, "model": args.model, "cues": aligned}, ensure_ascii=False),
        encoding="utf-8",
    )
    os.replace(temporary, args.out)
    emit(type="done", out=str(args.out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
