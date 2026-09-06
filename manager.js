// Headquarters/manager view: read-only visibility across locations.
// RLS scopes every query to the signed-in manager's own organization.
const app = document.getElementById("app");
let PROFILE = null;

function showError(err) {
  console.error(err);
  app.innerHTML = `<div class="screen"><p class="muted" style="color:#b91c1c">Something went wrong: ${err.message || err}</p></div>`;
}

async function renderDashboard() {
  app.innerHTML = `<div class="screen"><p class="muted">Loading…</p></div>`;
  const [locations, todaysRecords] = await Promise.all([Store.getLocations(), Store.todaysInventories()]);

  const rows = locations.map((loc) => ({
    loc,
    record: todaysRecords.find((r) => r.locationId === loc.id),
  }));
  const completeCount = rows.filter((r) => r.record).length;

  app.innerHTML = `
    <div class="topbar">
      <div class="brand">Manager Dashboard</div>
      ${PROFILE?.role === "admin" ? `<button class="pill" onclick="window.location.href='admin.html'" style="margin-left:auto">Admin</button>` : ""}
      <button class="pill" onclick="Auth.signOut()" style="${PROFILE?.role === "admin" ? "" : "margin-left:auto"}">Sign out</button>
    </div>
    <div class="screen">
      <h1>Today's Status</h1>
      <div class="mgr-status"><span class="status-chip">Inventory: ${completeCount}/${rows.length} completed</span></div>
      <p class="muted">Branches</p>
      ${rows.map(({ loc, record }) => `
        <button class="branch-card" onclick="showBranch('${loc.id}')">
          <span class="branch-name">${loc.name}</span>
          <span class="badge ${record ? "green" : "red"}">${record ? "Complete" : "Missing inventory"}</span>
        </button>
      `).join("")}
    </div>
  `;
}

async function showBranch(locationId) {
  app.innerHTML = `<div class="screen"><p class="muted">Loading…</p></div>`;
  const [locations, records] = await Promise.all([
    Store.getLocations(),
    Store.getInventories({ locationId }),
  ]);
  const loc = locations.find((l) => l.id === locationId);

  app.innerHTML = `
    <div class="topbar"><button class="back" onclick="renderDashboard()">←</button><div class="brand">${loc.name}</div></div>
    <div class="screen">
      ${records.length === 0 ? `<p class="muted">No submissions yet.</p>` : records.map((r) => `
        <div class="history-card">
          <div class="history-head"><span>${r.date}</span><span class="muted">by ${r.employee}</span></div>
          ${r.items.map((it) => `<div class="review-row"><span>${it.productName}</span><span>${it.totalPieces} pcs</span></div>`).join("")}
        </div>
      `).join("")}
    </div>
  `;
}

async function boot() {
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
    renderDashboard();
  } catch (err) {
    showError(err);
  }
}
boot();
