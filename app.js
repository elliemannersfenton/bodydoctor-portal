/* The Body Doctor — Customer Query Portal (GitHub Pages + Supabase) */
(() => {
"use strict";
const CFG = window.PORTAL_CONFIG || {};
const LEVEL = { viewer:1, contributor:2, editor:3, admin:4 };
const S = { products:[], faqs:[], notes:[], topics:[], specs:[], specsMissing:false, me:null, loaded:false, q:"", route:"home",
  noteFilter:"all", editingFaq:null, offline:false, draft:null, authMode:"team",
  specBrand:"all", specQ:"", specCheck:false, specImport:null,
  secQ:{ products:"", faqs:"" },
  amazon:[], amzLoaded:false, amzMissing:false, amzError:null, amzQ:"", amzBrand:"all", amzStatus:"live", amzShowAll:false, amzRow:{}, amzText:{}, amzImport:null };
const SP = window.TBDSpecs;
const $ = (s, r=document) => r.querySelector(s);
const main = $("#main");
const lvl = () => LEVEL[S.me?.role] || 0;
const canWrite = () => lvl() >= 2, canEdit = () => lvl() >= 3, isAdmin = () => false;
const store = { get(k){ try { return localStorage.getItem(k); } catch { return null; } }, set(k,v){ try { localStorage.setItem(k,v); } catch {} } };
const DEVICE = store.get("tbd-device") || (() => { const id = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now()); store.set("tbd-device", id); return id; })();
const configured = CFG.SUPABASE_URL && /^https:\/\//.test(CFG.SUPABASE_URL) && CFG.SUPABASE_ANON_KEY && !/PASTE/.test(CFG.SUPABASE_ANON_KEY);
const sb = configured && window.supabase ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, { auth: { persistSession:true, autoRefreshToken:true, storageKey:"tbd-portal-auth" } }) : null;
const PHOTO_BASE = configured ? CFG.SUPABASE_URL.replace(/\/$/,"") + "/storage/v1/object/public/photos/" : "\u0000";

/* ---------- server ---------- */
const friendly = e => {
  const m = String(e?.message || e || "");
  if (/JWT|session|refresh/i.test(m)) return "Your sign-in has expired. Sign in again.";
  if (/row-level security|permission|not allowed|Only editors/i.test(m)) return "You don't have permission to do that.";
  if (/Failed to fetch|NetworkError|network/i.test(m)) return "Can't reach the server. Check your connection and try again.";
  return m || "Something went wrong. Try again.";
};
const chk = r => { if (r.error) throw new Error(friendly(r.error)); return r.data; };
const asList = v => Array.isArray(v) ? v.map(x => String(x ?? "").trim()).filter(Boolean) : [];
function slugId(name){ return String(name).toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"") || "product"; }

/** One entry point for every change, so the views stay the same as the server version. */
async function api(action, body){
  switch (action){
    case "note_add":
      return chk(await sb.from("notes").insert({ text: body.text, topic: body.topic || "general", important: !!body.important, author_name: (myName() || "").slice(0,80), device_id: DEVICE }));
    case "note_delete":
      if (canEdit()) return chk(await sb.from("notes").delete().eq("id", body.id));
      return chk(await sb.rpc("delete_own_note", { note_id: Number(body.id), dev: DEVICE }));
    case "faq_save": {
      if (!body.category || !body.question) throw new Error("Add a topic and a question.");
      const row = { category: body.category, question: body.question, answer: body.answer || "", steps: asList(body.steps), note: body.note || "", products: asList(body.products) };
      if (body.id) chk(await sb.from("faqs").update({ ...row, updated_at: new Date().toISOString() }).eq("id", body.id));
      else {
        const order = Math.max(0, ...S.faqs.map(f => f.order || 0)) + 1;
        chk(await sb.from("faqs").insert({ ...row, sort: order }));
        if (!S.topics.some(t => t.name === body.category)) await sb.from("topics").insert({ name: body.category, sort: Math.max(0, ...S.topics.map(t => t.sort || 0)) + 1 });
      }
      return {};
    }
    case "faq_delete": return chk(await sb.from("faqs").delete().eq("id", body.id));
    case "topic_save":
      chk(await sb.rpc("save_topic", { old_name: body.name, new_name: body.newName, new_photo: body.photo || null }));
      return { name: body.newName };
    case "product_save": {
      const name = String(body.name || "").trim();
      if (!name) throw new Error("Give the product a name.");
      let id = body.id;
      if (!id){ const base = slugId(name); id = base; let n = 2; while (S.products.some(p => p.id === id)) id = base + "-" + n++; }
      const sections = (body.sections || []).map(s => {
        const o = { title: String(s.title || "").trim() };
        for (const k of ["intro","text","note"]) if (String(s[k] || "").trim()) o[k] = String(s[k]).trim();
        for (const k of ["steps","bullets"]) { const v = asList(s[k]); if (v.length) o[k] = v; }
        if (s.table?.rows?.length) o.table = { head: asList(s.table.head), rows: s.table.rows.map(asList).filter(r => r.length) };
        return o;
      }).filter(s => s.title || Object.keys(s).length > 1);
      const order = body.order !== "" && body.order != null && !isNaN(Number(body.order)) ? Number(body.order) : (prodById(id)?.order ?? (Math.max(0, ...S.products.map(p => p.order || 0)) + 1));
      chk(await sb.from("products").upsert({ id, name, family: body.family || "", ref: body.ref || "", ifu: body.ifu || "", summary: body.summary || "",
        facts: (body.facts || []).filter(f => f[0] || f[1]).map(f => [String(f[0]||""), String(f[1]||"")]), sections, photo: body.photo || null, sort: order, updated_at: new Date().toISOString() }));
      return { id };
    }
    case "product_delete": return chk(await sb.from("products").delete().eq("id", body.id));
    case "upload": {
      const file = body.get("file");
      if (!file) throw new Error("Choose an image first.");
      if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) throw new Error("Upload a JPG, PNG, WebP or GIF image.");
      if (file.size > 6 * 1048576) throw new Error("That image is too large. Keep it under 6 MB.");
      const ext = { "image/jpeg":"jpg", "image/png":"png", "image/webp":"webp", "image/gif":"gif" }[file.type];
      const path = new Date().toISOString().slice(0,10) + "-" + Math.random().toString(36).slice(2,10) + "." + ext;
      chk(await sb.storage.from("photos").upload(path, file, { contentType: file.type, upsert:false }));
      return { path: PHOTO_BASE + path };
    }
    case "specs_import": {
      const now = new Date().toISOString();
      const rows = body.specs.map(x => { const { warnings, ...data } = x.data; return { sku:x.sku, brand:x.brand, family:x.family, name:x.name, sort:x.sort, data, source: body.source || "", updated_at: now }; });
      for (let i = 0; i < rows.length; i += 200) chk(await sb.from("specs").upsert(rows.slice(i, i + 200)));
      if (body.removed?.length) chk(await sb.from("specs").delete().in("sku", body.removed));
      return {};
    }
    case "amazon_import": {
      const now = new Date().toISOString(), TEXT = ["title","desc","bullet1","bullet2","bullet3","bullet4","bullet5"];
      const rows = body.listings.map(x => { const data = {}, listing = {};
        for (const [k, v] of Object.entries(x.data)){ if (v == null || k === "warnings") continue; (TEXT.includes(k) ? listing : data)[k] = v; }
        return { id:x.id, asin:x.asin, code:x.code, name:x.name, brand:x.brand, sort:x.sort, data, listing, source: body.source || "", updated_at: now }; });
      for (let i = 0; i < rows.length; i += 100) chk(await sb.from("amazon").upsert(rows.slice(i, i + 100)));
      for (let i = 0; i < (body.removed || []).length; i += 100) chk(await sb.from("amazon").delete().in("id", body.removed.slice(i, i + 100)));
      return {};
    }
    case "password": return chk(await sb.auth.updateUser({ password: body.new }));
    default: throw new Error("Unknown request.");
  }
}
const rowsToState = (p, f, t, n) => {
  S.products = p.map(x => ({ id:x.id, name:x.name, family:x.family, ref:x.ref, ifu:x.ifu, summary:x.summary, facts:x.facts || [], sections:x.sections || [], photo:x.photo, order:x.sort }));
  S.faqs = f.map(x => ({ id:String(x.id), category:x.category, question:x.question, answer:x.answer, steps:x.steps || [], note:x.note, products:x.products || [], order:x.sort }));
  S.topics = t;
  S.notes = n.map(x => ({ id:String(x.id), text:x.text, topic:x.topic, important:x.important, author_name:x.author_name, device_id:x.device_id, createdAt: Date.parse(x.created_at) }));
};
let loading = null;
async function load(){
  if (loading) return loading;
  loading = (async () => {
    try {
      const [p, f, t, n] = await Promise.all([
        sb.from("products").select("*").order("sort").order("name"),
        sb.from("faqs").select("*").order("sort").order("id"),
        sb.from("topics").select("*"),
        Promise.resolve({ data: [], error: null })]);
      rowsToState(chk(p), chk(f), chk(t), chk(n));
      await loadSpecs();
      S.loaded = true; S.offline = false;
      render();
    } catch(e){ S.offline = true; if (S.loaded) render(); else main.replaceChildren(W(h("div",{class:"band"},h("div",{class:"empty",text:friendly(e)})))); }
    finally { loading = null; }
  })();
  return loading;
}
// Specs live in their own table; if it isn't set up yet the rest of the portal still works.
async function loadSpecs(){
  if (!SP) { S.specsMissing = true; return; }
  const r = await sb.from("specs").select("*").order("sort").order("sku");
  if (r.error){ S.specsMissing = /relation|does not exist|schema cache|not find/i.test(r.error.message || ""); if (!S.specsMissing) throw new Error(friendly(r.error)); S.specs = []; return; }
  S.specsMissing = false;
  S.specs = SP.checkAll(r.data.map(x => ({ sku:x.sku, brand:x.brand || "", family:x.family || "", name:x.name || x.sku, sort:x.sort, data:{ ...(x.data || {}), gaps:(x.data || {}).gaps || {} }, source:x.source, updatedAt: Date.parse(x.updated_at) })));
}
let reloadT;
const reloadSoon = () => { clearTimeout(reloadT); reloadT = setTimeout(load, 400); };
async function act(action, body, okMsg){
  const r = await api(action, body);
  if (okMsg) toast(okMsg);
  await load();
  return r;
}
const myName = () => store.get("tbd-name") || "";

