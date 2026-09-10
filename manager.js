// Headquarters/manager view: read-only visibility across locations.
// RLS scopes every query to the signed-in manager's own organization.
const app = document.getElementById("app");
let PROFILE = null;
let currentBranchId = null;

function showError(err) {
  console.error(err);
  app.innerHTML = `<div class="screen"><p class="muted" style="color:#b91c1c">Something went wrong: ${err.message || err}</p></div>`;
}

// Same in-app navigation history problem and fix as app.js: Dashboard ->
// Branch was a single history entry, so Back from a branch view skipped
// past the dashboard entirely. goBranch()/goDashboard() push real
// entries; the visible "←" button uses history.back() so it stays in
// sync with whatever the browser's Back button would also do.
function paintSidebar() {
  const links = [{ key: "dashboard", label: "Dashboard", icon: "dashboard", onClick: () => goDashboard() }];
  if (PROFILE?.role === "admin") {
    links.push({ key: "admin", label: "Admin", icon: "admin", onClick: () => { window.location.href = "admin.html"; } });
  }
  renderSidebar("Restaurant Ops", links, "dashboard");
}

async function goDashboard() {
  history.pushState({ view: "dashboard" }, "", "#dashboard");
  await renderDashboard();
  paintSidebar();
}
async function goBranch(locationId) {
  history.pushState({ view: "branch", locationId }, "", "#branch");
  await showBranch(locationId);
  paintSidebar();
}
window.addEventListener("popstate", (e) => {
  if (!e.state) return;
  if (e.state.view === "branch") showBranch(e.state.locationId);
  else renderDashboard();
  paintSidebar();
});

async function renderDashboard() {
  await runAsyncView(app, {
    load: () => Promise.all([
      Store.getLocations(),
      Store.todaysInventories(),
      Store.getDeliveries(),
    ]),
    render: ([locations, todaysRecords, deliveries]) => renderDashboardBody(locations, todaysRecords, deliveries),
  });
}

function renderDashboardBody(locations, todaysRecords, deliveries) {
  const rows = locations.map((loc) => ({
    loc,
    record: todaysRecords.find((r) => r.locationId === loc.id),
  }));
  const completeCount = rows.filter((r) => r.record).length;
  const missing = rows.filter((r) => !r.record);
  const today = new Date().toISOString().slice(0, 10);
  const deliveriesToday = deliveries.filter((d) => new Date(d.receivedAt).toISOString().slice(0, 10) === today);

  // Only real, currently-available signals go here — no invented
  // discrepancy/review counts, since that data doesn't exist yet (no AI
  // extraction, no expected-vs-received comparison built). "Needs
  // attention" today means exactly one thing: a location that hasn't
  // counted inventory yet.
  const needsAttention = missing;

  app.innerHTML = `
    <div class="topbar">
      <div class="brand">Manager Dashboard</div>
      ${PROFILE?.role === "admin" ? `<button class="pill" onclick="window.location.href='admin.html'" style="margin-left:auto">Admin</button>` : ""}
      <button class="pill" onclick="Auth.signOut()" style="${PROFILE?.role === "admin" ? "" : "margin-left:auto"}">Sign out</button>
    </div>
    <div class="screen">
      <h1>Today's Status</h1>
      <div class="mgr-status">
        <span class="status-chip">Inventory: ${completeCount}/${rows.length} completed</span>
        <span class="status-chip">Deliveries today: ${deliveriesToday.length}</span>
      </div>

      ${needsAttention.length > 0 ? `
        <p class="muted" style="margin-top:20px">Needs attention</p>
        ${needsAttention.map(({ loc }) => `
          <button class="branch-card" onclick="goBranch('${loc.id}')">
            <span class="branch-name">${loc.name}</span>
            <span class="badge red">Inventory not started</span>
          </button>
        `).join("")}
      ` : `<p class="muted" style="margin-top:20px;color:#15803d">✓ Nothing needs attention right now.</p>`}

      <p class="muted" style="margin-top:20px">All branches</p>
      ${rows.map(({ loc, record }) => `
        <button class="branch-card" onclick="goBranch('${loc.id}')">
          <span class="branch-name">${loc.name}</span>
          <span class="badge ${record ? "green" : "red"}">${record ? "Complete" : "Missing inventory"}</span>
        </button>
      `).join("")}
    </div>
  `;
}

async function showBranch(locationId) {
  currentBranchId = locationId;
  await runAsyncView(app, {
    load: () => Promise.all([
      Store.getLocations(),
      Store.getInventories({ locationId }),
      Store.getDeliveries({ locationId }),
    ]),
    render: ([locations, records, deliveries]) => renderBranchBody(locations, locationId, records, deliveries),
  });
}

