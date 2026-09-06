# Restaurant Ops — Inventory MVP

A mobile-first, installable (PWA) product for the first slice of a larger
restaurant operations platform: morning inventory counting, with real
multi-tenant authentication and data isolation via Supabase.

**Philosophy:** the employee counts and confirms; the software calculates.
No AI is used here — box/piece conversions are deterministic arithmetic
against a configurable, per-organization product catalog.

## Status

Honest classification per area (see "Testing" for exactly what each claim rests on):

| Area | Status |
|---|---|
| Deterministic quantity calculations (boxes+pieces, fractions, pieces, edge cases) | **VERIFIED** — 19/19 automated tests, `tests/calculations.test.js` |
| Server-side recomputation of quantities (client can't fabricate a total) | **VERIFIED** against a real local Postgres instance |
| Cross-organization data isolation (RLS) | **VERIFIED** against a real local Postgres instance (see below) — not yet verified against the actual hosted Supabase project, since none exists yet |
| Atomic submission (no orphaned rows on partial failure) | **VERIFIED** — reproduced the old bug, confirmed the fix prevents it |
| Admin-only edit/delete of inventory history | **VERIFIED** locally |
| Per-employee location scoping (`employee_locations`) — employees can't read/write outside their assigned branch, only admins can edit the product/location catalog | **VERIFIED** locally, including a real RLS infinite-recursion bug found and fixed during testing (see "Phase 2" below) |
| Concurrent submissions to the same location/day don't corrupt data | **VERIFIED** — two genuinely parallel processes raced against real Postgres; exactly one won, zero orphaned rows (see "Phase 3") |
| Query scalability (no N+1, bounded result sets) | **VERIFIED** the fix's data shape against real Postgres; **NOT VERIFIED** under actual load/many-rows since this is still demo-scale data |
| PWA icons render correctly on iOS home screen | **NOT VERIFIED** on a physical device (no device access in this sandbox) — but the underlying defect (SVG icon, unsupported by iOS Safari) is fixed with real PNGs; verified the files are valid images of the correct dimensions |
| Admin UI (`admin.html`) — create/deactivate products & locations, assign/unassign employees to locations | **VERIFIED** the underlying writes against real Postgres (each SQL statement the UI issues, run directly); **NOT VERIFIED** in a browser — see Phase 4 below |
| `employee_locations` read policy scoped to the caller's own organization | **VERIFIED** (real bug, real fix — see Phase 4) |
| Employee self-service onboarding via invite code (`signup.html`/`join.html`, `redeem_invite()`) | **VERIFIED** against real Postgres: valid redemption, reused/expired/nonexistent code rejection, already-has-a-profile rejection, cross-org invite invisibility, and a genuine concurrent-redemption race (see Phase 5) — **NOT VERIFIED** in a browser, and the email-confirmation branch's exact behavior depends on Supabase Auth settings this sandbox can't configure or test |
| Employee/manager UI screens, PWA install, real Supabase Auth login | **NOT VERIFIED** — requires a real Supabase project + browser; this sandbox has no browser and cannot provision Supabase |
| Delivery receiving, invoice AI, integrations, forecasting | **NOT BUILT** — deliberately out of scope for this MVP |

### How the backend was verified without a live Supabase project

This sandbox has PostgreSQL 16 installed locally (but no Supabase account/
credentials). To actually test the RLS policies and the `submit_daily_inventory`
function — rather than just reading them — a minimal shim was created that
emulates the two Supabase-specific pieces `schema.sql` depends on
(`auth.users`, `auth.uid()`), the full schema was applied to a throwaway
local database, and a non-superuser `authenticated` role was used so RLS
was actually enforced (superusers bypass RLS entirely, which would make
the test meaningless). Two organizations, three users (two in org 1 — one
employee, one admin — and one employee in a rival org 2) were created, and
the following were run as real queries impersonating each user:

- Org 1 employee sees only org 1's 3 locations and 10 products — confirmed.
- Org 1 employee submits inventory; server recomputes the total (verified
  it stores exactly 576 for 24 boxes @ 24/box, matching the spec).
- Org 1 employee tries to submit inventory **against the rival org's
  location** → rejected by the function's own check, before RLS even needs
  to intervene.
- Rival org employee runs a raw `SELECT` against `locations`/`products`/
  `inventory_submissions` → sees only their own org's rows, zero of org 1's.
- Rival org employee attempts a raw `INSERT` directly into
  `inventory_submissions` naming org 1's `organization_id` → rejected with
  "new row violates row-level security policy".
- Org 1 employee (role `employee`) attempts to `DELETE` a historical
  submission → `DELETE 0` (silently blocked by RLS, no rows affected).
- Org 1 **admin** performs the same delete → succeeds.
- Duplicate same-day submission for one location → rejected with a unique
  constraint violation, and critically, **zero rows left behind** — verified
  by counting rows as the table owner after the rejected attempt.
- To prove the atomicity fix actually mattered: the *old* two-step
  insert-then-insert pattern was manually reproduced (insert a submission,
  skip the items insert to simulate a mid-write failure) — this did leave
  an orphaned submission row, and a legitimate retry for that same
  location+day was then permanently rejected by the unique constraint with
  no way to recover. This confirms the bug was real and that
  `submit_daily_inventory()`'s single-transaction design fixes it.

What this does *not* prove: it does not exercise Supabase's actual Auth
service (GoTrue), PostgREST's HTTP layer, or the browser-side `auth.js`/
`storage.js`/`app.js` code against a real network — only the SQL/RLS layer,
which was the part most likely to hide a real vulnerability. The browser
flow still needs a real Supabase project to verify end-to-end.

### Phase 2: per-employee location scoping (`employee_locations`)

The first audit pass above left one gap explicitly flagged as a known
limitation: `locations` and `products` used `for all` RLS policies, so any
authenticated org member — including a plain employee — could directly
`INSERT`/`UPDATE`/`DELETE` those tables through the API, not just read
them. Closed by adding an `employee_locations` assignment table and
splitting every policy into per-action rules (read: broad; write:
admin-only; inventory read: employees scoped to their assigned
location(s), admins/managers see everything).

Testing this against the same local Postgres setup immediately surfaced a
real bug: the `locations` policy queries `employee_locations` to check an
employee's assignment, and the first version of the `employee_locations`
policy queried `locations` right back — Postgres detected the circular
dependency and refused every query on either table with "infinite
recursion detected in policy." Fixed by rewriting the `employee_locations`
policy to check `profile_id = auth.uid()` directly instead of joining
through `locations`. Re-ran the full scenario after the fix:

- An employee assigned only to "Downtown" sees exactly one location, not
  the other two — confirmed.
- The same employee's attempt to submit inventory for "Mall Branch"
  (same org, just unassigned) is rejected by `submit_daily_inventory()`
  — confirmed (the error message says "does not belong to your
  organization" rather than "not assigned," because RLS itself hides the
  unassigned location from the query the function uses to check it; this
  is a cosmetic inaccuracy, not a security gap — if anything it leaks
  less information to the caller than a precise message would).
- The same employee submitting to their own assigned location succeeds.
- Direct `INSERT` into `locations` or `products` by an employee is now
  rejected — confirmed (previously would have succeeded).
- A manager with **no** row in `employee_locations` at all still sees all
  3 org locations and all of the org's inventory submissions — confirmed
  the admin/manager blanket-visibility rule works independently of the
  assignment table.
- A manager's attempt to directly `INSERT` a product is rejected (manager
  is not admin) — confirmed the write restriction is role-specific, not
  just "not a plain employee."