/* ---------- helpers ---------- */
function h(tag, props, ...kids){
  const el = document.createElement(tag);
  if (props) for (const [k,v] of Object.entries(props)){
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k === "value") el.value = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}
const W = (...kids) => h("div",{class:"wrap"},...kids);
const searchIcon = () => { const t = document.createElement("template"); t.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>'; return t.content.firstChild; };
// Bundled photos sit next to index.html (saved in the database as assets/img/name.webp); uploads are Supabase links.
const safeSrc = p => { if (typeof p !== "string") return null;
  const m = p.match(/^(?:assets\/img\/)?([A-Za-z0-9._-]+\.(?:webp|png|jpe?g|gif))$/); if (m) return m[1];
  return (p.startsWith(PHOTO_BASE) && /^[A-Za-z0-9._-]+$/.test(p.slice(PHOTO_BASE.length))) ? p : null; };
const photo = (src, alt) => safeSrc(src) ? h("div",{class:"photo"},h("img",{src:safeSrc(src),alt:alt||"",loading:"lazy"})) : null;
const slug = s => String(s).toLowerCase().replace(/&/g,"and").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
const terms = () => S.q.toLowerCase().split(/\s+/).filter(t => t.length > 1 || /\d/.test(t));
function hl(text){
  const t = terms(); text = String(text ?? "");
  if (!t.length) return document.createTextNode(text);
  const re = new RegExp("(" + t.map(x => x.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")).join("|") + ")", "gi");
  const frag = document.createDocumentFragment();
  text.split(re).forEach((part,i) => frag.append(i % 2 ? h("mark",{text:part}) : document.createTextNode(part)));
  return frag;
}
function snippet(text){
  const t = terms(), low = text.toLowerCase();
  let i = -1; for (const x of t){ const j = low.indexOf(x); if (j >= 0 && (i < 0 || j < i)) i = j; }
  if (i < 0) return text.slice(0, 160) + (text.length > 160 ? "…" : "");
  const s = Math.max(0, i - 70), e = Math.min(text.length, i + 120);
  return (s ? "…" : "") + text.slice(s, e) + (e < text.length ? "…" : "");
}
const matches = hay => { const t = terms(), low = hay.toLowerCase(); return t.length && t.every(x => low.includes(x)); };
function toast(msg){ const t = h("div",{class:"toast",role:"status",text:msg}); document.body.append(t); setTimeout(() => t.remove(), 2400); }
function fmtDate(ms){ try { return new Date(ms).toLocaleString("en-GB",{day:"numeric",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"}); } catch { return ""; } }
const lines = s => String(s||"").split("\n").map(x => x.trim()).filter(Boolean);

/* ---------- derived ---------- */
const prodById = id => S.products.find(p => p.id === id);
const topicPhoto = name => S.topics.find(t => t.name === name)?.photo || null;
function categories(){
  const m = new Map();
  const sortOf = name => { const t = S.topics.find(x => x.name === name); return t ? Number(t.sort)||0 : 1e6; };
  for (const f of S.faqs){ const c = f.category || "General"; if (!m.has(c)) m.set(c, {name:c, slug:slug(c), count:0, first:f.order ?? 1e9}); const e = m.get(c); e.count++; e.first = Math.min(e.first, f.order ?? 1e9); }
  return [...m.values()].sort((a,b) => (sortOf(a.name) - sortOf(b.name)) || (a.first - b.first));
}
function topicLabel(topic){
  if (!topic || topic === "general") return "General";
  if (topic.startsWith("p:")) return prodById(topic.slice(2))?.name || "Product";
  if (topic.startsWith("c:")) return topic.slice(2);
  return topic;
}
const sectionText = s => [s.title, s.intro, s.text, ...(s.steps||[]), ...(s.bullets||[]), s.note, ...(s.table ? s.table.rows.flat() : [])].filter(Boolean).join(" ");
const faqText = f => [f.question, f.answer, ...(f.steps||[]), f.note, f.category].filter(Boolean).join(" ");
const faqCopyText = f => [f.answer, ...(f.steps||[]).map(s => "• " + s)].filter(Boolean).join("\n");

/* ---------- pieces ---------- */
function sectionEl(s, id){
  return h("section",{class:"sec", id},
    h("h2",null,hl(s.title)),
    s.intro ? h("p",null,hl(s.intro)) : null,
    s.text ? h("p",null,hl(s.text)) : null,
    s.steps?.length ? h("ol",{class:"steps"}, s.steps.map(x => h("li",null,h("span",null,hl(x))))) : null,
    s.table?.rows?.length ? h("div",{class:"tbl"},h("table",null, s.table.head?.length ? h("thead",null,h("tr",null,s.table.head.map(x => h("th",{text:x})))) : null, h("tbody",null,s.table.rows.map(r => h("tr",null,r.map(c => h("td",null,hl(c)))))))) : null,
    s.bullets?.length ? h("ul",{class:"bul"}, s.bullets.map(x => h("li",null,hl(x)))) : null,
    s.note ? h("div",{class:"callout"},hl(s.note)) : null);
}
function faqEl(f, open){
  const copyBtn = h("button",{class:"link",type:"button",text:"Copy answer",onclick: async () => {
    const txt = faqCopyText(f);
    try { await navigator.clipboard.writeText(txt); toast("Answer copied"); }
    catch { const ta = h("textarea",{style:"position:fixed;opacity:0"}); ta.value = txt; document.body.append(ta); ta.select(); try{document.execCommand("copy"); toast("Answer copied");}catch{toast("Select the answer text to copy it");} ta.remove(); }
  }});
  const foot = h("div",{class:"faq-foot"}, copyBtn,
    (f.products||[]).map(pid => prodById(pid) ? h("a",{href:"#p-"+pid, text:"See "+prodById(pid).name.replace(/^Eye Doctor /,"")+" instructions"}) : null),
    h("a",{class:"chip",href:"#t-"+slug(f.category),text:f.category}));
  if (canEdit()) foot.append(h("button",{class:"link",type:"button",text:"Edit",onclick:() => openFaqDialog(f)}), confirmDelete("Delete", () => act("faq_delete",{id:f.id},"FAQ deleted")));
  return h("details",{class:"faq", open: open || null, id:"f-"+f.id},
    h("summary",null,h("span",{class:"q"},hl(f.question))),
    h("div",{class:"faq-body"},
      f.answer ? h("p",null,hl(f.answer)) : null,
      f.steps?.length ? h("ol",{class:"steps"}, f.steps.map(x => h("li",null,h("span",null,hl(x))))) : null,
      f.note ? h("div",{class:"callout"},hl(f.note)) : null,
      foot));
}
function confirmDelete(label, fn){
  const b = h("button",{class:"link danger",type:"button",text:label});
  let armed = false, t;
  b.addEventListener("click", async () => {
    if (!armed){ armed = true; b.textContent = "Click again to confirm"; t = setTimeout(() => { armed = false; b.textContent = label; }, 4000); return; }
    clearTimeout(t); b.disabled = true;
    try { await fn(); } catch(e){ toast(e.message); b.disabled = false; armed = false; b.textContent = label; }
  });
  return b;
}
function noteEl(n){
  const mine = n.device_id && n.device_id === DEVICE;
  return h("article",{class:"note" + (n.important ? " important" : "")},
    n.important ? h("span",{class:"flag",text:"Important"}) : null,
    h("p",null,hl(n.text)),
    h("div",{class:"meta"},
      h("span",{text: (n.author_name || "Team") + (mine ? " (you)" : "")}),
      h("span",{text:"·"}), h("span",{text:fmtDate(n.createdAt)}),
      h("a",{class:"chip", href: n.topic?.startsWith("p:") ? "#p-"+n.topic.slice(2) : n.topic?.startsWith("c:") ? "#t-"+slug(n.topic.slice(2)) : "#notes", text:topicLabel(n.topic)}),
      (mine || canEdit()) ? confirmDelete("Delete", () => act("note_delete",{id:n.id},"Note deleted")) : null));
}
const sortedNotes = list => [...list].sort((a,b) => (b.important?1:0) - (a.important?1:0) || (b.createdAt||0) - (a.createdAt||0));
function noteForm(defaultTopic){
  if (!canWrite()) return h("div",{class:"status",text:"You have view-only access, so you can read notes but not add them."});
  const key = defaultTopic.replace(/[^a-z0-9]/gi,"");
  const sel = h("select",{id:"nTopic-"+key},
    h("option",{value:"general",text:"General notice"}),
    h("optgroup",{label:"Product"}, S.products.map(p => h("option",{value:"p:"+p.id,text:p.name}))),
    h("optgroup",{label:"FAQ topic"}, categories().map(c => h("option",{value:"c:"+c.name,text:c.name}))));
  sel.value = defaultTopic;
  const ta = h("textarea",{id:"nText-"+key, placeholder:"Add a tip, update or reminder for the team…", required:true});
  const imp = h("input",{type:"checkbox", id:"nImp-"+key});
  const btn = h("button",{class:"btn small",type:"submit",text:"Post note"});
  const nameI = h("input",{type:"text",id:"nName-"+key,value: myName() || (canEdit() ? (S.me.email||"").split("@")[0] : ""),placeholder:"Your first name",required:true,maxlength:"80"});
  const f = h("form",{class:"addnote"},
    h("label",null,"New staff note", ta),
    h("div",{class:"row"}, h("label",{style:"flex:1 1 220px"},"Attach to", sel), h("label",{style:"flex:0 1 200px"},"Your name", nameI), h("label",{class:"inline"}, imp, "Mark as important")),
    h("div",null,btn));
  f.addEventListener("submit", async e => {
    e.preventDefault();
    const text = ta.value.trim(); if (!text) return;
    if (nameI.value.trim()) store.set("tbd-name", nameI.value.trim().slice(0,80));
    btn.disabled = true;
    try { await api("note_add",{text, topic: sel.value, important: imp.checked}); ta.value = ""; imp.checked = false; toast("Note posted"); await load(); }
    catch(err){ toast(err.message); }
    btn.disabled = false;
  });
  return f;
}
const loadingOr = msg => h("div",{class:"empty",text: S.loaded ? msg : "Loading…"});
function productTile(p){
  return h("a",{class:"ptile",href:"#p-"+p.id},
    photo(p.photo, p.name) || h("div",{class:"photo"}),
    p.ref ? h("span",{class:"chip ref",style:"align-self:flex-start",text:"REF "+p.ref}) : null,
    h("h3",{text:p.name}),
    h("span",{class:"more",text:"View instructions"}));
}
function topicTile(c){
  const ph = photo(topicPhoto(c.name));
  return h("a",{class:"ttile",href:"#t-"+c.slug}, ph || h("div",{class:"noimg"},h("span")), h("div",null,h("b",{text:c.name}),h("small",{text:c.count+" answer"+(c.count>1?"s":"")})));
}
function photoField(current, onChange){
  const wrap = h("div",{class:"photo-field"});
  const draw = src => {
    const input = h("input",{type:"file",accept:"image/jpeg,image/png,image/webp,image/gif",id:"photoInput"});
    const msg = h("span",{class:"help"});
    input.addEventListener("change", async () => {
      const file = input.files?.[0]; if (!file) return;
      msg.textContent = "Uploading…";
      const fd = new FormData(); fd.append("file", file);
      try { const r = await api("upload", fd, true); onChange(r.path); draw(r.path); }
      catch(e){ msg.textContent = e.message; }
    });
    wrap.replaceChildren(photo(src) || h("div",{class:"ph-empty",text:"No photo"}),
      h("div",{class:"stack",style:"gap:8px"},
        h("label",null,"Photo", input),
        h("span",{class:"help",text:"A square product shot on a white background looks best. JPG, PNG or WebP, up to 6 MB."}),
        src ? h("button",{class:"link",type:"button",text:"Remove photo",onclick:() => { onChange(null); draw(null); }}) : null, msg));
  };
  draw(current);
  return wrap;
}

/* ---------- views ---------- */
function viewHome(){
  const recent = sortedNotes(S.notes).slice(0, 4);
  const pics = S.products.map(p => safeSrc(p.photo)).filter(Boolean);
  const pic = i => pics.length ? pics[i % pics.length] : null;
  return h("div",null,
    h("section",{class:"hero"},W(
      h("div",null,
        h("div",{class:"eyebrow",text:"Customer services portal"}),
        h("h1",{style:"margin-top:12px"},"How can we help the customer today?"),
        h("p",{class:"lede",text:"Instructions for use, approved answers, packing specs and Amazon listings in one place. Each section has its own search."}),
        h("div",{class:"try jump"}, [["#products","Instructions"],["#faqs","FAQs"],["#specs","Product specs"],["#amazon","Amazon"]].map(([href, t]) => h("a",{href, text:t})))),
      pics.length ? h("div",{class:"collage","aria-hidden":"true"},
        h("figure",{class:"c1"},h("img",{src:pic(0),alt:""})),
        h("figure",{class:"c2"},h("img",{src:pic(3),alt:""})),
        h("figure",{class:"c3"},h("img",{src:pic(2),alt:""})),
        h("span",{class:"plus"})) : h("div"))),
    h("section",{class:"band"},W(
      h("div",{class:"band-head"},h("div",null,h("div",{class:"eyebrow",text:"Instructions for use"}),h("h2",{style:"margin-top:6px"},"Product instructions")),h("a",{href:"#products",text:"View all"})),
      S.products.length ? h("div",{class:"pgrid"}, S.products.map(productTile)) : loadingOr("No product instructions yet."))),
    h("section",{class:"band alt"},W(
      h("div",{class:"band-head"},h("div",null,h("div",{class:"eyebrow",text:"Customer queries"}),h("h2",{style:"margin-top:6px"},"FAQs by product")),h("a",{href:"#faqs",text:"All "+S.faqs.length+" FAQs"})),
      S.faqs.length ? h("div",{class:"tgrid"}, categories().map(topicTile)) : loadingOr("No FAQs yet."))));
}
/** A search box that only searches one section (instructions or FAQs). */
function secSearch(sec, placeholder){
  const input = h("input",{type:"search",id:"q-"+sec,value:S.secQ[sec],placeholder,"aria-label":placeholder,autocomplete:"off"});
  let t; input.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => { S.secQ[sec] = input.value; render(); }, 120); });
  input.addEventListener("keydown", e => { if (e.key === "Escape" && input.value){ S.secQ[sec] = ""; render(); } });
  return h("div",{class:"search secsearch",role:"search"}, searchIcon(), input,
    S.secQ[sec] ? h("button",{class:"clear",type:"button","aria-label":"Clear search",text:"✕",onclick:() => { S.secQ[sec] = ""; render(); $("#q-"+sec)?.focus(); }}) : null);
}
const switchSearch = (sec, label) => h("a",{href:"#"+sec,onclick: e => { e.preventDefault(); S.secQ[sec] = S.q.trim(); if (S.route === sec) render(); else location.hash = sec; },text:label});
function instructionHits(){
  const hits = [];
  for (const p of S.products){
    if (matches([p.name,p.summary,p.ref,...(p.facts||[]).flat()].join(" "))) hits.push({p, title:"Overview", text:[p.summary, ...(p.facts||[]).map(f => f.join(": "))].filter(Boolean).join(" · "), jump:null});
    p.sections.forEach((s,i) => { const t = sectionText(s); if (matches(p.name+" "+t)) hits.push({p, title:s.title || "Section "+(i+1), text:t, jump:"s"+i}); });
  }
  return hits;
}
function viewProducts(){
  const q = S.q.trim(), searching = q && terms().length;
  const hits = searching ? instructionHits() : [];
  return h("section",{class:"band"},W(h("div",{class:"stack",style:"gap:26px"},
    h("div",{class:"band-head",style:"margin-bottom:0"},h("div",null,h("div",{class:"eyebrow",text:"Instructions for use"}),h("h1",{style:"margin-top:6px"},"Product instructions"),
      h("p",{class:"lede",style:"margin-top:10px",text:"Taken from the printed leaflets that go out with each product. Open a product for heating times, step-by-step use, warnings and related FAQs."})),
      canEdit() ? h("a",{class:"btn",href:"#new-product",text:"Add a product"}) : null),
    secSearch("products","Search instructions, e.g. microwave or crystals"),
    !searching ? (S.products.length ? h("div",{class:"pgrid"}, S.products.map(productTile)) : loadingOr("No product instructions yet."))
    : hits.length ? h("section",null,
        h("p",{class:"help",style:"margin-bottom:6px",text: hits.length + " match" + (hits.length > 1 ? "es" : "") + " in the instructions"}),
        hits.map(r => h("a",{class:"res",href:"#p-"+r.p.id,onclick: e => { e.preventDefault(); pendingJump = r.jump || null;
            const target = "p-" + r.p.id; if (S.route === target) render(); else location.hash = target; if (!pendingJump) window.scrollTo(0,0); }},
          photo(r.p.photo) || h("span"),
          h("div",null,h("div",{class:"eyebrow",text:r.p.name}),h("h3",{style:"margin:2px 0 4px"},hl(r.title)),h("div",{class:"snip"},hl(snippet(r.text)))))))
    : h("div",{class:"empty"},"Nothing in the instructions matches “" + q + "”. ", switchSearch("faqs","Search the FAQs instead"), "."))));
}
function viewProduct(id){
  const p = prodById(id);
  if (!p) return W(h("div",{class:"band"},loadingOr("That product isn't in the portal.")));
  const related = S.faqs.filter(f => (f.products||[]).includes(p.id));
  const notes = sortedNotes(S.notes.filter(n => n.topic === "p:"+p.id));
  const jump = (target, label) => h("a",{href:"#p-"+p.id,"data-jump":target,text:label});
  const pack = productSpecBlock(p);
  return W(
    h("div",{class:"crumbs row",style:"justify-content:space-between"},h("span",null,h("a",{href:"#products",text:"Instructions"})," / ",p.name),
      canEdit() ? h("a",{class:"btn small ghost",href:"#edit-"+p.id,text:"Edit product"}) : null),
    h("div",{class:"split"},
      h("aside",null,h("div",{class:"stick"},
        photo(p.photo, p.name),
        p.facts?.length ? h("dl",{class:"facts"}, p.facts.map(([k,v]) => h("div",null,h("dt",{text:k}),h("dd",{text:v})))) : null,
        h("div",null,h("div",{class:"eyebrow",style:"margin-bottom:8px",text:"On this page"}),
          h("nav",{class:"toc"}, p.sections.map((s,i) => jump("s"+i, s.title || "Section "+(i+1))), pack ? jump("pack","Packing and pallet") : null, related.length ? jump("rel","Related FAQs ("+related.length+")") : null)))),
      h("div",null,
        h("div",{class:"stack",style:"gap:14px;padding-bottom:12px"},
          h("div",{class:"eyebrow",text:[p.family, "Instructions for use"].filter(Boolean).join(" · ")}),
          h("h1",{text:p.name}),
          h("div",{class:"row",style:"gap:8px"}, p.ref ? h("span",{class:"chip ref",text:"REF "+p.ref}) : null, p.ifu ? h("span",{class:"chip ref",text:"IFU "+p.ifu}) : null),
          p.summary ? h("p",{class:"lede"},hl(p.summary)) : null),
        p.sections.map((s,i) => sectionEl(s, "s"+i)),
        pack,
        related.length ? h("section",{class:"sec",id:"rel",style:"border-bottom:0"},h("h2",null,"Related FAQs"),h("div",{class:"faqs"},related.map(f => faqEl(f)))) : null)));
}

/* product editor */
function blankSection(){ return {title:"", intro:"", text:"", steps:[], bullets:[], note:"", table:null}; }
function viewProductEditor(id){
  if (!canEdit()) return W(h("div",{class:"band"},h("div",{class:"empty",text:"Only editors can change product instructions."})));
  const existing = id ? prodById(id) : null;
  if (id && !existing) return W(h("div",{class:"band"},loadingOr("That product isn't in the portal.")));
  const key = id || "__new";
  if (!S.draft || S.draft.key !== key){
    const src = existing ? JSON.parse(JSON.stringify(existing)) : {name:"",family:"Eye Doctor",ref:"",ifu:"",summary:"",facts:[],sections:[blankSection()],photo:null};
    S.draft = { key, p: { ...src, facts: src.facts?.length ? src.facts : [["",""]], sections: src.sections?.length ? src.sections : [blankSection()] } };
  }
  const d = S.draft.p;
  const bind = (obj, k, el, transform) => { el.addEventListener("input", () => { obj[k] = transform ? transform(el.value) : el.value; }); return el; };
  const txt = (obj, k, attrs={}) => bind(obj, k, h("input",{type:"text", value: obj[k] ?? "", ...attrs}));
  const area = (obj, k, attrs={}) => bind(obj, k, h("textarea",{...attrs}), null);
  const areaVal = (el, v) => { el.value = v ?? ""; return el; };
  const listArea = (obj, k, attrs={}) => { const el = h("textarea",attrs); el.value = (obj[k]||[]).join("\n"); el.addEventListener("input", () => { obj[k] = lines(el.value); }); return el; };
  const tableArea = sec => {
    const el = h("textarea",{rows:"3",placeholder:"Microwave power | Maximum time\n0 to 850W | 30 seconds"});
    if (sec.table?.rows?.length) el.value = [sec.table.head||[], ...sec.table.rows].map(r => r.join(" | ")).join("\n");
    el.addEventListener("input", () => { const rows = lines(el.value).map(l => l.split("|").map(c => c.trim())); sec.table = rows.length > 1 ? {head: rows[0], rows: rows.slice(1)} : null; });
    return el;
  };
  const rerender = () => render();
  const factsBox = h("div",{class:"stack",style:"gap:8px"},
    d.facts.map((f, i) => h("div",{class:"fact-row"},
      bind(f, 0, h("input",{type:"text",value:f[0],placeholder:"Label, e.g. Microwave, up to 850W","aria-label":"Fact label"})),
      bind(f, 1, h("input",{type:"text",value:f[1],placeholder:"Value, e.g. 30 sec max","aria-label":"Fact value"})),
      h("button",{class:"icon-btn",type:"button",title:"Remove",text:"✕",onclick:() => { d.facts.splice(i,1); rerender(); }}))),
    h("div",null,h("button",{class:"link",type:"button",text:"+ Add a key fact",onclick:() => { d.facts.push(["",""]); rerender(); }})));
  const secCards = d.sections.map((s, i) => h("div",{class:"card"},
    h("div",{class:"card-head"},h("h3",{text:"Section "+(i+1)+(s.title ? ": "+s.title : "")}),
      h("div",{class:"sec-tools"},
        h("button",{class:"icon-btn",type:"button",title:"Move up",text:"↑",disabled:i===0||null,onclick:() => { [d.sections[i-1], d.sections[i]] = [d.sections[i], d.sections[i-1]]; rerender(); }}),
        h("button",{class:"icon-btn",type:"button",title:"Move down",text:"↓",disabled:i===d.sections.length-1||null,onclick:() => { [d.sections[i+1], d.sections[i]] = [d.sections[i], d.sections[i+1]]; rerender(); }}),
        h("button",{class:"icon-btn",type:"button",title:"Remove section",text:"✕",onclick:() => { d.sections.splice(i,1); rerender(); }}))),
    h("label",null,"Heading", txt(s,"title",{placeholder:"e.g. Heating in the microwave"})),
    h("label",null,"Intro (optional)", areaVal(area(s,"intro",{rows:"2"}), s.intro)),
    h("div",{class:"grid2"},
      h("label",null,h("span",null,"Numbered steps ",h("span",{class:"help",text:"one per line"})), listArea(s,"steps",{rows:"5"})),
      h("label",null,h("span",null,"Bullet points ",h("span",{class:"help",text:"one per line"})), listArea(s,"bullets",{rows:"5"}))),
    h("label",null,"Paragraph (optional)", areaVal(area(s,"text",{rows:"3"}), s.text)),
    h("label",null,h("span",null,"Table (optional) ",h("span",{class:"help",text:"first line is the header; separate columns with |"})), tableArea(s)),
    h("label",null,"Highlighted note (optional)", areaVal(area(s,"note",{rows:"2",placeholder:"Warnings or things staff must not miss"}), s.note))));
  const err = h("span",{class:"form-msg"});
  const save = h("button",{class:"btn",type:"button",text: existing ? "Save changes" : "Create product", onclick: async () => {
    err.textContent = ""; save.disabled = true;
    try {
      const body = { ...d, id: existing?.id || "", facts: d.facts.filter(f => f[0] || f[1]) };
      const r = await api("product_save", body);
      S.draft = null; toast(existing ? "Product saved" : "Product created"); await load(); location.hash = "p-" + r.id;
    } catch(e){ err.textContent = e.message; }
    save.disabled = false;
  }});
  return h("section",{class:"band"},W(h("div",{class:"editor"},
    h("div",{class:"crumbs",style:"padding:0"},h("a",{href:"#products",text:"Instructions"})," / ", existing ? h("a",{href:"#p-"+existing.id,text:existing.name}) : "New product"," / Edit"),
    h("div",null,h("div",{class:"eyebrow",text: existing ? "Edit product" : "New product"}),h("h1",{style:"margin-top:6px",text: existing ? existing.name : "Add a product"})),
    h("div",{class:"card"},
      h("label",null,"Product name", txt(d,"name",{required:true,placeholder:"e.g. Eye Doctor Essential"})),
      h("div",{class:"grid3"},
        h("label",null,"Range", txt(d,"family",{placeholder:"e.g. Eye Doctor"})),
        h("label",null,"REF / product code", txt(d,"ref",{placeholder:"e.g. EDPR03"})),
        h("label",null,"Leaflet version (IFU)", txt(d,"ifu",{placeholder:"e.g. EDPR03-IFU-V1-JAN25"}))),
      h("label",null,"Short summary", areaVal(area(d,"summary",{rows:"3"}), d.summary)),
      h("label",null,h("span",null,"Display order ",h("span",{class:"help",text:"lower numbers show first"})), h("input",{type:"text",inputmode:"numeric",value:String(d.order ?? ""),style:"max-width:120px",oninput:e => { d.order = e.target.value; }})),
      photoField(d.photo, v => { d.photo = v; })),
    h("div",{class:"card"},h("h3",null,"Key facts"),h("p",{class:"help",text:"Short label and value pairs shown beside the photo, such as heating times or shelf life."}), factsBox),
    h("div",{class:"stack",style:"gap:14px"},h("h2",null,"Instruction sections"), secCards,
      h("div",null,h("button",{class:"btn ghost small",type:"button",text:"+ Add a section",onclick:() => { d.sections.push(blankSection()); rerender(); }}))),
    h("div",{class:"sticky-bar"}, save, h("a",{class:"btn ghost",href: existing ? "#p-"+existing.id : "#products",text:"Cancel",onclick:() => { S.draft = null; }}),
      existing ? confirmDelete("Delete this product", async () => { await api("product_delete",{id:existing.id}); S.draft = null; toast("Product deleted"); await load(); location.hash = "products"; }) : null, err))));
}

/* ---------- product specs (packing, pallets, trade) ---------- */
const specId = sku => String(sku).toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
const specBySlug = id => S.specs.find(s => specId(s.sku) === id);
const brandsOf = list => { const m = new Map(); for (const s of list){ const b = s.brand || "Other"; m.set(b, (m.get(b)||0) + 1); } return [...m].sort((a,b) => b[1] - a[1]); };
const valEl = (v, cls) => h("span",{class:(cls||"") + (v.gap ? " gap" : ""), text:v.text});
const numOr = n => n == null ? null : SP.fmt(n);
async function copyPlain(txt, ok){
  try { await navigator.clipboard.writeText(txt); toast(ok); }
  catch { const ta = h("textarea",{style:"position:fixed;opacity:0"}); ta.value = txt; document.body.append(ta); ta.select(); try{document.execCommand("copy"); toast(ok);}catch{toast("Copy didn't work on this computer. Select the text instead.");} ta.remove(); }
}
function specTiles(s, compact){
  const d = s.data, x = SP.derived(d);
  const tile = (label, v, sub) => h("div",{class:"tile"}, h("span",{class:"tl",text:label}), v == null ? h("b",{class:"gap",text:"Not provided"}) : h("b",{text:v}), sub ? h("small",{text:sub}) : null);
  return h("div",{class:"tiles" + (compact ? " compact" : "")},
    tile("Units per outer", numOr(d.outerQty)),
    tile("Outers per pallet", numOr(x.outersPerPallet), d.outersPerLayer && d.layers ? d.outersPerLayer + " per layer × " + d.layers + " layers" : null),
    tile("Units per pallet", numOr(x.unitsPerPallet), x.unitsPerPalletCalculated ? "Calculated" : null));
}
function specLadder(s){
  const d = s.data;
  const step = t => h("span",{class:"step",text:t});
  const arrow = () => h("span",{class:"arr","aria-hidden":"true",text:"→"});
  const parts = [step("1 unit")];
  if (d.outerQty) parts.push(arrow(), step("Outer of " + SP.fmt(d.outerQty)));
  if (d.outersPerLayer) parts.push(arrow(), step(d.outersPerLayer + " outers per layer"));
  if (d.layers) parts.push(arrow(), step(d.layers + " layers per pallet"));
  return parts.length > 1 ? h("div",{class:"ladder","aria-label":"How units pack"}, parts) : null;
}
function specFacts(rows){
  return h("dl",{class:"facts spec-facts"}, rows.filter(Boolean).map(([k, v, note]) => h("div",null,h("dt",{text:k}),h("dd",null, valEl(v), note ? h("small",{text:note}) : null))));
}
function specWarnings(s, short){
  const w = s.data.warnings || [];
  if (!w.length) return null;
  return h("div",{class:"callout spec-warn"},
    h("b",{text: w.length === 1 ? "One figure needs checking" : w.length + " figures need checking"}),
    short ? h("span",{text:" before you quote packing figures. "}, h("a",{href:"#s-"+specId(s.sku),text:"See details"})) :
      h("ul",{class:"bul"}, w.map(t => h("li",{text:t}))),
    short ? null : h("p",{class:"help",text:"Check with production before quoting these. Fix them in the Product Information File, then update the portal from it."}));
}
function specLinkedProducts(s){ return S.products.filter(p => SP.forProduct(p, [s]).length); }

function viewSpecs(){
  if (S.specsMissing) return h("section",{class:"band"},W(h("div",{class:"stack",style:"max-width:760px"},
    h("div",null,h("div",{class:"eyebrow",text:"Packing and pallets"}),h("h1",{style:"margin-top:6px"},"Product specs")),
    h("div",{class:"empty",text:"Product specs aren't set up yet. Whoever looks after the portal needs to run portal-update.sql in Supabase once."}))));
  const all = S.specs;
  const fq = S.specQ.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const inBrand = s => S.specBrand === "all" || (s.brand || "Other") === S.specBrand;
  const inText = s => !fq.length || fq.every(t => SP.searchText(s).toLowerCase().includes(t));
  const flagged = all.filter(s => s.data.warnings?.length);
  const list = all.filter(s => inBrand(s) && inText(s) && (!S.specCheck || s.data.warnings?.length));
  const newest = all.reduce((m, s) => Math.max(m, s.updatedAt || 0), 0);
  const source = all.find(s => s.source)?.source;
  const filter = h("input",{type:"text",id:"specFilter",value:S.specQ,placeholder:"Filter by name, SKU or barcode","aria-label":"Filter product specs",autocomplete:"off"});
  let ft; filter.addEventListener("input", () => { clearTimeout(ft); ft = setTimeout(() => { S.specQ = filter.value; render(); }, 120); });
  const pill = (label, on, fn) => h("button",{type:"button","aria-pressed":String(on),text:label,onclick:fn});
  const groups = S.specBrand === "all" ? brandsOf(list).map(([b]) => b) : [S.specBrand];
  const num = (n, calc) => n == null ? h("td",{class:"num gap",text:"–",title:"Not provided"}) : h("td",{class:"num",text:SP.fmt(n), title: calc ? "Calculated" : null});
  const table = rows => h("div",{class:"tbl"},h("table",{class:"spec-table"},
    h("thead",null,h("tr",null,h("th",{text:"Product"}),h("th",{class:"num",text:"Per outer"}),h("th",{class:"num hide-sm",text:"Outers per pallet"}),h("th",{class:"num"},h("span",{class:"hide-sm",text:"Units "}),"per pallet"),h("th",{class:"hide-sm",text:"Unit barcode"}))),
    h("tbody",null, rows.map(s => { const d = s.data, x = SP.derived(d); return h("tr",null,
      h("td",null,h("a",{href:"#s-"+specId(s.sku)},h("span",{class:"nm"},hlSpec(d.name)), d.warnings?.length ? h("span",{class:"wdot",title:"Some figures need checking","aria-label":"Some figures need checking"}) : null), h("span",{class:"mono sku"},hlSpec(s.sku))),
      num(d.outerQty), (() => { const c = num(x.outersPerPallet); c.classList.add("hide-sm"); return c; })(), num(x.unitsPerPallet, x.unitsPerPalletCalculated),
      h("td",{class:"mono hide-sm"}, d.ean ? hlSpec(d.ean) : h("span",{class:"gap",text:"–"}))); }))));
  return h("section",{class:"band"},W(h("div",{class:"stack",style:"gap:26px"},
    h("div",{class:"band-head",style:"margin-bottom:0"},
      h("div",null,h("div",{class:"eyebrow",text:"Packing and pallets"}),h("h1",{style:"margin-top:6px"},"Product specs"),
        h("p",{class:"lede",style:"margin-top:10px",text:"Barcodes, box quantities and pallet figures for " + all.length + " products. Open a product for sizes, weights, commodity codes and country of origin."}),
        all.length ? h("p",{class:"help",style:"margin-top:8px",text:"From " + (source || "the Product Information File") + (newest ? " · updated " + fmtDate(newest) : "")}) : null),
      canEdit() ? h("a",{class:"btn ghost",href:"#import-specs",text:"Update from spreadsheet"}) : null),
    ...(!all.length ? [loadingOr("No product specs yet. An editor can add them with Update from spreadsheet.")] : [
      h("div",{class:"spec-bar"}, filter,
        h("div",{class:"pills"}, pill("All brands", S.specBrand === "all", () => { S.specBrand = "all"; render(); }),
          brandsOf(all).map(([b, n]) => pill(b + " (" + n + ")", S.specBrand === b, () => { S.specBrand = b; render(); })),
          flagged.length ? pill("Needs checking (" + flagged.length + ")", S.specCheck, () => { S.specCheck = !S.specCheck; render(); }) : null)),
      ...(list.length ? groups.map(b => { const rows = list.filter(s => (s.brand || "Other") === b); return rows.length ? h("section",{class:"group"}, S.specBrand === "all" ? h("h2",{style:"font-size:1.3rem;margin-bottom:4px",text:b + " (" + rows.length + ")"}) : null, table(rows)) : null; })
        : [h("div",{class:"empty",text:"No products match. Try part of the name, the SKU or the barcode."})])]))));
}
function hlSpec(text){
  const t = S.specQ.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!t.length) return hl(text);
  text = String(text ?? "");
  const re = new RegExp("(" + t.map(x => x.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")).join("|") + ")", "gi");
  const frag = document.createDocumentFragment();
  text.split(re).forEach((part,i) => frag.append(i % 2 ? h("mark",{text:part}) : document.createTextNode(part)));
  return frag;
}
function viewSpec(id){
  const s = specBySlug(id);
  if (!s) return W(h("div",{class:"band"},loadingOr("That product isn't in the specs.")));
  const d = s.data, x = SP.derived(d), sh = (f, u) => SP.show(d, f, u);
  const linked = specLinkedProducts(s);
  const variants = S.specs.filter(o => o !== s && o.data.ean && o.data.ean === d.ean);
  return W(
    h("div",{class:"crumbs"},h("a",{href:"#specs",text:"Product specs"})," / ",d.name),
    h("div",{class:"stack spec-page",style:"gap:26px;padding-bottom:56px;border-top:1px solid var(--line);padding-top:32px"},
      h("div",{class:"stack",style:"gap:14px"},
        h("div",{class:"eyebrow",text:[s.brand, s.family].filter(Boolean).join(" · ")}),
        h("h1",{text:d.name}),
        h("div",{class:"row",style:"gap:8px"}, h("span",{class:"chip ref",text:"SKU " + s.sku}), d.category ? h("span",{class:"chip",text:d.category}) : null),
        h("div",{class:"row",style:"gap:16px"},
          h("button",{class:"btn small",type:"button",text:"Copy packing details",onclick:() => copyPlain(SP.copyText(s), "Packing details copied")}),
          linked.map(p => h("a",{href:"#p-"+p.id,text:"See " + p.name + " instructions"})))),
      specWarnings(s),
      specTiles(s),
      specLadder(s),
      h("div",{class:"spec-cards"},
        h("section",{class:"card"},h("h3",null,"Unit"), specFacts([
          ["Barcode", sh("ean")], ["Size (L × W × H)", SP.dims(d,"each")], ["Gross weight", sh("eachGross","g")], ["Net weight", sh("eachNet","g")]])),
        h("section",{class:"card"},h("h3",null,"Outer"), specFacts([
          ["Barcode", sh("outerGtin")], ["Units per outer", sh("outerQty")], ["Size (L × W × H)", SP.dims(d,"outer")], ["Gross weight", sh("outerGross","g")]])),
        h("section",{class:"card"},h("h3",null,"Pallet"), specFacts([
          ["Footprint", d.palletL && d.palletW ? {text: SP.fmt(d.palletL) + " × " + SP.fmt(d.palletW) + " mm"} : {text:"Not provided", gap:true}],
          ["Outers per layer", sh("outersPerLayer")], ["Layers", sh("layers")],
          ["Units per layer", x.unitsPerLayer ? {text: SP.fmt(x.unitsPerLayer)} : {text:"Not provided", gap:true}],
          x.loadHeight ? ["Load height", {text: SP.fmt(x.loadHeight) + " mm"}, "Boxes only, calculated. Add the pallet base."] : null,
          x.loadWeightKg && !(d.warnings || []).some(t => /^Outer weight/.test(t)) ? ["Load weight", {text: SP.fmt(Math.round(x.loadWeightKg * 10) / 10) + " kg"}, "Boxes only, calculated. Add the pallet."] : null]))),
      h("details",{class:"faq spec-more",id:"spec-trade"},
        h("summary",null,h("span",{class:"q",text:"Trade and compliance"})),
        h("div",{class:"faq-body"}, specFacts([
          ["Minimum order", sh("moq")], ["Product type", sh("category")], ["Commodity code", sh("commodity")],
          ["Duty rate", d.duty != null ? {text: SP.fmt(d.duty) + "%"} : sh("duty")], ["Country of origin", sh("origin")],
          ["Shelf life", d.shelfLife ? {text: d.shelfLife + " months"} : sh("shelfLife")]]))),
      (() => { ensureAmazon(); const az = amzForSpec(s.sku); return az.length ? h("section",{class:"stack",style:"gap:10px"},
        h("h2",{style:"font-size:1.35rem",text:"Amazon listings (" + az.length + ")"}),
        h("div",{class:"faqs"}, az.map(g => h("a",{class:"res spec-res",href:"#a-"+g.key},
          h("span",{class:"sku-badge mono",text:g.main.asin || g.main.code}),
          h("div",null,h("h3",{style:"margin:0 0 4px",text:g.main.data.product || g.main.name}),h("div",{class:"row",style:"gap:6px"}, liveChip(g.main.data), AZ.isYes(g.main.data.bundle) ? h("span",{class:"chip",text:"Bundle"}) : null, h("span",{class:"snip",text: (n => n + " marketplace" + (n === 1 ? "" : "s"))(AZ.soldIn(g.main.data).length)}))))))) : null; })(),
      variants.length ? h("p",{class:"help"},"Same unit barcode as: ", variants.flatMap((v,i) => [i ? ", " : "", h("a",{href:"#s-"+specId(v.sku),text:v.sku})])) : null));
}
function productSpecBlock(p){
  if (!SP || !S.specs.length) return null;
  const list = SP.forProduct(p, S.specs);
  if (!list.length) return null;
  return h("section",{class:"sec",id:"pack"},
    h("h2",null,"Packing and pallet"),
    h("p",{class:"help",text:"From the Product Information File. Open the full spec for barcodes, sizes, weights and trade details."}),
    list.map(s => h("div",{class:"stack",style:"gap:10px"},
      list.length > 1 ? h("div",{class:"eyebrow",text:s.data.name + " · " + s.sku}) : null,
      specTiles(s, true),
      specWarnings(s, true),
      h("div",null,h("a",{href:"#s-"+specId(s.sku),text:"Full spec for " + s.sku + " →"})))));
}

/* spreadsheet import (editors) */
let xlsxLib = null;
function loadXlsx(){
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (xlsxLib) return xlsxLib;
  xlsxLib = new Promise((res, rej) => {
    const sc = h("script",{src:"https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"});
    sc.onload = () => window.XLSX ? res(window.XLSX) : rej(new Error("The spreadsheet reader didn't load."));
    sc.onerror = () => { xlsxLib = null; rej(new Error("Couldn't load the spreadsheet reader. Check this computer can reach cdn.jsdelivr.net.")); };
    document.head.append(sc);
  });
  return xlsxLib;
}
async function readSpecFile(file){
  const X = await loadXlsx();
  const wb = X.read(await file.arrayBuffer(), { type:"array" });
  let lastErr = null;
  for (const name of wb.SheetNames){
    const rows = X.utils.sheet_to_json(wb.Sheets[name], { header:1, raw:true, defval:"", blankrows:false });
    try { return { ...SP.parseSheet(rows), sheet:name }; } catch(e){ lastErr = e; }
  }
  throw lastErr || new Error("That file has no sheets.");
}
const specKey = s => { const { warnings, ...d } = s.data; return JSON.stringify([s.brand, s.family, s.name, d]); };
function viewSpecImport(){
  if (!canEdit()) return W(h("div",{class:"band"},h("div",{class:"empty",text:"Only editors can update product specs."})));
  const st = S.specImport;
  const msg = h("span",{class:"form-msg",text: st?.error || ""});
  const input = h("input",{type:"file",id:"specFile",accept:".xlsx,.xlsm,.xls,.csv"});
  input.addEventListener("change", async () => {
    const file = input.files?.[0]; if (!file) return;
    S.specImport = { busy:true, file:file.name }; render();
    try {
      const r = await readSpecFile(file);
      const old = new Map(S.specs.map(s => [s.sku, s]));
      const added = r.specs.filter(s => !old.has(s.sku)).map(s => s.sku);
      const changed = r.specs.filter(s => old.has(s.sku) && specKey(old.get(s.sku)) !== specKey(s)).map(s => s.sku);
      const removed = S.specs.filter(s => !r.specs.some(n => n.sku === s.sku)).map(s => s.sku);
      S.specImport = { file:file.name, ...r, added, changed, removed };
    } catch(e){ S.specImport = { error: e.message }; }
    render();
  });
  const list = (label, skus) => skus.length ? h("div",null,h("b",{text:label + " (" + skus.length + ")"}),h("p",{class:"help mono",text:skus.slice(0,40).join(", ") + (skus.length > 40 ? " and " + (skus.length - 40) + " more" : "")})) : null;
  const save = h("button",{class:"btn",type:"button",text:"Save to portal",onclick: async () => {
    save.disabled = true; msg.textContent = "";
    try { await api("specs_import",{ specs: st.specs, removed: st.removed, source: st.file }); S.specImport = null; toast("Product specs updated"); await load(); location.hash = "specs"; }
    catch(e){ msg.textContent = e.message; save.disabled = false; }
  }});
  return h("section",{class:"band"},W(h("div",{class:"editor"},
    h("div",{class:"crumbs",style:"padding:0"},h("a",{href:"#specs",text:"Product specs"})," / Update from spreadsheet"),
    h("div",null,h("div",{class:"eyebrow",text:"Editors"}),h("h1",{style:"margin-top:6px",text:"Update product specs"}),
      h("p",{class:"lede",style:"margin-top:10px",text:"Choose the latest Product Information File. The portal reads the sheet with SKU and Product Name columns, shows what will change, and only saves when you confirm."})),
    h("div",{class:"card"},
      h("label",null,"Spreadsheet (.xlsx)", input),
      h("p",{class:"help",text:"Columns are matched by their header names, so they can be in any order. TBC, #N/A and blank cells show as gaps. Products missing from the file are removed from the portal."}),
      st?.busy ? h("div",{class:"status",text:"Reading " + st.file + "…"}) : null,
      st?.error ? msg : null),
    st?.specs ? h("div",{class:"card"},
      h("h3",{text:"Ready to save: " + st.specs.length + " products from " + st.file}),
      h("p",{class:"help",text:"Sheet “" + st.sheet + "”, header on row " + st.headerRow + (st.skipped ? ". Skipped " + st.skipped + " rows with no SKU or a repeated SKU." : ".")}),
      !st.added.length && !st.changed.length && !st.removed.length ? h("div",{class:"status",text:"Nothing has changed since the last update."}) : null,
      list("New", st.added), list("Changed", st.changed), list("Will be removed", st.removed),
      (() => { const n = st.specs.filter(s => s.data.warnings.length).length; return n ? h("div",{class:"callout",text: n + " products have figures that don't add up. They'll be flagged in the portal so staff check before quoting them."}) : null; })(),
      h("div",{class:"row"}, save, h("button",{class:"btn ghost",type:"button",text:"Cancel",onclick:() => { S.specImport = null; render(); }}), msg)) : null)));
}

/* ---------- Amazon listings ---------- */
const AZ = window.TBDAmazon;
const AMZ_TEXT = ["title","desc","bullet1","bullet2","bullet3","bullet4","bullet5"];
const amzKey = l => specId(l.id.split("#")[0]);
let amzLoading = null;
function ensureAmazon(){
  if (!AZ || S.amzLoaded || S.amzMissing || S.amzError || amzLoading) return amzLoading;
  amzLoading = (async () => {
    try {
      const all = [];
      for (let from = 0; ; from += 1000){
        const r = await sb.from("amazon").select("id,asin,code,name,brand,sort,data,source,updated_at").order("sort").range(from, from + 999);
        if (r.error){ if (/relation|does not exist|schema cache|not find/i.test(r.error.message || "")){ S.amzMissing = true; break; } throw new Error(friendly(r.error)); }
        all.push(...r.data); if (r.data.length < 1000) break;
      }
      S.amazon = AZ.checkAll(all.map(x => ({ id:x.id, asin:x.asin || "", code:x.code || "", name:x.name || x.asin, brand:x.brand || "", sort:x.sort, data:x.data || {}, source:x.source, updatedAt: Date.parse(x.updated_at) })));
      S.amzLoaded = true;
    } catch(e){ S.amzError = e.message; }
    finally { amzLoading = null; render(); }
  })();
  return amzLoading;
}
function amzGroups(){
  if (S.amzGroupsFor === S.amazon) return S.amzGroupsCache;
  const m = new Map();
  for (const l of S.amazon){ const k = amzKey(l); if (!m.has(k)) m.set(k, []); m.get(k).push(l); }
  const groups = [...m].map(([key, rows]) => { const main = rows.find(r => AZ.isYes(r.data.mainSku)) || rows[0]; return { key, rows, main }; });
  S.amzGroupsFor = S.amazon; S.amzGroupsCache = groups;
  return groups;
}
const amzForSpec = sku => S.amazon.length ? amzGroups().filter(g => g.rows.some(r => r.code.toUpperCase() === sku.toUpperCase())) : [];
function liveChip(d){
  if (AZ.isYes(d.discontinued)) return h("span",{class:"chip st-off",text:"Discontinued"});
  return AZ.isYes(d.live) ? h("span",{class:"chip st-live",text:"Live"}) : h("span",{class:"chip st-off",text:"Not live"});
}
function marketText(v){ const s = AZ.marketState(v); return s === "sku" ? v : AZ.MARKET_TEXT[s] || v.charAt(0) + v.slice(1).toLowerCase(); }
function loadingAmazon(){
  if (S.amzError) return h("div",{class:"empty",text:S.amzError});
  return h("div",{class:"empty",text:"Loading Amazon listings…"});
}
function amzHeader(){
  return h("div",null,h("div",{class:"eyebrow",text:"Amazon"}),h("h1",{style:"margin-top:6px"},"Amazon listings"));
}
function viewAmazon(){
  ensureAmazon();
  if (S.amzMissing) return h("section",{class:"band"},W(h("div",{class:"stack",style:"max-width:760px"}, amzHeader(),
    h("div",{class:"empty",text:"The Amazon section isn't set up yet. Whoever looks after the portal needs to run portal-update.sql in Supabase once."}))));
  if (!S.amzLoaded) return h("section",{class:"band"},W(h("div",{class:"stack"}, amzHeader(), loadingAmazon())));
  const groups = amzGroups();
  const fq = S.amzQ.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const text = g => g.textCache || (g.textCache = g.rows.map(AZ.searchText).join(" ").toLowerCase());
  const live = g => AZ.isYes(g.main.data.live) && !AZ.isYes(g.main.data.discontinued);
  const expiring = g => g.rows.some(r => r.data.warnings?.some(t => /^Stock expire/.test(t)));
  const brands = [...new Set(groups.map(g => g.main.brand || "Other"))].sort();
  const counts = { live: groups.filter(live).length, off: groups.filter(g => !live(g)).length, exp: groups.filter(expiring).length };
  const list = groups.filter(g => (S.amzStatus === "all" || (S.amzStatus === "live" ? live(g) : S.amzStatus === "off" ? !live(g) : expiring(g)))
    && (S.amzBrand === "all" || (g.main.brand || "Other") === S.amzBrand) && (!fq.length || fq.every(t => text(g).includes(t))));
  const newest = S.amazon.reduce((m, s) => Math.max(m, s.updatedAt || 0), 0);
  const source = S.amazon.find(s => s.source)?.source;
  const filter = h("input",{type:"text",id:"amzFilter",value:S.amzQ,placeholder:"ASIN, seller SKU, product code or barcode","aria-label":"Filter Amazon listings",autocomplete:"off"});
  let ft; filter.addEventListener("input", () => { clearTimeout(ft); ft = setTimeout(() => { S.amzQ = filter.value; S.amzShowAll = false; render(); }, 150); });
  const brandSel = h("select",{id:"amzBrand","aria-label":"Brand"}, h("option",{value:"all",text:"All brands"}), brands.map(b => h("option",{value:b,text:b})));
  brandSel.value = S.amzBrand; brandSel.addEventListener("change", () => { S.amzBrand = brandSel.value; render(); });
  const pill = (v, label) => h("button",{type:"button","aria-pressed":String(S.amzStatus === v),text:label,onclick:() => { S.amzStatus = v; S.amzShowAll = false; render(); }});
  const shown = S.amzShowAll ? list : list.slice(0, 150);
  const markets = d => { const s = AZ.soldIn(d); return s.length ? s.slice(0, 4).map(m => m[0].toUpperCase()).join(", ") + (s.length > 4 ? " +" + (s.length - 4) : "") : "–"; };
  return h("section",{class:"band"},W(h("div",{class:"stack",style:"gap:26px"},
    h("div",{class:"band-head",style:"margin-bottom:0"},
      h("div",null,h("div",{class:"eyebrow",text:"Amazon"}),h("h1",{style:"margin-top:6px"},"Amazon listings"),
        h("p",{class:"lede",style:"margin-top:10px",text:groups.length + " products and " + S.amazon.length + " seller SKUs across " + AZ.MARKETS.filter(m => m[0] !== "mfn").length + " marketplaces. Search by ASIN, seller SKU, product code or barcode."}),
        S.amazon.length ? h("p",{class:"help",style:"margin-top:8px",text:"From " + (source || "the Amazon SKU Masterlist") + (newest ? " · updated " + fmtDate(newest) : "")}) : null),
      canEdit() ? h("a",{class:"btn ghost",href:"#import-amazon",text:"Update from spreadsheet"}) : null),
    ...(!S.amazon.length ? [h("div",{class:"empty",text:"No Amazon listings yet. An editor can add them with Update from spreadsheet."})] : [
      h("div",{class:"spec-bar"},
        h("div",{class:"row",style:"gap:12px;align-items:stretch"}, filter, brandSel),
        h("div",{class:"pills"}, pill("live","Live (" + counts.live + ")"), pill("off","Not live (" + counts.off + ")"), pill("all","All (" + groups.length + ")"),
          counts.exp ? pill("exp","Expired or expiring (" + counts.exp + ")") : null)),
      list.length ? h("div",{class:"tbl"},h("table",{class:"spec-table amz-table"},
        h("thead",null,h("tr",null,h("th",{text:"Product"}),h("th",{class:"hide-sm",text:"Product code"}),h("th",{text:"Status"}),h("th",{class:"hide-sm",text:"Sold in"}),h("th",{class:"hide-sm",text:"Expiry"}))),
        h("tbody",null, shown.map(g => { const d = g.main.data; return h("tr",null,
          h("td",null,h("a",{href:"#a-"+g.key},h("span",{class:"nm"},hlAmz(d.product || g.main.name)), g.rows.some(r => r.data.warnings?.length) ? h("span",{class:"wdot",title:"Something needs checking","aria-label":"Something needs checking"}) : null),
            h("span",{class:"mono sku"},hlAmz(g.main.asin || "No ASIN"), g.rows.length > 1 ? " · " + g.rows.length + " seller SKUs" : "")),
          h("td",{class:"mono hide-sm"}, g.main.code ? hlAmz(g.main.code) : h("span",{class:"gap",text:"–"})),
          h("td",null, h("div",{class:"row",style:"gap:6px"}, liveChip(d), AZ.isYes(d.bundle) ? h("span",{class:"chip",text:"Bundle"}) : null)),
          h("td",{class:"hide-sm"}, markets(d)),
          h("td",{class:"hide-sm" + (d.expiryDate ? "" : " gap"), text: d.expiryDate ? AZ.fmtDate(d.expiryDate) : "–"})); }))))
        : h("div",{class:"empty",text:"No listings match. Try the ASIN, part of the product name or a seller SKU."}),
      list.length > shown.length ? h("div",null,h("button",{class:"btn ghost small",type:"button",text:"Show all " + list.length,onclick:() => { S.amzShowAll = true; render(); }})) : null]))));
}
function hlAmz(text){
  const t = S.amzQ.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!t.length) return hl(text);
  text = String(text ?? "");
  const re = new RegExp("(" + t.map(x => x.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")).join("|") + ")", "gi");
  const frag = document.createDocumentFragment();
  text.split(re).forEach((part,i) => frag.append(i % 2 ? h("mark",{text:part}) : document.createTextNode(part)));
  return frag;
}
async function loadListingText(id){
  if (S.amzText[id] !== undefined) return;
  S.amzText[id] = null;
  const r = await sb.from("amazon").select("listing").eq("id", id);
  S.amzText[id] = r.error ? { error: friendly(r.error) } : (r.data?.[0]?.listing || {});
  render();
}
function viewAmazonListing(key){
  ensureAmazon();
  if (!S.amzLoaded) return W(h("div",{class:"band"}, S.amzMissing ? h("div",{class:"empty",text:"The Amazon section isn't set up yet."}) : loadingAmazon()));
  const g = amzGroups().find(x => x.key === key);
  if (!g) return W(h("div",{class:"band"},h("div",{class:"empty"},"That listing isn't in the portal. ",h("a",{href:"#amazon",text:"See all Amazon listings"}))));
  const idx = Math.min(S.amzRow[key] || g.rows.indexOf(g.main), g.rows.length - 1);
  const l = g.rows[idx], d = l.data;
  const spec = l.code ? S.specs.find(s => s.sku.toUpperCase() === l.code.toUpperCase()) : null;
  const sold = AZ.soldIn(d);
  const tile = (label, v, sub) => h("div",{class:"tile"}, h("span",{class:"tl",text:label}), v == null ? h("b",{class:"gap",text:"Not provided"}) : h("b",{text:v}), sub ? h("small",{text:sub}) : null);
  const facts = rows => specFacts(rows);
  const basics = ["barcode","expiryDate","route","currentRoute","regClass","transparency","primarySku","expiry"].filter(k => d[k] != null).map(k => [AZ.F.find(f => f[0] === k)[2], AZ.show(d, k)]);
  const txt = S.amzText[l.id];
  const textBody = () => {
    if (txt === undefined || txt === null) return h("p",{class:"help",text:"Loading listing text…"});
    if (txt.error) return h("p",{class:"form-msg",text:txt.error});
    const rows = AMZ_TEXT.filter(k => txt[k]);
    return rows.length ? h("div",{class:"stack",style:"gap:12px"},
      txt.title ? h("p",{style:"font-weight:500"},hl(txt.title)) : null,
      [1,2,3,4,5].some(n => txt["bullet"+n]) ? h("ul",{class:"bul"}, [1,2,3,4,5].map(n => txt["bullet"+n] ? h("li",null,hl(txt["bullet"+n])) : null)) : null,
      txt.desc ? h("p",{class:"amz-desc"},hl(String(txt.desc).replace(/<br\s*\/?>/gi,"\n").replace(/<\/p>\s*/gi,"\n\n").replace(/<[^>]+>/g,"").replace(/&amp;/g,"&").replace(/\n{3,}/g,"\n\n").trim())) : null) : h("p",{class:"help",text:"No listing text in the masterlist for this SKU."});
  };
  const fold = (group, label) => {
    const rows = AZ.F.filter(f => f[3] === group && !AMZ_TEXT.includes(f[0]) && d[f[0]] != null).map(f => [f[2], AZ.show(d, f[0])]);
    if (group === "listing"){
      const det = h("details",{class:"faq spec-more",id:"amz-listing"},
        h("summary",null,h("span",{class:"q",text:label})),
        h("div",{class:"faq-body"}, rows.length ? facts(rows) : null, textBody()));
      det.addEventListener("toggle", () => { if (det.open) loadListingText(l.id); });
      if (txt !== undefined) det.open = true;
      return det;
    }
    if (!rows.length) return null;
    return h("details",{class:"faq spec-more",id:"amz-"+group}, h("summary",null,h("span",{class:"q",text:label})), h("div",{class:"faq-body"}, facts(rows)));
  };
  return W(
    h("div",{class:"crumbs"},h("a",{href:"#amazon",text:"Amazon"})," / ",d.product || l.name),
    h("div",{class:"stack spec-page",style:"gap:26px;padding-bottom:56px;border-top:1px solid var(--line);padding-top:32px"},
      h("div",{class:"stack",style:"gap:14px"},
        h("div",{class:"eyebrow",text:[l.brand, l.code].filter(Boolean).join(" · ")}),
        h("h1",{text:d.product || l.name}),
        h("div",{class:"row",style:"gap:8px"}, l.asin ? h("span",{class:"chip ref",text:"ASIN " + l.asin}) : null, liveChip(d), AZ.isYes(d.bundle) ? h("span",{class:"chip",text:"Bundle"}) : null, AZ.isYes(d.variation) ? h("span",{class:"chip",text:"Variation"}) : null),
        h("div",{class:"row",style:"gap:16px"},
          h("button",{class:"btn small",type:"button",text:"Copy listing details",onclick:() => copyPlain(AZ.copyText(l), "Listing details copied")}),
          spec ? h("a",{href:"#s-"+specId(spec.sku),text:"See product spec for " + spec.sku}) : null,
          l.asin && /^[A-Z0-9]{10}$/.test(l.asin) ? h("a",{href:"https://www.amazon.co.uk/dp/" + l.asin,target:"_blank",rel:"noopener",text:"Open on Amazon UK ↗"}) : null)),
      g.rows.length > 1 ? h("div",{class:"stack",style:"gap:8px"},
        h("div",{class:"eyebrow",text:g.rows.length + " seller SKUs for this ASIN"}),
        h("div",{class:"pills"}, g.rows.map((r, i) => h("button",{type:"button","aria-pressed":String(i === idx),onclick:() => { S.amzRow[key] = i; render(); }},
          r.data.uk && AZ.marketState(r.data.uk) === "sku" ? r.data.uk : r.data.mfn && AZ.marketState(r.data.mfn) === "sku" ? r.data.mfn : "Row " + (i + 1),
          AZ.isYes(r.data.mainSku) ? " (main)" : "")))) : null,
      (d.warnings || []).length ? h("div",{class:"callout spec-warn"}, h("b",{text: d.warnings.length === 1 ? "One thing to check" : d.warnings.length + " things to check"}), h("ul",{class:"bul"}, d.warnings.map(t => h("li",{text:t})))) : null,
      h("div",{class:"tiles"},
        tile("Sold in", sold.length ? sold.length + " marketplace" + (sold.length === 1 ? "" : "s") : null),
        tile("Units per box", d.boxQty != null ? SP.fmt(d.boxQty) : null, "FBA"),
        tile("UK RRP", d.rrp != null ? AZ.show(d,"rrp").text : null)),
      h("section",{class:"stack",style:"gap:12px"},
        h("h2",{style:"font-size:1.35rem",text:"Marketplaces and seller SKUs"}),
        h("div",{class:"markets"}, AZ.MARKETS.map(([k,, label]) => { const v = d[k], st = AZ.marketState(v);
          return h("div",{class:"mk mk-" + st}, h("span",{class:"tl",text:label}), h("b",{class: st === "sku" ? "mono" : null, text: v ? marketText(v) : "Not listed"})); }),
          d.inFnsku ? h("div",{class:"mk mk-sku"}, h("span",{class:"tl",text:"India FNSKU"}), h("b",{class:"mono",text:d.inFnsku})) : null)),
      basics.length ? h("section",{class:"card"},h("h3",null,"Listing basics"), facts(basics)) : null,
      AZ.GROUPS.map(([gk, label]) => fold(gk, label))));
}
function amazonSearchHits(){
  if (!AZ || !S.amzLoaded) return [];
  return amzGroups().filter(g => g.rows.some(r => matches(AZ.searchText(r))));
}

/* spreadsheet import (editors) */
function viewAmazonImport(){
  if (!canEdit()) return W(h("div",{class:"band"},h("div",{class:"empty",text:"Only editors can update Amazon listings."})));
  ensureAmazon();
  const st = S.amzImport;
  const msg = h("span",{class:"form-msg",text: st?.error || ""});
  const input = h("input",{type:"file",id:"amzFile",accept:".xlsx,.xlsm,.xls,.csv"});
  input.addEventListener("change", async () => {
    const file = input.files?.[0]; if (!file) return;
    S.amzImport = { busy:true, file:file.name }; render();
    try {
      const X = await loadXlsx();
      const wb = X.read(await file.arrayBuffer(), { type:"array" });
      let r = null, lastErr = null, sheet = null;
      for (const name of wb.SheetNames){
        const rows = X.utils.sheet_to_json(wb.Sheets[name], { header:1, raw:true, defval:"", blankrows:false });
        try { r = AZ.parseSheet(rows); sheet = name; break; } catch(e){ lastErr = e; }
      }
      if (!r) throw lastErr || new Error("That file has no sheets.");
      const old = new Set(S.amazon.map(l => l.id)), now = new Set(r.listings.map(l => l.id));
      S.amzImport = { file:file.name, sheet, ...r, added: r.listings.filter(l => !old.has(l.id)).length, removed: S.amazon.filter(l => !now.has(l.id)).map(l => l.id) };
    } catch(e){ S.amzImport = { error: e.message }; }
    render();
  });
  const save = h("button",{class:"btn",type:"button",text:"Save to portal",onclick: async () => {
    save.disabled = true; msg.textContent = "Saving…";
    try { await api("amazon_import",{ listings: st.listings, removed: st.removed, source: st.file }); S.amzImport = null; S.amzLoaded = false; S.amzText = {}; toast("Amazon listings updated"); location.hash = "amazon"; ensureAmazon(); }
    catch(e){ msg.textContent = e.message; save.disabled = false; }
  }});
  return h("section",{class:"band"},W(h("div",{class:"editor"},
    h("div",{class:"crumbs",style:"padding:0"},h("a",{href:"#amazon",text:"Amazon"})," / Update from spreadsheet"),
    h("div",null,h("div",{class:"eyebrow",text:"Editors"}),h("h1",{style:"margin-top:6px",text:"Update Amazon listings"}),
      h("p",{class:"lede",style:"margin-top:10px",text:"Choose the latest Amazon SKU Masterlist. The portal finds the sheet with ASIN, Product Code and FBA MSKU columns, shows what will change, and only saves when you confirm."})),
    h("div",{class:"card"},
      h("label",null,"Spreadsheet (.xlsx)", input),
      h("p",{class:"help",text:"Columns are matched by their header names. Keyword and browse-node columns aren't brought in. Listings missing from the file are removed from the portal."}),
      st?.busy ? h("div",{class:"status",text:"Reading " + st.file + "…"}) : null,
      st?.error ? msg : null),
    st?.listings ? h("div",{class:"card"},
      h("h3",{text:"Ready to save: " + st.listings.length + " seller SKUs from " + st.file}),
      h("p",{class:"help",text:"Sheet “" + st.sheet + "”, header on row " + st.headerRow + ". " + new Set(st.listings.map(l => l.asin || l.id)).size + " products (ASINs)." + (st.skipped ? " Skipped " + st.skipped + " empty rows." : "")}),
      S.amazon.length ? h("p",null, st.added + " new, " + st.removed.length + " will be removed, the rest updated.") : null,
      (() => { const n = st.listings.filter(l => l.data.warnings.length).length; return n ? h("div",{class:"callout",text: n + " listings have expired or soon-to-expire stock or a barcode to check. They'll be flagged in the portal."}) : null; })(),
      h("div",{class:"row"}, save, h("button",{class:"btn ghost",type:"button",text:"Cancel",onclick:() => { S.amzImport = null; render(); }}), msg)) : null)));
}

/* ---------- handbook (all staff) ---------- */
const ST = window.TBDStarter;
const STARTER_PAGES = [["handbook","Summary"],["about","About us"],["finder","Product finder"],["glossary","Glossary"],["say","What we can say"],["howto","How-to guides"],["contacts","Who to ask"]];
const isStarter = r => STARTER_PAGES.some(([k]) => k === r);
const draftChip = () => h("span",{class:"chip draft",text:"Draft · to confirm"});
function starterShell(key, eyebrow, title, lede, ...body){
  return h("section",{class:"band"},W(h("div",{class:"stack",style:"gap:26px"},
    h("nav",{class:"tabs","aria-label":"Handbook"}, STARTER_PAGES.map(([k, label]) => h("a",{href:"#"+k,class: k === key ? "on" : null,text:label}))),
    h("div",null,h("div",{class:"eyebrow",text:eyebrow}),h("h1",{style:"margin-top:6px",text:title}), lede ? h("p",{class:"lede",style:"margin-top:10px",text:lede}) : null),
    ...body)));
}
function viewHandbook(){
  const key = "tbd-week";
  let done = {}; try { done = JSON.parse(store.get(key) || "{}") || {}; } catch {}
  const n = ST.firstWeek.filter((_, i) => done[i]).length;
  const tick = h("ol",{class:"checklist"}, ST.firstWeek.map((t, i) => {
    const cb = h("input",{type:"checkbox",id:"wk"+i,checked: done[i] || null});
    cb.addEventListener("change", () => { done[i] = cb.checked; store.set(key, JSON.stringify(done)); render(); });
    return h("li",{class: done[i] ? "done" : null}, h("label",{class:"inline",for:"wk"+i}, cb, h("span",{text:t})));
  }));
  const card = (k, title, text, extra) => h("a",{class:"card hb-card",href:"#"+k}, h("h3",{text:title}), h("p",{text:text}), extra || null, h("span",{class:"more",text:"Open " + title}));
  return starterShell("handbook","Handbook","How we work","What we sell, how to talk to customers about it, and who to ask. For everyone in the team.",
    h("div",{class:"hb-grid"},
      card("about","About us", ST.brands.length + " brands and the ways we sell them: direct, wholesale and Amazon.", h("p",{class:"help",text:ST.brands.map(b => b.name).join(" · ")})),
      card("finder","Product finder","Which products are designed for which eye condition, backed by their leaflets.", h("p",{class:"help",text:ST.conditions.map(c => c.name).join(" · ")})),
      card("glossary","Glossary", ST.glossary.length + " terms in plain English, from MGD to FNSKU."),
      card("say","What we can say","The medical advice limits for our products, and when to send a customer for urgent help.", h("p",{class:"help",text:"Never diagnose. Escalate sudden vision loss, severe pain or eye injuries."})),
      card("howto","How-to guides", ST.howtos.length + " step-by-step guides for everyday jobs, from late orders to reporting an incident."),
      card("contacts","Who to ask","Who looks after discount codes, replacements, trade, Amazon and more.")),
    h("details",{class:"faq spec-more",id:"hb-week"},
      h("summary",null,h("span",{class:"q"},"New to the team? Your first-week checklist ",h("span",{class:"help",text:"(" + n + " of " + ST.firstWeek.length + " done, saved on this computer)"}))),
      h("div",{class:"faq-body"}, tick)));
}
function viewAbout(){
  const count = b => b.specs ? S.specs.filter(s => s.brand === b.specs).length : 0;
  return starterShell("about","Handbook","About us","The Body Doctor's brands and how we sell them.",
    h("section",{class:"stack",style:"gap:12px"},
      h("h2",{style:"font-size:1.35rem",text:"Our brands"}),
      h("div",{class:"brand-grid"}, ST.brands.map(b => h("div",{class:"card"},
        h("h3",{text:b.name}), h("p",{text:b.what}), h("p",{class:"help",text:"For example: " + b.examples}),
        count(b) ? h("a",{href:"#specs",onclick:e => { e.preventDefault(); S.specBrand = b.specs; S.specQ = ""; location.hash = "specs"; },text:count(b) + " products in Product specs →"}) : null)))),
    h("section",{class:"stack",style:"gap:12px"},
      h("h2",{style:"font-size:1.35rem",text:"How we sell"}),
      h("div",{class:"brand-grid three"}, ST.channels.map(c => h("div",{class:"card"}, h("div",{class:"row",style:"justify-content:space-between"},h("h3",{text:c.name}), c.check ? draftChip() : null), h("p",{text:c.what}))))));
}
function specLink(sku){
  const s = S.specs.find(x => x.sku.toUpperCase() === sku.toUpperCase());
  return s ? h("a",{class:"range-item",href:"#s-"+specId(s.sku)}, h("span",{class:"mono",text:s.sku}), h("span",{text:s.data.name})) : null;
}
function viewFinder(){
  const sel = S.finder || ST.conditions[0].id;
  const c = ST.conditions.find(x => x.id === sel) || ST.conditions[0];
  return starterShell("finder","Handbook","Product finder","Pick what the customer describes to see which products are designed for it. Lead products are backed by their instruction leaflets.",
    h("div",{class:"pills"}, ST.conditions.map(x => h("button",{type:"button","aria-pressed":String(x.id === c.id),text:x.name,onclick:() => { S.finder = x.id; render(); }}))),
    h("section",{class:"finder"},
      h("div",{class:"stack",style:"gap:6px"},h("h2",{text:c.name}),h("p",{class:"lede",text:c.plain})),
      c.lead.length ? h("div",{class:"lead-grid"}, c.lead.map(([pid, why]) => { const p = prodById(pid); return p ? h("a",{class:"lead-card",href:"#p-"+pid},
        photo(p.photo, p.name) || h("div",{class:"photo"}), h("div",{class:"stack",style:"gap:6px"},h("b",{text:p.name}),h("span",{text:why}),h("span",{class:"more",text:"View instructions"}))) : null; })) : null,
      c.note ? h("div",{class:"callout",text:c.note}) : null,
      c.range.length ? h("div",{class:"stack",style:"gap:10px"},
        h("div",{class:"row",style:"gap:10px"},h("h3",{text:"Also in the range"}),h("span",{class:"help",text:"Matched by product name. Check the leaflet before recommending."})),
        h("div",{class:"range-list"}, c.range.map(specLink))) : null),
    h("div",{class:"status"},"Symptoms severe, sudden or getting worse? Don't recommend a product. ",h("a",{href:"#say",text:"See when to escalate"}),"."));
}
function viewGlossary(){
  const q = (S.glossQ || "").trim().toLowerCase();
  const input = h("input",{type:"search",id:"q-gloss",value:S.glossQ || "",placeholder:"Search the glossary, e.g. MGD or FNSKU","aria-label":"Search the glossary",autocomplete:"off"});
  let t; input.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => { S.glossQ = input.value; render(); }, 120); });
  const list = ST.glossary.filter(([g, term, def]) => !q || (term + " " + def).toLowerCase().includes(q));
  const groups = [...new Set(ST.glossary.map(x => x[0]))];
  const mark = txt => { if (!q) return txt; const i = txt.toLowerCase().indexOf(q); return i < 0 ? txt : [txt.slice(0,i), h("mark",{text:txt.slice(i, i + q.length)}), txt.slice(i + q.length)]; };
  return starterShell("glossary","Handbook","Glossary","The terms used across the business, in plain English.",
    h("div",{class:"search secsearch",role:"search"}, searchIcon(), input),
    list.length ? groups.map(g => { const rows = list.filter(x => x[0] === g); return rows.length ? h("section",{class:"group"},
      h("h2",{style:"font-size:1.3rem;margin-bottom:6px",text:g}),
      h("dl",{class:"gloss"}, rows.map(([, term, def]) => h("div",null,h("dt",null,mark(term)),h("dd",null,mark(def)))))) : null; })
      : h("div",{class:"empty",text:"Nothing matches. Ask your manager, and we'll add it."}));
}
function viewSay(){
  return starterShell("say","Handbook","What we can and can't say","Several of our products are medical devices. These rules keep customers safe and protect you and the business.",
    h("div",null,draftChip()),
    h("div",{class:"grid2"},
      h("section",{class:"card do"},h("h3",null,"We can"),h("ul",{class:"bul"}, ST.sayDo.map(x => h("li",{text:x})))),
      h("section",{class:"card dont"},h("h3",null,"We don't"),h("ul",{class:"bul"}, ST.sayDont.map(x => h("li",{text:x}))))),
    h("section",{class:"callout urgent"},
      h("h3",{text:"Tell the customer to get urgent help today if they mention:"}),
      h("ul",{class:"bul"}, ST.redFlags.map(x => h("li",{text:x}))),
      h("p",{text:"Advise an optometrist today, NHS 111, or A&E for injuries and sudden loss of vision. Don't suggest a product. Tell your manager afterwards."})),
    h("section",{class:"stack",style:"gap:10px"},
      h("h2",{style:"font-size:1.35rem",text:"If something went wrong with a product"}),
      h("ol",{class:"steps"}, ["Thank the customer and take it seriously. Don't argue about the cause.","Write down their name and contact details, the product, the batch or lot number, where they bought it, and what happened.","Ask them to keep the product and packaging.","Tell your manager the same day.","Serious incidents are reported to the manufacturer and to the MHRA. Your manager decides this with the content owner."].map(x => h("li",null,h("span",{text:x}))))));
}
function viewHowto(){
  return starterShell("howto","Handbook","How-to guides","Step-by-step guides for everyday jobs. These are outlines to fill in: each shows what we already know.",
    h("div",{class:"faqs"}, ST.howtos.map((g, i) => h("details",{class:"faq",id:"ht"+i},
      h("summary",null,h("span",{class:"q"}, g.title, " ", h("span",{class:"chip",text:g.topic}))),
      h("div",{class:"faq-body"},
        g.known.length ? h("ol",{class:"steps"}, g.known.map(x => h("li",null,h("span",{text:x})))) : h("p",{class:"help",text:"No steps written yet."}),
        h("div",{class:"row"}, draftChip(), h("span",{class:"help",text:"Steps to be written by the team lead for this area."})))))));
}
function viewContacts(){
  return starterShell("contacts","Handbook","Who to ask","Who looks after what. If you're not sure, ask your manager.",
    h("div",{class:"tbl"},h("table",{class:"spec-table contacts"},
      h("thead",null,h("tr",null,h("th",{text:"For"}),h("th",{text:"Who"}),h("th",{text:"How to reach them"}))),
      h("tbody",null, ST.contacts.map(c => h("tr",null, h("td",{text:c.topic}), h("td",null, c.who, c.check ? [" ", draftChip()] : null), h("td",{class: c.how ? null : "gap",text:c.how || "To confirm"})))))));
}

