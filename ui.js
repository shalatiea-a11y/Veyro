// Shared button-feedback helper. Used everywhere a button triggers a
// network write, so every important action gets real state (Saving… ->
// Saved ✓ / error) instead of looking identical before, during, and after
// a tap — and the disabled state during the call IS the double-submit
// guard (a second tap while busy is a no-op, not a second request).
function loadingScreen(label = "Loading…") {
  return `<div class="screen" style="align-items:center;justify-content:center;min-height:40vh;display:flex;flex-direction:column;gap:10px;text-align:center">
    <div style="width:28px;height:28px;border:3px solid #e5e7eb;border-top-color:#111827;border-radius:50%;animation:spin .7s linear infinite"></div>
    <p class="muted">${label}</p>
  </div>
  <style>@keyframes spin{to{transform:rotate(360deg)}}</style>`;
}

function errorScreen(message) {
  return `<div class="screen" style="align-items:center;justify-content:center;min-height:40vh;display:flex;flex-direction:column;gap:12px;text-align:center">
    <p class="muted" style="color:#b91c1c">Couldn't load this.${message ? ` (${message})` : ""}</p>
    <button class="primary retry-btn">Retry</button>
  </div>`;
}

// Fetches data and renders it into `container`, but only paints a loading
// screen if the fetch is still running after `delayMs` — a fast request
// (the common case, online) never flashes "Loading…" at all. On failure,
// renders a Retry button wired to re-run the exact same load+render instead
// of leaving whatever was on screen (often the loading text itself) stuck
// there forever.
function runAsyncView(container, { load, render, loadingLabel = "Loading…", delayMs = 150 }) {
  let settled = false;
  const timer = setTimeout(() => {
    if (!settled) container.innerHTML = loadingScreen(loadingLabel);
  }, delayMs);

  return Promise.resolve()
    .then(load)
    .then((data) => {
      settled = true;
      clearTimeout(timer);
      reportApiOutcome(null);
      render(data);
    })
    .catch((err) => {
      settled = true;
      clearTimeout(timer);
      reportApiOutcome(err);
      console.error(err);
      container.innerHTML = errorScreen(err.message || String(err));
      const btn = container.querySelector(".retry-btn");
      if (btn) btn.onclick = () => runAsyncView(container, { load, render, loadingLabel, delayMs });
    });
}

// Two DISTINCT real signals, never conflated:
//  - internet: navigator.onLine + the browser's online/offline events. This
//    is reliable and instant.
//  - server: whether the last real Supabase round-trip actually completed.
//    There is no health-check polling (that would be an extra request just
//    to paint a badge, and this app is online-first — every screen already
//    makes real requests via runAsyncView/withBusyButton). Every one of
//    those calls reports its outcome here, so the badge reflects genuine
//    request history, not a fabricated status.
let serverReachable = true;

function isNetworkError(err) {
  const msg = String((err && err.message) || err || "").toLowerCase();
  return msg.includes("failed to fetch") || msg.includes("networkerror") || msg.includes("network request failed");
}

// Called by runAsyncView/withBusyButton after every real request. A normal
// app-level error (bad input, RLS denial, duplicate key) says nothing about
// connectivity, so it does NOT flip the server badge — only a genuine
// fetch-level failure does. A successful round-trip is direct proof the
// server IS reachable, so it always clears the flag.
function reportApiOutcome(err) {
  if (err) {
    if (isNetworkError(err)) serverReachable = false;
  } else {
    serverReachable = true;
  }
  updateConnBadge();
}

function updateConnBadge() {
  const badge = document.getElementById("connBadge");
  if (!badge) return;
  if (!navigator.onLine) {
    badge.textContent = "⚠ Offline";
    badge.style.background = "#fef2f2";
    badge.style.color = "#b91c1c";
  } else if (!serverReachable) {
    badge.textContent = "⚠ Connection problem";
    badge.style.background = "#fef2f2";
    badge.style.color = "#b91c1c";
  } else {
    badge.textContent = "✓ Online";
    badge.style.background = "#f0fdf4";
    badge.style.color = "#15803d";
  }
}

function initConnectivityBadge() {
  if (document.getElementById("connBadge")) return;
  const badge = document.createElement("div");
  badge.id = "connBadge";
  badge.style.cssText = "position:fixed;top:8px;right:8px;z-index:9999;font-size:11px;font-weight:600;padding:3px 9px;border-radius:999px;box-shadow:0 1px 3px rgba(0,0,0,.12)";
  document.body.appendChild(badge);
  window.addEventListener("online", updateConnBadge);
  window.addEventListener("offline", updateConnBadge);
  updateConnBadge();
}
if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", initConnectivityBadge);
}

function withBusyButton(button, fn, { busyText = "Saving…", doneText = "Saved ✓" } = {}) {
  if (!button || button.disabled) return Promise.resolve();
  const original = button.textContent;
  button.disabled = true;
  button.textContent = busyText;
  return Promise.resolve()
    .then(fn)
    .then((result) => {
      reportApiOutcome(null);
      button.textContent = doneText;
      setTimeout(() => {
        button.disabled = false;
        button.textContent = original;
      }, 900);
      return result;
    })
    .catch((err) => {
      reportApiOutcome(err);
      button.disabled = false;
      button.textContent = original;
      throw err;
    });
}
