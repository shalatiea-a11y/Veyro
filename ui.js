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

// Veyro wordmark: a rounded gradient badge with a cut "V" mark, plus the
// name. `animate` plays the draw-in/pop-in once (sign-in/sign-up/join
// screens, each rendered a single time); pass false for the sidebar,
// which repaints on every navigation and shouldn't replay motion there.
// The gradient needs a unique <id> per call — this can render twice at
// once (sidebar + topbar, both visible on desktop), and duplicate SVG
// ids are invalid even though most browsers silently tolerate it.
let _veyroLogoInstance = 0;
function veyroLogo(size = 28, animate = true) {
  const gradId = `veyroGrad${_veyroLogoInstance++}`;
  return `<span class="veyro-logo ${animate ? "veyro-logo-animate" : ""}" style="--logo-size:${size}px">
    <svg class="veyro-logo-mark" width="${size}" height="${size}" viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <rect x="1.5" y="1.5" width="37" height="37" rx="11" fill="url(#${gradId})"/>
      <path class="veyro-logo-v" d="M11 12.5l9 16 9-16" stroke="#fff" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round"/>
      <defs>
        <linearGradient id="${gradId}" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
          <stop stop-color="#4f86ff"/>
          <stop offset="1" stop-color="#1d4ed8"/>
        </linearGradient>
      </defs>
    </svg>
    <span class="veyro-logo-text">Veyro</span>
  </span>`;
}

// Consistent flat line-icon set for category tiles, keyed by category
// name (case-insensitive substring match, since categories are free text
// entered by an admin). Falls back to a plain box icon for any category
// name that doesn't match. Shared across app.js/admin.js/manager.js.
const CATEGORY_ICONS = {
  meat: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="5"/><circle cx="12" cy="16" r="5"/></svg>`,
  bread: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12a8 5 0 0 1 16 0v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M8 12v2M12 11v3M16 12v2"/></svg>`,
  drinks: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="3" width="10" height="18" rx="2"/><path d="M7 9h10"/></svg>`,
  frozen: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M4.5 6.5l15 11M19.5 6.5l-15 11"/></svg>`,
  cheese: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l9-11 9 11z"/><circle cx="12" cy="15" r=".6" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r=".6" fill="currentColor" stroke="none"/></svg>`,
  vegetable: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21c-4-1-7-4-7-9a5 5 0 0 1 9-3 5 5 0 0 1 5 9c-1 2-4 3-7 3z"/><path d="M12 9V4"/></svg>`,
  sauce: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2c3 3 5 6 5 9a5 5 0 0 1-10 0c0-3 2-6 5-9z"/></svg>`,
};
const DEFAULT_CATEGORY_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7l9-4 9 4-9 4-9-4z"/><path d="M3 7v10l9 4 9-4V7M12 11v10"/></svg>`;

function categoryIcon(categoryName) {
  const key = String(categoryName || "").toLowerCase();
  const match = Object.keys(CATEGORY_ICONS).find((k) => key.includes(k));
  return `<span class="cat-icon">${match ? CATEGORY_ICONS[match] : DEFAULT_CATEGORY_ICON}</span>`;
}

// Per-product visual identity fallback — a distinct color/shape combo per
// catalog product (including the three Monster variants, which must
// never look identical to each other), used only when a product has no
// real uploaded photo yet (see productIcon() below).
const PRODUCT_VISUAL = {
  "monster energy": { shape: "drinks", color: "#16a34a" },
  "monster ultra": { shape: "drinks", color: "#64748b" },
  "monster mango": { shape: "drinks", color: "#f97316" },
  "bacon": { shape: "meat", color: "#b91c1c" },
  "stora kött": { shape: "meat", color: "#dc2626" },
  "small kött": { shape: "meat", color: "#ef4444" },
  "kycklingburgare crispy": { shape: "meat", color: "#d97706" },
  "vegoburgare crispy nochick o": { shape: "meat", color: "#65a30d" },
  "stora bröd": { shape: "bread", color: "#b45309" },
  "small bröd": { shape: "bread", color: "#c2833f" },
  "potatis bröd": { shape: "bread", color: "#a16207" },
  "glutenfri": { shape: "bread", color: "#92400e" },
  "pommes": { shape: "frozen", color: "#eab308" },
  "nuggets": { shape: "frozen", color: "#f59e0b" },
  "chili cheese": { shape: "cheese", color: "#dc2626" },
  "ost cheddar": { shape: "cheese", color: "#f59e0b" },
  "grillost": { shape: "cheese", color: "#ca8a04" },
};

// Accepts either a product object (preferred — checked for a real uploaded
// photo first) or a bare name (legacy call sites, always falls back to the
// color icon since there's no image_url to check).
function productIcon(product, size) {
  const name = typeof product === "string" ? product : product?.name;
  const imageUrl = typeof product === "object" ? product?.image_url : null;
  const dim = size || 40;
  if (imageUrl) {
    return `<img class="product-photo" src="${imageUrl}" alt="" width="${dim}" height="${dim}" style="width:${dim}px;height:${dim}px" loading="lazy">`;
  }
  const key = String(name || "").toLowerCase();
  const visual = PRODUCT_VISUAL[key];
  const shape = CATEGORY_ICONS[visual?.shape] || DEFAULT_CATEGORY_ICON;
  const color = visual?.color || "#2563eb";
  return `<span class="cat-icon" style="width:${dim}px;height:${dim}px;color:${color};background:${color}1a">${shape}</span>`;
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
      // Small delight, not a notification: a brief scale+glow on the
      // button itself, plus a short haptic tick where supported (mobile
      // Chrome/Android) — both feature-detected/no-ops everywhere else,
      // so this is safe to fire on every successful action app-wide.
      button.classList.add("btn-success-pop");
      if (navigator.vibrate) { try { navigator.vibrate(12); } catch (e) {} }
      setTimeout(() => {
        button.disabled = false;
        button.textContent = original;
        button.classList.remove("btn-success-pop");
      }, 900);
      return result;
    })
    .catch((err) => {
      button.disabled = false;
      button.textContent = original;
      throw err;
    });
}
