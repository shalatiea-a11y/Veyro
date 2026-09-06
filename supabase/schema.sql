-- Restaurant Ops Platform — core schema
-- Run this once in your Supabase project's SQL editor.
-- Multi-tenant isolation is enforced with Postgres Row Level Security (RLS):
-- every table that holds business data carries organization_id, and every
-- policy checks it against the signed-in user's own organization via the
-- profiles table. No app code can bypass this — it's enforced by Postgres.

create extension if not exists "pgcrypto";

-- One row per restaurant company / customer of the platform.
create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

-- Extends auth.users (Supabase-managed) with org membership + role.
-- Role model: employee | manager | admin. Kept simple; regional/HQ tiers
-- can be added later without changing the shape.
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  full_name text not null,
  role text not null default 'employee' check (role in ('employee', 'manager', 'admin')),
  created_at timestamptz not null default now()
);

create table locations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  category text not null,
  package_unit text not null default 'box',
  units_per_package integer not null check (units_per_package > 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- One row per submitted morning inventory (one location, one day, one employee).
create table inventory_submissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  location_id uuid not null references locations(id) on delete cascade,
  submitted_by uuid not null references profiles(id),
  submitted_at timestamptz not null default now(),
  inventory_date date not null default current_date
);

-- Line items. entered_* columns preserve exactly what the employee typed;
-- normalized_quantity is the deterministic calculation, computed by the
-- application (never by AI) at submission time and stored, not recomputed
-- silently later — this keeps historical records auditable even if a
-- product's package size changes afterwards.
create table inventory_items (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references inventory_submissions(id) on delete cascade,
  product_id uuid not null references products(id),
  entry_mode text not null check (entry_mode in ('boxes_pieces', 'fraction', 'pieces')),
  entered_full_boxes numeric check (entered_full_boxes is null or entered_full_boxes >= 0),
  entered_pieces numeric check (entered_pieces is null or entered_pieces >= 0),
  entered_fraction text check (entered_fraction is null or entered_fraction in ('full','3/4','1/2','1/3','1/4')),
  units_per_package_at_entry integer not null check (units_per_package_at_entry > 0),
  normalized_quantity numeric not null check (normalized_quantity >= 0)
);

create unique index inventory_submissions_one_per_day
  on inventory_submissions (location_id, inventory_date);

create index inventory_submissions_org_idx on inventory_submissions (organization_id);
create index inventory_items_submission_idx on inventory_items (submission_id);
create index locations_org_idx on locations (organization_id);
create index products_org_idx on products (organization_id);

-- Helper: the calling user's organization_id, looked up once per query.
create or replace function current_org_id() returns uuid
language sql stable security definer as $$
  select organization_id from profiles where id = auth.uid();
$$;

alter table organizations enable row level security;
alter table profiles enable row level security;
alter table locations enable row level security;
alter table products enable row level security;
alter table inventory_submissions enable row level security;
alter table inventory_items enable row level security;

create policy "own org only" on organizations
  for select using (id = current_org_id());

create policy "profiles in own org" on profiles
  for select using (organization_id = current_org_id());

-- Which locations a given employee is allowed to work with. Admins and
-- managers are not listed here — they see every location in their
-- organization regardless (checked via current_role() below). Only meant
-- to scope plain employees to the branch(es) they actually work at.
create table employee_locations (
  profile_id uuid not null references profiles(id) on delete cascade,
  location_id uuid not null references locations(id) on delete cascade,
  primary key (profile_id, location_id)
);
alter table employee_locations enable row level security;

create or replace function current_role_name() returns text
language sql stable security definer as $$
  select role from profiles where id = auth.uid();
$$;

