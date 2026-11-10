/* The Body Doctor Product Library: new-starter content.
   Plain data so it's easy to correct. Anything marked check:true still needs sign-off. */
(function (root) {
"use strict";

const brands = [
  { name:"The Eye Doctor", what:"Our main eye-care range: heated and cold eye compresses, eyelid wipes and cleansers, eye drops and sprays, and treatment kits.", examples:"Premium, Click & Go, Essential, Lid Wipes, Intensive Relief drops", specs:"The Eye Doctor" },
  { name:"M-Club", what:"Wellbeing and personal care: pulse-point roller oils and pillow sprays, oral supplement sprays, body and face moisturisers, hair care, wipes and eye masks.", examples:"Restful Nights Pillow Spray, Magnesium Sleep Spray, Shampoo", specs:"M-Club" },
  { name:"Zocular", what:"Eyelid products from the US, including the ZEST treatment kits used by eye-care professionals in clinic, plus Zocu wipes, foam and gels.", examples:"ZEST Kit, Zocuwipe, ZocuFoam", specs:"Zocular" },
  { name:"Revolutioneyes", what:"A smaller eye-care range: an eye mask and eyelid wipes.", examples:"Revolutioneyes Eye Mask, Eyelid Wipes 30", specs:"Revolutioneyes" },
  { name:"AB Masks", what:"Antibacterial face masks and anti-fog wipes for glasses.", examples:"Antibacterial Face Mask, Anti-fog", specs:"AB Masks" },
  { name:"ThinOptics", what:"Slim folding reading glasses with compact cases, sold mainly on Amazon.", examples:"Reading glasses in strengths 1.0 to 2.5", specs:null }
];

const channels = [
  { name:"Direct to customers", what:"Orders from the-body-doctor.com. Most customer service queries come from here.", check:true },
  { name:"Wholesale and trade", what:"Pharmacies, opticians and retailers ordering by the outer. Packing and pallet details are in Product specs.", check:true },
  { name:"Amazon", what:"Sold in up to 15 Amazon marketplaces, mostly fulfilled by Amazon (FBA). Listings and seller SKUs are in the Amazon section." }
];

const firstWeek = [
  "Read the four instruction pages, starting with Eye Doctor Premium.",
  "Learn the eye conditions in the Glossary: dry eye, MGD, blepharitis, styes and chalazion.",
  "Use the Product finder to see which products help each condition.",
  "Read What we can and can't say, including when to escalate.",
  "Read the 10 most-asked FAQs and practise copying an answer into a reply.",
  "Look up a product in Product specs and on Amazon, so you know where barcodes and box quantities are.",
  "Shadow a colleague on live customer queries.",
  "Learn who to ask for discount codes, replacements and anything you're unsure about."
];

/* Condition finder. "lead" products are backed by their leaflet wording (quoted in why);
   "range" items are other products whose name suggests a fit: check the leaflet before recommending. */
const conditions = [
  { id:"dry-eye", name:"Dry eye", plain:"Eyes feel dry, gritty, sore or tired, often worse with screens, air conditioning or contact lenses.",
    lead:[["ed-premium","Hot compress for dry eye disease, MGD and grittiness, followed by eyelid massage."],
          ["ed-click-go","Self-heating compress for heat treatment on the go."],
          ["ed-intensive-drops","Intensive lubrication for dry, irritated, strained or burning eyes."],
          ["ed-advanced-spray","Spray for moderate to severe dry eye, applied to closed eyelids."]],
    range:["EDDESINTENSE","EDEDINTENSE","EDEDADV","EDELO"] },
  { id:"mgd", name:"MGD and blepharitis", plain:"The oil glands in the eyelids get blocked, or the eyelid edges are inflamed. Eyes can be red, crusty, itchy or gritty.",
    lead:[["ed-premium","Moist heat therapy for MGD (blepharitis), then eyelid massage to clear the glands."],
          ["ed-click-go","Heat treatment with eyelid massage, when away from a microwave."]],
    range:["KIT-BELPH","ELW20","ELWEDTT20","ELC","ELCTT","EDHC01"] },
  { id:"stye", name:"Styes and chalazion", plain:"A painful red lump on the eyelid edge (stye), or a firmer, usually painless lump inside the eyelid (chalazion).",
    lead:[["ed-premium","Hot compress listed for chalazion (eyelid cysts)."]],
    range:["EDST","KIT-STYE"] },
  { id:"allergy", name:"Hay fever and allergies", plain:"Itchy, watery, puffy eyes from pollen, dust or pets.",
    lead:[["ed-premium","Used cold (from the freezer) for hay fever, allergies, inflammation and itchy eyes."]],
    range:["EDA","ELWEDA20","EDAED","EDHOCA"] },
  { id:"tired", name:"Tired, puffy or screen-strained eyes", plain:"Eyes that feel heavy, puffy or strained after long days or lots of screen time.",
    lead:[["ed-premium","Used cold for tired, puffy or sore eyes, sinus headaches and migraine."],
          ["ed-intensive-drops","For strained eyes, including from screen use."]],
    range:["EDEDREFRESH","EDEDNIGHT"] },
  { id:"lenses", name:"Contact lens wearers", plain:"Customers who wear lenses and want to know what's safe to use.",
    lead:[["ed-intensive-drops","Suitable with hard or soft contact lenses."],
          ["ed-advanced-spray","Can be used while wearing contact lenses."]],
    note:"Eye Doctor Premium: contact lenses must be removed before using the compress.",
    range:[] },
  { id:"surgery", name:"After eye surgery", plain:"Customers recovering from an eye procedure.",
    lead:[["ed-intensive-drops","The leaflet says it's also suitable after eye surgery."]],
    note:"Always tell the customer to follow their surgeon's or clinic's aftercare instructions first.",
    range:["KIT-ZESTAFTERCARE"] },
  { id:"children", name:"Children", plain:"Parents asking what's suitable for babies and children.",
    lead:[],
    note:"Eye Doctor Click & Go is not suitable for children under 3. For anything else, check the product's leaflet for age guidance.",
    range:["EDJ","EDJELW20","ELWEDB20","EDJKIT1"] }
];

const glossary = [
  // eye conditions
  ["Eye conditions","Dry eye disease","When the eyes don't make enough tears, or the tears evaporate too fast. Eyes feel dry, gritty, sore or tired."],
  ["Eye conditions","MGD (meibomian gland dysfunction)","The meibomian glands along the eyelid edges make the oily layer of the tear film. When they block, tears evaporate quickly and eyes get dry and irritated. Heat plus eyelid massage helps clear them."],
  ["Eye conditions","Blepharitis","Inflammation of the eyelid edges, often with crusting around the lashes. Usually managed with daily eyelid hygiene and warm compresses."],
  ["Eye conditions","Chalazion","A lump in the eyelid from a blocked oil gland. Usually painless. Our leaflets call it an eyelid cyst."],
  ["Eye conditions","Stye","A small, painful red lump on the edge of the eyelid, from an infected lash follicle or gland."],
  ["Eye conditions","Tear film","The thin layer of tears that covers the eye. It has an oily outer layer that slows evaporation."],
  ["Eye conditions","Eyelid massage","Gentle pressure on the eyelids straight after heat treatment, to push the melted oil out of the glands. Instructions are on the Premium and Click & Go pages."],
  // products & regulation
  ["Products and regulation","IFU (instructions for use)","The printed leaflet that goes in the box. The Instructions section is taken from these."],
  ["Products and regulation","Medical device","A product used to treat or relieve a medical condition that works physically rather than as a medicine, such as our compresses and drops. They're registered with the MHRA."],
  ["Products and regulation","Class 1 medical device","The lowest-risk group of medical devices. Eye Doctor Premium is one."],
  ["Products and regulation","MHRA","The Medicines and Healthcare products Regulatory Agency, the UK regulator for medicines and medical devices. Serious incidents with our devices are reported to them."],
  ["Products and regulation","CE marking","Shows a product meets EU safety rules. Several of our products carry it."],
  ["Products and regulation","Sterileyes®","Our antibacterial fabric treatment, permanently bound to the compress fibres. It reduces bacteria on the surface by up to 99.9% (British patent GB2561707)."],
  ["Products and regulation","BodyBeads®","The beads inside Eye Doctor compresses that hold heat or cold."],
  ["Products and regulation","Preservative-free","No preservatives, which can irritate sensitive eyes. Our drops and spray are preservative-free."],
  ["Products and regulation","Sodium hyaluronate","A moisture-holding ingredient in eye drops (0.3% in Intensive Relief). Also called hyaluronic acid."],
  ["Products and regulation","Hypochlorous","A gentle cleansing ingredient used in our hypochlorous sprays for eyelids and skin."],
  ["Products and regulation","ZEST","Zocular's in-clinic eyelid treatment, carried out by an eye-care professional. We sell the treatment kits and aftercare kit."],
  // packing
  ["Packing and barcodes","SKU","Our own code for a product, for example EDPR03 for Eye Doctor Premium."],
  ["Packing and barcodes","GTIN, EAN or barcode","The number under the barcode on a unit, usually 13 digits starting 50344450 for our products."],
  ["Packing and barcodes","Outer","The shipping box that units are packed in. Trade customers order by the outer."],
  ["Packing and barcodes","Outer GTIN","The barcode on the outer box, usually 14 digits."],
  ["Packing and barcodes","MOQ (minimum order quantity)","The smallest order we accept. For trade it's usually one outer."],
  ["Packing and barcodes","Commodity code (HS code)","The customs code used when shipping goods abroad."],
  ["Packing and barcodes","Country of origin","Where the product was made, which isn't always where we ship it from."],
  // amazon
  ["Amazon","ASIN","Amazon's 10-character ID for a product listing, for example B08HYMSZWD. A customer may quote it."],
  ["Amazon","MSKU (seller SKU)","Our own code for a listing in Amazon's system. One ASIN can have several."],
  ["Amazon","FNSKU","The label code Amazon uses in its warehouses to track our stock."],
  ["Amazon","FBA (fulfilled by Amazon)","Amazon stores, packs and ships the order, and handles delivery questions."],
  ["Amazon","MFN (merchant-fulfilled)","We ship the Amazon order ourselves."],
  ["Amazon","Stickerless","Stock Amazon tracks by its barcode without an extra Amazon label."],
  ["Amazon","Bundle","Several products sold together as one listing, for example a mask with wipes."]
];

const sayDo = [
  "Share what the instructions leaflet says, and copy approved FAQ answers.",
  "Explain how to use a product safely, including warnings and how long to use it.",
  "Suggest the customer speaks to an optometrist, pharmacist or GP about their symptoms.",
  "Say which products are designed for a condition, using the wording in the Product finder.",
  "Write down what the customer said, the product, batch or lot number and the date if something went wrong."
];
const sayDont = [
  "Diagnose a condition, or tell someone what they have.",
  "Say a product will cure anything, or promise results.",
  "Tell someone to stop, change or replace medicine or treatment their doctor has given them.",
  "Recommend a product for something its leaflet doesn't cover.",
  "Give advice about children, pregnancy or after surgery beyond what the leaflet says."
];
const redFlags = [
  "Sudden loss of vision, or vision getting worse quickly",
  "Severe eye pain, or pain with sensitivity to light",
  "A chemical, burn or injury to the eye",
  "A very red, swollen eye with fever, or swelling spreading around the eye",
  "Problems after eye surgery"
];

const howtos = [
  { title:"Order hasn't arrived", topic:"Orders", known:["Check the order status and tracking before replying."], check:true },
  { title:"Replacement for a faulty or damaged item", topic:"Returns and replacements", known:["Packaged replacements go through Adam."], check:true },
  { title:"Returns and refunds", topic:"Returns and replacements", known:[], check:true },
  { title:"Discount codes", topic:"Pricing", known:["Temporary codes come from Jess.","Check the discount code list is current: the version in the FAQs is dated 04/10/2021."], check:true },
  { title:"Warranty claims, including ThinOptics", topic:"Warranty", known:[], check:true },
  { title:"Amazon customer messages", topic:"Amazon", known:["For orders fulfilled by Amazon (FBA), delivery problems are handled by Amazon."], check:true },
  { title:"Trade and wholesale enquiries", topic:"Trade", known:["Packing, pallet and barcode details are in Product specs.","Sales enquiries go to sales@the-body-doctor.com."], check:true },
  { title:"Reporting a side effect or serious incident", topic:"Safety", known:["Note the customer's details, product, batch or lot number and what happened.","Tell your manager the same day.","Serious incidents are reported to the manufacturer and the MHRA."], check:true }
];

const contacts = [
  { topic:"Temporary discount codes", who:"Jess", how:"", check:true },
  { topic:"Packaged replacements", who:"Adam", how:"", check:true },
  { topic:"Customer service inbox", who:"Customer services team", how:"customerservices@the-body-doctor.com" },
  { topic:"Trade and wholesale", who:"Sales team", how:"sales@the-body-doctor.com" },
  { topic:"Side effects and serious incidents", who:"To confirm", how:"", check:true },
  { topic:"Amazon listings and stock", who:"To confirm", how:"", check:true },
  { topic:"Product specs and barcodes", who:"To confirm (production)", how:"", check:true },
  { topic:"Changes to this Product Library", who:"To confirm (content owner)", how:"", check:true },
  { topic:"Head office", who:"The Body Doctor Ltd", how:"+44 (0)1484 868 816 · Unit 1, Bridge Industrial Estate, Park Mill Way, Clayton West, Huddersfield HD8 9XJ" }
];

root.TBDStarter = { brands, channels, firstWeek, conditions, glossary, sayDo, sayDont, redFlags, howtos, contacts };
})(typeof window !== "undefined" ? window : globalThis);
