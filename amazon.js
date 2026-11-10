/* The Body Doctor portal: Amazon listings.
   Reads the "Amazon SKU Masterlist" layout (one row per seller SKU), cleans it and flags
   expiry dates and barcodes worth checking. Used by app.js. */
(function (root) {
"use strict";

// [field, header (lower case), label, group, type]
const F = [
  ["asin","asin","ASIN","overview","code"],
  ["product","product","Product","overview"],
  ["code","product code","Product code","overview","code"],
  ["brand","brand","Brand","overview"],
  ["barcode","barcode","Barcode","overview","code"],
  ["live","live?","Live","overview","yesno"],
  ["discontinued","discontinued","Discontinued","overview","yesno"],
  ["bundle","bundle","Bundle","overview","yesno"],
  ["expiry","expiry","Has an expiry date","overview","yesno"],
  ["expiryDate","expiry date","Expiry date","overview","date"],
  ["mainSku","main sku","Main SKU","overview","yesno"],
  ["primarySku","primary sku","Primary SKU","overview","yesno"],
  ["route","primary route?","Primary route","overview"],
  ["currentRoute","current route","Current route","overview"],
  ["transparency","transp","Transparency codes","overview","yesno"],
  ["regClass","regulatory classification","Regulatory classification","overview"],

  ["uk","uk fba msku","UK","markets"], ["mfn","mfn msku","UK merchant-fulfilled (MFN)","markets"],
  ["de","de fba msku","Germany","markets"], ["es","es fba msku","Spain","markets"], ["fr","fr fba msku","France","markets"],
  ["it","it fba msku","Italy","markets"], ["nl","nl fba msku","Netherlands","markets"], ["pl","pl fba msku","Poland","markets"],
  ["se","se fba msku","Sweden","markets"], ["tr","tr fba msku","Turkey","markets"], ["be","be fba msku","Belgium","markets"],
  ["ie","ie fba msku","Ireland","markets"], ["us","us fba msku","United States","markets"], ["ca","ca fba msku","Canada","markets"],
  ["au","au fba msku","Australia","markets"], ["in","in fba msku","India","markets"], ["inFnsku","in fba fnsku","India FNSKU","markets"],

  ["boxQty","box qty","Units per box","fba","num"],
  ["fbaL","fba length (cm)","FBA length","fba","num","cm"], ["fbaW","fba width (cm)","FBA width","fba","num","cm"], ["fbaH","fba height (cm)","FBA height","fba","num","cm"],
  ["fbaWeight","fba weight (g)","FBA weight","fba","num","g"], ["volWeight","volume weight (g)","Volume weight","fba","num","g"],
  ["realL","real length (cm)","Real length","fba","num","cm"], ["realW","real width (cm)","Real width","fba","num","cm"], ["realH","real height (cm)","Real height","fba","num","cm"],
  ["realWeight","real weight (kg)","Real weight","fba","num","kg"],
  ["auL","au fba length (cm)","Australia FBA length","fba","num","cm"], ["auW","au fba width (cm)","Australia FBA width","fba","num","cm"], ["auH","au fba height (cm)","Australia FBA height","fba","num","cm"],
  ["auWeight","au fba weight (g)","Australia FBA weight","fba","num","g"],
  ["ukStorage","uk fba storage type","UK storage type","fba"], ["euStorage","eu fba storage type","EU storage type","fba"], ["feeCat","fba fee category","FBA fee category","fba"],

  ["ifu","ifu","Instruction leaflet","inserts"],
  ["ifuAName","ifu a name","Leaflet A","inserts"], ["ifuACode","ifu a code","Leaflet A code","inserts","code"], ["ifuAQty","ifu a qty","Leaflet A quantity","inserts"],
  ["ifuBName","ifu b name","Leaflet B","inserts"], ["ifuBCode","ifu b code","Leaflet B code","inserts","code"], ["ifuBQty","ifu b qty","Leaflet B quantity","inserts"],
  ["caSleeve","ca sleeve","Canada sleeve","inserts"],
  ["sleeveAName","ca sleeve a name","Sleeve A","inserts"], ["sleeveACode","ca sleeve a code","Sleeve A code","inserts"], ["sleeveAQty","ca sleeve a qty","Sleeve A quantity","inserts"],
  ["sleeveBName","ca sleeve b name","Sleeve B","inserts"], ["sleeveBCode","ca sleeve b code","Sleeve B code","inserts"], ["sleeveBQty","ca sleeve b qty","Sleeve B quantity","inserts"],

  ["ciDesc","commercial invoice description of goods","Invoice description of goods","customs"],
  ["ciMaterial","commercial invoice product material","Product material","customs"],
  ["ciHs","commercial invoice hs code","HS code (invoice)","customs","code"],
  ["ciCoo","commercial invoice country of origin","Country of origin (invoice)","customs"],
  ["commodity","commodity code","Commodity code","customs","code"],
  ["sageCoo","sage country of origin","Country of origin (Sage)","customs"],
  ["cooUk","uk coo","Origin label: UK","customs"], ["cooDe","de coo","Origin label: Germany","customs"], ["cooEs","es coo","Origin label: Spain","customs"],
  ["cooFr","fr coo","Origin label: France","customs"], ["cooIt","it coo","Origin label: Italy","customs"], ["cooNl","nl coo","Origin label: Netherlands","customs"],
  ["cooPl","pl coo","Origin label: Poland","customs"], ["cooSe","se coo","Origin label: Sweden","customs"], ["cooBe","be coo","Origin label: Belgium","customs"],

  ["rrp","uk rrp","UK RRP","pricing","money","£"],
  ["costGbp","product cost £","Product cost (£)","pricing","money","£"],
  ["costUsd","product cost $","Product cost ($)","pricing","money","$"],
  ["vendorCost","uk vendor cost","UK vendor cost","pricing","money","£"],

  ["ukCategory","uk category","UK category","listing"],
  ["title","uk product title","Title","listing"],
  ["bullet1","uk product bullet 1","Bullet 1","listing"], ["bullet2","uk product bullet 2","Bullet 2","listing"], ["bullet3","uk product bullet 3","Bullet 3","listing"],
  ["bullet4","uk product bullet 4","Bullet 4","listing"], ["bullet5","uk product bullet 5","Bullet 5","listing"],
  ["desc","uk product description","Description","listing"],
  ["variation","uk variation","Variation","listing","yesno"], ["parentAsin","uk parent asin","Parent ASIN","listing","code"], ["parentSku","uk parent sku","Parent SKU","listing","code"]
];
const MARKETS = F.filter(f => f[3] === "markets" && f[0] !== "inFnsku");
const GROUPS = [["fba","FBA box and dimensions"],["inserts","Leaflets and sleeves"],["customs","Customs and origin"],["pricing","Prices and costs"],["listing","Listing text (UK)"]];

const norm = s => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
const isError = s => /^#(N\/A|VALUE!|REF!|DIV\/0!|NAME\?|NUM!|NULL!)$/i.test(s);
function excelDate(v){
  if (v instanceof Date) return isNaN(v) ? null : new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate())).toISOString().slice(0,10);
  if (typeof v === "number" && v > 20000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000).toISOString().slice(0,10);
  const s = norm(v); let m;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return m[1] + "-" + m[2] + "-" + m[3];
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) return m[3] + "-" + m[2].padStart(2,"0") + "-" + m[1].padStart(2,"0");
  return null;
}
function clean(type, v){
  if (type === "date") return excelDate(v);
  let s = typeof v === "number" ? (Number.isInteger(v) ? String(v) : String(Math.round(v * 10000) / 10000)) : norm(v);
  if (!s || isError(s) || /^n\/?a$/i.test(s)) return null;
  if (type === "num" || type === "money"){ const n = Number(s.replace(/[£$,]/g, "")); return isFinite(n) && n > 0 ? n : (isFinite(n) ? null : s); }
  if (type === "code"){ s = s.replace(/\s+/g, "").replace(/\.0+$/, ""); return /^0+$/.test(s) ? null : s; }
  return s;
}

