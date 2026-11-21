const RECENT_KEY = "hitaru.youtube.recent.v1";
const RECENT_LIMIT = 8;
const ID = /^[\w-]{11}$/;

/** Accepts watch, youtu.be, shorts, live and embed links, or a bare 11-character ID. */
export function parseVideoId(input: string): string | null {
  const text = input.trim();
  if (ID.test(text)) return text;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www|m|music)\./, "");
  let id: string | null = null;
  if (host === "youtu.be") id = url.pathname.split("/")[1] ?? null;
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    id = url.pathname === "/watch"
      ? url.searchParams.get("v")
      : url.pathname.match(/^\/(?:shorts|live|embed|v)\/([^/?#]+)/)?.[1] ?? null;
  }
  return id && ID.test(id) ? id : null;
}

/** Progress and positions share storage with the library player, so keys are namespaced. */
export function youtubeKey(videoId: string): string {
  return `youtube:${videoId}`;
}

export interface RecentVideo {
  id: string;
  title: string;
}

export function loadRecent(): RecentVideo[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? (JSON.parse(raw) as RecentVideo[]) : [];
  } catch {
    return [];
  }
}

/** Most recent first, without duplicates. Keeps a known title if the new one is blank. */
export function addRecent(list: RecentVideo[], video: RecentVideo): RecentVideo[] {
  const old = list.find((v) => v.id === video.id);
  const entry = { id: video.id, title: video.title || old?.title || "" };
  return [entry, ...list.filter((v) => v.id !== video.id)].slice(0, RECENT_LIMIT);
}

export function saveRecent(list: RecentVideo[]): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    // The list is a convenience; playing still works without it.
  }
}