function viewFaqs(catSlug){
  const cats = categories();
  const cat = catSlug ? cats.find(c => c.slug === catSlug) : null;
  const notes = cat ? sortedNotes(S.notes.filter(n => n.topic === "c:"+cat.name)) : [];
  const addBtn = canWrite() ? h("button",{class:"btn",type:"button",text:"Add a FAQ",onclick:() => openFaqDialog(null, cat?.name)}) : null;
  const head = cat
    ? h("div",{class:"topic-head"}, photo(topicPhoto(cat.name)) || h("div",{class:"ttile",style:"padding:0;border:0"},h("div",{class:"noimg",style:"width:80px"},h("span"))),
        h("div",null,h("div",{class:"eyebrow",text:"FAQ topic"}),h("h1",{style:"margin-top:6px",text:cat.name}),h("p",{class:"lede",style:"margin-top:8px",text:cat.count+" approved answer"+(cat.count>1?"s":"")+". Open one to see the full answer and copy it."})),
        h("div",{class:"edit-bar"}, canEdit() ? h("button",{class:"btn ghost",type:"button",text:"Edit topic",onclick:() => openTopic(cat.name)}) : null, addBtn))
    : h("div",{class:"band-head",style:"margin-bottom:0"},h("div",null,h("div",{class:"eyebrow",text:"Customer queries"}),h("h1",{style:"margin-top:6px"},"Frequently asked questions"),
        h("p",{class:"lede",style:"margin-top:10px",text:S.faqs.length+" approved answers across "+cats.length+" topics. Open one to see the full answer and copy it into your reply."})), addBtn);
  if (catSlug && !cat && S.loaded) return h("section",{class:"band"},W(h("div",{class:"empty"},"That topic has no FAQs. ",h("a",{href:"#faqs",text:"See all FAQs"}))));
  const q = S.q.trim(), searching = q && terms().length;
  const shown = f => !searching || matches(faqText(f));
  const groups = (cat ? [cat] : cats).map(g => ({ g, list: S.faqs.filter(f => f.category === g.name && shown(f)) })).filter(x => x.list.length);
  const total = groups.reduce((n, x) => n + x.list.length, 0);
  const elsewhere = searching && cat ? S.faqs.filter(f => f.category !== cat.name && shown(f)).length : 0;
  const pillHref = c => c ? "#t-"+c.slug : "#faqs";
  return h("section",{class:"band"},W(h("div",{class:"stack",style:"gap:28px"},
    head,
    secSearch("faqs", cat ? "Search " + cat.name + " FAQs" : "Search all FAQs, e.g. warranty or not arrived"),
    h("div",{class:"pills"}, h("a",{href:pillHref(null),class:cat ? null : "on",text:"All"}), cats.map(c => h("a",{href:pillHref(c),class:cat?.slug === c.slug ? "on" : null,text:c.name}))),
    searching ? h("p",{class:"help"}, total ? total + (total > 1 ? " FAQs match “" : " FAQ matches “") + q + "”" + (cat ? " in " + cat.name : "") + ". " : "",
      elsewhere ? h("a",{href:"#faqs",text: elsewhere + " more in other topics"}) : null) : null,
    !S.faqs.length ? loadingOr("No FAQs yet.")
    : total ? groups.map(({g, list}) => h("section",{class:"group",id:"g-"+g.slug}, cat ? null : h("h2",{style:"font-size:1.4rem;margin-bottom:6px"},g.name),
        h("div",{class:"faqs"}, list.map(f => faqEl(f, searching && total <= 3)))))
    : h("div",{class:"empty"}, "No FAQs match “" + q + "”" + (cat ? " in " + cat.name : "") + ". ",
        elsewhere ? [h("a",{href:"#faqs",text:"See " + elsewhere + " in other topics"}), " · "] : null,
        switchSearch("products","Search the instructions instead"),
        canWrite() ? [" · ", h("button",{class:"link",type:"button",text:"Add this as a FAQ",onclick:() => openFaqDialog(null, cat?.name, q)})] : null))));
}
function viewNotes(){
  const topics = [...new Set(S.notes.map(n => n.topic || "general"))];
  const list = sortedNotes(S.noteFilter === "all" ? S.notes : S.notes.filter(n => (n.topic||"general") === S.noteFilter));
  return h("section",{class:"band"},W(h("div",{class:"stack",style:"gap:24px;max-width:860px"},
    h("div",null,h("div",{class:"eyebrow",text:"Notice board"}),h("h1",{style:"margin-top:6px"},"Staff notes"),
      h("p",{class:"lede",style:"margin-top:10px",text:"Tips, updates and reminders from the team. Important notes stay at the top. Notes attached to a product or topic also appear on that page."})),
    noteForm("general"),
    topics.length > 1 ? h("div",{class:"pills"}, [["all","All"],...topics.map(t => [t, topicLabel(t)])].map(([v,l]) =>
      h("button",{type:"button","aria-pressed":String(S.noteFilter===v),text:l,onclick:() => { S.noteFilter = v; render(); }}))) : null,
    list.length ? h("div",{class:"notes"},list.map(noteEl)) : h("div",{class:"empty",text: S.loaded ? "No notes yet. Use the form above to post the first one." : "Loading notes…"}))));
}
function viewSearch(){
  const prodHits = [];
  for (const p of S.products){
    if (matches([p.name,p.summary,p.ref,...(p.facts||[]).flat()].join(" "))) prodHits.push({p, title:"Overview", text:p.summary, jump:null});
    p.sections.forEach((s,i) => { const t = sectionText(s); if (matches(p.name+" "+t)) prodHits.push({p, title:s.title, text:t, jump:"s"+i}); });
  }
  const faqHits = S.faqs.filter(f => matches(faqText(f)));
  const noteHits = [];
  const specHits = SP ? S.specs.filter(s => matches(SP.searchText(s))) : [];
  ensureAmazon();
  const amzHits = amazonSearchHits();
  const total = prodHits.length + faqHits.length + noteHits.length + specHits.length + amzHits.length;
  return h("section",{class:"band"},W(h("div",{class:"stack",style:"gap:36px;max-width:960px"},
    h("div",null,h("div",{class:"eyebrow",text:"Search results"}),h("h1",{style:"margin-top:6px"},total ? total+" result"+(total>1?"s":"")+" for “"+S.q.trim()+"”" : "No results for “"+S.q.trim()+"”"),
      total ? null : h("p",{class:"lede",style:"margin-top:10px",text:"Try fewer or different words, such as microwave, warranty, crystals or contact lenses. If it's a new question, add it as a FAQ so the next person finds it."})),
    faqHits.length ? h("section",null,h("h2",{style:"margin-bottom:10px"},"FAQs ("+faqHits.length+")"),h("div",{class:"faqs"},faqHits.map(f => faqEl(f, faqHits.length <= 3)))) : null,
    prodHits.length ? h("section",null,h("h2",{style:"margin-bottom:6px"},"Instructions ("+prodHits.length+")"),
      prodHits.map(r => h("a",{class:"res",href:"#p-"+r.p.id,onclick: e => { e.preventDefault(); pendingJump = r.jump || null; resetSearch();
          const target = "p-" + r.p.id; if (S.route === target) render(); else location.hash = target; if (!pendingJump) window.scrollTo(0,0); }},
        photo(r.p.photo) || h("span"),
        h("div",null,h("div",{class:"eyebrow",text:r.p.name}),h("h3",{style:"margin:2px 0 4px"},hl(r.title)),h("div",{class:"snip"},hl(snippet(r.text))))))) : null,
    specHits.length ? h("section",null,h("h2",{style:"margin-bottom:6px"},"Product specs ("+specHits.length+")"),
      specHits.slice(0, 8).map(s => { const d = s.data, x = SP.derived(d);
        const bits = [d.outerQty ? SP.fmt(d.outerQty) + " per outer" : null, x.unitsPerPallet ? SP.fmt(x.unitsPerPallet) + " per pallet" : null, d.ean ? "Barcode " + d.ean : null].filter(Boolean).join(" · ");
        return h("a",{class:"res spec-res",href:"#s-"+specId(s.sku),onclick: e => { e.preventDefault(); resetSearch(); location.hash = "s-" + specId(s.sku); }},
          h("span",{class:"sku-badge mono",text:s.sku}),
          h("div",null,h("div",{class:"eyebrow",text:[s.brand, s.family].filter(Boolean).join(" · ")}),h("h3",{style:"margin:2px 0 4px"},hl(d.name)),h("div",{class:"snip"},hl(bits || "Open for packing details")))); }),
      specHits.length > 8 ? h("p",{style:"margin-top:12px"},h("a",{href:"#specs",onclick: e => { e.preventDefault(); S.specQ = S.q.trim(); S.specBrand = "all"; resetSearch(); location.hash = "specs"; if (S.route === "specs") render(); },text:"See all "+specHits.length+" in Product specs →"})) : null) : null,
    amzHits.length ? h("section",null,h("h2",{style:"margin-bottom:6px"},"Amazon listings ("+amzHits.length+")"),
      amzHits.slice(0, 8).map(g => { const d = g.main.data;
        const bits = [AZ.isYes(d.live) ? "Live" : "Not live", AZ.isYes(d.bundle) ? "Bundle" : null, g.main.code, AZ.soldIn(d).length ? "Sold in " + AZ.soldIn(d).length + " marketplace" + (AZ.soldIn(d).length === 1 ? "" : "s") : null].filter(Boolean).join(" · ");
        return h("a",{class:"res spec-res",href:"#a-"+g.key,onclick: e => { e.preventDefault(); resetSearch(); location.hash = "a-" + g.key; }},
          h("span",{class:"sku-badge mono",text:g.main.asin || g.main.code}),
          h("div",null,h("div",{class:"eyebrow",text:"Amazon" + (g.main.brand ? " · " + g.main.brand : "")}),h("h3",{style:"margin:2px 0 4px"},hl(d.product || g.main.name)),h("div",{class:"snip"},hl(bits)))); }),
      amzHits.length > 8 ? h("p",{style:"margin-top:12px"},h("a",{href:"#amazon",onclick: e => { e.preventDefault(); S.amzQ = S.q.trim(); S.amzStatus = "all"; S.amzBrand = "all"; resetSearch(); location.hash = "amazon"; if (S.route === "amazon") render(); },text:"See all "+amzHits.length+" in Amazon →"})) : null) : null,
    (!S.amzLoaded && !S.amzMissing && AZ) ? h("p",{class:"help",text:"Still loading Amazon listings…"}) : null,
    noteHits.length ? h("section",null,h("h2",{style:"margin-bottom:10px"},"Staff notes ("+noteHits.length+")"),h("div",{class:"notes"},sortedNotes(noteHits).map(noteEl))) : null,
    (!total && canWrite()) ? h("div",null,h("button",{class:"btn ghost",type:"button",text:"Add this as a FAQ",onclick:() => openFaqDialog(null, null, S.q.trim())})) : null)));
}

