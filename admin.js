// Admin configuration UI: products, locations, and employee location
// assignments. This exists so a manager configuring their organization
// doesn't need direct SQL access (previously the only way — see README).
// It is a thin UI over storage.js's admin functions; the real
// authorization boundary is server-side RLS (schema.sql "admin insert/
// update" policies), not this page's role check below.
const app = document.getElementById("app");
let PROFILE = null;
const VALID_TABS = ["products", "locations", "suppliers", "team"];
const requestedTab = new URLSearchParams(location.search).get("tab");
let tab = VALID_TABS.includes(requestedTab) ? requestedTab : "products";

function showError(err) {
  console.error(err);
  const box = document.getElementById("adminError");
  if (box) {
    box.textContent = err.message || String(err);
    box.style.display = "block";
  }
  // Without this, a failed fetch left #adminBody showing the literal text
  // "Loading…" forever — the error banner above it was the only visible
  // sign anything went wrong, and there was no way to retry short of
  // switching tabs and back.
  const body = document.getElementById("adminBody");
  if (body) {
    body.innerHTML = errorScreen(err.message || String(err));
    const btn = body.querySelector(".retry-btn");
    if (btn) btn.onclick = () => render();
  }
}

async function render() {
  app.innerHTML = `
    <div class="topbar">
      <div class="brand">Admin</div>
      <button class="pill" onclick="Auth.signOut()" style="margin-left:auto">Sign out</button>
    </div>
    <div class="screen">
      <div class="tabs">
        <button class="tab ${tab === "products" ? "active" : ""}" data-tab="products">Products</button>
        <button class="tab ${tab === "locations" ? "active" : ""}" data-tab="locations">Locations</button>
        <button class="tab ${tab === "suppliers" ? "active" : ""}" data-tab="suppliers">Suppliers</button>
        <button class="tab ${tab === "team" ? "active" : ""}" data-tab="team">Team</button>
      </div>
      <div id="adminError" class="muted" style="color:#b91c1c;display:none;margin-bottom:12px"></div>
      <div id="adminBody"></div>
    </div>
  `;
  document.querySelectorAll(".tab").forEach((btn) => {
    btn.onclick = () => { tab = btn.dataset.tab; render(); };
  });
  try {
    if (tab === "products") await renderProducts();
    else if (tab === "locations") await renderLocations();
    else if (tab === "suppliers") await renderSuppliers();
    else await renderTeam();
  } catch (err) {
    showError(err);
  }
}

let PRODUCTS_CACHE = [];

async function renderProducts() {
  const products = await Store.getAllProducts();
  PRODUCTS_CACHE = products;
  const body = document.getElementById("adminBody");
  body.innerHTML = `
    <form id="productForm" style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin-bottom:16px">
      <div class="stepper-row"><label>Name</label><input name="name" required style="flex:1;margin-left:12px;padding:8px;border:1px solid #e5e7eb;border-radius:8px"></div>
      <div class="stepper-row"><label>Category</label><input name="category" required style="flex:1;margin-left:12px;padding:8px;border:1px solid #e5e7eb;border-radius:8px"></div>
      <div class="stepper-row"><label>Package unit</label><input name="packageUnit" value="box" required style="flex:1;margin-left:12px;padding:8px;border:1px solid #e5e7eb;border-radius:8px"></div>
      <div class="stepper-row"><label>Units per package</label><input name="unitsPerPackage" type="number" min="1" required style="flex:1;margin-left:12px;padding:8px;border:1px solid #e5e7eb;border-radius:8px"></div>
      <button class="primary" type="submit" style="margin-top:10px">Add product</button>
    </form>
    ${products.map((p) => `
      <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:12px 16px;margin-bottom:10px">
        <div class="list-row" style="cursor:default;padding:0;border:none">
          <span>${p.name} <span class="muted">— ${p.category}, 1 ${p.package_unit} = ${p.units_per_package} pcs</span></span>
          <div style="display:flex;gap:8px">
            <button class="pill" onclick="togglePackageEditor('${p.id}')">${productPackageSummary(p)}</button>
            <button class="pill" onclick="toggleProduct('${p.id}', ${!p.active})">${p.active ? "Deactivate" : "Reactivate"}</button>
          </div>
        </div>
        <div id="pkgEditor-${p.id}" style="display:none;margin-top:12px;border-top:1px solid #e5e7eb;padding-top:12px"></div>
      </div>
    `).join("")}
  `;
  document.getElementById("productForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const btn = e.target.querySelector("button[type=submit]");
    try {
      await withBusyButton(btn, () => Store.createProduct({
        name: f.get("name"), category: f.get("category"),
        packageUnit: f.get("packageUnit"), unitsPerPackage: Number(f.get("unitsPerPackage")),
      }), { busyText: "Adding…", doneText: "Added ✓" });
      await renderProducts();
    } catch (err) { showError(err); }
  });
}

