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
      render(data);
    })
    .catch((err) => {
      settled = true;
      clearTimeout(timer);
      console.error(err);
      container.innerHTML = errorScreen(err.message || String(err));
      const btn = container.querySelector(".retry-btn");
      if (btn) btn.onclick = () => runAsyncView(container, { load, render, loadingLabel, delayMs });
    });
}

// Real (not simulated) connectivity signal from navigator.onLine plus the
// browser's online/offline events — no fake "server health" polling. Stays
// hidden while online so it never distracts; only appears when the device
// itself has no network, which is the one case Supabase calls can't
// distinguish from "backend is just slow".
function initConnectivityBadge() {
  if (document.getElementById("connBadge")) return;
  const badge = document.createElement("div");
  badge.id = "connBadge";
  badge.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:9999;background:#b91c1c;color:#fff;font-size:13px;text-align:center;padding:6px;display:none";
  badge.textContent = "You're offline — some actions may fail";
  document.body.appendChild(badge);
  function update() {
    badge.style.display = navigator.onLine ? "none" : "block";
  }
  window.addEventListener("online", update);
  window.addEventListener("offline", update);
  update();
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
      button.textContent = doneText;
      setTimeout(() => {
        button.disabled = false;
        button.textContent = original;
      }, 900);
      return result;
    })
    .catch((err) => {
      button.disabled = false;
      button.textContent = original;
      throw err;
    });
}