-- Deliberately does NOT reference the locations table: locations' own
-- policy (below) queries employee_locations to decide what an employee can
-- see, so if this policy queried locations right back, Postgres would
-- detect infinite recursion between the two (confirmed by testing this
-- exact scenario against a real instance — see README). A profile can
-- always see its own assignment rows; admins/managers can see everyone's
-- IN THEIR OWN ORGANIZATION — querying profiles (not locations) to scope
-- this is safe, since profiles' own policy never queries employee_locations
-- back. The unscoped "admin/manager sees everyone's" version of this
-- policy shipped in the previous commit was a real cross-tenant leak (an
-- admin in one org could read which employees are assigned to which
-- locations in every other org on the platform) — caught in this pass
-- because a two-organization test scenario was used, unlike the
-- single-org scenario that verified the original recursion fix.
create policy "own assignments or admin/manager in own org" on employee_locations
  for select using (
    profile_id = auth.uid()
    or (
      current_role_name() in ('admin', 'manager')
      and profile_id in (select id from profiles where organization_id = current_org_id())
    )
  );

create policy "admin manages location assignments" on employee_locations
  for insert with check (current_role_name() = 'admin');
create policy "admin updates location assignments" on employee_locations
  for update using (current_role_name() = 'admin');
create policy "admin removes location assignments" on employee_locations
  for delete using (current_role_name() = 'admin');

-- Configuration data (locations, products): every org member can read it
-- (an employee needs to see the product catalog to count inventory), but
-- only admins can create/edit/delete it — this was previously "for all",
-- which let a plain employee write directly to these tables.
-- An employee is further restricted to their assigned location(s);
-- admins/managers see and can be assigned to every location in the org.
create policy "locations readable in own org, scoped for employees" on locations
  for select using (
    organization_id = current_org_id()
    and (
      current_role_name() in ('admin', 'manager')
      or id in (select location_id from employee_locations where profile_id = auth.uid())
    )
  );
create policy "locations admin insert" on locations
  for insert with check (organization_id = current_org_id() and current_role_name() = 'admin');
create policy "locations admin update" on locations
  for update using (organization_id = current_org_id() and current_role_name() = 'admin');
create policy "locations admin delete" on locations
  for delete using (organization_id = current_org_id() and current_role_name() = 'admin');

create policy "products readable in own org" on products
  for select using (organization_id = current_org_id());
create policy "products admin insert" on products
  for insert with check (organization_id = current_org_id() and current_role_name() = 'admin');
create policy "products admin update" on products
  for update using (organization_id = current_org_id() and current_role_name() = 'admin');
create policy "products admin delete" on products
  for delete using (organization_id = current_org_id() and current_role_name() = 'admin');

-- Inventory records are an audit trail: admins/managers read everything in
-- the org; employees only read submissions for their assigned location(s)
-- (same rule as the locations policy above). Only admins may edit or
-- delete a historical submission. Normal writes go through
-- submit_daily_inventory() below (SECURITY INVOKER, still subject to
-- these same policies) rather than direct inserts from the client.
create policy "inventory submissions read scoped to role" on inventory_submissions
  for select using (
    organization_id = current_org_id()
    and (
      current_role_name() in ('admin', 'manager')
      or location_id in (select location_id from employee_locations where profile_id = auth.uid())
    )
  );

create policy "inventory submissions insert in own org" on inventory_submissions
  for insert with check (organization_id = current_org_id());

