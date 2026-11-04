/* The Body Doctor — Customer Query Portal (GitHub Pages + Supabase) */
(() => {
"use strict";
const CFG = window.PORTAL_CONFIG || {};
const LEVEL = { viewer:1, contributor:2, editor:3, admin:4 };
const S = { products:[], faqs:[], notes:[], topics:[], me:null, loaded:false, q:"", route:"home",
  noteFilter:"all", editingFaq:null, offline:false, draft:null, authMode:"team" };
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
        sb.from("notes").select("*").order("created_at", { ascending:false }).limit(1000)]);
      rowsToState(chk(p), chk(f), chk(t), chk(n));
      S.loaded = true; S.offline = false;
      render();
    } catch(e){ S.offline = true; if (S.loaded) render(); else main.replaceChildren(W(h("div",{class:"band"},h("div",{class:"empty",text:friendly(e)})))); }
    finally { loading = null; }
  })();
  return loading;
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
  const big = h("input",{id:"bigq",type:"search",placeholder:"What is the customer asking about?","aria-label":"Search the portal",autocomplete:"off"});
  big.addEventListener("input", () => { qEl.value = big.value; qEl.focus(); qEl.setSelectionRange(qEl.value.length, qEl.value.length); qEl.dispatchEvent(new Event("input")); });
  const trySearch = t => h("button",{type:"button",text:t,onclick:() => { qEl.value = t; qEl.dispatchEvent(new Event("input")); qEl.focus(); }});
  const pics = S.products.map(p => safeSrc(p.photo)).filter(Boolean);
  const pic = i => pics.length ? pics[i % pics.length] : null;
  return h("div",null,
    h("section",{class:"hero"},W(
      h("div",null,
        h("div",{class:"eyebrow",text:"Customer services portal"}),
        h("h1",{style:"margin-top:12px"},"How can we help the customer today?"),
        h("p",{class:"lede",text:"Instructions for use, approved answers and team notes for every product in one place. Search, open the answer and copy it straight into your reply."}),
        h("div",{class:"bigsearch"}, searchIcon(), big),
        h("div",{class:"try"}, "Try:", ["microwave","crystals","warranty","not arrived","discount code","contact lenses"].map(trySearch))),
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
      S.faqs.length ? h("div",{class:"tgrid"}, categories().map(topicTile)) : loadingOr("No FAQs yet."))),
    h("section",{class:"band"},W(
      h("div",{class:"band-head"},h("div",null,h("div",{class:"eyebrow",text:"From the team"}),h("h2",{style:"margin-top:6px"},"Latest staff notes")),h("a",{href:"#notes",text:"Notice board"})),
      recent.length ? h("div",{class:"notes"}, recent.map(noteEl)) : h("div",{class:"empty",text: S.loaded ? "No staff notes yet. Post the first one on the notice board, or on any product page." : "Loading notes…"}))));
}
function viewProducts(){
  return h("section",{class:"band"},W(
    h("div",{class:"band-head"},h("div",null,h("div",{class:"eyebrow",text:"Instructions for use"}),h("h1",{style:"margin-top:6px"},"Product instructions"),
      h("p",{class:"lede",style:"margin-top:10px",text:"Taken from the printed leaflets that go out with each product. Open a product for heating times, step-by-step use, warnings and related FAQs."})),
      canEdit() ? h("a",{class:"btn",href:"#new-product",text:"Add a product"}) : null),
    S.products.length ? h("div",{class:"pgrid"}, S.products.map(productTile)) : loadingOr("No product instructions yet.")));
}
function viewProduct(id){
  const p = prodById(id);
  if (!p) return W(h("div",{class:"band"},loadingOr("That product isn't in the portal.")));
  const related = S.faqs.filter(f => (f.products||[]).includes(p.id));
  const notes = sortedNotes(S.notes.filter(n => n.topic === "p:"+p.id));
  const jump = (target, label) => h("a",{href:"#p-"+p.id,"data-jump":target,text:label});
  return W(
    h("div",{class:"crumbs row",style:"justify-content:space-between"},h("span",null,h("a",{href:"#home",text:"Overview"})," / ",h("a",{href:"#products",text:"Instructions"})," / ",p.name),
      canEdit() ? h("a",{class:"btn small ghost",href:"#edit-"+p.id,text:"Edit product"}) : null),
    h("div",{class:"split"},
      h("aside",null,h("div",{class:"stick"},
        photo(p.photo, p.name),
        p.facts?.length ? h("dl",{class:"facts"}, p.facts.map(([k,v]) => h("div",null,h("dt",{text:k}),h("dd",{text:v})))) : null,
        h("div",null,h("div",{class:"eyebrow",style:"margin-bottom:8px",text:"On this page"}),
          h("nav",{class:"toc"}, p.sections.map((s,i) => jump("s"+i, s.title || "Section "+(i+1))), related.length ? jump("rel","Related FAQs ("+related.length+")") : null, jump("pnotes","Staff notes"+(notes.length?" ("+notes.length+")":"")))))),
      h("div",null,
        h("div",{class:"stack",style:"gap:14px;padding-bottom:12px"},
          h("div",{class:"eyebrow",text:[p.family, "Instructions for use"].filter(Boolean).join(" · ")}),
          h("h1",{text:p.name}),
          h("div",{class:"row",style:"gap:8px"}, p.ref ? h("span",{class:"chip ref",text:"REF "+p.ref}) : null, p.ifu ? h("span",{class:"chip ref",text:"IFU "+p.ifu}) : null),
          p.summary ? h("p",{class:"lede"},hl(p.summary)) : null),
        p.sections.map((s,i) => sectionEl(s, "s"+i)),
        related.length ? h("section",{class:"sec",id:"rel"},h("h2",null,"Related FAQs"),h("div",{class:"faqs"},related.map(f => faqEl(f)))) : null,
        h("section",{class:"sec",id:"pnotes",style:"border-bottom:0"},h("h2",null,"Staff notes"),
          notes.length ? h("div",{class:"notes"},notes.map(noteEl)) : h("p",{class:"lede",text:"No notes yet. Add anything customers keep asking that isn't covered above."}),
          noteForm("p:"+p.id)))));
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
  return h("section",{class:"band"},W(h("div",{class:"stack",style:"gap:28px"},
    head,
    h("div",{class:"pills"}, h("a",{href:"#faqs",class:cat ? null : "on",text:"All"}), cats.map(c => h("a",{href:"#t-"+c.slug,class:cat?.slug === c.slug ? "on" : null,text:c.name}))),
    S.faqs.length ? (cat ? [cat] : cats).map(g => h("section",{class:"group",id:"g-"+g.slug}, cat ? null : h("h2",{style:"font-size:1.4rem;margin-bottom:6px"},g.name),
        h("div",{class:"faqs"}, S.faqs.filter(f => f.category === g.name).map(f => faqEl(f)))))
      : loadingOr("No FAQs yet."),
    cat ? h("section",{class:"stack",style:"gap:14px;margin-top:20px"},h("h2",null,"Staff notes on "+cat.name), notes.length ? h("div",{class:"notes"},notes.map(noteEl)) : null, noteForm("c:"+cat.name)) : null)));
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
  const noteHits = S.notes.filter(n => matches(n.text + " " + topicLabel(n.topic)));
  const total = prodHits.length + faqHits.length + noteHits.length;
  return h("section",{class:"band"},W(h("div",{class:"stack",style:"gap:36px;max-width:960px"},
    h("div",null,h("div",{class:"eyebrow",text:"Search results"}),h("h1",{style:"margin-top:6px"},total ? total+" result"+(total>1?"s":"")+" for “"+S.q.trim()+"”" : "No results for “"+S.q.trim()+"”"),
      total ? null : h("p",{class:"lede",style:"margin-top:10px",text:"Try fewer or different words, such as microwave, warranty, crystals or contact lenses. If it's a new question, add it as a FAQ so the next person finds it."})),
    faqHits.length ? h("section",null,h("h2",{style:"margin-bottom:10px"},"FAQs ("+faqHits.length+")"),h("div",{class:"faqs"},faqHits.map(f => faqEl(f, faqHits.length <= 3)))) : null,
    prodHits.length ? h("section",null,h("h2",{style:"margin-bottom:6px"},"Instructions ("+prodHits.length+")"),
      prodHits.map(r => h("a",{class:"res",href:"#p-"+r.p.id,onclick: e => { e.preventDefault(); pendingJump = r.jump || null; resetSearch();
          const target = "p-" + r.p.id; if (S.route === target) render(); else location.hash = target; if (!pendingJump) window.scrollTo(0,0); }},
        photo(r.p.photo) || h("span"),
        h("div",null,h("div",{class:"eyebrow",text:r.p.name}),h("h3",{style:"margin:2px 0 4px"},hl(r.title)),h("div",{class:"snip"},hl(snippet(r.text))))))) : null,
    noteHits.length ? h("section",null,h("h2",{style:"margin-bottom:10px"},"Staff notes ("+noteHits.length+")"),h("div",{class:"notes"},sortedNotes(noteHits).map(noteEl))) : null,
    (!total && canWrite()) ? h("div",null,h("button",{class:"btn ghost",type:"button",text:"Add this as a FAQ",onclick:() => openFaqDialog(null, null, S.q.trim())})) : null)));
}