function productPackageSummary(p) {
  const tiers = p.product_packages || [];
  if (tiers.length === 0 && p.base_unit === "piece") return "Configure packaging";
  const label = p.base_unit_label || p.base_unit;
  return tiers.length
    ? `${tiers.map((t) => t.name).join(" → ")} → ${label}`
    : `Tracked in ${label}`;
}

// Simple generic tier editor: base unit + an ordered list of package
// tiers (name/contains/unit), matching product_packages' shape exactly —
// works for ANY product (Pommes' 2-level hierarchy included) without a
// one-off UI per product. Kept intentionally plain: this is an admin
// configuration screen used rarely, not the employee-facing entry UI.
let pkgDraft = {}; // productId -> { baseUnit, baseUnitLabel, openPieceNotes, tiers: [{name,contains,unit}] }

function togglePackageEditor(productId) {
  const el = document.getElementById(`pkgEditor-${productId}`);
  const isOpen = el.style.display !== "none";
  if (isOpen) { el.style.display = "none"; return; }
  const p = PRODUCTS_CACHE.find((x) => x.id === productId);
  pkgDraft[productId] = {
    baseUnit: p.base_unit || "piece",
    baseUnitLabel: p.base_unit_label || "",
    openPieceNotes: !!p.open_piece_notes,
    tiers: (p.product_packages || []).map((t) => ({ name: t.name, contains: t.contains, unit: t.unit })),
  };
  el.style.display = "block";
  renderPackageEditor(productId);
}

function renderPackageEditor(productId) {
  const draft = pkgDraft[productId];
  const el = document.getElementById(`pkgEditor-${productId}`);
  el.innerHTML = `
    <div class="stepper-row"><label>Base unit</label>
      <select id="pkgBaseUnit-${productId}" style="padding:6px;border:1px solid #e5e7eb;border-radius:8px">
        ${["piece", "kg", "ml"].map((u) => `<option value="${u}" ${draft.baseUnit === u ? "selected" : ""}>${u}</option>`).join("")}
      </select>
    </div>
    <div class="stepper-row"><label>Display label (optional, e.g. "slice", "can")</label>
      <input id="pkgBaseLabel-${productId}" value="${draft.baseUnitLabel}" placeholder="${draft.baseUnit}" style="flex:1;margin-left:12px;padding:6px;border:1px solid #e5e7eb;border-radius:8px">
    </div>
    <div class="stepper-row"><label>Allow an unconverted note count</label>
      <input id="pkgOpenNotes-${productId}" type="checkbox" ${draft.openPieceNotes ? "checked" : ""}>
    </div>
    <p class="muted" style="margin:10px 0 4px">Package tiers (outermost first — e.g. carton → bag → base unit)</p>
    ${draft.tiers.map((t, i) => `
      <div class="stepper-row">
        <input value="${t.name}" placeholder="name (e.g. carton)" oninput="updatePkgTier('${productId}',${i},'name',this.value)" style="width:100px;padding:6px;border:1px solid #e5e7eb;border-radius:8px">
        <span class="muted">=</span>
        <input type="number" step="any" value="${t.contains}" oninput="updatePkgTier('${productId}',${i},'contains',this.value)" style="width:70px;padding:6px;border:1px solid #e5e7eb;border-radius:8px">
        <input value="${t.unit}" placeholder="unit (next tier or base unit)" oninput="updatePkgTier('${productId}',${i},'unit',this.value)" style="width:120px;padding:6px;border:1px solid #e5e7eb;border-radius:8px">
        <button onclick="removePkgTier('${productId}',${i})" style="border:none;background:none;color:#b91c1c;cursor:pointer">Remove</button>
      </div>
    `).join("")}
    <button class="pill" onclick="addPkgTier('${productId}')" style="margin-top:6px">+ Add tier</button>
    <div id="pkgEditorError-${productId}" class="muted" style="color:#b91c1c;display:none;margin-top:8px"></div>
    <button class="primary" id="pkgSaveBtn-${productId}" onclick="savePackageConfig('${productId}')" style="margin-top:10px">Save packaging</button>
  `;
  document.getElementById(`pkgBaseUnit-${productId}`).onchange = (e) => { draft.baseUnit = e.target.value; };
  document.getElementById(`pkgBaseLabel-${productId}`).oninput = (e) => { draft.baseUnitLabel = e.target.value; };
  document.getElementById(`pkgOpenNotes-${productId}`).onchange = (e) => { draft.openPieceNotes = e.target.checked; };
}

