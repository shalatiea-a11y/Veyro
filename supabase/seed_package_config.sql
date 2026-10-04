-- Package/unit configuration for the product catalog. CONFIGURATION ONLY —
-- no current stock/inventory counts are inserted here, only package sizes
-- and conversion factors.
--
-- Run this in your Supabase SQL editor AFTER schema.sql's product_packages/
-- product_external_mappings sections, the products columns, and
-- resolve_generic_inventory_quantity/submit_daily_inventory have been applied.
--
-- Targets YOUR organization automatically by looking it up from your own
-- profile (shalatiea@gmail.com) — never touches any other organization.
-- Safe to re-run: a product with the same name already in your org gets
-- its config updated and its package tiers replaced, not duplicated.
--
-- Names and conversion factors below were confirmed against the real
-- Oracle MICROS Simphony inventory system (2026-10-04) — not guessed.
-- A few notes on products whose unit doesn't match what the name implies:
--   - Chicken Nuggets 22g: 1 bag = 105 pieces (NOT the earlier 1kg/22g
--     estimate of ~45 — the real bag is closer to 2.3kg). Each piece is
--     still 22g = 0.022kg, confirmed separately.
--   - Chili Cheese Nuggets 1kg: 1 bag = 51 pieces (confirmed; earlier
--     estimate was 48).
--   - Kycklingfile Southern 125g: tracked by WEIGHT (kg) in Oracle, not
--     piece count, even though it's sold in 25-piece bags — base_unit is
--     kg here to match, with a piece=0.125kg tier for convenience.
--   - Small kött: Oracle's own name is cut off in every screenshot we
--     have ("Hamburgare 45 gr smashhamburgare 45 g (r...") — kept as
--     "Small kött" until the full name is confirmed, rather than guess.

do $$
declare
  v_org_id uuid;
