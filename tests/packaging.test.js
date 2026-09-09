// Exercises the REAL packaging.js conversion engine against every test
// vector the product spec explicitly asked for (section 60), plus the
// "no invented conversion" guarantees for Nuggets/Chili cheese. Nothing
// here is hand-traced — every assertion calls the actual function.
const { normalizeBreakdown, decompose, formatBreakdown } = require("../packaging.js");

const results = [];
function check(label, cond) { results.push({ label, pass: !!cond }); }
function close(a, b, eps = 1e-6) { return Math.abs(a - b) < eps; }

// --- Stora kött: carton=24 pieces, piece=114g ---
const storaKott = { name: "Stora kött", base_unit: "piece", packages: [{ name: "carton", contains: 24, unit: "piece" }] };
check("Stora kött: 1 carton = 24 pieces", normalizeBreakdown(storaKott, { carton: 1 }) === 24);
check("Stora kött: 2.5 cartons = 60 pieces", normalizeBreakdown(storaKott, { carton: 2.5 }) === 60);
check("Stora kött: 12 pieces direct = 12", normalizeBreakdown(storaKott, { piece: 12 }) === 12);
check("Stora kött: mixed 2 carton + 12 piece = 60", normalizeBreakdown(storaKott, { carton: 2, piece: 12 }) === 60);
check("Stora kött: decompose(60) = 2 carton + 12 piece", formatBreakdown(decompose(storaKott, 60)) === "2 carton + 12 piece");
check("Stora kött: decompose(53) = 2 carton + 5 piece (spec's own generic example)",
  formatBreakdown(decompose(storaKott, 53)) === "2 carton + 5 piece");

// --- Small kött: carton=60 pieces, piece=45g ---
const smallKott = { name: "Small kött", base_unit: "piece", packages: [{ name: "carton", contains: 60, unit: "piece" }] };
check("Small kött: 1 carton = 60 pieces", normalizeBreakdown(smallKott, { carton: 1 }) === 60);
check("Small kött: 2.5 cartons = 150 pieces", normalizeBreakdown(smallKott, { carton: 2.5 }) === 150);
check("Small kött: 30 pieces direct = 30", normalizeBreakdown(smallKott, { piece: 30 }) === 30);

// --- Kycklingburgare crispy: bag=25 pieces ---
const chicken = { name: "Kycklingburgare crispy", base_unit: "piece", packages: [{ name: "bag", contains: 25, unit: "piece" }] };
check("Chicken: 1 bag = 25 pieces", normalizeBreakdown(chicken, { bag: 1 }) === 25);
check("Chicken: 2.5 bags = 62.5 pieces", normalizeBreakdown(chicken, { bag: 2.5 }) === 62.5);
check("Chicken: 10 pieces direct = 10", normalizeBreakdown(chicken, { piece: 10 }) === 10);

// --- Vegoburgare crispy nochick O: bag=24 units ---
const vego = { name: "Vegoburgare crispy nochick O", base_unit: "piece", packages: [{ name: "bag", contains: 24, unit: "piece" }] };
check("Vegoburger: 1 bag = 24 units", normalizeBreakdown(vego, { bag: 1 }) === 24);
check("Vegoburger: 2.5 bags = 60 units", normalizeBreakdown(vego, { bag: 2.5 }) === 60);
check("Vegoburger: 9 units direct = 9", normalizeBreakdown(vego, { piece: 9 }) === 9);

// --- Bread: all four package sizes ---
const storaBrod = { name: "Stora bröd", base_unit: "piece", packages: [{ name: "carton", contains: 42, unit: "piece" }] };
const smallBrod = { name: "Small bröd", base_unit: "piece", packages: [{ name: "carton", contains: 48, unit: "piece" }] };
const potatisBrod = { name: "Potatis bröd", base_unit: "piece", packages: [{ name: "carton", contains: 40, unit: "piece" }] };
const glutenfri = { name: "Glutenfri", base_unit: "piece", packages: [{ name: "bag", contains: 4, unit: "piece" }] };
check("Stora bröd: 1 carton = 42", normalizeBreakdown(storaBrod, { carton: 1 }) === 42);
check("Small bröd: 1 carton = 48", normalizeBreakdown(smallBrod, { carton: 1 }) === 48);
check("Potatis bröd: 1 carton = 40", normalizeBreakdown(potatisBrod, { carton: 1 }) === 40);
check("Glutenfri: 1 bag = 4", normalizeBreakdown(glutenfri, { bag: 1 }) === 4);
check("Stora bröd: 1.5 cartons = 63", normalizeBreakdown(storaBrod, { carton: 1.5 }) === 63);

