// Employee-facing mobile inventory workflow.
const app = document.getElementById("app");
let session = { entries: {} }; // productId -> { mode, fullBoxes, pieces, fraction }
let PRODUCTS = [];
let LOCATIONS = [];
let CATEGORIES = [];
let PROFILE = null;

// Delivery Receiving used to be its own HTML document (delivery.html),
// reached via a full browser navigation. That navigation — unload this
// page, load a new one — is exactly what produced the white screen the
// user kept reporting even after every other loading/caching fix: none
// of those fixes could touch it, because the delay was the navigation
// itself, not anything our code renders. Moving it in here as a normal
// go()/views entry, like Categories or History, removes the navigation
// entirely — "opening" Delivery is now the same in-memory screen swap as
// every other in-app screen, with no document reload at all.
let SUPPLIERS = null; // null = not fetched yet; fetched once, lazily, on first visit
let deliveryItems = [];
let deliveryPhoto = null; // { file, previewUrl, uploadedPath, status: 'idle'|'uploading'|'uploaded'|'failed' }
const MAX_PHOTO_BYTES = 8 * 1024 * 1024; // matches the bucket's file_size_limit in schema.sql

async function ensureSuppliers() {
  if (SUPPLIERS === null) {
    const all = await Store.getAllSuppliers();
    SUPPLIERS = all.filter((s) => s.active);
  }
  return SUPPLIERS;
}

function render(html) { app.innerHTML = html; }

function currentLocation() {
  const id = Store.getCurrentLocation();
  return LOCATIONS.find((l) => l.id === id) || LOCATIONS[0];
}

// In-app navigation history. Without this, every go() call just
// overwrites #app's contents in place — the browser never learns a new
// "page" happened, so the entire Home->Inventory->Category->Product
// drill-down was a SINGLE history entry. Pressing Android/browser Back
// from three screens deep skipped straight past all of it to whatever
// page was open before this one (often exiting the PWA entirely). Each
// go() now pushes a real history entry; Back replays the previous one
// via popstate. Only once there's no in-app entry left does Back fall
// through to actual browser/OS back behavior, which is the correct rule.
async function go(view, ...args) {
  history.pushState({ view, args }, "", "#" + view);
  await views[view](...args);
  window.scrollTo(0, 0);
}

window.addEventListener("popstate", (e) => {
  if (e.state && views[e.state.view]) {
    views[e.state.view](...(e.state.args || []));
    window.scrollTo(0, 0);
  }
  // No state means we've fallen off the front of our own history stack —
  // let the browser handle Back normally (leave the page) rather than
  // guessing at a fallback view.
});

function showError(err) {
  console.error(err);
  render(`<div class="screen"><p class="muted" style="color:#b91c1c">Something went wrong: ${err.message || err}</p></div>`);
}

// Caches the "has this location's inventory been submitted today"
// lookup by location id. Without this, every return to Home — including
// just pressing Back from Categories, which needs no fresh data at all —
// re-ran the same query and repainted a full "Loading…" screen first.
// That's the concrete cause of the app feeling like "tap -> Loading ->
// Loading" the report describes: two loading screens back to back (the
// generic boot one, then this one) for data that hadn't changed. Now
// it's fetched once per location and reused; a fresh fetch only happens
// when the location changes (different cache key) or right after a
// submission (explicitly invalidated below), which are the only two
// moments the answer can actually be different.
let homeStatusCache = { locationId: null, existing: null };

async function loadHomeStatus(loc, { force = false } = {}) {
  if (!force && homeStatusCache.locationId === loc.id) {
    return homeStatusCache.existing;
  }
  const existing = await Store.todaysInventory(loc.id);
  homeStatusCache = { locationId: loc.id, existing };
  return existing;
}

// Consistent flat line-icon set for category tiles, keyed by category
// name (case-insensitive substring match, since categories are free text
// entered by an admin). No external icon font/CDN, no product photography
// pipeline in this environment — these are the "visually consistent
// illustration" fallback the design spec explicitly allows for when real
// product photos aren't practical, so a category at least reads as
// "bread" or "drinks" at a glance instead of a generic arrow. Falls back
// to a plain box icon for any category name that doesn't match.
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

