// Automated, repeatable multi-tenant RLS regression test — closes the
// exact gap the technical audit found: cross-org isolation and role
// permissions were previously only verified through ad-hoc manual psql
// sessions during development, never as a re-runnable test. This applies
// the REAL supabase/schema.sql to a REAL local Postgres instance (via
// the project's existing tests/../shim, same approach used throughout
// this project's history) and drives it as two separate organizations,
// each with an admin and an employee, using the actual RLS-enforcing
// "authenticated" role — not a superuser bypass.
//
// Requires a local Postgres reachable via `psql` with no password
// (peer/trust auth) — the same environment this project's schema
// migrations have been manually verified against all along. If that
// isn't available, this test SKIPS (exit 0) rather than failing "npm
// test" on a machine with no local Postgres — this is an integration
// test against a real database engine, not a pure logic test like the
// other files in this directory.
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const DB = "veyro_rls_test_" + Date.now();
const results = [];
function check(label, cond) { results.push({ label, pass: !!cond }); }

function psql(sql, { db = DB } = {}) {
  try {
    const out = execSync(`sudo -u postgres psql -d ${db} -t -A -F'|' -v ON_ERROR_STOP=1`, {
      input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
    });
    return { ok: true, out };
  } catch (e) {
    return { ok: false, out: (e.stdout || "") + (e.stderr || "") };
  }
}

// psql -t suppresses column headers/footers for SELECT results, but
// still prints command-completion tags (SET, BEGIN, ROLLBACK, UPDATE N)
// for every other statement in the same script — so the actual query
// result isn't reliably "the first line". Pull out the first line that
// looks like a plain result value instead.
function firstResultLine(out) {
  const line = out.split("\n").find((l) => /^-?\d+(\.\d+)?$/.test(l.trim()) || /^[0-9a-f-]{36}$/.test(l.trim()) || l.trim() === "t" || l.trim() === "f");
  return line ? line.trim() : null;
}
function affectedRowCount(out, verb) {
  const m = out.match(new RegExp(`${verb} (\\d+)`));
  return m ? Number(m[1]) : null;
}

