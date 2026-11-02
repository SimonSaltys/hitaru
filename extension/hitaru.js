// Hands queued sessions to an open Hitaru page. They leave the queue only once the page has saved them.

async function deliver() {
  const { outbox = [] } = await chrome.storage.local.get("outbox");
  if (outbox.length > 0) window.postMessage({ type: "hitaru:log", sessions: outbox }, location.origin);
}

window.addEventListener("message", async (event) => {
  if (event.source !== window || event.origin !== location.origin) return;
  if (event.data?.type === "hitaru:ready") void deliver();
  if (event.data?.type === "hitaru:logged" && Array.isArray(event.data.ids)) {
    const { outbox = [] } = await chrome.storage.local.get("outbox");
    await chrome.storage.local.set({ outbox: outbox.filter((s) => !event.data.ids.includes(s.id)) });
  }
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.outbox) void deliver();
});

void deliver();