const views = {
  async home({ force = false } = {}) {
    const loc = currentLocation();
    const isFresh = !force && homeStatusCache.locationId === loc.id;
    const renderHome = (existing) => render(`
      <div class="topbar">
        <div class="brand">Restaurant Ops</div>
        <button class="pill" onclick="go('locationPicker')">${loc.name} ▾</button>
        <button class="pill" onclick="Auth.signOut()" style="margin-left:6px">Sign out</button>
      </div>
      <div class="screen">
        <h1>Good morning</h1>
        <p class="muted">Today's tasks</p>
        <div class="tasklist">
          <button class="task-card ${existing ? "done" : "pending"}" onclick="go('categories')">
            <span class="dot ${existing ? "green" : "yellow"}"></span>
            <span class="task-label">Morning Inventory</span>
            <span class="task-status">${existing ? "Completed" : "Start"}</span>
          </button>
          <button class="task-card" onclick="go('delivery')">
            <span class="dot blue"></span>
            <span class="task-label">Delivery Receiving</span>
            <span class="task-status">Record delivery</span>
          </button>
          <button class="task-card" onclick="go('history')">
            <span class="dot blue"></span>
            <span class="task-label">Review Previous Inventory</span>
            <span class="task-status">View</span>
          </button>
        </div>
      </div>
    `);
    if (isFresh) {
      renderHome(homeStatusCache.existing);
      return;
    }
    await runAsyncView(app, {
      load: () => loadHomeStatus(loc, { force }),
      render: renderHome,
    });
  },

  async locationPicker() {
    render(`
      <div class="topbar"><button class="back" onclick="go('home')">←</button><div class="brand">Select Location</div></div>
      <div class="screen">
        ${LOCATIONS.map((l) => `
          <button class="list-row" onclick="Store.setCurrentLocation('${l.id}'); go('home')">${l.name}</button>
        `).join("")}
      </div>
    `);
  },

  async categories() {
    render(`
      <div class="topbar"><button class="back" onclick="go('home')">←</button><div class="brand">Morning Inventory</div></div>
      <div class="screen">
        <p class="muted">Select category</p>
        <div class="grid">
          ${CATEGORIES.map((c) => {
            const count = PRODUCTS.filter((p) => p.category === c).length;
            const done = PRODUCTS.filter((p) => p.category === c && session.entries[p.id]).length;
            return `
              <button class="category-tile" onclick="go('productList','${c}')">
                ${categoryIcon(c)}
                <div class="cat-name">${c}</div>
                <div class="cat-count">${done}/${count}</div>
              </button>
            `;
          }).join("")}
        </div>
        ${Object.keys(session.entries).length ? `<button class="primary sticky" onclick="go('review')">Review & Submit (${Object.keys(session.entries).length})</button>` : ""}
      </div>
    `);
  },

  async productList(category) {
    const products = PRODUCTS.filter((p) => p.category === category);
    render(`
      <div class="topbar"><button class="back" onclick="go('categories')">←</button><div class="brand">${category}</div></div>
      <div class="screen">
        ${products.map((p) => {
          const entry = session.entries[p.id];
          const total = entry ? Store.normalizeQuantity(p, entry) : null;
          const isGeneric = (p.packages && p.packages.length > 0) || (p.base_unit && p.base_unit !== "piece");
          const unitLabel = isGeneric ? (p.base_unit_label || p.base_unit) : "pcs";
          return `
            <button class="list-row" onclick="go('productEntry','${p.id}')">
              <span>${p.name}</span>
              <span class="row-right">${total !== null ? `${formatQty(total)} ${unitLabel} ✓` : "Enter →"}</span>
            </button>
          `;
        }).join("")}
      </div>
    `);
  },

  async productEntry(productId) {
    const p = PRODUCTS.find((x) => x.id === productId);
    // Employee counts, system calculates: any product with a configured
    // package hierarchy (product_packages rows) or a non-piece base unit
    // (kg/ml, e.g. Bacon) uses the generic conversion-engine UI below.
    // A product with neither — every product that existed before this
    // phase — falls straight through to the original boxes+pieces/
    // fraction/pieces UI, completely unchanged.
    if ((p.packages && p.packages.length > 0) || (p.base_unit && p.base_unit !== "piece")) {
      renderGenericProductEntry(p);
      return;
    }
    const entry = session.entries[productId] || { mode: "boxes+pieces", fullBoxes: 0, pieces: 0, fraction: "full" };
    session.entries[productId] = entry;

    const total = () => Store.normalizeQuantity(p, entry);

    render(`
      <div class="topbar"><button class="back" onclick="go('productList','${p.category}')">←</button><div class="brand">${p.name}</div></div>
      <div class="screen">
        <p class="muted">1 box = ${p.unitsPerBox} pieces</p>
        <div class="tabs">
          <button class="tab ${entry.mode === "boxes+pieces" ? "active" : ""}" data-mode="boxes+pieces">Boxes + pieces</button>
          <button class="tab ${entry.mode === "fraction" ? "active" : ""}" data-mode="fraction">Fraction</button>
          <button class="tab ${entry.mode === "pieces" ? "active" : ""}" data-mode="pieces">Pieces only</button>
        </div>
        <div id="entryBody"></div>
        <div class="total-card">
          <span>Total</span>
          <span id="totalVal" class="total-val">${total()} pieces</span>
        </div>
        <button class="primary sticky" onclick="commitEntry('${productId}')">Save</button>
      </div>
    `);

    function renderBody() {
      const body = document.getElementById("entryBody");
      if (entry.mode === "boxes+pieces") {
        body.innerHTML = `
          <div class="stepper-row">
            <label>Full boxes</label>
            <div class="stepper">
              <button onclick="stepField('${productId}','fullBoxes',-1)">−</button>
              <span id="val-fullBoxes">${entry.fullBoxes}</span>
              <button onclick="stepField('${productId}','fullBoxes',1)">+</button>
            </div>
          </div>
          <div class="stepper-row">
            <label>Individual pieces</label>
            <div class="stepper">
              <button onclick="stepField('${productId}','pieces',-1)">−</button>
              <span id="val-pieces">${entry.pieces}</span>
              <button onclick="stepField('${productId}','pieces',1)">+</button>
            </div>
          </div>
        `;
      } else if (entry.mode === "fraction") {
        const options = ["full", "3/4", "1/2", "1/3", "1/4"];
        body.innerHTML = `
          <div class="fraction-grid">
            ${options.map((f) => `<button class="fraction-btn ${entry.fraction === f ? "active" : ""}" onclick="setFraction('${productId}','${f}')">${f}</button>`).join("")}
          </div>
        `;
      } else {
        body.innerHTML = `
          <div class="stepper-row">
            <label>Pieces counted</label>
            <div class="stepper">
              <button onclick="stepField('${productId}','pieces',-1)">−</button>
              <span id="val-pieces">${entry.pieces}</span>
              <button onclick="stepField('${productId}','pieces',1)">+</button>
            </div>
          </div>
        `;
      }
    }
    renderBody();

    document.querySelectorAll(".tab").forEach((btn) => {
      btn.onclick = () => {
        entry.mode = btn.dataset.mode;
        renderBody();
        updateTotal();
        document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b === btn));
      };
    });

    window.stepField = (id, field, delta) => {
      const e = session.entries[id];
      e[field] = Math.max(0, (Number(e[field]) || 0) + delta);
      e._confirmedHigh = false; // any change re-triggers the suspicious-quantity check
      document.getElementById("val-" + field).textContent = e[field];
      updateTotal();
    };

    window.setFraction = (id, frac) => {
      session.entries[id].fraction = frac;
      renderBody();
      updateTotal();
    };

    function updateTotal() {
      document.getElementById("totalVal").textContent = total() + " pieces";
    }
  },

  async review() {
    const rows = Object.keys(session.entries).map((pid) => {
      const p = PRODUCTS.find((x) => x.id === pid);
      const isGeneric = (p.packages && p.packages.length > 0) || (p.base_unit && p.base_unit !== "piece");
      return { p, total: Store.normalizeQuantity(p, session.entries[pid]), unitLabel: isGeneric ? (p.base_unit_label || p.base_unit) : "pcs" };
    });
    render(`
      <div class="topbar"><button class="back" onclick="go('categories')">←</button><div class="brand">Review</div></div>
      <div class="screen">
        ${rows.length === 0 ? `<p class="muted">No products entered yet.</p>` : rows.map((r) => `
          <div class="review-row"><span>${r.p.name}</span><span>${formatQty(r.total)} ${r.unitLabel}</span></div>
        `).join("")}
        <button id="submitInventoryBtn" class="primary sticky" ${rows.length === 0 ? "disabled" : ""} onclick="submitInventory()">Submit Inventory</button>
      </div>
    `);
  },

  async done(count) {
    render(`
      <div class="screen center">
        <div class="check">✓</div>
        <h1>Inventory submitted</h1>
        <p class="muted">${count} products recorded for ${currentLocation().name}</p>
        <button class="primary" onclick="resetSession(); go('home', { force: true })">Back to Home</button>
      </div>
    `);
  },

  async history() {
    const loc = currentLocation();
    await runAsyncView(app, {
      load: () => Store.getInventories({ locationId: loc.id }),
      render: (records) => render(`
        <div class="topbar"><button class="back" onclick="go('home')">←</button><div class="brand">Previous Inventory</div></div>
        <div class="screen">
          ${records.length === 0 ? `<p class="muted">No submissions yet.</p>` : records.map((r) => `
            <div class="history-card">
              <div class="history-head"><span>${r.date}</span><span class="muted">${r.items.length} products</span></div>
              <div class="muted">By ${r.employee}</div>
            </div>
          `).join("")}
        </div>
      `),
    });
  },

  async delivery() {
    await ensureSuppliers();
    if (LOCATIONS.length === 0) {
      renderEmptyState("Delivery Receiving",
        "No location assigned",
        "You're not assigned to any location yet. Ask an administrator to assign you one (Admin → Team)."
      );
      return;
    }
    if (SUPPLIERS.length === 0) {
      renderEmptyState("Delivery Receiving",
        "No suppliers configured",
        PROFILE?.role === "admin"
          ? "Add a supplier before receiving your first delivery."
          : "Ask an administrator to add a supplier before you can receive a delivery.",
        PROFILE?.role === "admin"
          ? `<button class="primary" onclick="window.location.href='admin.html?tab=suppliers'">Add Supplier</button>`
          : ""
      );
      return;
    }
    // Without this check, addDeliveryItem() would crash on an empty
    // <select> (no active products -> PRODUCTS.find() returns undefined
    // -> reading undefined.name throws) with no visible error.
    if (PRODUCTS.length === 0) {
      renderEmptyState("Delivery Receiving",
        "No products configured",
        PROFILE?.role === "admin"
          ? "Add at least one product before receiving a delivery."
          : "Ask an administrator to configure at least one product before you can receive a delivery.",
        PROFILE?.role === "admin"
          ? `<button class="primary" onclick="window.location.href='admin.html?tab=products'">Add Product</button>`
          : ""
      );
      return;
    }
    renderDelivery();
  },
};

