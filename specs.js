/* The Body Doctor portal: product specs (packing, pallet, compliance).
   Reads the "Product Information File" spreadsheet layout, cleans each row and
   checks it for gaps and figures that don't add up. Used by app.js and by the seed script. */
(function (root) {
"use strict";

// Spreadsheet column → field. Matched on the header text, so columns can move.
const COLUMNS = [
  ["brand", /^brand$/],
  ["family", /^product family$/],
  ["sku", /^sku$/],
  ["name", /^product name$/],
  ["ean", /^barcode gtin$/],
  ["outerGtin", /^outer gtin$/],
  ["moq", /^minimum order qty$/],
  ["eachGross", /^each gross weight/],
  ["eachNet", /^each net weight/],
  ["eachL", /^each dimensions.*\(l\)/],
  ["eachW", /^each dimensions.*\(w\)/],
  ["eachH", /^each dimensions.*\(h\)/],
  ["outerQty", /^outer quantity$/],
  ["outerL", /^outer dimensions.*\(l\)/],
  ["outerW", /^outer dimensions.*\(w\)/],
  ["outerH", /^outer dimensions.*\(h\)/],
  ["outerGross", /^outer gross weight/],
  ["outersPerLayer", /^number of outers per layer$/],
  ["unitsPerLayer", /^tier/],
  ["layers", /^layers per pallet$/],
  ["palletUnits", /^pallet number of eaches$/],
  ["palletL", /^pallet length/],
  ["palletW", /^pallet width/],
  ["category", /^medical/],
  ["commodity", /^commodity code$/],
  ["duty", /^duty rate/],
  ["origin", /^country of origin$/],
  ["shelfLife", /^shelf life/]
];
// Numbers where 0 means "not filled in" rather than a real zero.
const COUNT_FIELDS = ["eachGross","eachNet","eachL","eachW","eachH","outerQty","outerL","outerW","outerH","outerGross",
  "outersPerLayer","unitsPerLayer","layers","palletUnits","palletL","palletW","shelfLife"];
const NUMBER_FIELDS = new Set([...COUNT_FIELDS, "duty"]);
const CODE_FIELDS = new Set(["ean","outerGtin","commodity"]);

const norm = s => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
const isError = s => /^#(N\/A|VALUE!|REF!|DIV\/0!|NAME\?|NUM!|NULL!)$/i.test(s);

// A cell becomes a value, or null plus a reason the portal can show.
function cell(field, v){
  let s = typeof v === "number" ? (Number.isInteger(v) ? String(v) : String(Math.round(v * 1000) / 1000)) : norm(v);
  if (!s || isError(s)) return { v:null, why:"missing" };
  if (/^tbc$/i.test(s)) return { v:null, why:"tbc" };
  if (/^create if required$/i.test(s)) return { v:null, why:"create" };
  if (/^n\/?a$/i.test(s)) return { v:null, why:"na" };
  if (CODE_FIELDS.has(field)){
    s = s.replace(/\s+/g, "");
    if (/^\d+(\.0+)?$/.test(s)) s = s.replace(/\.0+$/, "");
    if (/^0+$/.test(s)) return { v:null, why:"missing" };
    return { v:s };
  }
  if (NUMBER_FIELDS.has(field)){
    const n = Number(s.replace(/,/g, "").replace(/%$/, ""));
    if (!isFinite(n)) return { v:null, why:"missing", raw:s };
    if (COUNT_FIELDS.includes(field) && n <= 0) return { v:null, why:"missing" };
    return { v:n };
  }
  return { v:s };
}

/** rows: array of arrays (the whole sheet). Returns { specs, skipped, headerRow }. */
function parseSheet(rows){
  const hi = rows.findIndex(r => r.some(c => /^sku$/i.test(norm(c))) && r.some(c => /^product name$/i.test(norm(c))));
  if (hi < 0) throw new Error("Couldn't find the header row. The sheet needs columns called SKU and Product Name.");
  const header = rows[hi].map(c => norm(c).toLowerCase());
  const idx = {};
  for (const [f, re] of COLUMNS){ const i = header.findIndex(hd => re.test(hd)); if (i >= 0) idx[f] = i; }
  const missingCols = ["sku","name","outerQty","layers"].filter(f => idx[f] == null);
  if (missingCols.length) throw new Error("The sheet is missing columns the portal needs: " + missingCols.join(", ") + ".");
  const specs = [], seen = new Set(); let skipped = 0;
  rows.slice(hi + 1).forEach((r, n) => {
    const sku = norm(r[idx.sku]);
    if (!sku || isError(sku)) { if (r.some(c => norm(c))) skipped++; return; }
    if (seen.has(sku.toUpperCase())) { skipped++; return; }
    seen.add(sku.toUpperCase());
    const d = { gaps:{} };
    for (const [f] of COLUMNS){
      if (idx[f] == null) { d[f] = null; continue; }
      const c = cell(f, r[idx[f]]);
      d[f] = c.v; if (c.v == null && c.why) d.gaps[f] = c.why;
    }
    d.sku = sku; d.name = d.name || sku;
    if (d.shelfLife == null && d.gaps.shelfLife === "na") d.shelfLife = null;
    specs.push({ sku, brand: d.brand || "", family: d.family || "", name: d.name, sort: n + 1, data: d });
  });
  if (!specs.length) throw new Error("No product rows found under the header row.");
  checkAll(specs);
  return { specs, skipped, headerRow: hi + 1 };
}

/* ---------- derived figures ---------- */
function derived(d){
  const o = {};
  o.outersPerPallet = d.outersPerLayer && d.layers ? d.outersPerLayer * d.layers : null;
  o.unitsPerLayer = d.unitsPerLayer || (d.outerQty && d.outersPerLayer ? d.outerQty * d.outersPerLayer : null);
  o.unitsPerPallet = d.palletUnits || (d.outerQty && o.outersPerPallet ? d.outerQty * o.outersPerPallet : null);
  o.unitsPerPalletCalculated = !d.palletUnits && o.unitsPerPallet != null;
  o.loadHeight = d.outerH && d.layers ? d.outerH * d.layers : null;              // boxes only, no pallet base
  o.loadWeightKg = d.outerGross && o.outersPerPallet ? d.outerGross * o.outersPerPallet / 1000 : null; // boxes only
  return o;
}

/* ---------- checks ---------- */
function gtinOk(code){
  if (!/^\d+$/.test(code) || ![8,12,13,14].includes(code.length)) return false;
  const digits = code.split("").map(Number), check = digits.pop();
  const sum = digits.reverse().reduce((a, x, i) => a + x * (i % 2 ? 1 : 3), 0);
  return (10 - sum % 10) % 10 === check;
}
const fmt = n => Number(n).toLocaleString("en-GB", { maximumFractionDigits: 2 });
function checkOne(d){
  const w = [];
  for (const [f, label] of [["ean","Unit barcode"],["outerGtin","Outer barcode"]]){
    const c = d[f]; if (!c) continue;
    if (!/^\d+$/.test(c)) w.push(label + " " + c + " contains characters that aren't digits.");
    else if (![8,12,13,14].includes(c.length)) w.push(label + " " + c + " has " + c.length + " digits. Barcodes have 8, 12, 13 or 14" + (c.length === 11 ? ", so a leading zero may have been lost." : "."));
    else if (!gtinOk(c)) w.push(label + " " + c + " fails the barcode check digit, so a digit is probably wrong.");
  }
  if (d.eachNet && d.eachGross && d.eachNet > d.eachGross) w.push("Unit net weight (" + fmt(d.eachNet) + " g) is more than its gross weight (" + fmt(d.eachGross) + " g).");
  if (d.outerGross && d.outerQty && d.eachGross && d.outerGross < d.outerQty * d.eachGross * 0.9)
    w.push("Outer weight (" + fmt(d.outerGross) + " g) is less than " + d.outerQty + " units × " + fmt(d.eachGross) + " g = " + fmt(d.outerQty * d.eachGross) + " g. One of these figures is probably wrong.");
  if (d.outerGross && d.outerQty && d.eachGross && d.outerGross > d.outerQty * d.eachGross * 3 && d.outerGross - d.outerQty * d.eachGross > 1500)
    w.push("Outer weight (" + fmt(d.outerGross) + " g) is much more than " + d.outerQty + " units × " + fmt(d.eachGross) + " g = " + fmt(d.outerQty * d.eachGross) + " g. One of these figures is probably wrong.");
  if (d.unitsPerLayer && d.outerQty && d.outersPerLayer && d.unitsPerLayer !== d.outerQty * d.outersPerLayer)
    w.push("Units per layer (" + fmt(d.unitsPerLayer) + ") doesn't equal " + d.outerQty + " per outer × " + d.outersPerLayer + " outers per layer = " + fmt(d.outerQty * d.outersPerLayer) + ".");
  if (d.palletUnits && d.outerQty && d.outersPerLayer && d.layers && d.palletUnits !== d.outerQty * d.outersPerLayer * d.layers)
    w.push("Units per pallet (" + fmt(d.palletUnits) + ") doesn't equal " + d.outerQty + " × " + d.outersPerLayer + " outers × " + d.layers + " layers = " + fmt(d.outerQty * d.outersPerLayer * d.layers) + ".");
  if (d.outerL && d.outerW && d.outersPerLayer && d.palletL && d.palletW && d.outerL * d.outerW * d.outersPerLayer > d.palletL * d.palletW * 1.05)
    w.push(d.outersPerLayer + " outers of " + d.outerL + " × " + d.outerW + " mm don't fit on one " + d.palletL + " × " + d.palletW + " mm pallet layer. Check outers per layer or the outer size.");
  if (d.outerH && d.layers && d.outerH * d.layers > 2200) w.push("Stacked load would be " + fmt(d.outerH * d.layers) + " mm tall before the pallet base. Check layers per pallet or outer height.");
  return w;
}
function checkAll(specs){
  const byOuter = new Map();
  for (const s of specs){ s.data.warnings = checkOne(s.data); const g = s.data.outerGtin; if (g) (byOuter.get(g) || byOuter.set(g, []).get(g)).push(s); }
  for (const [g, list] of byOuter){
    const eans = new Set(list.map(s => s.data.ean || s.sku));
    if (list.length > 1 && eans.size > 1)
      for (const s of list) s.data.warnings.push("Outer barcode " + g + " is also used for " + list.filter(x => x !== s).map(x => x.sku).join(", ") + ", which is a different product.");
  }
  return specs;
}

/* ---------- display ---------- */
const GAP_TEXT = { tbc:"To be confirmed", create:"None yet (created if required)", na:"Not applicable", missing:"Not provided" };
function show(d, f, unit){
  const v = d[f];
  if (v == null) return { text: GAP_TEXT[d.gaps?.[f]] || GAP_TEXT.missing, gap: true };
  if (typeof v === "number") return { text: fmt(v) + (unit ? " " + unit : "") };
  return { text: String(v) + (unit ? " " + unit : "") };
}
function dims(d, p){
  const a = [d[p+"L"], d[p+"W"], d[p+"H"]];
  if (a.every(x => x == null)) return { text: GAP_TEXT[d.gaps?.[p+"L"]] || GAP_TEXT.missing, gap:true };
  return { text: a.map(x => x == null ? "?" : fmt(x)).join(" × ") + " mm", gap: a.some(x => x == null) };
}
const gapCount = d => ["ean","outerQty","outerGross","outerL","outersPerLayer","layers","eachGross","eachL"].filter(f => d[f] == null).length;
const ok = x => x && !x.gap;

/** Plain text block for pasting into an email to a trade customer. */
function copyText(s){
  const d = s.data, x = derived(d), L = [];
  const add = (label, v) => { if (ok(v)) L.push(label + ": " + v.text); };
  L.push(d.name + " (" + s.sku + ")");
  add("Unit barcode", show(d,"ean")); add("Unit size", dims(d,"each")); add("Unit weight", show(d,"eachGross","g"));
  add("Units per outer", show(d,"outerQty")); add("Outer barcode", show(d,"outerGtin")); add("Outer size", dims(d,"outer")); add("Outer weight", show(d,"outerGross","g"));
  if (d.outersPerLayer && d.layers) L.push("Pallet: " + d.outersPerLayer + " outers per layer × " + d.layers + " layers = " + fmt(x.outersPerPallet) + " outers");
  if (x.unitsPerPallet) L.push("Units per pallet: " + fmt(x.unitsPerPallet));
  if (d.palletL && d.palletW) L.push("Pallet footprint: " + fmt(d.palletL) + " × " + fmt(d.palletW) + " mm");
  add("Minimum order", show(d,"moq")); add("Country of origin", show(d,"origin")); add("Commodity code", show(d,"commodity"));
  return L.join("\n");
}

/** Text used by portal search. */
const searchText = s => { const d = s.data; return [s.sku, d.name, d.brand, d.family, d.ean, d.outerGtin, d.commodity, d.origin, d.category].filter(Boolean).join(" "); };

/** Product page link: a product's REF or leaflet code names the SKU; Amazon/regional variants come along. */
function forProduct(p, specs){
  const codes = new Set([String(p.ref||"").split(/[\s(]/)[0], String(p.ifu||"").split("-IFU")[0]].map(c => c.toUpperCase()).filter(c => c.length > 2));
  const hit = s => { const u = s.sku.toUpperCase(); return [...codes].some(c => u === c || u.startsWith(c + "-")); };
  return specs.filter(hit);
}

root.TBDSpecs = { parseSheet, checkAll, derived, show, dims, gapCount, copyText, searchText, forProduct, gtinOk, fmt, GAP_TEXT };
})(typeof window !== "undefined" ? window : globalThis);