/** rows: the whole sheet as arrays. Returns { listings, skipped, headerRow }. */
function parseSheet(rows){
  const hi = rows.findIndex(r => { const h = r.map(c => norm(c).toLowerCase()); return h.includes("asin") && h.includes("product code") && h.some(x => /fba msku/.test(x)); });
  if (hi < 0) throw new Error("Couldn't find the header row. The sheet needs ASIN, Product Code and FBA MSKU columns.");
  const header = rows[hi].map(c => norm(c).toLowerCase());
  const idx = {}; for (const [k, hd] of F){ const i = header.indexOf(hd); if (i >= 0) idx[k] = i; }
  const listings = [], count = new Map(); let skipped = 0;
  rows.slice(hi + 1).forEach((r, n) => {
    const d = {};
    for (const [k,, , , type] of F) d[k] = idx[k] == null ? null : clean(type, r[idx[k]]);
    if (!d.asin && !d.code && !d.product){ if (r.some(c => norm(c))) skipped++; return; }
    const base = d.asin || ("code-" + (d.code || "row" + (n + 1)));
    const k = (count.get(base) || 0) + 1; count.set(base, k);
    listings.push({ id: base + "#" + k, asin: d.asin || "", code: d.code || "", name: d.product || d.title || d.code || base, brand: d.brand || "", sort: n + 1, data: d });
  });
  if (!listings.length) throw new Error("No listing rows found under the header row.");
  checkAll(listings);
  return { listings, skipped, headerRow: hi + 1 };
}