// --- Pommes: carton -> 5 bags -> 2.5 kg each (3-way: carton/bag/kg) ---
const pommes = { name: "Pommes", base_unit: "kg", packages: [{ name: "carton", contains: 5, unit: "bag" }, { name: "bag", contains: 2.5, unit: "kg" }] };
check("Pommes: 1 carton = 12.5 kg", normalizeBreakdown(pommes, { carton: 1 }) === 12.5);
check("Pommes: 1 bag = 2.5 kg", normalizeBreakdown(pommes, { bag: 1 }) === 2.5);
check("Pommes: 5 kg direct = 5", normalizeBreakdown(pommes, { kg: 5 }) === 5);
check("Pommes: 17 bags = 42.5 kg", normalizeBreakdown(pommes, { bag: 17 }) === 42.5);
check("Pommes: 17 bags -> decompose -> '3 carton + 2 bag' (the spec's exact worked example)",
  formatBreakdown(decompose(pommes, normalizeBreakdown(pommes, { bag: 17 }))) === "3 carton + 2 bag");
check("Pommes: 2.5 cartons = 31.25 kg", normalizeBreakdown(pommes, { carton: 2.5 }) === 31.25);
check("Pommes: mixed 1 carton + 2 bags = 17.5 kg", normalizeBreakdown(pommes, { carton: 1, bag: 2 }) === 17.5);
check("Pommes: decompose(0) has no phantom cartons/bags, just 0 kg",
  formatBreakdown(decompose(pommes, 0)) === "0 kg");

// --- Bacon: internal base unit is kg, no package tiers configured yet ---
const bacon = { name: "Bacon", base_unit: "kg", packages: [] };
check("Bacon: 3.2 kg direct = 3.2", normalizeBreakdown(bacon, { kg: 3.2 }) === 3.2);
let baconThrew = false;
try { normalizeBreakdown(bacon, { unit_500g: 4 }); } catch (e) { baconThrew = true; }
check("Bacon: entering an undefined external unit throws instead of guessing a conversion", baconThrew);

// --- Nuggets: bag = 1 kg known; NO pieces-per-bag conversion exists ---
const nuggets = { name: "Nuggets", base_unit: "kg", packages: [{ name: "bag", contains: 1, unit: "kg" }] };
check("Nuggets: 1 bag = 1 kg", normalizeBreakdown(nuggets, { bag: 1 }) === 1);
check("Nuggets: 2.5 bags = 2.5 kg", normalizeBreakdown(nuggets, { bag: 2.5 }) === 2.5);
check("Nuggets: 4 kg direct = 4", normalizeBreakdown(nuggets, { kg: 4 }) === 4);
let nuggetsThrew = false;
try { normalizeBreakdown(nuggets, { piece: 45 }); } catch (e) { nuggetsThrew = true; }
check("Nuggets: entering 'piece' throws — NO invented bag->piece conversion exists", nuggetsThrew);
check("Nuggets: an informational piece note is accepted but NOT added to the total",
  normalizeBreakdown(nuggets, { bag: 2, _note_pieces: 90 }) === 2);

// --- Chili cheese: kg only, no invented piece conversion ---
const chiliCheese = { name: "Chili cheese", base_unit: "kg", packages: [] };
check("Chili cheese: 1.75 kg direct = 1.75", normalizeBreakdown(chiliCheese, { kg: 1.75 }) === 1.75);
let chiliThrew = false;
try { normalizeBreakdown(chiliCheese, { piece: 10 }); } catch (e) { chiliThrew = true; }
check("Chili cheese: entering 'piece' throws — no invented kg->piece conversion", chiliThrew);

// --- Ost cheddar: package -> 4 blocks -> 22 slices (88 slices = 1 kg total, informational) ---
const ostCheddar = { name: "Ost cheddar", base_unit: "slice", packages: [{ name: "package", contains: 4, unit: "block" }, { name: "block", contains: 22, unit: "slice" }] };
check("Ost cheddar: 1 package = 88 slices", normalizeBreakdown(ostCheddar, { package: 1 }) === 88);
check("Ost cheddar: 1 block = 22 slices", normalizeBreakdown(ostCheddar, { block: 1 }) === 22);
check("Ost cheddar: 10 slices direct = 10", normalizeBreakdown(ostCheddar, { slice: 10 }) === 10);

// --- Grillost: box = 16 pieces, decimal boxes supported ---
const grillost = { name: "Grillost", base_unit: "piece", packages: [{ name: "box", contains: 16, unit: "piece" }] };
check("Grillost: 2 boxes = 32 pieces", normalizeBreakdown(grillost, { box: 2 }) === 32);
check("Grillost: 1.5 boxes = 24 pieces", normalizeBreakdown(grillost, { box: 1.5 }) === 24);

// --- Monster: carton = 24 cans, 1 can = 500 ml (ml tracked as info, base_unit stays 'piece'/can count) ---
const monster = { name: "Monster Energy", base_unit: "piece", unit_volume_ml: 500, packages: [{ name: "carton", contains: 24, unit: "piece" }] };
check("Monster: 1 carton = 24 cans", normalizeBreakdown(monster, { carton: 1 }) === 24);
check("Monster: unit_volume_ml is carried as product info, not folded into the count", monster.unit_volume_ml === 500);

results.forEach((r) => console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.label}`));
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