let pendingJump = null;
function render(){
  if (!S.me) return;
  const sec0 = S.route.startsWith("p-") || S.route === "products" ? "products" : S.route.startsWith("t-") || S.route === "faqs" ? "faqs" : null;
  S.q = sec0 ? S.secQ[sec0] || "" : "";
  const top = S.route.startsWith("p-") || S.route.startsWith("edit-") || S.route === "new-product" ? "products" : S.route.startsWith("t-") ? "faqs" : S.route.startsWith("s-") || S.route === "import-specs" ? "specs" : S.route.startsWith("a-") || S.route === "import-amazon" ? "amazon" : isStarter(S.route) ? "handbook" : S.route;
  document.querySelectorAll("#nav a").forEach(a => a.classList.toggle("on", a.dataset.r === top));
  let v;
  if (S.route === "products") v = viewProducts();
  else if (S.route === "new-product") v = viewProductEditor(null);
  else if (S.route.startsWith("edit-")) v = viewProductEditor(S.route.slice(5));
  else if (S.route.startsWith("p-")) v = viewProduct(S.route.slice(2));
  else if (S.route.startsWith("t-")) v = viewFaqs(S.route.slice(2));
  else if (S.route === "faqs") v = viewFaqs(null);

  else if (S.route === "specs") v = viewSpecs();
  else if (S.route === "import-specs") v = viewSpecImport();
  else if (S.route.startsWith("s-")) v = viewSpec(S.route.slice(2));
  else if (S.route === "amazon") v = viewAmazon();
  else if (S.route === "handbook") v = viewHandbook();
  else if (S.route === "about") v = viewAbout();
  else if (S.route === "finder") v = viewFinder();
  else if (S.route === "glossary") v = viewGlossary();
  else if (S.route === "say") v = viewSay();
  else if (S.route === "howto") v = viewHowto();
  else if (S.route === "contacts") v = viewContacts();
  else if (S.route === "import-amazon") v = viewAmazonImport();
  else if (S.route.startsWith("a-")) v = viewAmazonListing(S.route.slice(2));
  else v = viewProducts();
  // keep open answers, half-typed notes and focus when other people's changes arrive
  const editing = S.route.startsWith("edit-") || S.route === "new-product";
  const open = new Set([...main.querySelectorAll("details[open]")].map(d => d.id));
  const act = document.activeElement, actId = act && main.contains(act) ? act.id : null;
  const drafts = {}; if (!editing) main.querySelectorAll("textarea[id],select[id],input[type=checkbox][id],input[type=text][id]").forEach(el => drafts[el.id] = el.type === "checkbox" ? el.checked : el.value);
  const scrollY = window.scrollY;
  const banners = S.offline ? [W(h("div",{class:"status",style:"margin-top:20px",text:"Can't reach the server right now. What you see may be out of date."}))] : [];
  main.replaceChildren(...banners, v);
  open.forEach(id => { const d = id && document.getElementById(id); if (d && d.tagName === "DETAILS") d.open = true; });
  for (const [id,val] of Object.entries(drafts)){ const el = document.getElementById(id); if (el){ if (el.type === "checkbox") el.checked = val; else el.value = val; } }
  if (actId){ const el = document.getElementById(actId); if (el){ el.focus({preventScroll:true}); if (el.id === "specFilter" || el.id === "amzFilter" || el.id.startsWith("q-") || el.id === "q-gloss") try { el.setSelectionRange(el.value.length, el.value.length); } catch {} } }
  if (editing) window.scrollTo(0, scrollY);
  if (pendingJump){ const el = document.getElementById(pendingJump); if (el){ el.scrollIntoView(); pendingJump = null; } }
}
main.addEventListener("click", e => {
  const a = e.target.closest("[data-jump]"); if (!a) return;
  const el = document.getElementById(a.dataset.jump); if (el){ e.preventDefault(); el.scrollIntoView({behavior:"smooth"}); }
});