/* ---------- markets ---------- */
function marketState(v){
  if (!v) return "none";
  if (/can'?t be sold|cannot be sold/i.test(v)) return "blocked";
  if (/only$/i.test(v)) return "restricted";
  if (/^duplicate$/i.test(v)) return "duplicate";
  return "sku";
}
const MARKET_TEXT = { none:"Not listed", blocked:"Can't be sold", duplicate:"Duplicate" };
// Countries with a seller SKU (UK merchant-fulfilled only counts when there's no UK FBA SKU).
const soldIn = d => MARKETS.filter(([k]) => marketState(d[k]) === "sku" && (k !== "mfn" || marketState(d.uk) !== "sku"));
const allSkus = d => [...MARKETS.map(([k]) => d[k]), d.inFnsku, d.parentSku].filter(v => v && marketState(v) === "sku");

/* ---------- checks ---------- */
function checkOne(d, today){
  const w = [], t = today || new Date().toISOString().slice(0,10);
  if (d.expiryDate){
    const days = Math.round((Date.parse(d.expiryDate) - Date.parse(t)) / 86400000);
    if (days < 0) w.push("Stock expired on " + fmtDate(d.expiryDate) + ".");
    else if (days <= 120) w.push("Stock expires on " + fmtDate(d.expiryDate) + ", in " + days + " day" + (days === 1 ? "" : "s") + ".");
  }
  const gtinOk = root.TBDSpecs?.gtinOk;
  if (d.barcode && gtinOk){
    if (!/^\d+$/.test(d.barcode)) w.push("Barcode " + d.barcode + " contains characters that aren't digits.");
    else if (![8,12,13,14].includes(d.barcode.length)) w.push("Barcode " + d.barcode + " has " + d.barcode.length + " digits" + (d.barcode.length === 11 ? ", so a leading zero may have been lost." : "."));
    else if (!gtinOk(d.barcode)) w.push("Barcode " + d.barcode + " fails the barcode check digit, so a digit is probably wrong.");
  }
  if (/^yes$/i.test(d.live || "") && !soldIn(d).length) w.push("Marked live but no marketplace has a seller SKU.");
  return w;
}
function checkAll(list, today){ for (const l of list) l.data.warnings = checkOne(l.data, today); return list; }

/* ---------- display ---------- */
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function fmtDate(iso){ const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? Number(m[3]) + " " + MONTHS[Number(m[2]) - 1] + " " + m[1] : String(iso); }
const num = n => Number(n).toLocaleString("en-GB", { maximumFractionDigits: 2 });
function show(d, field){
  const f = F.find(x => x[0] === field); const v = d[field];
  if (v == null) return { text:"Not provided", gap:true };
  const [, , , , type, unit] = f;
  if (type === "date") return { text: fmtDate(v) };
  if (type === "money" && typeof v === "number") return { text: unit + v.toFixed(2) };
  if (type === "num" && typeof v === "number") return { text: num(v) + (unit ? " " + unit : "") };
  return { text: String(v) };
}
const isYes = v => /^yes/i.test(v || "");
/** Groups of [label, value] rows that have something in them. */
function groupRows(d, group){ return F.filter(f => f[3] === group && d[f[0]] != null).map(f => [f[2], show(d, f[0])]); }
const searchText = l => { const d = l.data; return [l.asin, l.code, d.product, d.brand, d.barcode, d.title, ...allSkus(d)].filter(Boolean).join(" "); };
function copyText(l){
  const d = l.data, L = [d.product + (l.code ? " (" + l.code + ")" : "")];
  const add = (k, v) => { if (v) L.push(k + ": " + v); };
  add("ASIN", l.asin); add("Barcode", d.barcode); add("Live", d.live); add("Bundle", d.bundle); add("Expiry date", d.expiryDate && fmtDate(d.expiryDate));
  for (const [k, , label] of MARKETS){ if (d[k]) add(label + " seller SKU", marketState(d[k]) === "sku" ? d[k] : MARKET_TEXT[marketState(d[k])] || d[k]); }
  add("Units per box", d.boxQty);
  return L.join("\n");
}

root.TBDAmazon = { F, MARKETS, GROUPS, parseSheet, checkAll, marketState, MARKET_TEXT, soldIn, allSkus, show, groupRows, isYes, searchText, copyText, fmtDate };
})(typeof window !== "undefined" ? window : globalThis);