// Generic package-entry UI: one input per configured unit (e.g. Pommes
// gets "carton" / "bag" / "kg" fields; Stora kött gets "carton" /
// "piece"; Bacon, with no tiers at all, gets a single "kg" field). The
// employee fills in whichever field matches how they're actually
// counting — never has to do the arithmetic themselves. Live preview
// uses the exact same packaging.js functions the server-side
// resolve_generic_inventory_quantity() mirrors, so what's shown here is
// never a guess at what will be saved.
function renderGenericProductEntry(p) {
  const entry = session.entries[p.id] || { mode: "generic", breakdown: {} };
  entry.mode = "generic";
  session.entries[p.id] = entry;

  // Outer tier first (matches product_packages.sort_order), base_unit last.
  const fields = [
    ...p.packages.map((t) => ({ key: t.name, label: t.name })),
    { key: p.base_unit, label: p.base_unit_label || p.base_unit },
  ];

  function currentTotal() {
    try { return normalizeBreakdown(p, entry.breakdown); }
    catch (e) { return 0; }
  }

  function equivalentLine() {
    const total = currentTotal();
    if (total <= 0) return "";
    try {
      const parts = decompose(p, total).filter((part) => part.count > 0);
      return formatBreakdown(parts.length ? parts : [{ name: p.base_unit_label || p.base_unit, count: total }]);
    } catch (e) {
      return `${total} ${p.base_unit_label || p.base_unit}`;
    }
  }

  render(`
    <div class="topbar"><button class="back" onclick="go('productList','${p.category}')">←</button><div class="brand">${p.name}</div></div>
    <div class="screen">
      <p class="muted">${p.packages.map((t) => `1 ${t.name} = ${formatQty(t.contains)} ${t.unit}`).join(" · ") || `Tracked in ${p.base_unit_label || p.base_unit}`}</p>
      <div class="generic-entry-card">
        ${fields.map((f) => `
          <div class="stepper-row">
            <label>${capitalize(f.label)}</label>
            <input type="number" inputmode="decimal" min="0" step="any" id="qty-${f.key}"
              value="${entry.breakdown[f.key] ?? ""}" placeholder="0"
              style="width:110px;padding:10px;border:1px solid #e5e7eb;border-radius:8px;font-size:16px;text-align:right"
              oninput="updateGenericField('${p.id}','${f.key}', this.value)">
          </div>
        `).join("")}
        ${p.open_piece_notes ? `
          <div class="stepper-row">
            <label class="muted">Pieces (approx, optional)</label>
            <input type="number" inputmode="decimal" min="0" step="any" id="qty-_note_pieces"
              value="${entry.breakdown._note_pieces ?? ""}" placeholder="0"
              style="width:110px;padding:10px;border:1px solid #e5e7eb;border-radius:8px;font-size:16px;text-align:right"
              oninput="updateGenericField('${p.id}','_note_pieces', this.value)">
          </div>
          <p class="muted" style="font-size:12px">Not converted — the exact pieces per bag for this product isn't confirmed yet, so this is just a note.</p>
        ` : ""}
      </div>
      <div class="total-card">
        <span>Total</span>
        <span id="totalVal" class="total-val">${formatQty(currentTotal())} ${p.base_unit_label || p.base_unit}</span>
      </div>
      <p class="muted" id="equivLine" style="text-align:right">${equivalentLine()}</p>
      <button class="primary sticky" onclick="commitEntry('${p.id}')">Save</button>
    </div>
  `);

  window.updateGenericField = (id, key, value) => {
    const e = session.entries[id];
    if (value === "") delete e.breakdown[key];
    else e.breakdown[key] = value;
    document.getElementById("totalVal").textContent = `${formatQty(currentTotal())} ${p.base_unit_label || p.base_unit}`;
    document.getElementById("equivLine").textContent = equivalentLine();
  };
}