/* ---------- routing & search ---------- */
function readHash(){ const hsh = (location.hash || "").slice(1); S.route = /^[A-Za-z0-9-]+$/.test(hsh) && hsh !== "home" ? hsh : "products"; }
window.addEventListener("hashchange", () => { readHash(); if (S.route !== "users") S.userEdit = null; if (S.route !== "import-specs") S.specImport = null; if (S.route !== "import-amazon") S.amzImport = null; S.amzError = null; if (!pendingJump) window.scrollTo(0,0); render(); });
function resetSearch(){}
// "/" jumps to the search box on the current page.
document.addEventListener("keydown", e => { if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)){ const el = main.querySelector('[id^="q-"],#specFilter,#amzFilter'); if (el){ e.preventDefault(); el.focus(); } } });
document.querySelectorAll("dialog [data-close]").forEach(b => b.addEventListener("click", () => b.closest("dialog").close()));
const showDlg = d => { try { d.showModal(); } catch { d.setAttribute("open",""); } };

/* ---------- FAQ dialog ---------- */
const dlg = $("#faqDlg"), fCat = $("#fCat"), fNewWrap = $("#fNewCatWrap");
function openFaqDialog(f, cat, question){
  S.editingFaq = f;
  $("#faqDlgTitle").textContent = f ? "Edit FAQ" : "Add a FAQ";
  fCat.replaceChildren(...categories().map(c => h("option",{value:c.name,text:c.name})), h("option",{value:"__new",text:"New topic…"}));
  fCat.value = f?.category || cat || categories()[0]?.name || "__new";
  fNewWrap.hidden = fCat.value !== "__new"; $("#fNewCat").value = "";
  $("#fQ").value = f?.question || question || ""; $("#fA").value = f?.answer || ""; $("#fSteps").value = (f?.steps||[]).join("\n"); $("#fNote").value = f?.note || "";
  $("#fProds").replaceChildren(...S.products.map(p => h("label",{class:"inline"}, h("input",{type:"checkbox",value:p.id,checked:(f?.products||[]).includes(p.id)||null}), p.name.replace(/^Eye Doctor /,""))));
  $("#fErr").textContent = "";
  showDlg(dlg); $("#fQ").focus();
}
fCat.addEventListener("change", () => { fNewWrap.hidden = fCat.value !== "__new"; });
$("#faqForm").addEventListener("submit", async e => {
  e.preventDefault();
  const category = fCat.value === "__new" ? $("#fNewCat").value.trim() : fCat.value;
  const body = { id: S.editingFaq?.id || 0, category, question:$("#fQ").value.trim(), answer:$("#fA").value.trim(), steps:lines($("#fSteps").value),
    note:$("#fNote").value.trim(), products:[...$("#fProds").querySelectorAll("input:checked")].map(i => i.value) };
  const btn = $("#fSave"); btn.disabled = true;
  try { await api("faq_save", body); toast(S.editingFaq ? "FAQ updated" : "FAQ added"); dlg.close(); await load(); }
  catch(err){ $("#fErr").textContent = err.message; }
  btn.disabled = false;
});

