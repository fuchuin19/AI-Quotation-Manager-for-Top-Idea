/* =============================================================================
   REFERENCE PROTOTYPE — READ THIS FIRST

   This file is a BEHAVIOUR SPEC, not code to copy.

   Take from it:  logic, state handling, interaction flow, edge-case handling
   Ignore:        the visual styling (superseded by the design export)
                  AND the four outdated implementations listed below

   ---------------------------------------------------------------------------
   OUTDATED — DO NOT COPY THESE. The real versions are already built.
   ---------------------------------------------------------------------------

   1. CATALOGUE LOADING
      This file has the user uploading a .xlsx in the Setup tab and parsing it
      with SheetJS in the browser.
      → WRONG NOW. Load the catalogue from /api/products (served from R2).
        Cache it in localStorage. Delete the upload UI entirely; replace it with
        a read-only line showing how many products are loaded.

   2. SCANNING
      This file calls api.anthropic.com directly from the browser.
      → WRONG NOW. POST the image as FormData to /api/scan. The API key must
        never reach the browser.

   3. EXCEL EXPORT
      This file builds the .xlsx client-side with SheetJS, which cannot embed
      images.
      → WRONG NOW. POST session + items to /api/export and download the
        response. Server-side ExcelJS embeds the real product images.

   4. STORAGE
      This file uses window.storage (an artifact-only API).
      → WRONG NOW. Use localStorage, keys qb:items and qb:session, every read
        wrapped in try/catch.

   ---------------------------------------------------------------------------
   MISSING — these did not exist when this was written, add them
   ---------------------------------------------------------------------------

   - Product images. The catalogue now returns images[] and dimensions[] URLs
     from R2. Show the product photo in the confirmation card and the item list.
     Handle a missing/blank image gracefully — some products genuinely have none.

   - priceMissing. 96 products in the catalogue have no price, 15 have none
     anywhere. When one is scanned, do NOT silently show RM0.00 — say clearly
     that the price is missing and let him type one in before adding.

   - brand field. Each product now carries the sheet it came from. Useful in
     search results to disambiguate similar items.

   - Blank line items should leave unit price and total EMPTY, not 0.00.
     RM0.00 looks like an error on a customer-facing quotation.

   ---------------------------------------------------------------------------
   KEEP ALL OF THIS — it is deliberate, do not simplify it away
   ---------------------------------------------------------------------------

   - Sticky area/sub-area, set once, every scan goes there
   - Quantity and discount persist between scans as defaults
   - Confirmation card before anything is added
   - Duplicate SKU in same sub-area offers to merge quantities
   - Not-found gives three escapes: type code, search, blank line
   - Inline edit of quantity and discount on any item
   - Delete with Undo
   - Move items up and down
   - Running totals for current location and whole quotation
   - Autosave on every change
============================================================================= */

import React, { useState, useEffect, useRef, useCallback } from "react";
import * as XLSX from "xlsx";
import {
  Camera, Check, X, Trash2, ChevronUp, ChevronDown, Plus, Search,
  FileSpreadsheet, Settings, Package, AlertTriangle, Loader2, MapPin,
  Edit3, Undo2, Database, ArrowLeft, ListChecks
} from "lucide-react";

/* ============================ storage helpers ============================ */
const store = {
  async get(k, fb) {
    try { const r = await window.storage.get(k); return r ? JSON.parse(r.value) : fb; }
    catch { return fb; }
  },
  async set(k, v) {
    try { await window.storage.set(k, JSON.stringify(v)); } catch (e) { console.error("save failed", e); }
  },
};

/* ============================ small utilities ============================ */
const money = (n) =>
  "RM" + (Number(n) || 0).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const ROMAN = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x", "xi", "xii"];

// SKUs differ by dashes (LS-5500-BN vs LS-5500TZ) so keep them, only kill spaces + case
const normSku = (s) => String(s || "").toUpperCase().replace(/\s+/g, "").trim();
const looseSku = (s) => normSku(s).replace(/[-_.]/g, "");

const lineTotal = (it) => (Number(it.price) || 0) * (Number(it.qty) || 0) * (1 - (Number(it.discount) || 0) / 100);

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