function formatQty(n) {
  const r = Math.round((Number(n) || 0) * 1000) / 1000;
  return r % 1 === 0 ? String(r) : String(r);
}

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function renderEmptyState(brand, title, body, actionHtml) {
  render(`
    <div class="topbar"><button class="back" onclick="go('home')">←</button><div class="brand">${brand}</div></div>
    <div class="screen empty-state">
      <span class="cat-icon">${DEFAULT_CATEGORY_ICON}</span>
      <h2>${title}</h2>
      <p>${body}</p>
      ${actionHtml || ""}
    </div>
  `);
}

function deliveryCurrentLocation() { return currentLocation(); }

function canSubmitDelivery() {
  return deliveryItems.length > 0 && (!deliveryPhoto || deliveryPhoto.status === "uploaded" || deliveryPhoto.status === "failed");
}

function deliveryPhotoSectionHtml() {
  if (!deliveryPhoto) {
    return `
      <div style="display:flex;gap:8px">
        <label class="pill" style="cursor:pointer">
          📷 Take Photo
          <input type="file" accept="image/*" capture="environment" onchange="onDeliveryPhotoSelected(event)" style="display:none">
        </label>
        <label class="pill" style="cursor:pointer">
          Upload from device
          <input type="file" accept="image/*" onchange="onDeliveryPhotoSelected(event)" style="display:none">
        </label>
      </div>
    `;
  }
  const statusLine = {
    uploading: `<p class="muted">Uploading…</p>`,
    uploaded: `<p class="muted" style="color:#15803d">✓ Attached</p>`,
    failed: `<p class="muted" style="color:#b91c1c">Upload failed — you can still submit without the photo, or retry.</p>`,
  }[deliveryPhoto.status] || "";
  return `
    <div style="display:flex;gap:12px;align-items:flex-start">
      <img src="${deliveryPhoto.previewUrl}" style="width:96px;height:96px;object-fit:cover;border-radius:10px;border:1px solid #e5e7eb">
      <div style="flex:1">
        ${statusLine}
        <div style="display:flex;gap:8px;margin-top:6px">
          ${deliveryPhoto.status === "failed" ? `<button class="pill" onclick="retryDeliveryPhotoUpload()">Retry upload</button>` : ""}
          <button class="pill" onclick="removeDeliveryPhoto()">Remove photo</button>
        </div>
      </div>
    </div>
  `;
}

