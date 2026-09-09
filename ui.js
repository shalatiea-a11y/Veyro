// Shared button-feedback helper. Used everywhere a button triggers a
// network write, so every important action gets real state (Saving… ->
// Saved ✓ / error) instead of looking identical before, during, and after
// a tap — and the disabled state during the call IS the double-submit
// guard (a second tap while busy is a no-op, not a second request).

function errorScreen(message) {
  return `<div class="screen" style="align-items:center;justify-content:center;min-height:40vh;display:flex;flex-direction:column;gap:12px;text-align:center">
    <p class="muted" style="color:#b91c1c">Couldn't load this.${message ? ` (${message})` : ""}</p>
    <button class="primary retry-btn">Retry</button>
  </div>`;
}

// Fetches data and renders it into `container` — no loading screen, no
// spinner, nothing painted while the request is in flight. Requests here
// are all short Supabase queries, so the screen simply appears once the
// data is ready. On failure, renders a Retry button wired to re-run the
// exact same load+render instead of leaving the container stuck showing
// nothing (or whatever was there before).
function runAsyncView(container, { load, render }) {
  return Promise.resolve()
    .then(load)
    .then((data) => {
      render(data);
    })
    .catch((err) => {
      console.error(err);
      container.innerHTML = errorScreen(err.message || String(err));
      const btn = container.querySelector(".retry-btn");
      if (btn) btn.onclick = () => runAsyncView(container, { load, render });
    });
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