function renderBranchBody(locations, locationId, records, deliveries) {
  const loc = locations.find((l) => l.id === locationId);

  app.innerHTML = `
    <div class="topbar"><button class="back" onclick="history.back()">←</button><div class="brand">${loc.name}</div></div>
    <div class="screen">
      <p class="muted">Recent deliveries</p>
      ${deliveries.length === 0 ? `<p class="muted">None recorded yet.</p>` : deliveries.slice(0, 10).map((d) => `
        <div class="history-card">
          <div class="history-head"><span>${d.supplierName}${d.invoiceNumber ? ` — ${d.invoiceNumber}` : ""}</span><span class="muted">by ${d.receivedBy}</span></div>
          ${d.items.map((it) => `<div class="review-row"><span>${it.productName}</span><span>${it.receivedQuantity} pcs${it.unitPrice != null ? ` @ ${it.unitPrice}` : ""}</span></div>`).join("")}
          ${d.documentPath ? `<button class="pill" onclick="viewDeliveryPhoto('${d.documentPath}')" style="margin-top:8px">View photo</button>` : ""}
        </div>
      `).join("")}

      <p class="muted" style="margin-top:20px">Inventory history</p>
      ${records.length === 0 ? `<p class="muted">No submissions yet.</p>` : records.map((r) => `
        <div class="history-card">
          <div class="history-head"><span>${r.date}</span><span class="muted">by ${r.employee}</span></div>
          ${r.items.map((it) => `
            <div class="review-row">
              <span>${it.productName}</span>
              <span style="display:flex;align-items:center;gap:8px">
                ${it.totalPieces} pcs
                ${PROFILE?.role === "admin" ? `<button class="pill" onclick="startCorrection('${it.itemId}','${it.productName.replace(/'/g, "\\'")}',${it.totalPieces})" style="padding:4px 10px;font-size:12px">Correct</button>` : ""}
              </span>
            </div>
          `).join("")}
        </div>
      `).join("")}
    </div>
    <div id="correctionModal"></div>
  `;
}

// Simple inline correction form — not a full modal component library,
// just enough to record "was X, should be Y, because Z" without an admin
// needing raw SQL. Preserved history and audit trail live server-side in
// correct_inventory_item() / inventory_item_corrections (schema.sql).
function startCorrection(itemId, productName, currentTotal) {
  document.getElementById("correctionModal").innerHTML = `
    <div class="screen" style="position:fixed;inset:0;background:rgba(0,0,0,.4);display:flex;align-items:flex-end;padding:0;max-width:none">
      <div style="background:#fff;border-radius:16px 16px 0 0;padding:20px;width:100%;max-width:480px;margin:0 auto">
        <h2 style="margin-top:0">Correct ${productName}</h2>
        <p class="muted">Currently recorded as ${currentTotal} pieces.</p>
        <label style="font-size:13px;color:#6b7280;font-weight:600">Correct piece count</label>
        <input id="correctionPieces" type="number" min="0" value="${currentTotal}"
          style="width:100%;padding:12px;margin:6px 0 14px;border:1px solid #e5e7eb;border-radius:10px">
        <label style="font-size:13px;color:#6b7280;font-weight:600">Reason (optional but recommended)</label>
        <input id="correctionReason" placeholder="e.g. Recounted, original count was wrong"
          style="width:100%;padding:12px;margin:6px 0 14px;border:1px solid #e5e7eb;border-radius:10px">
        <div style="display:flex;gap:8px">
          <button class="pill" onclick="document.getElementById('correctionModal').innerHTML=''">Cancel</button>
          <button id="saveCorrectionBtn" class="primary" style="margin-top:0" onclick="submitCorrection('${itemId}')">Save correction</button>
        </div>
      </div>
    </div>
  `;
}

async function submitCorrection(itemId) {
  const pieces = Number(document.getElementById("correctionPieces").value);
  const reason = document.getElementById("correctionReason").value.trim();
  if (isNaN(pieces) || pieces < 0) return;
  const btn = document.getElementById("saveCorrectionBtn");
  try {
    // Corrections are entered as a direct piece count (the simplest,
    // least error-prone way to fix a number after the fact) rather than
    // re-deriving boxes/pieces — correct_inventory_item() accepts any
    // valid entry mode, "pieces" is just the one this UI exposes.
    await withBusyButton(btn, () => Store.correctInventoryItem(itemId, { mode: "pieces", pieces }, reason), { busyText: "Saving…", doneText: "Saved ✓" });
    document.getElementById("correctionModal").innerHTML = "";
    if (currentBranchId) await showBranch(currentBranchId);
    else await renderDashboard();
  } catch (err) {
    showError(err);
  }
}

async function viewDeliveryPhoto(path) {
  try {
    const url = await Store.getDeliveryDocumentUrl(path);
    window.open(url, "_blank");
  } catch (err) {
    showError(err);
  }
}

function renderShell() {
  app.innerHTML = `<div class="topbar"><div class="brand">Manager Dashboard</div></div>`;
}

async function boot() {
  renderShell();
  await Auth.requireSession();
  try {
    PROFILE = await Store.init();
    // This is now backed by a real server-side boundary, not just UI: RLS
    // scopes an employee's reads/writes to their assigned location(s) via
    // the employee_locations table (see supabase/schema.sql), so even if
    // an employee opened this page directly they could not fetch another
    // location's data through the API. This check just gives them a clear
    // message instead of an empty/broken-looking dashboard.
    if (PROFILE.role === "employee") {
      app.innerHTML = `<div class="screen"><p class="muted">Manager or admin access required.</p></div>`;
      return;
    }
    history.replaceState({ view: "dashboard" }, "", "#dashboard");
    renderDashboard();
    paintSidebar();
  } catch (err) {
    showError(err);
  }
}
boot();