function renderDelivery() {
  const loc = deliveryCurrentLocation();
  render(`
    <div class="topbar"><button class="back" onclick="go('home')">←</button><div class="brand">Delivery Receiving</div></div>
    <div class="screen">
      <p class="muted">Location: <strong>${loc ? loc.name : "none"}</strong></p>

      <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin-bottom:16px">
        <p class="muted" style="margin-top:0">Photo of invoice (optional, kept as a record — not read automatically)</p>
        ${deliveryPhotoSectionHtml()}
      </div>

      <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin-bottom:16px">
        <div class="stepper-row"><label>Supplier</label>
          <select id="supplier" style="flex:1;margin-left:12px;padding:8px;border:1px solid #e5e7eb;border-radius:8px">
            ${SUPPLIERS.map((s) => `<option value="${s.id}">${s.name}</option>`).join("")}
          </select>
        </div>
        <div class="stepper-row"><label>Invoice #</label>
          <input id="invoiceNumber" style="flex:1;margin-left:12px;padding:8px;border:1px solid #e5e7eb;border-radius:8px" placeholder="optional">
        </div>
      </div>

      <p class="muted">Add what was received</p>
      <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin-bottom:16px">
        <div class="stepper-row"><label>Product</label>
          <select id="deliveryProduct" style="flex:1;margin-left:12px;padding:8px;border:1px solid #e5e7eb;border-radius:8px">
            ${PRODUCTS.map((p) => `<option value="${p.id}">${p.name} (1 ${p.unit} = ${p.unitsPerBox} pcs)</option>`).join("")}
          </select>
        </div>
        <div class="stepper-row"><label>Full boxes</label>
          <input id="deliveryFullBoxes" type="number" min="0" value="0" style="width:100px;padding:8px;border:1px solid #e5e7eb;border-radius:8px">
        </div>
        <div class="stepper-row"><label>Pieces</label>
          <input id="deliveryPieces" type="number" min="0" value="0" style="width:100px;padding:8px;border:1px solid #e5e7eb;border-radius:8px">
        </div>
        <div class="stepper-row"><label>Unit price (optional)</label>
          <input id="deliveryUnitPrice" type="number" min="0" step="0.01" style="width:100px;padding:8px;border:1px solid #e5e7eb;border-radius:8px">
        </div>
        <button class="pill" onclick="addDeliveryItem()" style="margin-top:8px">Add to delivery</button>
      </div>

      ${deliveryItems.length ? `
        <p class="muted">Items in this delivery</p>
        ${deliveryItems.map((it, i) => `
          <div class="review-row">
            <span>${it.productName} — ${it.totalPieces} pcs${it.unitPrice != null ? ` @ ${it.unitPrice}` : ""}</span>
            <button onclick="removeDeliveryItem(${i})" style="border:none;background:none;color:#b91c1c;cursor:pointer">Remove</button>
          </div>
        `).join("")}
      ` : `<p class="muted">No items added yet.</p>`}

      <div id="deliveryError" class="muted" style="color:#b91c1c;display:none;margin-top:10px"></div>
      <button id="submitDeliveryBtn" class="primary sticky" ${!canSubmitDelivery() ? "disabled" : ""} onclick="submitDelivery()">
        ${deliveryPhoto && deliveryPhoto.status === "uploading" ? "Uploading photo…" : `Submit Delivery (${deliveryItems.length} items)`}
      </button>
    </div>
  `);
}

