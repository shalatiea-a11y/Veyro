// One small hand-rolled SVG icon set, shared by every page, instead of
// emoji or a mix of ad-hoc icon styles. Deliberately NOT an external
// icon library (Lucide, etc.): this project ships zero runtime
// dependencies by design (the one exception, the Supabase SDK, is a
// hard requirement, not a style choice), and 24x24 stroke-based icons in
// this exact style already existed for category tiles before this pass
// — this just gives the same treatment to actions/navigation instead of
// introducing a second, inconsistent icon system alongside it. Same
// visual language throughout: 1.8 stroke width, round caps/joins, no
// fill, 24x24 viewBox — swap in a real icon library later with a
// find-and-replace of uiIcon() call sites if ever justified.
const UI_ICONS = {
  home: `<path d="M3 11l9-7 9 7"/><path d="M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9"/>`,
  inventory: `<path d="M9 4h6v3H9z"/><rect x="5" y="7" width="14" height="14" rx="1.5"/><path d="M9 12h6M9 16h6"/>`,
  delivery: `<rect x="2" y="8" width="12" height="9" rx="1"/><path d="M14 11h4l3 3v3h-3"/><circle cx="7" cy="19" r="1.6"/><circle cx="17" cy="19" r="1.6"/>`,
  suppliers: `<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>`,
  location: `<path d="M12 21s7-6.5 7-11.5a7 7 0 1 0-14 0C5 14.5 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.3"/>`,
  history: `<circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2"/><path d="M9 2h6"/>`,
  dashboard: `<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>`,
  team: `<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.5 2.7-6 6-6s6 2.5 6 6"/><circle cx="17.5" cy="9" r="2.3"/><path d="M15.5 13c2.6.4 4.5 2.4 4.5 5"/>`,
  admin: `<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M4.2 6.2l2.1 2.1M17.7 15.7l2.1 2.1M3 12h3M18 12h3M4.2 17.8l2.1-2.1M17.7 8.3l2.1-2.1"/>`,
  signout: `<path d="M9 21H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>`,
  plus: `<path d="M12 5v14M5 12h14"/>`,
  minus: `<path d="M5 12h14"/>`,
  chevronLeft: `<path d="M15 18l-6-6 6-6"/>`,
  close: `<path d="M6 6l12 12M18 6L6 18"/>`,
  edit: `<path d="M4 20h4l10.5-10.5a2 2 0 0 0-4-4L4 16v4z"/>`,
  trash: `<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>`,
  check: `<path d="M5 13l4 4L19 7"/>`,
  alert: `<path d="M12 3l9 17H3z"/><path d="M12 10v4M12 17.5v.1"/>`,
  camera: `<path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="14" r="3.5"/>`,
  document: `<path d="M7 3h7l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v4h4"/>`,
};
const DEFAULT_UI_ICON = `<circle cx="12" cy="12" r="9"/>`;

function uiIcon(name, size = 18) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${UI_ICONS[name] || DEFAULT_UI_ICON}</svg>`;
}

// Renders the persistent desktop sidebar (hidden by CSS below 1024px).
// `links`: [{ key, label, icon, onClick }]. `activeKey` highlights the
// current section. Lives outside whatever the page's router
// overwrites, so it's rendered once and only needs re-rendering when
// the active section changes (cheap — it's a handful of nodes).
function renderSidebar(brand, links, activeKey, onSignOut) {
  const el = document.getElementById("sidebar");
  if (!el) return;
  el.innerHTML = `
    <div class="sidebar-brand">${brand}</div>
    ${links.map((l) => `<button class="sidebar-link ${l.key === activeKey ? "active" : ""}" data-key="${l.key}">${uiIcon(l.icon)}<span>${l.label}</span></button>`).join("")}
    <div class="sidebar-spacer"></div>
    <button class="sidebar-link" id="sidebarSignOut">${uiIcon("signout")}<span>Sign out</span></button>
  `;
  links.forEach((l) => {
    el.querySelector(`[data-key="${l.key}"]`).onclick = l.onClick;
  });
  const signOutBtn = document.getElementById("sidebarSignOut");
  if (signOutBtn) signOutBtn.onclick = onSignOut || (() => Auth.signOut());
}

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