- An admin's `INSERT` into `locations` succeeds — confirmed.

This is the same class of finding the rest of this document keeps
emphasizing: the recursion bug would not have been caught by reading the
SQL, only by actually running it.

### Phase 3: scalability, concurrency, and PWA correctness

A second audit pass, deliberately looking for things the first two passes
hadn't checked rather than re-running identical checks against unchanged
code:

- **N+1 query bug**: `getInventories()` fetched N submissions, then issued
  a *separate* query per submission for its line items — fine with 1-2 demo
  rows, but hundreds of extra round-trips per page load for a real chain's
  history. Fixed by embedding `inventory_items(...)` directly in the
  submission query (PostgREST/Postgres does the join server-side). Verified
  the resulting data shape by running the equivalent SQL join directly
  against Postgres — confirmed a single query returns both line items with
  correct server-computed totals (576 and 1205 for a two-product
  submission).
- **Unbounded queries**: nothing capped how many rows `getInventories()`
  could return — a real hazard once a chain has months of history. Added
  sane limits (200 org-wide / 50 per location) and a dedicated
  `todaysInventories()` for the manager dashboard's "today" summary, which
  only ever needs one row per location rather than the whole history table.
- **Concurrency**: fired two `submit_daily_inventory()` calls at the exact
  same location/day *genuinely in parallel* (two OS processes racing, not
  sequential transactions) against real Postgres. Exactly one committed;
  the other rolled back cleanly with the unique-constraint error and zero
  leftover rows — confirming the atomicity fix from Phase 1 holds under
  real concurrent load, not just sequential retries.