function showDeliveryError(err) {
  console.error(err);
  const box = document.getElementById("deliveryError");
  if (box) { box.textContent = err.message || String(err); box.style.display = "block"; }
}

async function onDeliveryPhotoSelected(event) {
  const file = event.target.files[0];
  event.target.value = ""; // allow re-selecting the same file later
  if (!file) return;

  if (!file.type.startsWith("image/")) {
    showDeliveryError(new Error("That file isn't an image. Please choose a photo."));
    return;
  }
  if (file.size > MAX_PHOTO_BYTES) {
    showDeliveryError(new Error(`That photo is too large (${(file.size / 1024 / 1024).toFixed(1)} MB) — the limit is 8 MB. Try again with lower camera quality, or retake it.`));
    return;
  }
  document.getElementById("deliveryError").style.display = "none";

  deliveryPhoto = { file, previewUrl: URL.createObjectURL(file), uploadedPath: null, status: "uploading" };
  renderDelivery();
  await uploadCurrentDeliveryPhoto();
}

async function uploadCurrentDeliveryPhoto() {
  try {
    const path = await Store.uploadDeliveryDocument(deliveryPhoto.file);
    deliveryPhoto.uploadedPath = path;
    deliveryPhoto.status = "uploaded";
  } catch (err) {
    console.error(err);
    deliveryPhoto.status = "failed";
  }
  renderDelivery();
}

