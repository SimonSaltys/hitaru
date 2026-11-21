const HITARU_URL = "http://localhost:5173/";
// Shorter than this is clicking past a video, not watching it.
const MIN_LISTED_MS = 15_000;

const list = document.getElementById("videos");
const empty = document.getElementById("empty");
const waiting = document.getElementById("waiting");
const logAll = document.getElementById("log-all");
const clearAll = document.getElementById("clear-all");

function minutes(ms) {
  return Math.max(1, Math.round(ms / 60_000));
}

async function watched() {
  const everything = await chrome.storage.local.get(null);
  return Object.values(
    Object.fromEntries(Object.entries(everything).filter(([key]) => key.startsWith("watch:"))),
  )
    .filter((video) => video.ms >= MIN_LISTED_MS)
    .sort((a, b) => b.date.localeCompare(a.date) || b.ms - a.ms);
}

/** Named by channel, so a channel's videos add up in Hitaru's top titles. */
function toSession(video) {
  return {
    id: crypto.randomUUID(),
    date: video.date,
    minutes: minutes(video.ms),
    category: "YouTube",
    title: video.channel || video.title,
    comprehension: null,
  };
}

async function logVideos(videos) {
  const { outbox = [] } = await chrome.storage.local.get("outbox");
  await chrome.storage.local.set({ outbox: [...outbox, ...videos.map(toSession)] });
  await chrome.storage.local.remove(videos.map((video) => `watch:${video.videoId}`));
}

/** Drops every timed video, including the short ones the list hides. */
async function clearWatched() {
  const everything = await chrome.storage.local.get(null);
  await chrome.storage.local.remove(Object.keys(everything).filter((key) => key.startsWith("watch:")));
}

// Clearing can't be undone, so the first click only arms the button.
let clearArmed = false;
let disarmTimer;
clearAll.addEventListener("click", () => {
  if (clearArmed) {
    clearTimeout(disarmTimer);
    clearArmed = false;
    clearAll.textContent = "Clear all";
    void clearWatched();
    return;
  }
  clearArmed = true;
  clearAll.textContent = "Click again to clear";
  disarmTimer = setTimeout(() => {
    clearArmed = false;
    clearAll.textContent = "Clear all";
  }, 3000);
});

function button(label, className, onClick) {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = label;
  element.className = className;
  element.addEventListener("click", onClick);
  return element;
}

async function render() {
  const videos = await watched();
  const { outbox = [] } = await chrome.storage.local.get("outbox");

  list.replaceChildren(
    ...videos.map((video) => {
      const title = document.createElement("div");
      title.className = "title";
      title.textContent = video.title;

      const info = document.createElement("span");
      info.className = "muted";
      info.textContent = [`${minutes(video.ms)} min`, video.channel, video.date].filter(Boolean).join(" · ");

      const actions = document.createElement("span");
      actions.className = "actions";
      actions.append(
        button("Dismiss", "quiet", () => chrome.storage.local.remove(`watch:${video.videoId}`)),
        button("Log", "primary", () => logVideos([video])),
      );

      const row = document.createElement("div");
      row.className = "row";
      row.append(info, actions);

      const item = document.createElement("li");
      item.append(title, row);
      return item;
    }),
  );

  empty.hidden = videos.length > 0;
  logAll.hidden = videos.length < 2;
  logAll.textContent = `Log all ${videos.length}`;
  logAll.onclick = () => logVideos(videos);
  clearAll.hidden = videos.length < 2;

  waiting.hidden = outbox.length === 0;
  if (outbox.length > 0) {
    const link = document.createElement("a");
    link.href = HITARU_URL;
    link.target = "_blank";
    link.textContent = "Open Hitaru";
    waiting.replaceChildren(
      `${outbox.length} ${outbox.length === 1 ? "session is" : "sessions are"} waiting for Hitaru to open. `,
      link,
    );
  }
}

chrome.storage.onChanged.addListener(() => void render());
void render();