begin
  select organization_id into v_org_id
  from profiles p join auth.users u on u.id = p.id
  where u.email = 'shalatiea@gmail.com';

  if v_org_id is null then
    raise exception 'Could not find an organization for shalatiea@gmail.com — check the email matches your Supabase Auth account.';
  end if;

  create temporary table _pkg_products (
    name text, category text, base_unit text, base_unit_label text,
    unit_weight_g numeric, unit_volume_ml numeric, net_weight_kg numeric,
    open_piece_notes boolean
  ) on commit drop;
  create temporary table _pkg_tiers (
    product_name text, sort_order int, tier_name text, contains numeric, unit text
  ) on commit drop;

  insert into _pkg_products (name, category, base_unit, base_unit_label, unit_weight_g, unit_volume_ml, net_weight_kg, open_piece_notes) values
    ('Monster Energy',                   'Drinks', 'piece', 'can',   null, 500, null, false),
    ('Monster energy Ultra',             'Drinks', 'piece', 'can',   null, 500, null, false),
    ('Monster Mango Loco',               'Drinks', 'piece', 'can',   null, 500, null, false),
    ('Bacon Stekt 500g',                 'Meat',   'kg',    null,    null, null, null, false),
    ('Hamburgare 114g, (räkna antal i puckar)', 'Meat', 'piece', 'patty', 114, null, null, false),
    ('Small kött',                       'Meat',   'piece', 'patty', 45,   null, null, false),
    ('Kycklingfile Southern 125g',       'Meat',   'kg',    null,    null, null, null, false),
    ('Kycklingvingar',                   'Meat',   'piece', null,    null, null, null, false),
    ('Vegoburgare Crispy NoChick 90g',   'Meat',   'piece', null,    null, null, null, false),
    ('Hamburgerbröd Brioche Bun 50g',    'Bread',  'piece', 'bun',   null, null, null, false),
    ('Hamburgerbröd 44',                 'Bread',  'piece', 'bun',   null, null, null, false),
    ('Hamburgerbröd Potato 70g Glaze',   'Bread',  'piece', 'bun',   null, null, null, false),
    ('Hamburgerbröd Glutfri 70g',        'Bread',  'piece', 'bun',   null, null, null, false),
    ('Pommes Sure Crisp m Skal 6mm',     'Frozen', 'kg',    null,    null, null, null, false),
    ('Chicken Nuggets 22g',              'Frozen', 'kg',    null,    null, null, null, false),
    ('Chili Cheese Nuggets 1kg',         'Frozen', 'piece', 'piece', null, null, null, false),
    ('Hamburgerost lättsmält',           'Cheese', 'piece', 'slice', null, null, 1,    false),
    ('Grillost Pannoumi Skiv 60g',       'Cheese', 'piece', null,    null, null, null, false);

  insert into _pkg_tiers (product_name, sort_order, tier_name, contains, unit) values
    ('Monster Energy',                   1, 'carton', 24,  'piece'),
    ('Monster energy Ultra',             1, 'carton', 24,  'piece'),
    ('Monster Mango Loco',               1, 'carton', 24,  'piece'),
    ('Hamburgare 114g, (räkna antal i puckar)', 1, 'carton', 24, 'piece'),
    ('Small kött',                       1, 'carton', 60,  'piece'),
    ('Kycklingfile Southern 125g',       1, 'bag',    25,  'piece'),
    ('Kycklingfile Southern 125g',       2, 'piece',  0.125, 'kg'),
    ('Vegoburgare Crispy NoChick 90g',   1, 'bag',    24,  'piece'),
    ('Hamburgerbröd Brioche Bun 50g',    1, 'carton', 42,  'piece'),
    ('Hamburgerbröd 44',                 1, 'carton', 48,  'piece'),
    ('Hamburgerbröd Potato 70g Glaze',   1, 'carton', 40,  'piece'),
    ('Hamburgerbröd Glutfri 70g',        1, 'bag',    4,   'piece'),
    ('Pommes Sure Crisp m Skal 6mm',     1, 'carton', 5,   'bag'),
    ('Pommes Sure Crisp m Skal 6mm',     2, 'bag',    2.5, 'kg'),
    ('Chicken Nuggets 22g',              1, 'bag',    105, 'piece'),
    ('Chicken Nuggets 22g',              2, 'piece',  0.022, 'kg'),
    ('Chili Cheese Nuggets 1kg',         1, 'bag',    51,  'piece'),
    ('Hamburgerost lättsmält',           1, 'package',4,   'block'),
    ('Hamburgerost lättsmält',           2, 'block',  22,  'piece'),
    ('Grillost Pannoumi Skiv 60g',       1, 'box',    16,  'piece');
    -- Bacon Stekt 500g and Kycklingvingar intentionally have NO tiers:
    -- their base_unit (kg / piece) is entered directly.

  -- Insert only the products that don't already exist by name in this org.
  insert into products (organization_id, name, category, package_unit, units_per_package, base_unit, base_unit_label, unit_weight_g, unit_volume_ml, net_weight_kg, open_piece_notes)
  select v_org_id, pp.name, pp.category, 'unit', 1, pp.base_unit, pp.base_unit_label, pp.unit_weight_g, pp.unit_volume_ml, pp.net_weight_kg, pp.open_piece_notes
  from _pkg_products pp
  where not exists (select 1 from products p where p.organization_id = v_org_id and p.name = pp.name);

  -- Update config on every matching product (covers ones that already existed).
  update products p set
    category = pp.category, base_unit = pp.base_unit, base_unit_label = pp.base_unit_label,
    unit_weight_g = pp.unit_weight_g, unit_volume_ml = pp.unit_volume_ml,
    net_weight_kg = pp.net_weight_kg, open_piece_notes = pp.open_piece_notes
  from _pkg_products pp
  where p.organization_id = v_org_id and p.name = pp.name;

  -- Replace package tiers for these products (safe to re-run).
  delete from product_packages
  where product_id in (select id from products where organization_id = v_org_id and name in (select name from _pkg_products));

  insert into product_packages (product_id, sort_order, name, contains, unit)
  select p.id, t.sort_order, t.tier_name, t.contains, t.unit
  from _pkg_tiers t
  join products p on p.organization_id = v_org_id and p.name = t.product_name;

end $$;