function main() {
  // Availability check — skip gracefully if there's no local Postgres.
  try {
    execSync("sudo -u postgres psql -c 'select 1' postgres", { stdio: "ignore" });
  } catch (e) {
    console.log("SKIPPED: no local Postgres reachable in this environment — RLS test needs a real database engine.");
    console.log("0/0 passed (skipped, not a failure)");
    process.exit(0);
  }

  const shimPath = "/tmp/shim.sql";
  if (!fs.existsSync(shimPath)) {
    console.log("SKIPPED: /tmp/shim.sql (Supabase auth/storage emulation shim) not present in this environment.");
    console.log("0/0 passed (skipped, not a failure)");
    process.exit(0);
  }

  execSync(`sudo -u postgres psql -c "DROP DATABASE IF EXISTS ${DB};"`, { stdio: "ignore" });
  execSync(`sudo -u postgres psql -c "CREATE DATABASE ${DB};"`, { stdio: "ignore" });
  execSync(`sudo -u postgres psql -d ${DB} -f ${shimPath}`, { stdio: "ignore" });
  const schemaResult = execSync(`sudo -u postgres psql -d ${DB} -1 -f ${path.join(__dirname, "..", "supabase", "schema.sql")} 2>&1 || true`, { encoding: "utf8" });
  check("schema.sql applies cleanly to a fresh database", !/ERROR/i.test(schemaResult));

  // Two separate organizations, each with an admin + employee + a
  // location + a product, so every isolation check has a real
  // counterpart to fail against, not just an empty table.
  psql(`
    insert into auth.users (id) values
      ('a0000000-0000-0000-0000-000000000001'), ('a0000000-0000-0000-0000-000000000002'),
      ('b0000000-0000-0000-0000-000000000001'), ('b0000000-0000-0000-0000-000000000002');
    insert into organizations (id, name) values
      ('11111111-1111-1111-1111-111111111111', 'Org A'),
      ('22222222-2222-2222-2222-222222222222', 'Org B');
    insert into profiles (id, organization_id, full_name, role) values
      ('a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'A Admin', 'admin'),
      ('a0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'A Employee', 'employee'),
      ('b0000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'B Admin', 'admin'),
      ('b0000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'B Employee', 'employee');
    insert into locations (id, organization_id, name) values
      ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'A Branch'),
      ('b1000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'B Branch');
    insert into employee_locations (profile_id, location_id) values
      ('a0000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001'),
      ('b0000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000001');
    insert into suppliers (id, organization_id, name) values
      ('a2000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'A Supplier'),
      ('b2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'B Supplier');
    insert into products (id, organization_id, name, category, package_unit, units_per_package, base_unit) values
      ('a3000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'A Product', 'Meat', 'box', 24, 'piece'),
      ('b3000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'B Product', 'Meat', 'box', 24, 'piece');
  `);

  const asAEmployee = `SET ROLE authenticated; BEGIN; SET LOCAL request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000002';`;
  const asAAdmin = `SET ROLE authenticated; BEGIN; SET LOCAL request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';`;
  const asBEmployee = `SET ROLE authenticated; BEGIN; SET LOCAL request.jwt.claim.sub = 'b0000000-0000-0000-0000-000000000002';`;

  // --- Positive control: an org can see its OWN data (proves the
  // negative results below are real isolation, not just broken queries). ---
  let r = psql(`${asAEmployee} select count(*) from products; ROLLBACK;`);
  check("Org A employee CAN see Org A's own products (positive control)", firstResultLine(r.out) === "1");

  // --- Organization A cannot access Organization B's data. ---
  r = psql(`${asAEmployee} select count(*) from products where organization_id = '22222222-2222-2222-2222-222222222222'; ROLLBACK;`);
  check("Org A employee sees ZERO of Org B's products (RLS-filtered, not an error)", r.ok && firstResultLine(r.out) === "0");

  r = psql(`${asAEmployee} select count(*) from suppliers where organization_id = '22222222-2222-2222-2222-222222222222'; ROLLBACK;`);
  check("Org A employee sees ZERO of Org B's suppliers", r.ok && firstResultLine(r.out) === "0");

  r = psql(`${asAEmployee} select count(*) from locations where organization_id = '22222222-2222-2222-2222-222222222222'; ROLLBACK;`);
  check("Org A employee sees ZERO of Org B's locations", r.ok && firstResultLine(r.out) === "0");

  // --- Organization A cannot WRITE into Organization B via the RPCs
  // (server-side validation, not just a UI restriction). ---
  r = psql(`${asAEmployee}
    select submit_daily_inventory('b1000000-0000-0000-0000-000000000001'::uuid,
      jsonb_build_array(jsonb_build_object('product_id', 'a3000000-0000-0000-0000-000000000001', 'entry_mode', 'boxes_pieces', 'entered_full_boxes', 1, 'entered_pieces', 0)))
      is not null; ROLLBACK;`);
  check("Org A employee CANNOT submit inventory for Org B's location (RPC raises, not silently scoped)",
    !r.ok && /does not belong to your organization/.test(r.out));

  r = psql(`${asAAdmin}
    select submit_daily_inventory('a1000000-0000-0000-0000-000000000001'::uuid,
      jsonb_build_array(jsonb_build_object('product_id', 'b3000000-0000-0000-0000-000000000001', 'entry_mode', 'boxes_pieces', 'entered_full_boxes', 1, 'entered_pieces', 0)))
      is not null; ROLLBACK;`);
  check("Org A admin CANNOT submit inventory using Org B's product_id",
    !r.ok && /does not belong to your organization/.test(r.out));

  // --- An employee cannot modify admin-only data, even within their OWN organization. ---
  r = psql(`${asAEmployee}
    insert into product_packages (product_id, sort_order, name, contains, unit)
    values ('a3000000-0000-0000-0000-000000000001', 1, 'carton', 24, 'piece'); ROLLBACK;`);
  check("Employee CANNOT write product_packages even in their own org (admin-only RLS policy)",
    !r.ok && /row-level security/.test(r.out));

  r = psql(`${asAEmployee}
    update products set name = 'Hacked' where id = 'a3000000-0000-0000-0000-000000000001'; ROLLBACK;`);
  // RLS silently filters the row out of the UPDATE's target set rather
  // than throwing — "UPDATE 0" (not an error) is the correct signature
  // of a blocked write here, same as a real Postgres RLS UPDATE policy
  // always behaves. Confirmed distinct from a real update by the
  // positive control below.
  check("Employee's UPDATE on a product affects ZERO rows (admin-only RLS policy blocks it)",
    r.ok && affectedRowCount(r.out, "UPDATE") === 0);

  r = psql(`${asAAdmin}
    update products set name = 'A Product' where id = 'a3000000-0000-0000-0000-000000000001'; ROLLBACK;`);
  check("Org A's OWN admin CAN update their own org's product (positive control)",
    r.ok && affectedRowCount(r.out, "UPDATE") === 1);

  // Submit a real inventory item as A's employee, then confirm B's admin
  // cannot correct it (cross-org write-blocking on a specific real row,
  // not just an empty-table check).
  psql(`${asAEmployee}
    select submit_daily_inventory('a1000000-0000-0000-0000-000000000001'::uuid,
      jsonb_build_array(jsonb_build_object('product_id', 'a3000000-0000-0000-0000-000000000001', 'entry_mode', 'boxes_pieces', 'entered_full_boxes', 1, 'entered_pieces', 0)));
    COMMIT;`);
  const itemIdResult = psql(`select ii.id from inventory_items ii join products p on p.id = ii.product_id where p.organization_id = '11111111-1111-1111-1111-111111111111';`);
  const itemId = itemIdResult.out.trim().split("\n")[0].trim();
  check("the cross-org correction test has a real inventory item to target", /^[0-9a-f-]{36}$/.test(itemId));

  const asBAdmin = `SET ROLE authenticated; BEGIN; SET LOCAL request.jwt.claim.sub = 'b0000000-0000-0000-0000-000000000001';`;
  r = psql(`${asBAdmin}
    select correct_inventory_item(p_item_id => '${itemId}'::uuid, p_entry_mode => 'boxes_pieces', p_full_boxes => 99, p_pieces => 0, p_fraction => null, p_reason => 'cross-org tampering attempt'); ROLLBACK;`);
  check("Org B's admin CANNOT correct an inventory item that belongs to Org A",
    !r.ok && /not found in your organization/.test(r.out));

  // A's own admin CAN correct it — proves the block above is real
  // isolation, not the function being broken outright.
  r = psql(`${asAAdmin}
    select correct_inventory_item(p_item_id => '${itemId}'::uuid, p_entry_mode => 'boxes_pieces', p_full_boxes => 2, p_pieces => 0, p_fraction => null, p_reason => 'legit recount') is not null; ROLLBACK;`);
  check("Org A's OWN admin CAN correct their own org's inventory item (positive control)", r.ok);

  execSync(`sudo -u postgres psql -c "DROP DATABASE IF EXISTS ${DB};"`, { stdio: "ignore" });

  results.forEach((x) => console.log(`${x.pass ? "PASS" : "FAIL"}  ${x.label}`));
  const failed = results.filter((x) => !x.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exit(1);
}

main();