function retryDeliveryPhotoUpload() {
  deliveryPhoto.status = "uploading";
  renderDelivery();
  uploadCurrentDeliveryPhoto();
}

function removeDeliveryPhoto() {
  if (deliveryPhoto?.previewUrl) URL.revokeObjectURL(deliveryPhoto.previewUrl);
  if (deliveryPhoto?.uploadedPath) {
    supabaseClient.storage.from("delivery-documents").remove([deliveryPhoto.uploadedPath]).catch(() => {});
  }
  deliveryPhoto = null;
  renderDelivery();
}

function addDeliveryItem() {
  const productId = document.getElementById("deliveryProduct").value;
  const product = PRODUCTS.find((p) => p.id === productId);
  const fullBoxes = Number(document.getElementById("deliveryFullBoxes").value) || 0;
  const pieces = Number(document.getElementById("deliveryPieces").value) || 0;
  const unitPriceRaw = document.getElementById("deliveryUnitPrice").value;
  const unitPrice = unitPriceRaw === "" ? null : Number(unitPriceRaw);

  if (fullBoxes === 0 && pieces === 0) {
    showDeliveryError(new Error("Enter at least one box or piece before adding."));
    return;
  }
  document.getElementById("deliveryError").style.display = "none";
  const entry = { mode: "boxes+pieces", fullBoxes, pieces };
  deliveryItems.push({
    productId,
    productName: product.name,
    entry,
    unitPrice,
    totalPieces: Store.normalizeQuantity(product, entry),
  });
  renderDelivery();
}

function removeDeliveryItem(index) {
  deliveryItems.splice(index, 1);
  renderDelivery();
}

async function submitDelivery() {
  const loc = deliveryCurrentLocation();
  const supplierId = document.getElementById("supplier").value;
  const invoiceNumber = document.getElementById("invoiceNumber").value.trim();
  if (!supplierId) {
    showDeliveryError(new Error("Select a supplier first."));
    return;
  }
  const btn = document.getElementById("submitDeliveryBtn");
  try {
    await withBusyButton(btn, () => Store.submitDelivery({
      locationId: loc.id,
      supplierId,
      invoiceNumber,
      invoiceDate: new Date().toISOString().slice(0, 10),
      notes: null,
      items: deliveryItems,
      documentPath: deliveryPhoto?.status === "uploaded" ? deliveryPhoto.uploadedPath : null,
    }), { busyText: "Confirming…", doneText: "Confirmed ✓" });
    if (deliveryPhoto?.previewUrl) URL.revokeObjectURL(deliveryPhoto.previewUrl);
    deliveryItems = [];
    deliveryPhoto = null;
    render(`
      <div class="screen center">
        <div class="check">✓</div>
        <h1>Delivery recorded</h1>
        <p class="muted">Saved for ${loc.name}</p>
        <button class="primary" onclick="go('home', { force: true })">Back to Home</button>
      </div>
    `);
  } catch (err) {
    showDeliveryError(err);
  }
}