function addPkgTier(productId) {
  pkgDraft[productId].tiers.push({ name: "", contains: 1, unit: "" });
  renderPackageEditor(productId);
}
function removePkgTier(productId, i) {
  pkgDraft[productId].tiers.splice(i, 1);
  renderPackageEditor(productId);
}
function updatePkgTier(productId, i, field, value) {
  pkgDraft[productId].tiers[i][field] = field === "contains" ? value : value;
}

async function savePackageConfig(productId) {
  const draft = pkgDraft[productId];
  const errBox = document.getElementById(`pkgEditorError-${productId}`);
  errBox.style.display = "none";
  const tiers = draft.tiers.map((t) => ({ name: t.name.trim(), contains: Number(t.contains), unit: t.unit.trim() }));
  for (const t of tiers) {
    if (!t.name || !t.unit || !(t.contains > 0)) {
      errBox.textContent = "Every tier needs a name, a positive amount, and a unit.";
      errBox.style.display = "block";
      return;
    }
  }
  const btn = document.getElementById(`pkgSaveBtn-${productId}`);
  try {
    await withBusyButton(btn, async () => {
      await Store.updateProductBaseUnit(productId, {
        baseUnit: draft.baseUnit, baseUnitLabel: draft.baseUnitLabel, openPieceNotes: draft.openPieceNotes,
      });
      await Store.setProductPackages(productId, tiers);
    }, { busyText: "Saving…", doneText: "Saved ✓" });
    await renderProducts();
  } catch (err) {
    errBox.textContent = err.message || String(err);
    errBox.style.display = "block";
  }
}

async function toggleProduct(id, active) {
  try { await Store.setProductActive(id, active); await renderProducts(); }
  catch (err) { showError(err); }
}

async function renderLocations() {
  const locations = await Store.getAllLocations();
  const body = document.getElementById("adminBody");
  body.innerHTML = `
    <form id="locationForm" style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin-bottom:16px">
      <div class="stepper-row"><label>Name</label><input name="name" required style="flex:1;margin-left:12px;padding:8px;border:1px solid #e5e7eb;border-radius:8px"></div>
      <button class="primary" type="submit" style="margin-top:10px">Add location</button>
    </form>
    ${locations.map((l) => `
      <div class="list-row" style="cursor:default">
        <span>${l.name}</span>
        <button class="pill" onclick="toggleLocation('${l.id}', ${!l.active})">${l.active ? "Deactivate" : "Reactivate"}</button>
      </div>
    `).join("")}
  `;
  document.getElementById("locationForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const btn = e.target.querySelector("button[type=submit]");
    try {
      await withBusyButton(btn, () => Store.createLocation({ name: f.get("name") }), { busyText: "Adding…", doneText: "Added ✓" });
      await renderLocations();
    } catch (err) { showError(err); }
  });
}

async function toggleLocation(id, active) {
  try { await Store.setLocationActive(id, active); await renderLocations(); }
  catch (err) { showError(err); }
}

async function renderSuppliers() {
  const suppliers = await Store.getAllSuppliers();
  const body = document.getElementById("adminBody");
  body.innerHTML = `
    <form id="supplierForm" style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin-bottom:16px">
      <div class="stepper-row"><label>Name</label><input name="name" required style="flex:1;margin-left:12px;padding:8px;border:1px solid #e5e7eb;border-radius:8px"></div>
      <button class="primary" type="submit" style="margin-top:10px">Add supplier</button>
    </form>
    ${suppliers.length === 0 ? `<p class="muted">No suppliers yet — add one before anyone can record a delivery.</p>` : suppliers.map((s) => `
      <div class="list-row" style="cursor:default">
        <span>${s.name}</span>
        <button class="pill" onclick="toggleSupplier('${s.id}', ${!s.active})">${s.active ? "Deactivate" : "Reactivate"}</button>
      </div>
    `).join("")}
  `;
  document.getElementById("supplierForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const btn = e.target.querySelector("button[type=submit]");
    try {
      await withBusyButton(btn, () => Store.createSupplier(f.get("name")), { busyText: "Adding…", doneText: "Added ✓" });
      await renderSuppliers();
    } catch (err) { showError(err); }
  });
}

async function toggleSupplier(id, active) {
  try { await Store.setSupplierActive(id, active); await renderSuppliers(); }
  catch (err) { showError(err); }
}

