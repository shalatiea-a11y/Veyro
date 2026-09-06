// Admin configuration UI: products, locations, and employee location
// assignments. This exists so a manager configuring their organization
// doesn't need direct SQL access (previously the only way — see README).
// It is a thin UI over storage.js's admin functions; the real
// authorization boundary is server-side RLS (schema.sql "admin insert/
// update" policies), not this page's role check below.
const app = document.getElementById("app");
let PROFILE = null;
let tab = "products";

function showError(err) {
  console.error(err);
  const box = document.getElementById("adminError");
  if (box) {
    box.textContent = err.message || String(err);
    box.style.display = "block";
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
        <button class="tab ${tab === "team" ? "active" : ""}" data-tab="team">Team</button>
      </div>
      <div id="adminError" class="muted" style="color:#b91c1c;display:none;margin-bottom:12px"></div>
      <div id="adminBody"><p class="muted">Loading…</p></div>
    </div>
  `;
  document.querySelectorAll(".tab").forEach((btn) => {
    btn.onclick = () => { tab = btn.dataset.tab; render(); };
  });
  try {
    if (tab === "products") await renderProducts();
    else if (tab === "locations") await renderLocations();
    else await renderTeam();
  } catch (err) {
    showError(err);
  }
}

async function renderProducts() {
  const products = await Store.getAllProducts();
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
      <div class="list-row" style="cursor:default">
        <span>${p.name} <span class="muted">— ${p.category}, 1 ${p.package_unit} = ${p.units_per_package} pcs</span></span>
        <button class="pill" onclick="toggleProduct('${p.id}', ${!p.active})">${p.active ? "Deactivate" : "Reactivate"}</button>
      </div>
    `).join("")}
  `;
  document.getElementById("productForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      await Store.createProduct({
        name: f.get("name"), category: f.get("category"),
        packageUnit: f.get("packageUnit"), unitsPerPackage: Number(f.get("unitsPerPackage")),
      });
      await renderProducts();
    } catch (err) { showError(err); }
  });
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
    try { await Store.createLocation({ name: f.get("name") }); await renderLocations(); }
    catch (err) { showError(err); }
  });
}

async function toggleLocation(id, active) {
  try { await Store.setLocationActive(id, active); await renderLocations(); }
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
        <button class="pill" onclick="createInvite()">Generate code</button>
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
  try {
    const code = await Store.createInvite(role);
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

async function boot() {
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