let pendingJump = null;
function render(){
  if (!S.me) return;
  const searching = S.q.trim() && terms().length;
  const top = S.route.startsWith("p-") || S.route.startsWith("edit-") || S.route === "new-product" ? "products" : S.route.startsWith("t-") ? "faqs" : S.route;
  document.querySelectorAll("#nav a").forEach(a => a.classList.toggle("on", !searching && a.dataset.r === top));
  let v;
  if (searching) v = viewSearch();
  else if (S.route === "products") v = viewProducts();
  else if (S.route === "new-product") v = viewProductEditor(null);
  else if (S.route.startsWith("edit-")) v = viewProductEditor(S.route.slice(5));
  else if (S.route.startsWith("p-")) v = viewProduct(S.route.slice(2));
  else if (S.route.startsWith("t-")) v = viewFaqs(S.route.slice(2));
  else if (S.route === "faqs") v = viewFaqs(null);
  else if (S.route === "notes") v = viewNotes();
  else v = viewHome();
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
  if (actId){ const el = document.getElementById(actId); if (el) el.focus({preventScroll:true}); }
  if (editing) window.scrollTo(0, scrollY);
  if (pendingJump && !S.q){ const el = document.getElementById(pendingJump); if (el){ el.scrollIntoView(); pendingJump = null; } }
}
main.addEventListener("click", e => {
  const a = e.target.closest("[data-jump]"); if (!a) return;
  const el = document.getElementById(a.dataset.jump); if (el){ e.preventDefault(); el.scrollIntoView({behavior:"smooth"}); }
});