async function renderTeam() {
  const [team, locations, invites] = await Promise.all([Store.getTeam(), Store.getAllLocations(), Store.getInvites()]);
  const body = document.getElementById("adminBody");
  const pendingInvites = invites.filter((i) => !i.used_at && new Date(i.expires_at) > new Date());

  body.innerHTML = `
    <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin-bottom:16px">
      <div class="stepper-row" style="margin-bottom:0">
        <label>Invite a new team member</label>
        <select id="inviteRole" style="padding:8px;border:1px solid #e5e7eb;border-radius:8px">
          <option value="employee">Employee</option>
          <option value="manager">Manager</option>
          <option value="admin">Admin</option>
        </select>
        <button id="createInviteBtn" class="pill" onclick="createInvite()">Generate code</button>
      </div>
      <p class="muted" style="margin-top:10px">Share the code with them (in person, chat, etc). They enter it at signup.html along with their own email and password — no SQL access needed. Codes expire after 7 days and work once.</p>
      <div id="newInviteCode"></div>
    </div>

    ${pendingInvites.length ? `
      <p class="muted">Pending invites</p>
      ${pendingInvites.map((i) => `
        <div class="list-row" style="cursor:default">
          <span><strong>${i.code}</strong> <span class="muted">— ${i.role}, expires ${new Date(i.expires_at).toLocaleDateString()}</span></span>
          <button class="pill" onclick="revokeInvite('${i.id}')">Revoke</button>
        </div>
      `).join("")}
    ` : ""}

    <p class="muted" style="margin-top:16px">Team</p>
    ${team.map((member) => `
      <div class="history-card">
        <div class="history-head"><span>${member.full_name}</span><span class="muted">${member.role}</span></div>
        ${member.role === "employee" ? `
          <div style="display:flex;flex-wrap:wrap;gap:6px;margin:8px 0">
            ${member.locations.length === 0 ? `<span class="muted">No locations assigned — this employee cannot start inventory anywhere yet.</span>` : ""}
            ${member.locations.map((l) => `
              <span class="badge green">${l.name}
                <button onclick="unassign('${member.id}','${l.id}')" style="border:none;background:none;color:#15803d;cursor:pointer;margin-left:4px">×</button>
              </span>
            `).join("")}
          </div>
          <div style="display:flex;gap:8px">
            <select id="loc-${member.id}" style="flex:1;padding:8px;border:1px solid #e5e7eb;border-radius:8px">
              ${locations.filter((l) => !member.locations.some((ml) => ml.id === l.id)).map((l) => `<option value="${l.id}">${l.name}</option>`).join("")}
            </select>
            <button class="pill" onclick="assign('${member.id}')">Assign</button>
          </div>
        ` : `<p class="muted">Sees and manages all locations in the organization.</p>`}
      </div>
    `).join("")}
  `;
}

async function createInvite() {
  const role = document.getElementById("inviteRole").value;
  const btn = document.getElementById("createInviteBtn");
  try {
    const code = await withBusyButton(btn, () => Store.createInvite(role), { busyText: "Generating…", doneText: "Generated ✓" });
    document.getElementById("newInviteCode").innerHTML =
      `<div class="total-card" style="margin-top:10px"><span>New code (${role})</span><span class="total-val">${code}</span></div>`;
    // Don't full re-render yet — that would wipe the code we just showed;
    // the new invite will simply appear in the pending list next visit.
  } catch (err) { showError(err); }
}

async function revokeInvite(id) {
  try { await Store.revokeInvite(id); await renderTeam(); }
  catch (err) { showError(err); }
}

async function assign(profileId) {
  const select = document.getElementById("loc-" + profileId);
  if (!select.value) return;
  try { await Store.assignEmployeeLocation(profileId, select.value); await renderTeam(); }
  catch (err) { showError(err); }
}

async function unassign(profileId, locationId) {
  try { await Store.unassignEmployeeLocation(profileId, locationId); await renderTeam(); }
  catch (err) { showError(err); }
}

function renderShell() {
  app.innerHTML = `<div class="topbar"><div class="brand">Admin</div></div>`;
}

async function boot() {
  renderShell();
  await Auth.requireSession();
  try {
    PROFILE = await Store.init();
    if (PROFILE.role !== "admin") {
      app.innerHTML = `<div class="screen"><p class="muted">Admin access required.</p></div>`;
      return;
    }
    render();
  } catch (err) {
    console.error(err);
    app.innerHTML = `<div class="screen"><p class="muted" style="color:#b91c1c">${err.message || err}</p></div>`;
  }
}
boot();