/* ---------- topic dialog ---------- */
const tDlg = $("#topicDlg"); let tState = null;
function openTopic(name){
  tState = { name, photo: topicPhoto(name) };
  $("#tName").value = name; $("#tErr").textContent = "";
  $("#tPhotoField").replaceWith(Object.assign(photoField(tState.photo, v => { tState.photo = v; }), {id:"tPhotoField"}));
  showDlg(tDlg);
}
$("#topicForm").addEventListener("submit", async e => {
  e.preventDefault(); $("#tErr").textContent = "";
  try { const r = await api("topic_save",{name:tState.name, newName:$("#tName").value.trim(), photo:tState.photo}); tDlg.close(); toast("Topic saved"); await load(); location.hash = "t-" + slug(r.name); }
  catch(err){ $("#tErr").textContent = err.message; }
});

/* ---------- editor password ---------- */
const pwDlg = $("#pwDlg");
$("#pwBtn").addEventListener("click", () => { $("#pwErr").textContent = ""; $("#pwNew").value = ""; showDlg(pwDlg); $("#pwNew").focus(); });
$("#pwForm").addEventListener("submit", async e => {
  e.preventDefault(); $("#pwErr").textContent = "";
  if ($("#pwNew").value.length < 8){ $("#pwErr").textContent = "Passwords need at least 8 characters."; return; }
  try { await api("password",{ new:$("#pwNew").value }); pwDlg.close(); toast("Password changed"); }
  catch(err){ $("#pwErr").textContent = err.message; }
});

