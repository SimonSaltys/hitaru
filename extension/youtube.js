// Times real listening on YouTube. Nothing leaves the browser; the popup decides what gets logged.

const TICK_MS = 1000;
const FLUSH_MS = 5000;
// A slow tick means the machine slept, not that the video kept playing.
const MAX_TICK_MS = 5000;

function currentVideoId() {
  const { pathname, searchParams } = new URL(location.href);
  if (pathname === "/watch") return searchParams.get("v");
  return pathname.match(/^\/shorts\/([\w-]+)/)?.[1] ?? null;
}

/** Hover previews are muted, so requiring sound also leaves them out. */
function isListening() {
  const player = document.querySelector(".html5-video-player");
  if (player?.classList.contains("ad-showing")) return false;
  return [...document.querySelectorAll("video")].some(
    (video) => !video.paused && !video.ended && !video.muted && video.volume > 0 && video.readyState >= 3,
  );
}

function pageTitle() {
  return document.title.replace(/^\(\d+\)\s*/, "").replace(/\s*-\s*YouTube$/, "").trim();
}

function details() {
  // Shorts keeps a hidden watch page around, so its headings only count on /watch.
  if (location.pathname !== "/watch") {
    const channel = document.querySelector("ytd-reel-video-renderer[is-active] #channel-name a, .ytReelChannelBarViewModelChannelName a");
    return { title: pageTitle(), channel: channel?.textContent?.trim() ?? "" };
  }
  const heading = document.querySelector("ytd-watch-metadata h1");
  const channel = document.querySelector("ytd-watch-metadata ytd-channel-name a, #owner ytd-channel-name a");
  return { title: heading?.textContent?.trim() || pageTitle(), channel: channel?.textContent?.trim() ?? "" };
}

function localDate() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

let unsaved = 0;
let unsavedVideo = null;
let lastTick = Date.now();
let lastFlush = lastTick;

/** Adds up time for the video. Names are only read while the page still shows that video. */
async function flush() {
  if (!unsavedVideo || unsaved === 0) return;
  const videoId = unsavedVideo;
  const ms = unsaved;
  unsaved = 0;
  const onPage = currentVideoId() === videoId ? details() : null;
  const key = `watch:${videoId}`;
  const stored = (await chrome.storage.local.get(key))[key];
  await chrome.storage.local.set({
    [key]: {
      videoId,
      title: onPage?.title || stored?.title || "YouTube video",
      channel: onPage?.channel || stored?.channel || "",
      ms: (stored?.ms ?? 0) + ms,
      date: localDate(),
    },
  });
}

const interval = setInterval(() => {
  // After the extension reloads, this old copy of the script can't reach storage any more.
  if (!chrome.runtime?.id) {
    clearInterval(interval);
    return;
  }
  const now = Date.now();
  const elapsed = Math.min(now - lastTick, MAX_TICK_MS);
  lastTick = now;

  const videoId = currentVideoId();
  if (videoId !== unsavedVideo) {
    void flush();
    unsavedVideo = videoId;
  }
  if (videoId && isListening()) unsaved += elapsed;

  if (now - lastFlush >= FLUSH_MS) {
    lastFlush = now;
    void flush();
  }
}, TICK_MS);

window.addEventListener("pagehide", () => void flush());
