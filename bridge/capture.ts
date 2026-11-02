export interface SubtitleLine {
  id: number;
  text: string;
}

export interface CaptureSnapshot {
  connected: boolean;
  title: string | null;
  playing: boolean;
  /** Time actually spent playing, excluding pauses. */
  activeMs: number;
  lines: SubtitleLine[];
}

export type CaptureEvent =
  | { type: "snapshot"; snapshot: CaptureSnapshot }
  | { type: "line"; line: SubtitleLine };

/** The properties mpv is asked to report; `handleMessage` consumes their changes. */
export const OBSERVED_PROPERTIES = ["core-idle", "media-title", "sub-text"] as const;

/**
 * Everything captured from mpv since the last reset. It lives in the server, so
 * watch time and lines keep accumulating when the browser tab is closed.
 */
export class Capture {
  private connected = false;
  private title: string | null = null;
  private accumulatedMs = 0;
  private runningSince: number | null = null;
  private lines: SubtitleLine[] = [];
  private nextId = 1;

  constructor(
    private readonly emit: (event: CaptureEvent) => void,
    private readonly now: () => number = Date.now,
  ) {}

  snapshot(): CaptureSnapshot {
    return {
      connected: this.connected,
      title: this.title,
      playing: this.runningSince !== null,
      activeMs: this.accumulatedMs + (this.runningSince === null ? 0 : this.now() - this.runningSince),
      lines: this.lines,
    };
  }

  setConnected(connected: boolean): void {
    this.connected = connected;
    if (!connected) this.setPlaying(false);
    this.emitSnapshot();
  }

  /** Handles one JSON message from mpv's IPC socket. Non-JSON and other messages are ignored. */
  handleMessage(raw: string): void {
    let message: { event?: string; name?: string; data?: unknown };
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if (message.event !== "property-change") return;

    switch (message.name) {
      case "core-idle":
        // core-idle covers pausing, buffering, and having no file loaded.
        this.setPlaying(message.data === false);
        this.emitSnapshot();
        break;
      case "media-title":
        if (typeof message.data === "string" && message.data) {
          this.title = message.data;
          this.emitSnapshot();
        }
        break;
      case "sub-text":
        if (typeof message.data === "string") this.addLine(message.data);
        break;
    }
  }

  removeLine(id: number): void {
    this.lines = this.lines.filter((line) => line.id !== id);
    this.emitSnapshot();
  }

  reset(): void {
    this.lines = [];
    this.accumulatedMs = 0;
    if (this.runningSince !== null) this.runningSince = this.now();
    this.emitSnapshot();
  }

  private setPlaying(playing: boolean): void {
    if (playing && this.runningSince === null) {
      this.runningSince = this.now();
    } else if (!playing && this.runningSince !== null) {
      this.accumulatedMs += this.now() - this.runningSince;
      this.runningSince = null;
    }
  }

  private addLine(raw: string): void {
    const text = raw.replace(/\s*\n\s*/g, " ").trim();
    if (!text || this.lines[this.lines.length - 1]?.text === text) return;
    const line = { id: this.nextId++, text };
    this.lines = [...this.lines, line];
    this.emit({ type: "line", line });
  }

  private emitSnapshot(): void {
    this.emit({ type: "snapshot", snapshot: this.snapshot() });
  }
}
