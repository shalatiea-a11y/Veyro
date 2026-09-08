// Employee-facing mobile inventory workflow.
const app = document.getElementById("app");
let session = { entries: {} }; // productId -> { mode, fullBoxes, pieces, fraction }
let PRODUCTS = [];
let LOCATIONS = [];
let CATEGORIES = [];

function render(html) { app.innerHTML = html; }

function currentLocation() {
  const id = Store.getCurrentLocation();
  return LOCATIONS.find((l) => l.id === id) || LOCATIONS[0];
}

async function go(view, ...args) {
  await views[view](...args);
  window.scrollTo(0, 0);
}

function showError(err) {
  console.error(err);
  render(`<div class="screen"><p class="muted" style="color:#b91c1c">Something went wrong: ${err.message || err}</p></div>`);
}

const views = {
  async home() {
    render(`<div class="screen"><p class="muted">Loading…</p></div>`);
    const loc = currentLocation();
    const existing = await Store.todaysInventory(loc.id);
    render(`
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
          <button class="task-card" onclick="window.location.href='delivery.html'">
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
          return `
            <button class="list-row" onclick="go('productEntry','${p.id}')">
              <span>${p.name}</span>
              <span class="row-right">${total !== null ? total + " pcs ✓" : "Enter →"}</span>
            </button>
          `;
        }).join("")}
      </div>
    `);
  },

  async productEntry(productId) {
    const p = PRODUCTS.find((x) => x.id === productId);
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
      return { p, total: Store.normalizeQuantity(p, session.entries[pid]) };
    });
    render(`
      <div class="topbar"><button class="back" onclick="go('categories')">←</button><div class="brand">Review</div></div>
      <div class="screen">
        ${rows.length === 0 ? `<p class="muted">No products entered yet.</p>` : rows.map((r) => `
          <div class="review-row"><span>${r.p.name}</span><span>${r.total} pcs</span></div>
        `).join("")}
        <button class="primary sticky" ${rows.length === 0 ? "disabled" : ""} onclick="submitInventory()">Submit Inventory</button>
      </div>
    `);
  },

  async done(count) {
    render(`
      <div class="screen center">
        <div class="check">✓</div>
        <h1>Inventory submitted</h1>
        <p class="muted">${count} products recorded for ${currentLocation().name}</p>
        <button class="primary" onclick="resetSession(); go('home')">Back to Home</button>
      </div>
    `);
  },

  async history() {
    render(`<div class="screen"><p class="muted">Loading…</p></div>`);
    const loc = currentLocation();
    const records = await Store.getInventories({ locationId: loc.id });
    render(`
      <div class="topbar"><button class="back" onclick="go('home')">←</button><div class="brand">Previous Inventory</div></div>
      <div class="screen">
        ${records.length === 0 ? `<p class="muted">No submissions yet.</p>` : records.map((r) => `
          <div class="history-card">
            <div class="history-head"><span>${r.date}</span><span class="muted">${r.items.length} products</span></div>
            <div class="muted">By ${r.employee}</div>
          </div>
        `).join("")}
      </div>
    `);
  },
};

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
  try {
    await Store.saveInventory({
      locationId: loc.id,
      date: new Date().toISOString().slice(0, 10),
      items,
    });
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

async function boot() {
  await Auth.requireSession();
  render(`<div class="screen"><p class="muted">Loading…</p></div>`);
  try {
    await Store.init();
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
    go("home");
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