- **PWA icon defect**: `apple-touch-icon` pointed at an SVG, which iOS
  Safari does not support for home-screen icons — on an iPhone (a
  plausible device for restaurant staff) "Add to Home Screen" would have
  silently fallen back to a page screenshot instead of the intended icon.
  Generated real PNG icons (180×180 for `apple-touch-icon`, 192×192 and
  512×512 maskable icons for the manifest) and wired them into all three
  HTML pages (`login.html`/`manager.html` were missing manifest/icon links
  entirely).
- **Service worker cache-first bug**: the SW cached the app shell at
  install and never revalidated it, so a user who had already installed
  the PWA would keep running old `app.js`/`storage.js` indefinitely —
  including, hypothetically, a version with the security bugs fixed in
  Phase 1 — until the `CACHE` constant was bumped *and* they happened to
  reopen the app online. Rewrote to network-first with cache only as an
  offline fallback, and excluded cross-origin/non-GET requests from being
  intercepted (previously the fetch handler ran on every request including
  Supabase API calls, which happened to be harmless but was fragile).

### Phase 4: cross-tenant leak in `employee_locations`, and an admin UI

Before building anything new on top of the Phase 2 `employee_locations`
work, it was re-checked from scratch against real Postgres rather than
assumed correct — and this found a real cross-tenant vulnerability that
the Phase 2 test suite had missed: its read policy was

```sql
for select using (profile_id = auth.uid() or current_role_name() in ('admin', 'manager'))
```

which has **no organization scoping at all**. Any admin or manager, in
*any* organization, could read every row in `employee_locations` — i.e.
which employees are assigned to which locations, across every customer on
the platform. This slipped through Phase 2's verification because that
test scenario only ever seeded one organization, so "sees everyone" and
"sees everyone in my org" looked identical. This pass deliberately used a
two-organization scenario and caught it immediately: an org-1 admin could
see an org-2 employee's location assignment.

Fixed by scoping the admin/manager branch through `profiles` (safe — profiles'
own policy never queries `employee_locations`, so no repeat of the Phase 2
recursion bug):

```sql
profile_id = auth.uid()
or (current_role_name() in ('admin', 'manager')
    and profile_id in (select id from profiles where organization_id = current_org_id()))
```

Verified: an org-1 admin now sees exactly the 1 row belonging to their own
org (not the 2 that exist across both orgs, confirmed as table owner). Also
re-ran the full Phase 2 regression scenario (recursion-safety, admin-only
writes, employee/manager scoping) to confirm this fix didn't reintroduce
anything — no recursion errors, all prior checks still pass. The other two
places using the same `current_role_name() in ('admin','manager')` pattern
(`locations`, `inventory_submissions`) were already correctly wrapped in an
outer `organization_id = current_org_id() AND (...)`, so this was the one
instance of the bug, not a systemic pattern.

With that fixed, built `admin.html`/`admin.js`: create/deactivate products,
create/deactivate locations, and assign/unassign employees to locations —
the actual missing piece between this and a manager configuring their
organization without SQL access. It's a thin UI over new `storage.js`
functions (`getAllProducts`, `createProduct`, `setProductActive`,
`getAllLocations`, `createLocation`, `setLocationActive`, `getTeam`,
`assignEmployeeLocation`, `unassignEmployeeLocation`) that reuse the exact
patterns already in the file — no parallel data layer. The real
authorization boundary is still server-side: the RLS "admin insert/update"
policies reject these writes from anyone whose role isn't `admin`
regardless of what the page shows; the page's own role check is just UX.

Verified directly against Postgres: an admin creating a product, assigning
an employee to a location (who then immediately sees it via the
`locations` read policy), unassigning them (who then immediately loses
it), and deactivating a product — each exactly the SQL statement the UI
code issues, run and confirmed. **Not verified**: the actual page in a
browser (this sandbox has none) — the form rendering, button wiring, and
Supabase-JS-client plumbing around these verified SQL operations have not
been exercised end-to-end.

### Phase 5: employee self-service onboarding (invite codes)