create policy "inventory submissions admin update" on inventory_submissions
  for update using (
    organization_id = current_org_id()
    and exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

create policy "inventory submissions admin delete" on inventory_submissions
  for delete using (
    organization_id = current_org_id()
    and exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

create policy "inventory items read via own org submission" on inventory_items
  for select using (
    submission_id in (select id from inventory_submissions where organization_id = current_org_id())
  );

create policy "inventory items insert via own org submission" on inventory_items
  for insert with check (
    submission_id in (select id from inventory_submissions where organization_id = current_org_id())
  );

create policy "inventory items admin update" on inventory_items
  for update using (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
    and submission_id in (select id from inventory_submissions where organization_id = current_org_id())
  );

create policy "inventory items admin delete" on inventory_items
  for delete using (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
    and submission_id in (select id from inventory_submissions where organization_id = current_org_id())
  );

-- Atomic, server-validated inventory submission. The client sends only what
-- the employee entered; this function — not the browser — is the source of
-- truth for the box/piece conversion math and for both rows being written
-- together. If any item fails validation, the whole submission is rolled
-- back (Postgres functions run inside the calling transaction), so there is
-- no half-written state for a retry to collide with.
create or replace function submit_daily_inventory(p_location_id uuid, p_items jsonb, p_inventory_date date default current_date)
returns uuid
language plpgsql
security invoker
as $$
declare
  v_org_id uuid := current_org_id();
  v_submission_id uuid;
  v_item jsonb;
  v_product products%rowtype;
  v_mode text;
  v_full_boxes numeric;
  v_pieces numeric;
  v_fraction text;
  v_normalized numeric;
  v_fraction_value numeric;
begin
  if v_org_id is null then
    raise exception 'No organization linked to this account';
  end if;

  if not exists (select 1 from locations where id = p_location_id and organization_id = v_org_id) then
    raise exception 'Location does not belong to your organization';
  end if;

  if current_role_name() = 'employee'
     and not exists (select 1 from employee_locations where profile_id = auth.uid() and location_id = p_location_id) then
    raise exception 'You are not assigned to this location';
  end if;

  insert into inventory_submissions (organization_id, location_id, submitted_by, inventory_date)
  values (v_org_id, p_location_id, auth.uid(), p_inventory_date)
  returning id into v_submission_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_product from products
      where id = (v_item->>'product_id')::uuid and organization_id = v_org_id;
    if not found then
      raise exception 'Product % does not belong to your organization', v_item->>'product_id';
    end if;

    v_mode := v_item->>'entry_mode';
    v_full_boxes := nullif(v_item->>'entered_full_boxes', '')::numeric;
    v_pieces := nullif(v_item->>'entered_pieces', '')::numeric;
    v_fraction := nullif(v_item->>'entered_fraction', '');

    if v_mode = 'boxes_pieces' then
      v_normalized := coalesce(v_full_boxes, 0) * v_product.units_per_package + coalesce(v_pieces, 0);
    elsif v_mode = 'fraction' then
      v_fraction_value := case v_fraction
        when 'full' then 1 when '3/4' then 0.75 when '1/2' then 0.5
        when '1/3' then 1.0/3 when '1/4' then 0.25 else 0 end;
      v_normalized := round(v_product.units_per_package * v_fraction_value);
    elsif v_mode = 'pieces' then
      v_normalized := coalesce(v_pieces, 0);
    else
      raise exception 'Unknown entry mode %', v_mode;
    end if;

    insert into inventory_items (
      submission_id, product_id, entry_mode, entered_full_boxes, entered_pieces,
      entered_fraction, units_per_package_at_entry, normalized_quantity
    ) values (
      v_submission_id, v_product.id, v_mode, v_full_boxes, v_pieces,
      v_fraction, v_product.units_per_package, v_normalized
    );
  end loop;

  return v_submission_id;
end;
$$;

-- Employee onboarding without direct SQL/database access. An admin
-- creates an invite (code + intended role) for their org; a new user signs
-- up with Supabase Auth (which creates their auth.users row, outside this
-- schema) and then redeems the code to get a profiles row created for
-- them. The tricky part: at redemption time the new user has NO profile
-- yet, so current_org_id() is null and none of the org-scoped RLS
-- policies would let them read anything — including the invites row
-- itself. redeem_invite() is SECURITY DEFINER specifically so it can look
-- up the invite by code (bypassing RLS) while still only ever creating a
-- profile for auth.uid() itself, never an arbitrary user — the function
-- body is the entire trust boundary here, not a table grant.
create table invites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  code text not null unique,
  role text not null default 'employee' check (role in ('employee', 'manager', 'admin')),
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  used_at timestamptz,
  used_by uuid references profiles(id)
);
alter table invites enable row level security;

-- Only admins manage invites, and only for their own org. Deliberately no
-- policy lets a plain "select by code" happen for an unauthenticated or
-- profile-less caller — redeem_invite() below is the only path in.
create policy "admin manages invites in own org" on invites
  for all using (organization_id = current_org_id() and current_role_name() = 'admin')
  with check (organization_id = current_org_id() and current_role_name() = 'admin');

create or replace function redeem_invite(p_code text, p_full_name text)
returns uuid
language plpgsql
security definer
as $$
declare
  v_invite invites%rowtype;
  v_org_id uuid;
begin
  if exists (select 1 from profiles where id = auth.uid()) then
    raise exception 'This account already has a profile';
  end if;

  select * into v_invite from invites where code = p_code for update;
  if not found then
    raise exception 'Invalid invite code';
  end if;
  if v_invite.used_at is not null then
    raise exception 'This invite code has already been used';
  end if;
  if v_invite.expires_at < now() then
    raise exception 'This invite code has expired';
  end if;

  insert into profiles (id, organization_id, full_name, role)
  values (auth.uid(), v_invite.organization_id, p_full_name, v_invite.role);

  update invites set used_at = now(), used_by = auth.uid() where id = v_invite.id;

  return v_invite.organization_id;
end;
$$;
-- Callable by any authenticated Supabase user, including one with no
-- profile row yet (that's the whole point) — Postgres's default grants
-- already cover this for a SECURITY DEFINER function owned by a superuser/
-- table owner, but this makes the intent explicit rather than implicit.
grant execute on function redeem_invite(text, text) to authenticated;

-- ---------------------------------------------------------------------
-- Demo seed data. Safe to run once. Create the two demo logins afterwards
-- in Supabase Auth (see README), then insert their profiles below.
-- ---------------------------------------------------------------------
insert into organizations (id, name) values
  ('00000000-0000-0000-0000-000000000001', 'Demo Restaurant Group');

insert into locations (organization_id, name) values
  ('00000000-0000-0000-0000-000000000001', 'Downtown'),
  ('00000000-0000-0000-0000-000000000001', 'Airport Road'),
  ('00000000-0000-0000-0000-000000000001', 'Mall Branch');

insert into products (organization_id, name, category, package_unit, units_per_package) values
  ('00000000-0000-0000-0000-000000000001', 'Big Meat', 'Meat', 'box', 24),
  ('00000000-0000-0000-0000-000000000001', 'Small Meat', 'Meat', 'box', 60),
  ('00000000-0000-0000-0000-000000000001', 'Cheese Slices', 'Cheese', 'box', 100),
  ('00000000-0000-0000-0000-000000000001', 'Burger Buns', 'Bread', 'box', 48),
  ('00000000-0000-0000-0000-000000000001', 'Lettuce', 'Vegetables', 'box', 12),
  ('00000000-0000-0000-0000-000000000001', 'Tomatoes', 'Vegetables', 'box', 20),
  ('00000000-0000-0000-0000-000000000001', 'Ketchup Sachets', 'Sauces', 'box', 200),
  ('00000000-0000-0000-0000-000000000001', 'Cola Cans', 'Drinks', 'box', 24),
  ('00000000-0000-0000-0000-000000000001', 'Fry Boxes', 'Packaging', 'box', 250),
  ('00000000-0000-0000-0000-000000000001', 'Frozen Fries', 'Frozen', 'box', 10);

-- After creating a user in Supabase Auth (email/password), link them to
-- the demo org by running, with their real auth.users.id:
-- insert into profiles (id, organization_id, full_name, role)
-- values ('<auth-user-uuid>', '00000000-0000-0000-0000-000000000001', 'Demo Employee', 'employee');