const todayRef = () => {
  const d = new Date();
  const yy = String(d.getFullYear()).slice(2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `PJAQ${yy}${mm}${dd}`;
};

const todayStr = () => {
  const d = new Date();
  const m = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${String(d.getDate()).padStart(2,"0")}-${m[d.getMonth()]}-${String(d.getFullYear()).slice(2)}`;
};

/* ============================ design tokens ============================ */
// Palette pulled from the GROHE tag itself: deep catalogue navy, paper white,
// blueprint grey, and a single amber for "needs your attention".
const C = {
  navy: "#12314F",
  navyDeep: "#0B2138",
  paper: "#F7F6F3",
  ink: "#101B24",
  rule: "#D8D5CE",
  slate: "#5C6B78",
  amber: "#B8791F",
  green: "#2F6B4F",
  red: "#9E3B2E",
};

/* ============================ app ============================ */
export default function QuoteBuilder() {
  const [ready, setReady] = useState(false);
  const [screen, setScreen] = useState("capture");

  const [catalog, setCatalog] = useState([]);          // [{sku, desc, price, dim}]
  const [items, setItems] = useState([]);              // captured lines
  const [session, setSession] = useState({
    customer: "", project: "", attn: "", ref: todayRef(), date: todayStr(),
    area: "", sub: "", defaultDiscount: 0,
  });

  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(null);        // confirm card
  const [notFound, setNotFound] = useState(null);      // {sku, photo, guessName}
  const [toast, setToast] = useState(null);
  const [lastDeleted, setLastDeleted] = useState(null);
  const [areaSheet, setAreaSheet] = useState(false);

  const [qty, setQty] = useState(1);
  const [disc, setDisc] = useState(0);

  /* ---------- load ---------- */
  useEffect(() => {
    (async () => {
      const [c, i, s] = await Promise.all([
        store.get("qb:catalog", []),
        store.get("qb:items", []),
        store.get("qb:session", null),
      ]);
      setCatalog(c || []);
      setItems(i || []);
      if (s) { setSession(s); setDisc(s.defaultDiscount || 0); }
      setReady(true);
    })();
  }, []);

  /* ---------- autosave ---------- */
  useEffect(() => { if (ready) store.set("qb:items", items); }, [items, ready]);
  useEffect(() => { if (ready) store.set("qb:session", session); }, [session, ready]);
  useEffect(() => { if (ready) store.set("qb:catalog", catalog); }, [catalog, ready]);

  const flash = useCallback((msg, tone = "ok") => {
    setToast({ msg, tone });
    setTimeout(() => setToast(null), 2600);
  }, []);

  /* ============================ catalog import ============================ */
  const importCatalog = async (file) => {
    setBusy(true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

      // find header row by looking for a cell containing "ITEM CODE"
      let hIdx = rows.findIndex((r) =>
        r.some((c) => String(c).toUpperCase().includes("ITEM CODE"))
      );
      if (hIdx < 0) hIdx = 0;
      const header = rows[hIdx].map((c) => String(c).toUpperCase().trim());

      const col = (...names) => {
        for (const n of names) {
          const i = header.findIndex((h) => h.includes(n));
          if (i >= 0) return i;
        }
        return -1;
      };
      const cSku = col("ITEM CODE", "SKU", "CODE");
      const cDesc = col("DESCRIPTION", "ITEM DESCRIPTIONS");
      const cPrice = col("LIST PRICE", "PRICE", "UNIT PRICE");
      const cDim = col("DIMENSION");

      const map = new Map();
      for (let r = hIdx + 1; r < rows.length; r++) {
        const row = rows[r];
        const sku = String(row[cSku] ?? "").trim();
        if (!sku) continue;
        const key = normSku(sku);
        const rec = {
          sku,
          desc: String(row[cDesc] ?? "").trim(),
          price: Number(String(row[cPrice] ?? "").replace(/[^0-9.]/g, "")) || 0,
          dim: cDim >= 0 ? String(row[cDim] ?? "").trim() : "",
          row: r + 1, // 1-based row in his library, useful for copying images
        };
        // dedupe: keep first, but prefer a row that actually has a price
        if (!map.has(key) || (!map.get(key).price && rec.price)) map.set(key, rec);
      }
      const list = [...map.values()];
      setCatalog(list);
      flash(`${list.length} products loaded`);
    } catch (e) {
      console.error(e);
      flash("Could not read that file. Use the .xlsx product library.", "err");
    }
    setBusy(false);
  };

  /* ============================ lookup ============================ */
  const findSku = useCallback((raw) => {
    const n = normSku(raw);
    let hit = catalog.find((p) => normSku(p.sku) === n);
    if (hit) return hit;
    const l = looseSku(raw);
    hit = catalog.find((p) => looseSku(p.sku) === l);
    return hit || null;
  }, [catalog]);

  /* ============================ photo -> sku ============================ */
  const onPhoto = async (file) => {
    if (!file) return;
    if (!session.area) { setAreaSheet(true); flash("Set the area first", "warn"); return; }
    setBusy(true);
    try {
      const b64 = await new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(String(fr.result).split(",")[1]);
        fr.onerror = () => rej(new Error("read fail"));
        fr.readAsDataURL(file);
      });

      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 1000,
          messages: [{
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: file.type || "image/jpeg", data: b64 } },
              { type: "text", text:
`This is a photo of a sanitaryware showroom price tag.

Read the PRODUCT CODE / SKU from the tag. It is usually the most prominent code line, above the product name. It may be all digits (e.g. 27222000) or alphanumeric with dashes (e.g. FFAS1M01-101500BF, LS-5500TZ).

If several tags are visible, use ONLY the tag that is largest and most centred in the frame. Ignore tags at the edges.

Respond with ONLY raw JSON, no markdown, no backticks:
{"sku":"<code exactly as printed, or empty string>","name":"<product name line, or empty>","price":"<printed price digits only, or empty>"}` }
            ]
          }]
        })
      });
      const data = await res.json();
      const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
      let parsed = { sku: "", name: "", price: "" };
      try { parsed = JSON.parse(text.replace(/```json|```/g, "").trim()); } catch { /* keep default */ }

      const match = parsed.sku ? findSku(parsed.sku) : null;
      if (match) {
        setPending({ ...match, qty: Number(qty) || 1, discount: Number(disc) || 0 });
      } else {
        setNotFound({ sku: parsed.sku || "", guessName: parsed.name || "" });
      }
    } catch (e) {
      console.error(e);
      setNotFound({ sku: "", guessName: "", error: true });
    }
    setBusy(false);
  };

  /* ============================ add / edit ============================ */
  const commit = (rec) => {
    const dupIdx = items.findIndex(
      (it) => normSku(it.sku) === normSku(rec.sku) && it.area === session.area && it.sub === session.sub
    );
    if (dupIdx >= 0) {
      const existing = items[dupIdx];
      const merge = window.confirm(
        `${rec.sku} is already in ${session.sub || session.area} (qty ${existing.qty}).\n\nOK = add ${rec.qty} to it.\nCancel = keep as a separate line.`
      );
      if (merge) {
        setItems((p) => p.map((it, i) => (i === dupIdx ? { ...it, qty: it.qty + rec.qty } : it)));
        setPending(null); setNotFound(null);
        flash(`${rec.sku} qty now ${existing.qty + rec.qty}`);
        return;
      }
    }
    setItems((p) => [...p, { id: uid(), area: session.area, sub: session.sub, ...rec }]);
    setPending(null); setNotFound(null);
    flash(`${rec.sku} added`);
  };

  const updateItem = (id, patch) => setItems((p) => p.map((it) => (it.id === id ? { ...it, ...patch } : it)));

  const removeItem = (id) => {
    const idx = items.findIndex((it) => it.id === id);
    if (idx < 0) return;
    setLastDeleted({ item: items[idx], idx });
    setItems((p) => p.filter((it) => it.id !== id));
    flash("Removed", "warn");
  };

  const undoDelete = () => {
    if (!lastDeleted) return;
    setItems((p) => { const n = [...p]; n.splice(lastDeleted.idx, 0, lastDeleted.item); return n; });
    setLastDeleted(null);
  };

  const moveItem = (id, dir) => {
    setItems((p) => {
      const i = p.findIndex((x) => x.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= p.length) return p;
      const n = [...p]; [n[i], n[j]] = [n[j], n[i]]; return n;
    });
  };

  /* ============================ grouping ============================ */
  const grouped = () => {
    const areas = [];
    for (const it of items) {
      let a = areas.find((x) => x.name === it.area);
      if (!a) { a = { name: it.area, subs: [] }; areas.push(a); }
      let s = a.subs.find((x) => x.name === it.sub);
      if (!s) { s = { name: it.sub, rows: [] }; a.subs.push(s); }
      s.rows.push(it);
    }
    return areas;
  };

  const grandTotal = items.reduce((s, it) => s + lineTotal(it), 0);
  const areaTotal = items
    .filter((it) => it.area === session.area && it.sub === session.sub)
    .reduce((s, it) => s + lineTotal(it), 0);
  const areaCount = items.filter((it) => it.area === session.area && it.sub === session.sub).length;

  /* ============================ export ============================ */
  const exportExcel = () => {
    if (!items.length) { flash("Nothing to export yet", "warn"); return; }
    const rows = [];
    const push = (r) => rows.push(r);

    push([`QUOTATION — ${session.customer || ""}`, "", "", "", "", "", "", ""]);
    push([`Project: ${session.project || ""}`, "", "", `Our Ref: ${session.ref}`, "", "", "", ""]);
    push([`Attn: ${session.attn || ""}`, "", "", `Date: ${session.date}`, "", "", "", ""]);
    push([]);
    push(["NO", "ITEM CODE", "IMAGE", "ITEM DESCRIPTIONS", "DIMENSION", "QTY", "UNIT PRICE", "TOTAL (RM)"]);

    grouped().forEach((area, ai) => {
      const aTotal = area.subs.flatMap((s) => s.rows).reduce((s, it) => s + lineTotal(it), 0);
      push([`${LETTERS[ai] || "?"}) ${String(area.name).toUpperCase()}`, "", "", `Subtotal: ${money(aTotal)}`, "", "", "", ""]);
      area.subs.forEach((sub, si) => {
        if (sub.name) push([`${ROMAN[si] || si + 1}) ${sub.name}`, "", "", "", "", "", "", ""]);
        sub.rows.forEach((it, ri) => {
          push([
            ri + 1,
            it.sku,
            it.libRow ? `library row ${it.libRow}` : "",
            it.desc + (it.discount ? `\n(less ${it.discount}%)` : ""),
            it.dim || "",
            it.qty,
            Number((Number(it.price) * (1 - (Number(it.discount) || 0) / 100)).toFixed(2)),
            Number(lineTotal(it).toFixed(2)),
          ]);
        });
      });
    });

    push([]);
    push(["", "", "", "", "", "", "TOTAL (RM):", Number(grandTotal.toFixed(2))]);

    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [{ wch: 6 }, { wch: 22 }, { wch: 16 }, { wch: 52 }, { wch: 18 }, { wch: 6 }, { wch: 14 }, { wch: 14 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Quotation");
    XLSX.writeFile(wb, `${session.ref}_${(session.customer || "quote").replace(/\s+/g, "_")}.xlsx`);
    flash("Excel downloaded");
  };

  /* ============================ render ============================ */
  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: C.paper }}>
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: C.navy }} />
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-28" style={{ background: C.paper, color: C.ink }}>
      <style>{`
        .tnum { font-variant-numeric: tabular-nums; }
        input, select, textarea { font-size: 16px; } /* stops iOS zoom-on-focus */
        .tap { -webkit-tap-highlight-color: transparent; }
      `}</style>

      {/* ---------- header ---------- */}
      <header className="sticky top-0 z-30" style={{ background: C.navyDeep }}>
        <div className="px-4 pt-3 pb-2 flex items-center justify-between">
          <div className="leading-tight">
            <div className="text-[10px] tracking-[0.2em] uppercase" style={{ color: "#7E9AB5" }}>Top Idea</div>
            <div className="text-white text-[15px] font-semibold">Quotation Builder</div>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider" style={{ color: "#7E9AB5" }}>Running total</div>
            <div className="text-white text-[17px] font-semibold tnum">{money(grandTotal)}</div>
          </div>
        </div>
        <nav className="flex border-t" style={{ borderColor: "#1E4266" }}>
          {[
            { k: "capture", label: "Capture", Icon: Camera },
            { k: "list", label: `Items (${items.length})`, Icon: ListChecks },
            { k: "setup", label: "Setup", Icon: Settings },
          ].map(({ k, label, Icon }) => (
            <button key={k} onClick={() => setScreen(k)}
              className="tap flex-1 py-2.5 text-[12px] font-medium flex items-center justify-center gap-1.5"
              style={{
                color: screen === k ? "#fff" : "#7E9AB5",
                borderBottom: screen === k ? "2px solid #fff" : "2px solid transparent",
              }}>
              <Icon className="w-3.5 h-3.5" />{label}
            </button>
          ))}
        </nav>
      </header>

      {/* ---------- catalog warning ---------- */}
      {catalog.length === 0 && (
        <div className="mx-4 mt-4 p-3 rounded flex gap-2.5 items-start" style={{ background: "#FBF1DF", border: `1px solid ${C.amber}` }}>
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" style={{ color: C.amber }} />
          <div className="text-[13px] leading-snug">
            <b>No product library loaded.</b> Open Setup and upload the products .xlsx before scanning.
          </div>
        </div>
      )}

      {/* ============================ CAPTURE ============================ */}
      {screen === "capture" && (
        <main className="px-4 pt-4">
          {/* sticky location */}
          <button onClick={() => setAreaSheet(true)}
            className="tap w-full text-left p-3.5 rounded mb-4 flex items-center justify-between"
            style={{ background: "#fff", border: `1px solid ${C.rule}` }}>
            <div className="flex items-center gap-2.5 min-w-0">
              <MapPin className="w-4 h-4 shrink-0" style={{ color: C.navy }} />
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-wider" style={{ color: C.slate }}>Adding to</div>
                <div className="font-semibold truncate text-[15px]">
                  {session.area || <span style={{ color: C.red }}>Tap to set area</span>}
                  {session.sub && <span style={{ color: C.slate }}> › {session.sub}</span>}
                </div>
              </div>
            </div>
            <Edit3 className="w-4 h-4 shrink-0" style={{ color: C.slate }} />
          </button>

          {/* qty + discount defaults */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            <Field label="Quantity">
              <div className="flex items-center">
                <Stepper onClick={() => setQty((q) => Math.max(1, q - 1))}>−</Stepper>
                <input type="number" inputMode="numeric" value={qty} min={1}
                  onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
                  className="flex-1 text-center py-2.5 font-semibold tnum outline-none"
                  style={{ background: "#fff" }} />
                <Stepper onClick={() => setQty((q) => q + 1)}>+</Stepper>
              </div>
            </Field>
            <Field label="Discount %">
              <input type="number" inputMode="decimal" value={disc} min={0} max={100}
                onChange={(e) => setDisc(Math.min(100, Math.max(0, Number(e.target.value) || 0)))}
                className="w-full text-center py-2.5 font-semibold tnum outline-none"
                style={{ background: "#fff" }} />
            </Field>
          </div>
          <p className="text-[12px] -mt-2 mb-5" style={{ color: C.slate }}>
            These stay set for every scan. Change them only when the next item is different.
          </p>

          {/* capture */}
          <CameraButton busy={busy} onFile={onPhoto} disabled={catalog.length === 0} />

          <div className="flex gap-2 mt-3">
            <SecondaryBtn onClick={() => setNotFound({ sku: "", guessName: "", manual: true })}>
              <Search className="w-4 h-4" /> Enter code / search
            </SecondaryBtn>
          </div>

          {/* current area tally */}
          {session.area && (
            <div className="mt-6 p-3.5 rounded flex items-center justify-between"
              style={{ background: "#fff", border: `1px solid ${C.rule}` }}>
              <div className="text-[13px]" style={{ color: C.slate }}>
                In this location
              </div>
              <div className="text-right">
                <div className="font-semibold tnum">{areaCount} item{areaCount === 1 ? "" : "s"}</div>
                <div className="text-[13px] tnum" style={{ color: C.slate }}>{money(areaTotal)}</div>
              </div>
            </div>
          )}

          {/* recent */}
          {items.length > 0 && (
            <div className="mt-6">
              <div className="text-[10px] uppercase tracking-[0.15em] mb-2" style={{ color: C.slate }}>Just added</div>
              {items.slice(-3).reverse().map((it) => (
                <div key={it.id} className="p-3 mb-2 rounded flex gap-3 items-start"
                  style={{ background: "#fff", border: `1px solid ${C.rule}` }}>
                  <Check className="w-4 h-4 mt-0.5 shrink-0" style={{ color: C.green }} />
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-[13px] tnum">{it.sku}</div>
                    <div className="text-[12px] truncate" style={{ color: C.slate }}>
                      {String(it.desc).split("\n")[0]}
                    </div>
                  </div>
                  <div className="text-right text-[13px] tnum shrink-0">
                    <div>×{it.qty}</div>
                    <div style={{ color: C.slate }}>{money(lineTotal(it))}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>
      )}

      {/* ============================ LIST ============================ */}
      {screen === "list" && (
        <main className="px-4 pt-4">
          {items.length === 0 ? (
            <Empty
              icon={Package}
              title="No items yet"
              body="Scan a price tag on the Capture tab and the item lands here."
              action={<PrimaryBtn onClick={() => setScreen("capture")}>Go to Capture</PrimaryBtn>}
            />
          ) : (
            <>
              {grouped().map((area, ai) => {
                const aTotal = area.subs.flatMap((s) => s.rows).reduce((s, it) => s + lineTotal(it), 0);
                return (
                  <section key={ai} className="mb-6">
                    <div className="flex items-baseline justify-between px-1 pb-1.5 mb-2"
                      style={{ borderBottom: `2px solid ${C.navy}` }}>
                      <h3 className="font-semibold text-[14px] uppercase tracking-wide">
                        <span style={{ color: C.slate }}>{LETTERS[ai]})</span> {area.name}
                      </h3>
                      <span className="text-[13px] font-semibold tnum">{money(aTotal)}</span>
                    </div>
                    {area.subs.map((sub, si) => (
                      <div key={si} className="mb-3">
                        {sub.name && (
                          <div className="text-[12px] italic mb-1.5 px-1" style={{ color: C.slate }}>
                            {ROMAN[si] || si + 1}) {sub.name}
                          </div>
                        )}
                        {sub.rows.map((it) => (
                          <ItemRow key={it.id} it={it}
                            onChange={(p) => updateItem(it.id, p)}
                            onDelete={() => removeItem(it.id)}
                            onUp={() => moveItem(it.id, -1)}
                            onDown={() => moveItem(it.id, 1)} />
                        ))}
                      </div>
                    ))}
                  </section>
                );
              })}

              <div className="flex items-center justify-between p-4 rounded mb-4"
                style={{ background: C.navyDeep }}>
                <span className="text-white text-[13px] uppercase tracking-wider">Total</span>
                <span className="text-white text-xl font-semibold tnum">{money(grandTotal)}</span>
              </div>

              <PrimaryBtn onClick={exportExcel}>
                <FileSpreadsheet className="w-4 h-4" /> Download Excel
              </PrimaryBtn>

              <button
                onClick={() => {
                  if (window.confirm("Clear all captured items? The product library and customer details stay.")) {
                    setItems([]); flash("Cleared", "warn");
                  }
                }}
                className="tap w-full mt-3 py-3 text-[13px]" style={{ color: C.red }}>
                Clear all items
              </button>
            </>
          )}
        </main>
      )}

      {/* ============================ SETUP ============================ */}
      {screen === "setup" && (
        <main className="px-4 pt-4 space-y-5">
          <Card title="Product library">
            <div className="flex items-center gap-2.5 mb-3">
              <Database className="w-4 h-4" style={{ color: catalog.length ? C.green : C.slate }} />
              <span className="text-[13px]">
                {catalog.length ? <><b>{catalog.length}</b> unique products loaded</> : "Not loaded yet"}
              </span>
            </div>
            <label className="tap block w-full text-center py-3 rounded cursor-pointer text-[14px] font-medium"
              style={{ background: C.navy, color: "#fff" }}>
              {catalog.length ? "Replace library" : "Upload products .xlsx"}
              <input type="file" accept=".xlsx,.xls" className="hidden"
                onChange={(e) => e.target.files?.[0] && importCatalog(e.target.files[0])} />
            </label>
            <p className="text-[12px] mt-2.5 leading-snug" style={{ color: C.slate }}>
              Reads ITEM CODE, ITEM DESCRIPTIONS and LIST PRICE. Repeated codes are collapsed to one entry.
            </p>
          </Card>

          <Card title="Customer details">
            <TextField label="Customer" value={session.customer}
              onChange={(v) => setSession((s) => ({ ...s, customer: v }))} placeholder="PEI WEE" />
            <TextField label="Project" value={session.project}
              onChange={(v) => setSession((s) => ({ ...s, project: v }))} placeholder="NUSA VALLEY" />
            <TextField label="Attn" value={session.attn}
              onChange={(v) => setSession((s) => ({ ...s, attn: v }))} placeholder="JABLANC - MS KUAY" />
            <div className="grid grid-cols-2 gap-3">
              <TextField label="Our Ref" value={session.ref}
                onChange={(v) => setSession((s) => ({ ...s, ref: v }))} />
              <TextField label="Date" value={session.date}
                onChange={(v) => setSession((s) => ({ ...s, date: v }))} />
            </div>
          </Card>

          <Card title="Default discount">
            <div className="flex items-center gap-3">
              <input type="number" inputMode="decimal" value={session.defaultDiscount} min={0} max={100}
                onChange={(e) => {
                  const v = Math.min(100, Math.max(0, Number(e.target.value) || 0));
                  setSession((s) => ({ ...s, defaultDiscount: v })); setDisc(v);
                }}
                className="w-24 text-center py-2.5 font-semibold tnum outline-none rounded"
                style={{ background: "#fff", border: `1px solid ${C.rule}` }} />
              <span className="text-[13px]" style={{ color: C.slate }}>
                % — applied to every new scan until you change it
              </span>
            </div>
          </Card>
        </main>
      )}

      {/* ============================ confirm sheet ============================ */}
      {pending && (
        <Sheet onClose={() => setPending(null)}>
          <div className="flex items-center gap-2 mb-3">
            <Check className="w-4 h-4" style={{ color: C.green }} />
            <span className="text-[11px] uppercase tracking-[0.15em]" style={{ color: C.green }}>Found in library</span>
          </div>
          <div className="text-[19px] font-semibold tnum mb-1">{pending.sku}</div>
          <div className="text-[13px] whitespace-pre-line mb-4" style={{ color: C.slate }}>{pending.desc}</div>

          <div className="grid grid-cols-2 gap-3 mb-4">
            <Field label="Quantity">
              <div className="flex items-center">
                <Stepper onClick={() => setPending((p) => ({ ...p, qty: Math.max(1, p.qty - 1) }))}>−</Stepper>
                <input type="number" inputMode="numeric" value={pending.qty}
                  onChange={(e) => setPending((p) => ({ ...p, qty: Math.max(1, Number(e.target.value) || 1) }))}
                  className="flex-1 text-center py-2.5 font-semibold tnum outline-none" style={{ background: "#fff" }} />
                <Stepper onClick={() => setPending((p) => ({ ...p, qty: p.qty + 1 }))}>+</Stepper>
              </div>
            </Field>
            <Field label="Discount %">
              <input type="number" inputMode="decimal" value={pending.discount}
                onChange={(e) => setPending((p) => ({ ...p, discount: Math.min(100, Math.max(0, Number(e.target.value) || 0)) }))}
                className="w-full text-center py-2.5 font-semibold tnum outline-none" style={{ background: "#fff" }} />
            </Field>
          </div>

          <div className="p-3 rounded mb-4 tnum text-[13px]" style={{ background: C.paper }}>
            <Row l="Unit price" r={money(pending.price)} />
            {pending.discount > 0 && (
              <>
                <Row l={`Less ${pending.discount}%`} r={"−" + money(pending.price * pending.discount / 100)} />
                <Row l="Net unit" r={money(pending.price * (1 - pending.discount / 100))} />
              </>
            )}
            <div className="mt-2 pt-2 flex justify-between font-semibold text-[15px]" style={{ borderTop: `1px solid ${C.rule}` }}>
              <span>Line total ×{pending.qty}</span>
              <span>{money(lineTotal(pending))}</span>
            </div>
          </div>

          <div className="flex gap-2.5">
            <SecondaryBtn onClick={() => setPending(null)}>Discard</SecondaryBtn>
            <PrimaryBtn onClick={() => commit(pending)}>Add to quotation</PrimaryBtn>
          </div>
        </Sheet>
      )}

      {/* ============================ not-found sheet ============================ */}
      {notFound && (
        <NotFoundSheet
          state={notFound}
          catalog={catalog}
          qty={qty} disc={disc}
          onClose={() => setNotFound(null)}
          onPick={(p) => setPending({ ...p, qty: Number(qty) || 1, discount: Number(disc) || 0 })}
          onBlank={() => commit({ sku: notFound.sku || "—", desc: notFound.guessName || "(not in library — fill in manually)", price: 0, dim: "", qty: Number(qty) || 1, discount: 0 })}
        />
      )}

      {/* ============================ area sheet ============================ */}
      {areaSheet && (
        <AreaSheet
          session={session} items={items}
          onClose={() => setAreaSheet(false)}
          onSave={(area, sub) => { setSession((s) => ({ ...s, area, sub })); setAreaSheet(false); }}
        />
      )}

      {/* ---------- toast ---------- */}
      {toast && (
        <div className="fixed left-4 right-4 bottom-6 z-50 px-4 py-3 rounded flex items-center justify-between shadow-lg"
          style={{ background: toast.tone === "err" ? C.red : toast.tone === "warn" ? C.amber : C.navyDeep, color: "#fff" }}>
          <span className="text-[13px]">{toast.msg}</span>
          {lastDeleted && toast.tone === "warn" && (
            <button onClick={undoDelete} className="tap text-[13px] font-semibold flex items-center gap-1 underline">
              <Undo2 className="w-3.5 h-3.5" /> Undo
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ============================ sub-components ============================ */

function Row({ l, r }) {
  return <div className="flex justify-between py-0.5"><span style={{ color: C.slate }}>{l}</span><span>{r}</span></div>;
}

function Field({ label, children }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: C.slate }}>{label}</div>
      <div className="rounded overflow-hidden" style={{ border: `1px solid ${C.rule}` }}>{children}</div>
    </div>
  );
}

function TextField({ label, value, onChange, placeholder }) {
  return (
    <div className="mb-3">
      <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: C.slate }}>{label}</div>
      <input value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2.5 rounded outline-none text-[14px]"
        style={{ background: "#fff", border: `1px solid ${C.rule}` }} />
    </div>
  );
}

function Stepper({ children, onClick }) {
  return (
    <button onClick={onClick} className="tap w-11 py-2.5 text-lg font-semibold shrink-0"
      style={{ background: C.paper, color: C.navy }}>{children}</button>
  );
}

function PrimaryBtn({ children, onClick, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className="tap flex-1 py-3.5 rounded font-semibold text-[14px] flex items-center justify-center gap-2 disabled:opacity-40"
      style={{ background: C.navy, color: "#fff" }}>{children}</button>
  );
}

function SecondaryBtn({ children, onClick }) {
  return (
    <button onClick={onClick}
      className="tap flex-1 py-3.5 rounded font-semibold text-[14px] flex items-center justify-center gap-2"
      style={{ background: "#fff", color: C.navy, border: `1px solid ${C.rule}` }}>{children}</button>
  );
}

function Card({ title, children }) {
  return (
    <section className="p-4 rounded" style={{ background: "#fff", border: `1px solid ${C.rule}` }}>
      <h3 className="text-[11px] uppercase tracking-[0.15em] mb-3" style={{ color: C.slate }}>{title}</h3>
      {children}
    </section>
  );
}

function Empty({ icon: Icon, title, body, action }) {
  return (
    <div className="text-center py-16 px-6">
      <Icon className="w-8 h-8 mx-auto mb-3" style={{ color: C.rule }} />
      <div className="font-semibold mb-1">{title}</div>
      <p className="text-[13px] mb-5" style={{ color: C.slate }}>{body}</p>
      <div className="flex justify-center"><div className="w-48 flex">{action}</div></div>
    </div>
  );
}

function CameraButton({ busy, onFile, disabled }) {
  const ref = useRef(null);
  return (
    <>
      <input ref={ref} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; onFile(f); }} />
      <button onClick={() => ref.current?.click()} disabled={busy || disabled}
        className="tap w-full rounded flex flex-col items-center justify-center gap-2 disabled:opacity-40"
        style={{ background: C.navy, color: "#fff", height: 132 }}>
        {busy ? <>
          <Loader2 className="w-7 h-7 animate-spin" />
          <span className="text-[13px]">Reading the tag…</span>
        </> : <>
          <Camera className="w-8 h-8" />
          <span className="text-[15px] font-semibold">Scan price tag</span>
          <span className="text-[11px]" style={{ color: "#9DB6CC" }}>Fill the frame with one tag</span>
        </>}
      </button>
    </>
  );
}

function Sheet({ children, onClose }) {
  return (
    <div className="fixed inset-0 z-40 flex items-end" style={{ background: "rgba(16,27,36,0.5)" }} onClick={onClose}>
      <div className="w-full rounded-t-2xl p-5 max-h-[92vh] overflow-y-auto"
        style={{ background: "#fff" }} onClick={(e) => e.stopPropagation()}>
        <div className="w-10 h-1 rounded-full mx-auto mb-4" style={{ background: C.rule }} />
        {children}
      </div>
    </div>
  );
}

function ItemRow({ it, onChange, onDelete, onUp, onDown }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-2 rounded overflow-hidden" style={{ background: "#fff", border: `1px solid ${C.rule}` }}>
      <button onClick={() => setOpen(!open)} className="tap w-full p-3 flex gap-3 items-start text-left">
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-[13px] tnum">{it.sku}</div>
          <div className="text-[12px] leading-snug" style={{ color: C.slate }}>
            {String(it.desc).split("\n").slice(0, 2).join(" · ")}
          </div>
        </div>
        <div className="text-right shrink-0 tnum">
          <div className="text-[13px] font-semibold">{money(lineTotal(it))}</div>
          <div className="text-[11px]" style={{ color: C.slate }}>
            ×{it.qty}{it.discount ? ` · −${it.discount}%` : ""}
          </div>
        </div>
      </button>

      {open && (
        <div className="px-3 pb-3 pt-1" style={{ borderTop: `1px solid ${C.rule}` }}>
          <div className="grid grid-cols-2 gap-3 my-3">
            <Field label="Quantity">
              <input type="number" inputMode="numeric" value={it.qty}
                onChange={(e) => onChange({ qty: Math.max(1, Number(e.target.value) || 1) })}
                className="w-full text-center py-2 font-semibold tnum outline-none" style={{ background: "#fff" }} />
            </Field>
            <Field label="Discount %">
              <input type="number" inputMode="decimal" value={it.discount}
                onChange={(e) => onChange({ discount: Math.min(100, Math.max(0, Number(e.target.value) || 0)) })}
                className="w-full text-center py-2 font-semibold tnum outline-none" style={{ background: "#fff" }} />
            </Field>
          </div>
          <div className="flex gap-2">
            <IconBtn onClick={onUp}><ChevronUp className="w-4 h-4" /></IconBtn>
            <IconBtn onClick={onDown}><ChevronDown className="w-4 h-4" /></IconBtn>
            <button onClick={onDelete}
              className="tap flex-1 py-2 rounded text-[13px] font-medium flex items-center justify-center gap-1.5"
              style={{ background: "#FBEEEC", color: C.red }}>
              <Trash2 className="w-3.5 h-3.5" /> Remove
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function IconBtn({ children, onClick }) {
  return (
    <button onClick={onClick} className="tap w-11 py-2 rounded flex items-center justify-center"
      style={{ background: C.paper, color: C.navy, border: `1px solid ${C.rule}` }}>{children}</button>
  );
}

function NotFoundSheet({ state, catalog, onClose, onPick, onBlank }) {
  const [q, setQ] = useState(state.sku || "");
  const term = q.trim().toUpperCase();
  const results = term.length >= 2
    ? catalog.filter((p) =>
        normSku(p.sku).includes(normSku(term)) || String(p.desc).toUpperCase().includes(term)
      ).slice(0, 25)
    : [];

  return (
    <Sheet onClose={onClose}>
      {!state.manual && (
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle className="w-4 h-4" style={{ color: C.amber }} />
          <span className="text-[11px] uppercase tracking-[0.15em]" style={{ color: C.amber }}>
            {state.error ? "Could not read the tag" : "Not in library"}
          </span>
        </div>
      )}
      {state.sku && (
        <p className="text-[13px] mb-3" style={{ color: C.slate }}>
          Read from the tag: <b className="tnum" style={{ color: C.ink }}>{state.sku}</b>
          {state.guessName ? ` · ${state.guessName}` : ""}
        </p>
      )}

      <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: C.slate }}>Type the code or product name</div>
      <input autoFocus value={q} onChange={(e) => setQ(e.target.value)}
        placeholder="27222000 or basin mixer"
        className="w-full px-3 py-2.5 rounded outline-none text-[15px] mb-3"
        style={{ background: "#fff", border: `1px solid ${C.rule}` }} />

      <div className="max-h-72 overflow-y-auto -mx-1 px-1">
        {results.map((p) => (
          <button key={p.sku} onClick={() => { onPick(p); onClose(); }}
            className="tap w-full text-left p-3 mb-2 rounded"
            style={{ background: C.paper, border: `1px solid ${C.rule}` }}>
            <div className="flex justify-between gap-3">
              <div className="min-w-0">
                <div className="font-semibold text-[13px] tnum">{p.sku}</div>
                <div className="text-[12px] leading-snug" style={{ color: C.slate }}>
                  {String(p.desc).split("\n").slice(0, 2).join(" · ")}
                </div>
              </div>
              <div className="text-[13px] font-semibold tnum shrink-0">{money(p.price)}</div>
            </div>
          </button>
        ))}
        {term.length >= 2 && results.length === 0 && (
          <p className="text-[13px] py-4 text-center" style={{ color: C.slate }}>
            Nothing matches “{q}”.
          </p>
        )}
      </div>

      <div className="flex gap-2.5 mt-4">
        <SecondaryBtn onClick={onClose}>Retake photo</SecondaryBtn>
        <PrimaryBtn onClick={onBlank}>
          <Plus className="w-4 h-4" /> Add blank line
        </PrimaryBtn>
      </div>
      <p className="text-[12px] mt-2.5 text-center" style={{ color: C.slate }}>
        A blank line keeps the spot in the quotation so you can fill it in later.
      </p>
    </Sheet>
  );
}

function AreaSheet({ session, items, onClose, onSave }) {
  const [area, setArea] = useState(session.area);
  const [sub, setSub] = useState(session.sub);

  const areas = [...new Set(items.map((i) => i.area).filter(Boolean))];
  const subs = [...new Set(items.filter((i) => i.area === area).map((i) => i.sub).filter(Boolean))];

  return (
    <Sheet onClose={onClose}>
      <h3 className="font-semibold text-[16px] mb-1">Where are you now?</h3>
      <p className="text-[13px] mb-4" style={{ color: C.slate }}>
        Everything you scan goes here until you change it.
      </p>

      <TextField label="Area" value={area} onChange={setArea} placeholder="Master Bath" />
      {areas.length > 0 && (
        <Chips items={areas} onPick={setArea} />
      )}

      <TextField label="Sub-area (optional)" value={sub} onChange={setSub} placeholder="Water Closet Area" />
      {subs.length > 0 && (
        <Chips items={subs} onPick={setSub} />
      )}

      <div className="flex gap-2.5 mt-4">
        <SecondaryBtn onClick={onClose}>Cancel</SecondaryBtn>
        <PrimaryBtn onClick={() => onSave(area.trim(), sub.trim())} disabled={!area.trim()}>
          Set location
        </PrimaryBtn>
      </div>
    </Sheet>
  );
}

function Chips({ items, onPick }) {
  return (
    <div className="flex flex-wrap gap-1.5 -mt-1 mb-3">
      {items.map((a) => (
        <button key={a} onClick={() => onPick(a)}
          className="tap px-2.5 py-1 rounded text-[12px]"
          style={{ background: C.paper, border: `1px solid ${C.rule}`, color: C.slate }}>
          {a}
        </button>
      ))}
    </div>
  );
}