/* ---------- routing & search ---------- */
function readHash(){ const hsh = (location.hash || "").slice(1); S.route = /^[A-Za-z0-9-]+$/.test(hsh) ? hsh : "home"; }
window.addEventListener("hashchange", () => { readHash(); if (S.q) resetSearch(); if (S.route !== "users") S.userEdit = null; if (!pendingJump) window.scrollTo(0,0); render(); });
const qEl = $("#q"), clearBtn = $("#clear");
let qt;
qEl.addEventListener("input", () => { clearTimeout(qt); qt = setTimeout(() => { const was = !!S.q.trim(); S.q = qEl.value; clearBtn.hidden = !S.q; render(); if (!was && S.q.trim()) window.scrollTo(0,0); }, 120); });
qEl.addEventListener("keydown", e => { if (e.key === "Escape"){ resetSearch(); render(); } });
function resetSearch(){ qEl.value = ""; S.q = ""; clearBtn.hidden = true; }
clearBtn.addEventListener("click", () => { resetSearch(); render(); qEl.focus(); });
document.addEventListener("keydown", e => { if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)){ e.preventDefault(); qEl.focus(); } });
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
    h("h1",{text: team ? "Customer Query Portal" : "Editor sign-in"}),
    h("p",{class:"lede",text: team ? "Enter the team password. You only need to do this once on each computer." : "Editors can change products, FAQs and topics."}),
    err,
    team ? null : h("label",null,"Email", email),
    h("label",null, team ? "Team password" : "Password", pw),
    team ? h("label",null,h("span",null,"Your first name ",h("span",{class:"help",text:"shown on notes you post"})), name) : null,
    btn,
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
  $("#editorBtn").hidden = true; $("#pwBtn").hidden = isTeam || !editor;
  readHash(); render(); await load();
  startLive();
}
$("#signOutBtn").addEventListener("click", async () => { stopLive(); await sb.auth.signOut(); S.me = null; S.loaded = false; S.authMode = "team"; signInView(); });
$("#editorBtn").addEventListener("click", async () => { stopLive(); await sb.auth.signOut(); S.me = null; S.loaded = false; S.authMode = "editor"; signInView(); });

/* ---------- live updates ---------- */
let channel = null, poll = null;
function startLive(){
  stopLive();
  channel = sb.channel("portal-changes")
    .on("postgres_changes", { event:"*", schema:"public", table:"notes" }, reloadSoon)
    .on("postgres_changes", { event:"*", schema:"public", table:"faqs" }, reloadSoon)
    .on("postgres_changes", { event:"*", schema:"public", table:"products" }, reloadSoon)
    .on("postgres_changes", { event:"*", schema:"public", table:"topics" }, reloadSoon)
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