Shipping `admin.html` immediately exposed the gap it didn't close: the
Team tab can assign *existing* profiles to locations, but there was still
no way to create a *new* profile without direct SQL access — the admin UI
couldn't actually onboard anyone. Closed with an invite-code flow:

- Admins generate a short code (`admin.html` → Team tab) scoped to a role
  and a 7-day expiry, stored in a new `invites` table.
- A new hire goes to `signup.html`, enters the code plus their own email/
  password/name. This calls Supabase Auth's `signUp()` (creating their
  `auth.users` row — outside this schema, Supabase-managed) and then a new
  `redeem_invite(code, full_name)` Postgres function that creates their
  `profiles` row.
- The tricky part: at the moment they redeem a code, they have no
  `profiles` row yet, so `current_org_id()` is null and none of the
  org-scoped RLS policies would let them read anything — including the
  invite row itself. `redeem_invite()` is `SECURITY DEFINER` specifically
  to bypass that for its own narrow lookup, but it only ever creates a
  profile for `auth.uid()` — the caller's own account — never an arbitrary
  one; the function body is the trust boundary, not a table grant.
- If the Supabase project requires email confirmation, there's no session
  yet at signup time to call `redeem_invite()` with. Handled by stashing
  the code/name in `localStorage` and adding `join.html`, which
  `storage.js`'s `Store.init()` now redirects to automatically (same
  pattern `Auth.requireSession()` already uses for "not logged in at all")
  whenever a signed-in user has no `profiles` row yet.

Verified against real Postgres, going beyond the happy path: a valid code
redeems correctly and the resulting profile is immediately usable (correct
org, correct role); reusing an already-used code is rejected; an expired
code is rejected; a nonexistent code is rejected cleanly rather than
crashing; an account that already has a profile is rejected from redeeming
a second code; an org-2 user cannot see org-1's invites at all (RLS holds
for this new table too, confirmed with the same two-organization
methodology as Phase 4, precisely because Phase 4 showed that isn't
automatic). Also fired two genuinely parallel redemption attempts at the
exact same code (matching the Phase 3 concurrency methodology) — the
function's `SELECT ... FOR UPDATE` row lock correctly serialized them:
exactly one account got linked, the other cleanly rejected, no duplicate
or partial profile.

**Not verified**: the actual pages in a browser, and — since this sandbox
cannot configure or drive Supabase Auth itself — the precise behavior of
the email-confirmation-required branch (the `localStorage` handoff to
`join.html`) end-to-end. The `redeem_invite()` half of that path (what
happens once they do reach `join.html` with a valid session) is verified;
the Supabase Auth email round-trip in front of it is not.

## Architecture

```
Employee / Manager browser (PWA)
        |
Supabase JS client (auth.js, storage.js)
        |
Supabase (Postgres + Auth)
  - Row Level Security scopes every query to the caller's own
    organization_id — enforced by Postgres, not application code.
```

Tables (see `supabase/schema.sql`): `organizations`, `profiles` (extends
Supabase auth users with org + role), `locations`, `products`,
`inventory_submissions`, `inventory_items`. Each inventory item stores both
what the employee entered (`entered_full_boxes`, `entered_pieces`,
`entered_fraction`) and the calculated `normalized_quantity`, so historical
records stay auditable even if a product's package size changes later.

## Setup