/* ---------- sign in ---------- */
function shell(on){
  $("#topbar").hidden = !on; $("#footer").hidden = !on; $("#acct").hidden = !on;
}
function signInView(msg){
  shell(false);
  const team = S.authMode === "team";
  const err = h("div",{class:"form-error",role:"alert",hidden: msg ? null : true,text: msg || ""});
  const email = h("input",{type:"email",id:"siEmail",autocomplete:"username",required:true});
  const pw = h("input",{type:"password",id:"siPw",autocomplete: team ? "current-password" : "current-password",required:true});
  const name = h("input",{type:"text",id:"siName",autocomplete:"name",placeholder:"e.g. Jess",value: myName()});
  const btn = h("button",{class:"btn",type:"submit",text: team ? "Open the portal" : "Sign in as editor"});
  const form = h("form",{class:"auth-card"},
    h("span",{class:"mark logo",role:"img","aria-label":"The Body Doctor"},h("i",{class:"ink"}),h("i",{class:"grn"})),
    h("h1",{text: team ? "Product Library" : "Editor sign-in"}),
    h("p",{class:"lede",text: team ? "Enter the team password. You only need to do this once on each computer." : "Editors can change products, FAQs and topics."}),
    err,
    team ? null : h("label",null,"Email", email),
    h("label",null, team ? "Team password" : "Password", pw),
    team ? h("label",null,h("span",null,"Your first name ",h("span",{class:"help",text:"shown on notes you post"})), name) : null,
    btn,
    team ? h("button",{class:"link",type:"button",style:"align-self:flex-start",text:"Editor? Sign in with your email",onclick:() => { S.authMode = "editor"; signInView(); }}) : null,
    team ? null : h("button",{class:"link",type:"button",style:"align-self:flex-start",text:"Back to team sign-in",onclick:() => { S.authMode = "team"; signInView(); }}),
    h("p",{class:"hint",text: team ? "Don't know the team password? Ask your manager." : "Forgotten your editor password? Ask whoever set up the portal to reset it in Supabase."}));
  form.addEventListener("submit", async e => {
    e.preventDefault(); err.hidden = true; btn.disabled = true;
    try {
      const r = await sb.auth.signInWithPassword({ email: team ? CFG.TEAM_EMAIL : email.value.trim(), password: pw.value });
      if (r.error) throw new Error(/invalid/i.test(r.error.message) ? (team ? "That isn't the team password." : "That email and password don't match an editor account.") : friendly(r.error));
      if (team && name.value.trim()) store.set("tbd-name", name.value.trim().slice(0,80));
      await afterSignIn();
    } catch(x){ err.textContent = x.message; err.hidden = false; btn.disabled = false; }
  });
  document.body.classList.add("auth");
  main.replaceChildren(h("div",{class:"auth-main"},form));
  (team ? pw : email).focus();
}
async function afterSignIn(){
  const { data:{ session } } = await sb.auth.getSession();
  if (!session) return signInView();
  const role = (await sb.rpc("my_role")).data;
  if (!role){ await sb.auth.signOut(); return signInView("This account hasn't been given access to the portal yet."); }
  S.me = { id: session.user.id, email: session.user.email, role: role === "editor" ? "editor" : "contributor" };
  document.body.classList.remove("auth");
  shell(true);
  const editor = role === "editor";
  const isTeam = (session.user.email || "").toLowerCase() === String(CFG.TEAM_EMAIL || "").toLowerCase();
  // Shared team login: show the person's name; never offer to change the shared password from here.
  $("#who").textContent = isTeam ? (myName() || "Team") : (session.user.email + (editor ? " · Editor" : ""));
  $("#editorBtn").hidden = !isTeam; $("#pwBtn").hidden = isTeam || !editor;
  readHash(); render(); await load();
  startLive();
}
$("#signOutBtn").addEventListener("click", async () => { stopLive(); await sb.auth.signOut(); S.me = null; S.loaded = false; S.authMode = "team"; signInView(); });
$("#editorBtn").addEventListener("click", async () => { stopLive(); await sb.auth.signOut(); S.me = null; S.loaded = false; S.authMode = "editor"; signInView(); });