// A soft sanity check, not a hard limit — some restaurants genuinely order
// in bulk. Never silently changes what the employee entered; it just asks
// for a second tap before accepting an unusually large count, the same
// principle as "AI proposes, human confirms" applied to plain data entry.
const SUSPICIOUS_BOX_THRESHOLD = 100;

function commitEntry(productId) {
  const p = PRODUCTS.find((x) => x.id === productId);
  const entry = session.entries[productId];
  const enteredBoxes = entry.mode === "boxes+pieces" ? Number(entry.fullBoxes) || 0 : 0;
  if (enteredBoxes > SUSPICIOUS_BOX_THRESHOLD && !entry._confirmedHigh) {
    const ok = window.confirm(
      `${enteredBoxes} boxes is unusually high for ${p.name}. That's ${Store.normalizeQuantity(p, entry)} pieces — is that right?`
    );
    if (!ok) return;
    entry._confirmedHigh = true;
  }
  go("productList", p.category);
}

async function submitInventory() {
  const loc = currentLocation();
  // Only the raw entries are sent — submit_daily_inventory() on the server
  // recomputes the normalized quantity itself rather than trusting a
  // client-supplied total.
  const items = Object.keys(session.entries).map((pid) => ({
    productId: pid,
    entry: session.entries[pid],
  }));
  const btn = document.getElementById("submitInventoryBtn");
  try {
    await withBusyButton(btn, () => Store.saveInventory({
      locationId: loc.id,
      date: new Date().toISOString().slice(0, 10),
      items,
    }), { busyText: "Submitting…", doneText: "Submitted ✓" });
    go("done", items.length);
  } catch (err) {
    if (String(err.message || "").includes("duplicate key")) {
      showError(new Error("Inventory for this location was already submitted today."));
    } else {
      showError(err);
    }
  }
}

function resetSession() { session = { entries: {} }; }

// Paints a minimal header synchronously, before any network call, so the
// screen never sits blank/white while boot()'s data queries are in
// flight. The location switcher and rest of the real Home screen replace
// this once LOCATIONS has actually loaded.
function renderShell() {
  render(`<div class="topbar"><div class="brand">Restaurant Ops</div></div>`);
}

async function boot() {
  renderShell();
  await Auth.requireSession();
  try {
    PROFILE = await Store.init();
    [PRODUCTS, LOCATIONS] = await Promise.all([Store.getProducts(), Store.getLocations()]);
    CATEGORIES = [...new Set(PRODUCTS.map((p) => p.category))];
    // The cached location id is a device-local preference, not org data —
    // it can point at a location from a different account that previously
    // used this browser, or one that no longer exists. Validate it against
    // what this signed-in user's organization actually has.
    const cachedId = Store.getCurrentLocation();
    const cachedIsValid = cachedId && LOCATIONS.some((l) => l.id === cachedId);
    if (!cachedIsValid && LOCATIONS[0]) {
      Store.setCurrentLocation(LOCATIONS[0].id);
    }
    if (LOCATIONS.length === 0) {
      throw new Error("No locations configured for your organization yet.");
    }
    await loadHomeStatus(currentLocation());
    // replaceState, not go()'s pushState: this is the initial view for
    // this page load, not a navigation the user took — it shouldn't add
    // an extra Back step on top of whatever brought them to index.html.
    history.replaceState({ view: "home", args: [] }, "", "#home");
    await views.home();
    window.scrollTo(0, 0);
  } catch (err) {
    showError(err);
  }
}
boot();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}