1. Create a free project at [supabase.com](https://supabase.com).
2. In the SQL editor, run `supabase/schema.sql`. This creates the schema,
   enables RLS, and seeds a demo organization ("Demo Restaurant Group")
   with 3 locations and 10 products.
3. In **Authentication → Users**, create one user (email + password) to be
   the first admin.
4. **One-time bootstrap only** — link that first admin via SQL (there's no
   admin yet to generate them an invite code):
   ```sql
   insert into profiles (id, organization_id, full_name, role)
   values ('<the user''s auth uid>', '00000000-0000-0000-0000-000000000001', 'Demo Admin', 'admin');
   ```
   Every other user after this one can be onboarded through the app itself
   — see "Adding more people" below. No further SQL is required.
5. In **Project Settings → API**, copy your Project URL and `anon` public
   key into `config.js`.
6. Serve the folder with any static file server (or open `login.html`
   directly) and sign in as the admin you just created.

### Adding more people (no SQL required)

Once the first admin is signed in: **Manager Dashboard → Admin → Team tab
→ Invite a new team member**, pick a role, and share the generated code
with them. They go to `signup.html`, enter the code plus their own email/
password/name, and their account is created and linked automatically. If
their role is `employee`, an admin still needs to assign which
location(s) they can work with (Team tab → pick a location → Assign) — an
employee with no location assigned will see zero locations and be unable
to start inventory, which is enforced by RLS, not a bug, but worth knowing
if a fresh account "shows nothing."

The `anon` key is safe to ship in frontend code — on its own it grants no
access; RLS policies are what actually restrict a signed-in user to their
own organization's rows.

## What's in this MVP

- **Login** (`login.html`) — Supabase email/password auth.
- **Employee app** (`index.html`) — pick a location, walk through product
  categories, enter quantities as full boxes + loose pieces, a box fraction
  (½, ⅓, ¼, ¾), or a direct piece count, and submit the day's inventory.
  One submission per location per day is enforced at the database level.
- **Manager dashboard** (`manager.html`) — which branches have completed
  today's inventory, and drill into any branch's submission history.
- **Admin UI** (`admin.html`, linked from the manager dashboard for
  `admin`-role users) — create/deactivate products and locations, and
  assign employees to the location(s) they can count inventory for.
  Replaces the need for direct SQL access to configure an organization.
- **Configurable product catalog** — each organization's products, package
  units and pieces-per-package live in the database, managed through the
  admin UI (or SQL/the Supabase table editor directly, if preferred).
- **Installable PWA** — `manifest.json` + `sw.js`.

## What this is not (yet)

This is the small, validated first step of a much larger vision (delivery
receiving, invoice AI extraction, discrepancy detection, integrations with
existing ERP/POS/accounting systems, analytics, forecasting, payments).
Those are deliberately out of scope until this workflow proves itself with
real employees — see the phased roadmap in the product vision doc.

## Testing

Run `node tests/calculations.test.js` for the pure calculation logic
(19 cases: worked spec examples, fractions, missing/empty input, unknown
modes, large numbers, and the negative-input boundary between UI clamping
and calculation logic).

The RLS/multi-tenancy/atomicity claims above were verified against a real
local PostgreSQL 16 instance with a shim for Supabase's `auth.uid()` — see
"How the backend was verified without a live Supabase project". The
browser-facing flow (login → submit inventory → manager sees it) still
needs a real Supabase project — set one up per "Setup" above to verify
end-to-end.

## Security notes

- Multi-tenant isolation is enforced by Postgres RLS, not by application
  code — verified directly, including raw-SQL cross-org attack attempts
  (see "Testing"); even a compromised or buggy frontend cannot read or
  write another organization's data through the anon key.
- Quantities are recomputed server-side inside `submit_daily_inventory()`
  from the employee's raw entered values and the product's *current*
  package size read from the database — a compromised or buggy client
  cannot forge a `normalized_quantity` by sending one directly.
- No secrets are stored client-side beyond the anon key (safe by design —
  it grants no access on its own; RLS is the actual boundary).
- Duplicate same-day submissions for a location are rejected by a unique
  database constraint, not just UI logic, and the submission is atomic:
  a failure partway through can never leave an orphaned row that blocks
  a legitimate retry (verified — see "Testing").
- Only `admin`-role profiles can edit or delete a historical inventory
  submission; `employee`/`manager` roles can insert and read but not alter
  the audit trail (verified).

## Known limitations (not yet fixed — flagging honestly rather than silently)

- **No profile self-service.** New users must be linked to an organization
  via a manual SQL `insert into profiles ...` (see Setup) — there is no
  admin UI or invite flow yet.
- **Product/location configuration is via the Supabase table editor or SQL**,
  not an in-app admin screen.
- **Offline support is not implemented.** The service worker caches the
  static app shell so it loads instantly on repeat visits, but every data
  operation (login, load products, submit inventory) requires a live
  network connection to Supabase; a submission attempted while offline
  will fail with an error, not queue for later.
- **PWA icon is a plain flat SVG**, not a proper maskable icon with safe-zone
  padding — will look slightly clipped on Android's adaptive icon shapes.

## Next steps (see priority order in the product vision)

1. Verify the Supabase setup end-to-end with a real project (see "Setup")
2. Admin UI for managing products/locations/users instead of raw SQL
3. Delivery receiving with photo capture
4. AI-assisted invoice extraction (human-confirmed, never auto-applied)
5. Discrepancy detection (expected vs. actual)
6. Integrations with the customer's existing systems (only after their
   exact platform and API capabilities are verified)