/* ---------- live updates ---------- */
let channel = null, poll = null, amzReloadT;
function startLive(){
  stopLive();
  channel = sb.channel("portal-changes")
    .on("postgres_changes", { event:"*", schema:"public", table:"faqs" }, reloadSoon)
    .on("postgres_changes", { event:"*", schema:"public", table:"products" }, reloadSoon)
    .on("postgres_changes", { event:"*", schema:"public", table:"topics" }, reloadSoon)
    .on("postgres_changes", { event:"*", schema:"public", table:"specs" }, reloadSoon)
    .on("postgres_changes", { event:"*", schema:"public", table:"amazon" }, () => { if (S.amzLoaded){ clearTimeout(amzReloadT); amzReloadT = setTimeout(() => { S.amzLoaded = false; S.amzText = {}; ensureAmazon(); }, 1500); } })
    .subscribe();
  poll = setInterval(() => { if (!document.hidden) load(); }, 60000); // safety net if live updates drop
}
function stopLive(){ if (channel){ sb.removeChannel(channel); channel = null; } if (poll){ clearInterval(poll); poll = null; } }
document.addEventListener("visibilitychange", () => { if (!document.hidden && S.me) load(); });

/* ---------- start ---------- */
(async () => {
  if (!sb){
    main.replaceChildren(h("div",{class:"auth-main"},h("div",{class:"auth-card"},
      h("h1",{text:"Almost there"}),
      h("p",{class:"lede",text: window.supabase ? "This portal isn't connected to its database yet. Open assets/config.js and paste in your Supabase Project URL and anon key, as described in the setup guide." : "The portal couldn't load its database library. Check this computer can reach cdn.jsdelivr.net, then reload."}))));
    return;
  }
  sb.auth.onAuthStateChange((ev) => { if (ev === "SIGNED_OUT" && S.me){ S.me = null; stopLive(); signInView("You've been signed out. Sign in again to carry on."); } });
  const { data:{ session } } = await sb.auth.getSession();
  if (session) await afterSignIn(); else signInView();
})();
})();
