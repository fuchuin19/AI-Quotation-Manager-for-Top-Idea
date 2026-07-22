"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Header } from "./Header";
import { BottomNav } from "./BottomNav";
import { CaptureScreen } from "./CaptureScreen";
import { ItemsScreen } from "./ItemsScreen";
import { SetupScreen } from "./SetupScreen";
import { ConfirmSheet } from "./ConfirmSheet";
import { NotFoundSheet } from "./NotFoundSheet";
import { LocationSheet } from "./LocationSheet";
import { HistorySheet } from "./HistorySheet";
import { ExportWarningSheet } from "./ExportWarningSheet";
import { LoginSheet } from "./LoginSheet";
import { AdminMenuSheet } from "./AdminMenuSheet";
import { MasterPasswordNoticeSheet } from "./MasterPasswordNoticeSheet";
import { Toast } from "./Toast";
import { loadJSON, saveJSON, saveQuotationsWithRetry, STORAGE_KEYS } from "@/lib/local-storage";
import {
  dedupeMissingSkus,
  fromStoredItem,
  lineTotal,
  newQuotationMeta,
  normSku,
  parseTagPrice,
  roundRM,
  sanitizeQuotations,
  toStoredItem,
  uid,
  type LastDeleted,
  type MissingSkuEntry,
  type NotFoundState,
  type PendingItem,
  type Product,
  type Quotation,
  type QuotationMeta,
  type QuoteItem,
  type ScanErrorState,
  type ScanResponse,
  type ScreenKey,
  type StoredItem,
  type ToastState,
  type ToastTone,
} from "@/lib/quote-types";

function extractFilename(header: string | null): string | null {
  if (!header) return null;
  const match = /filename="?([^";]+)"?/.exec(header);
  return match ? match[1] : null;
}

interface LocationState {
  area: string;
  sub: string;
}

export function QuoteApp() {
  const [ready, setReady] = useState(false);
  const [screen, setScreen] = useState<ScreenKey>("capture");

  const [catalog, setCatalog] = useState<Product[]>([]);
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [activeMeta, setActiveMeta] = useState<QuotationMeta>(() => newQuotationMeta([]));
  const [items, setItems] = useState<QuoteItem[]>([]);
  const [area, setArea] = useState("");
  const [sub, setSub] = useState("");
  const [locationLog, setLocationLog] = useState<{ area: string; sub: string }[]>([]);
  const [missingSkus, setMissingSkus] = useState<MissingSkuEntry[]>([]);

  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [pending, setPending] = useState<PendingItem | null>(null);
  const [notFound, setNotFound] = useState<NotFoundState | null>(null);
  const [scanError, setScanError] = useState<ScanErrorState | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [lastDeleted, setLastDeleted] = useState<LastDeleted | null>(null);
  const [lastDeletedMissingSku, setLastDeletedMissingSku] = useState<{ entry: MissingSkuEntry; index: number } | null>(null);
  const [areaSheet, setAreaSheet] = useState(false);

  const [customerExpanded, setCustomerExpanded] = useState(false);
  const [customerFocusToken, setCustomerFocusToken] = useState(0);
  const [exportWarningOpen, setExportWarningOpen] = useState(false);
  const [viewingHistoryId, setViewingHistoryId] = useState<string | null>(null);

  // Admin is a UI convenience only — every route that actually does
  // anything admin-only re-verifies the session cookie server-side. This
  // state just decides what buttons the UI shows.
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminUsername, setAdminUsername] = useState("");
  const [loginSheetOpen, setLoginSheetOpen] = useState(false);
  const [adminMenuOpen, setAdminMenuOpen] = useState(false);
  const [masterPasswordNoticeOpen, setMasterPasswordNoticeOpen] = useState(false);

  const [qty, setQty] = useState(1);
  const [disc, setDisc] = useState(0);

  const scanningRef = useRef(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Shared by the initial load, a periodic background poll, and the "catalogue
  // updated" callback from the admin tool — so an admin editing the catalogue
  // in one tab (or his dad's phone a minute later) picks up changes without a
  // hard refresh.
  const refreshCatalog = useCallback(async () => {
    try {
      const res = await fetch("/api/products", { cache: "no-store" });
      if (res.ok) {
        const fresh: Product[] = await res.json();
        setCatalog(fresh);
        saveJSON(STORAGE_KEYS.catalog, fresh);
      }
    } catch (err) {
      console.error("Failed to refresh the catalogue — using the cached copy if any.", err);
    }
  }, []);

  /* ---------- load ---------- */
  useEffect(() => {
    // Every value pulled from localStorage is validated for basic shape
    // (array where an array's expected, object where an object's expected)
    // before use, and the whole block is wraped in a try/catch as a
    // last-resort net — corrupted data, or data from some future version of
    // the app with a different shape, must never leave him on a permanent
    // blank screen. Worst case: start a fresh empty quotation rather than
    // crash. See sanitizeQuotations() for the deeper per-item validation.
    try {
      const isArray = (v: unknown) => Array.isArray(v);
      const isPlainObject = (v: unknown) => !!v && typeof v === "object" && !Array.isArray(v);

      const rawQuotations = loadJSON<unknown[]>(STORAGE_KEYS.quotations, [], isArray);
      const cachedQuotations = sanitizeQuotations(rawQuotations);
      const cachedActiveId = loadJSON<string>(STORAGE_KEYS.activeId, "", (v) => typeof v === "string");
      const cachedLocation = loadJSON<LocationState>(STORAGE_KEYS.location, { area: "", sub: "" }, isPlainObject);
      const rawLocationLog = loadJSON<unknown[]>(STORAGE_KEYS.locationLog, [], isArray);
      const cachedLocationLog = rawLocationLog.filter(
        (p): p is { area: string; sub: string } =>
          isPlainObject(p) && typeof (p as { area?: unknown }).area === "string" && typeof (p as { sub?: unknown }).sub === "string"
      );
      const cachedCatalog = loadJSON<Product[]>(STORAGE_KEYS.catalog, [], isArray);
      const rawMissingSkus = loadJSON<MissingSkuEntry[]>(STORAGE_KEYS.missingSkus, [], isArray);
      // Migration: entries logged before dedup-on-commit existed can carry
      // duplicate SKUs and lack a `count`, which crashed the list on a
      // duplicate React key — clean that up once, here, rather than on every
      // render.
      const cachedMissingSkus = dedupeMissingSkus(rawMissingSkus);
      saveJSON(STORAGE_KEYS.missingSkus, cachedMissingSkus);

      const found = cachedQuotations.find((q) => q.id === cachedActiveId);
      let meta: QuotationMeta;
      let storedItems: StoredItem[];
      if (found) {
        meta = {
          id: found.id,
          ref: found.ref,
          customer: found.customer,
          project: found.project,
          attn: found.attn,
          date: found.date,
          defaultDiscount: found.defaultDiscount,
          createdAt: found.createdAt,
          updatedAt: found.updatedAt,
        };
        storedItems = found.items;
      } else {
        // No active record yet (first run, or the previous draft never got an
        // item and so was never persisted) — silently start a fresh one rather
        // than asking "restore your session?".
        meta = newQuotationMeta(cachedQuotations);
        storedItems = [];
        saveJSON(STORAGE_KEYS.activeId, meta.id);
      }

      setQuotations(cachedQuotations);
      setActiveMeta(meta);
      setItems(storedItems.map((si) => fromStoredItem(si, cachedCatalog)));
      setDisc(meta.defaultDiscount || 0);
      setArea(cachedLocation.area || "");
      setSub(cachedLocation.sub || "");
      setLocationLog(cachedLocationLog);
      if (cachedCatalog.length) setCatalog(cachedCatalog);
      setMissingSkus(cachedMissingSkus);
    } catch (err) {
      console.error("Saved data was unreadable — starting a fresh quotation instead of crashing.", err);
      setQuotations([]);
      setActiveMeta(newQuotationMeta([]));
      setItems([]);
      setArea("");
      setSub("");
      setLocationLog([]);
      setMissingSkus([]);
    } finally {
      setReady(true);
    }

    refreshCatalog();

    // The session cookie is httpOnly, so this is the only way the UI can
    // know whether to show "Login as admin" or the "Admin" badge — the
    // actual gate on anything admin-only is still the cookie check each
    // route does server-side, not this.
    (async () => {
      try {
        const res = await fetch("/api/admin/me");
        if (res.ok) {
          const data = (await res.json()) as { loggedIn: boolean; username?: string };
          if (data.loggedIn) {
            setIsAdmin(true);
            setAdminUsername(data.username || "");
          }
        }
      } catch (err) {
        console.error("Failed to check admin session:", err);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refreshCatalog is a stable useCallback([]); this effect is deliberately mount-only, matching every other setter above it.
  }, []);

  // Picks up an admin catalogue update within a minute or two without
  // needing a hard refresh, even in a tab that's just been sitting open.
  useEffect(() => {
    if (!ready) return;
    const interval = setInterval(refreshCatalog, 90_000);
    return () => clearInterval(interval);
  }, [ready, refreshCatalog]);

  /* ---------- autosave ---------- */
  useEffect(() => {
    if (ready) saveJSON(STORAGE_KEYS.location, { area, sub });
  }, [area, sub, ready]);

  useEffect(() => {
    if (ready) saveJSON(STORAGE_KEYS.missingSkus, missingSkus);
  }, [missingSkus, ready]);

  const flash = useCallback((msg: string, tone: ToastTone = "ok") => {
    setToast({ msg, tone });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  /* ============================ admin ============================ */
  const handleLoggedIn = useCallback(
    ({ username, usedMasterPassword }: { username: string; usedMasterPassword: boolean }) => {
      setIsAdmin(true);
      setAdminUsername(username);
      setLoginSheetOpen(false);
      flash("Logged in as admin");
      if (usedMasterPassword) setMasterPasswordNoticeOpen(true);
    },
    [flash]
  );

  const handleLogout = useCallback(async () => {
    setAdminMenuOpen(false);
    try {
      await fetch("/api/admin/logout", { method: "POST" });
    } catch (err) {
      console.error("Logout request failed:", err);
    }
    setIsAdmin(false);
    setAdminUsername("");
    flash("Logged out", "warn");
  }, [flash]);

  // The server already logged the session out as part of a successful
  // credentials change — this just brings the client UI in line with that.
  const handleCredentialsChanged = useCallback(() => {
    setIsAdmin(false);
    setAdminUsername("");
    flash("Credentials updated — log in again with the new ones.", "warn");
  }, [flash]);

  // Remembers every area/sub ever set via the location sheet, independent of
  // whether an item ever got added under it — so the dropdown recalls it
  // immediately next time, not only once it's backed by a committed item.
  const recordLocation = useCallback((a: string, s: string) => {
    if (!a.trim()) return;
    setLocationLog((prev) => {
      const exists = prev.some(
        (p) => p.area.trim().toLowerCase() === a.trim().toLowerCase() && p.sub.trim().toLowerCase() === s.trim().toLowerCase()
      );
      if (exists) return prev;
      const next = [...prev, { area: a, sub: s }];
      saveJSON(STORAGE_KEYS.locationLog, next);
      return next;
    });
  }, []);

  // The active quotation is always saved — no separate archive step. It
  // joins `quotations` (becomes visible in History) the moment it has its
  // first item, and is upserted on every subsequent change to items or
  // customer/ref/date/discount.
  useEffect(() => {
    if (!ready) return;
    const storedItems = items.map(toStoredItem);
    setQuotations((prev) => {
      const idx = prev.findIndex((q) => q.id === activeMeta.id);
      let next: Quotation[];
      if (idx >= 0) {
        next = prev.map((q, i) => (i === idx ? { ...activeMeta, items: storedItems, updatedAt: new Date().toISOString() } : q));
      } else if (storedItems.length > 0) {
        next = [...prev, { ...activeMeta, items: storedItems, updatedAt: new Date().toISOString() }];
      } else {
        return prev;
      }
      return saveQuotationsWithRetry(next, (n) =>
        flash(`Storage was full — removed ${n} old quotation${n === 1 ? "" : "s"} to make room.`, "warn")
      );
    });
  }, [items, activeMeta, ready, flash]);

  /* ============================ scanning ============================ */
  const handleCapture = useCallback(
    async (file: File) => {
      if (scanningRef.current) return; // an impatient double-tap must not fire this twice
      if (!area) {
        setAreaSheet(true);
        flash("Set the area first", "warn");
        return;
      }
      // Check before spending a round-trip on it — scanning needs Gemini,
      // which needs a live connection, so fail fast and clearly rather than
      // waiting on a fetch that's going nowhere. This catches "phone thinks
      // it's offline"; the catch block below still covers "wifi bar full but
      // no real internet", which navigator.onLine can't see.
      if (!navigator.onLine) {
        setScanError({
          file,
          message: "You're offline — scanning needs a connection. The photo is saved, try again once you're back online.",
        });
        return;
      }
      scanningRef.current = true;
      setBusy(true);
      setScanError(null);
      try {
        const form = new FormData();
        form.append("image", file);
        const res = await fetch("/api/scan", { method: "POST", body: form });

        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          setScanError({
            file,
            message: body.error || "Could not read that tag. The photo is saved — try again.",
          });
          return;
        }

        const data = (await res.json()) as ScanResponse;
        if ("error" in data) {
          setScanError({ file, message: data.error });
          return;
        }

        if (data.found) {
          const p = data.product;
          const catalogPrice = p.price !== null ? roundRM(p.price) : null;
          // Showroom tags sometimes carry a promo price that differs from the
          // catalogue — that's what the customer is looking at, so it wins by
          // default. He can switch back to the catalogue price in the confirm
          // sheet. If Gemini didn't read a usable price off the tag, or the
          // catalogue has no price to compare it to, this falls back to
          // exactly today's behavior.
          const tagPrice = parseTagPrice(data.guessPrice);
          const hasBothPrices = tagPrice !== null && catalogPrice !== null;
          setPending({
            sku: p.sku,
            desc: p.desc,
            price: hasBothPrices ? tagPrice : catalogPrice,
            priceMissing: catalogPrice === null && tagPrice === null,
            qty: Number(qty) || 1,
            discount: Number(disc) || 0,
            netPriceOverride: null,
            images: p.images,
            dimensions: p.dimensions,
            descImages: p.descImages ?? [],
            descImageSizes: p.descImageSizes ?? [],
            // Catalogue has no price at all but a price WAS read off the tag:
            // prefill the manual-entry box with it (same pattern as "use tag
            // details" below) instead of leaving it blank — he still reviews
            // and confirms it, just doesn't have to retype it.
            enteredPrice: catalogPrice === null && tagPrice !== null ? String(tagPrice) : "",
            tagPrice: hasBothPrices ? tagPrice : null,
            catalogPrice: hasBothPrices ? catalogPrice : null,
            priceSource: hasBothPrices ? "tag" : undefined,
          });
        } else {
          setNotFound({ sku: data.rawSku, guessName: data.guessName, guessPrice: data.guessPrice });
        }
      } catch (err) {
        console.error("Scan request failed:", err);
        setScanError({ file, message: "No connection. The photo is saved — try again when you have signal." });
      } finally {
        setBusy(false);
        scanningRef.current = false;
      }
    },
    [area, qty, disc, flash]
  );

  const retryScan = useCallback(() => {
    if (scanError) handleCapture(scanError.file);
  }, [scanError, handleCapture]);

  /* ============================ add / edit ============================ */
  const commit = useCallback(
    (rec: Omit<QuoteItem, "id" | "area" | "sub">) => {
      const dupIdx = rec.sku
        ? items.findIndex((it) => normSku(it.sku) === normSku(rec.sku) && it.area === area && it.sub === sub)
        : -1;

      if (dupIdx >= 0) {
        const existing = items[dupIdx];
        const merge = window.confirm(
          `${rec.sku} is already in ${sub || area} (qty ${existing.qty}).\n\nOK = add ${rec.qty} to it.\nCancel = keep as a separate line.`
        );
        if (merge) {
          setItems((p) => p.map((it, i) => (i === dupIdx ? { ...it, qty: it.qty + rec.qty } : it)));
          setPending(null);
          setNotFound(null);
          flash(`${rec.sku} qty now ${existing.qty + rec.qty}`);
          return;
        }
      }

      setItems((p) => [...p, { id: uid(), area, sub, ...rec }]);
      setPending(null);
      setNotFound(null);
      flash(rec.sku ? `${rec.sku} added` : "Blank line added");
    },
    [items, area, sub, flash]
  );

  const commitPending = useCallback(() => {
    if (!pending) return;
    const finalPrice = pending.priceMissing ? roundRM(Number(pending.enteredPrice) || 0) : pending.price;
    if (pending.fromTag) {
      // A to-do log of showroom products that need adding to the source
      // price list — deduped by SKU: a repeat sighting refreshes the price
      // and date and bumps the counter instead of adding a new row.
      const key = normSku(pending.sku);
      setMissingSkus((prev) => {
        const entry: MissingSkuEntry = { sku: pending.sku, desc: pending.desc, price: finalPrice ?? 0, date: new Date().toISOString(), count: 1 };
        if (!key) return [...prev, entry];
        const idx = prev.findIndex((m) => normSku(m.sku) === key);
        if (idx < 0) return [...prev, entry];
        const next = [...prev];
        next[idx] = { ...next[idx], desc: pending.desc, price: finalPrice ?? 0, date: entry.date, count: next[idx].count + 1 };
        return next;
      });
    }
    commit({
      sku: pending.sku,
      desc: pending.desc,
      price: finalPrice,
      qty: pending.qty,
      discount: pending.discount,
      netPriceOverride: pending.netPriceOverride,
      images: pending.images,
      dimensions: pending.dimensions,
      descImages: pending.descImages,
      descImageSizes: pending.descImageSizes,
      // Marks the item as tag-priced whenever the ACTIVE price came from the
      // tag — either because the whole SKU isn't catalogued (pending.fromTag,
      // unchanged meaning) or because it is catalogued but he picked the tag
      // price over the catalogue one. Only the former ever logs to the
      // missing-SKU list (see the block above, which still checks
      // pending.fromTag alone) — a catalogue-matched item priced from a tag
      // is not "missing from the catalogue" and must not appear there.
      fromTag: pending.fromTag || pending.priceSource === "tag",
    });
  }, [pending, commit]);

  const commitBlank = useCallback(() => {
    commit({
      sku: notFound?.sku || "",
      desc: notFound?.guessName || "(not in library — fill in manually)",
      price: null,
      qty: Number(qty) || 1,
      discount: 0,
      netPriceOverride: null,
      images: [],
      dimensions: [],
    });
  }, [commit, notFound, qty]);

  // "Use details from the tag" — his showroom regularly has products that
  // aren't in the price list yet. Pre-fills the same price-entry UI used for
  // priceMissing catalogue matches, but with sku/desc editable too, since
  // none of it is authoritative yet.
  const useTagDetails = useCallback(() => {
    if (!notFound) return;
    setPending({
      sku: notFound.sku,
      desc: notFound.guessName,
      price: null,
      priceMissing: true,
      qty: Number(qty) || 1,
      discount: Number(disc) || 0,
      netPriceOverride: null,
      images: [],
      dimensions: [],
      enteredPrice: notFound.guessPrice,
      fromTag: true,
    });
    setNotFound(null);
  }, [notFound, qty, disc]);

  const pickFromSearch = useCallback(
    (p: Product) => {
      setPending({
        sku: p.sku,
        desc: p.desc,
        price: p.price !== null ? roundRM(p.price) : null,
        priceMissing: p.priceMissing,
        qty: Number(qty) || 1,
        discount: Number(disc) || 0,
        netPriceOverride: null,
        images: p.images,
        dimensions: p.dimensions,
        descImages: p.descImages ?? [],
        descImageSizes: p.descImageSizes ?? [],
        enteredPrice: "",
      });
      setNotFound(null);
    },
    [qty, disc]
  );

  const updateItem = useCallback((id: string, patch: Partial<QuoteItem>) => {
    setItems((p) => p.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }, []);

  const removeItem = useCallback(
    (id: string) => {
      const idx = items.findIndex((it) => it.id === id);
      if (idx < 0) return;
      setLastDeleted({ item: items[idx], index: idx });
      setLastDeletedMissingSku(null);
      setItems((p) => p.filter((it) => it.id !== id));
      flash("Removed", "warn");
    },
    [items, flash]
  );

  const undoDelete = useCallback(() => {
    if (!lastDeleted) return;
    setItems((p) => {
      const n = [...p];
      n.splice(lastDeleted.index, 0, lastDeleted.item);
      return n;
    });
    setLastDeleted(null);
    setToast(null);
  }, [lastDeleted]);

  // Same delete-with-undo pattern as quote items, applied to the missing-SKU
  // to-do log — a mis-scanned or already-added-to-the-spreadsheet row should
  // be just as easy to remove and just as safe to undo.
  const removeMissingSku = useCallback(
    (sku: string, date: string) => {
      const key = normSku(sku);
      const idx = missingSkus.findIndex((m) => (key ? normSku(m.sku) === key : m.date === date));
      if (idx < 0) return;
      setLastDeletedMissingSku({ entry: missingSkus[idx], index: idx });
      setLastDeleted(null);
      setMissingSkus((p) => p.filter((_, i) => i !== idx));
      flash("Removed from missing list", "warn");
    },
    [missingSkus, flash]
  );

  const undoMissingSkuDelete = useCallback(() => {
    if (!lastDeletedMissingSku) return;
    setMissingSkus((p) => {
      const n = [...p];
      n.splice(lastDeletedMissingSku.index, 0, lastDeletedMissingSku.entry);
      return n;
    });
    setLastDeletedMissingSku(null);
    setToast(null);
  }, [lastDeletedMissingSku]);

  const moveItem = useCallback((id: string, dir: 1 | -1) => {
    setItems((p) => {
      const i = p.findIndex((x) => x.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= p.length) return p;
      const n = [...p];
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });
  }, []);

  const clearAll = useCallback(() => {
    if (window.confirm("Clear all captured items? Customer details stay.")) {
      setItems([]);
      flash("Cleared", "warn");
    }
  }, [flash]);

  /* ============================ quotation switching ============================ */
  const startNewQuotation = useCallback(() => {
    const fresh = newQuotationMeta(quotations);
    setActiveMeta(fresh);
    setItems([]);
    setQty(1);
    setDisc(fresh.defaultDiscount);
    saveJSON(STORAGE_KEYS.activeId, fresh.id);
    setCustomerExpanded(false);
    setScreen("capture");
  }, [quotations]);

  const reopenQuotation = useCallback(
    (q: Quotation) => {
      setActiveMeta({
        id: q.id,
        ref: q.ref,
        customer: q.customer,
        project: q.project,
        attn: q.attn,
        date: q.date,
        defaultDiscount: q.defaultDiscount,
        createdAt: q.createdAt,
        updatedAt: q.updatedAt,
      });
      setItems(q.items.map((si) => fromStoredItem(si, catalog)));
      setQty(1);
      setDisc(q.defaultDiscount || 0);
      saveJSON(STORAGE_KEYS.activeId, q.id);
      setViewingHistoryId(null);
      setCustomerExpanded(false);
      setScreen("items");
    },
    [catalog]
  );

  const deleteQuotation = useCallback(
    (q: Quotation) => {
      if (!window.confirm(`Delete "${q.customer.trim() || "Untitled quotation"}"? This can't be undone.`)) return;
      setQuotations((prev) => {
        const next = prev.filter((x) => x.id !== q.id);
        return saveQuotationsWithRetry(next);
      });
      setViewingHistoryId(null);
      if (q.id === activeMeta.id) {
        startNewQuotation();
      } else {
        flash("Quotation deleted", "warn");
      }
    },
    [activeMeta.id, startNewQuotation, flash]
  );

  /* ============================ export ============================ */
  const runExport = useCallback(
    async (
      meta: { customer: string; project: string; attn: string; ref: string; date: string },
      exportItems: QuoteItem[]
    ) => {
      if (exportItems.length === 0) {
        flash("Nothing to export yet", "warn");
        return;
      }
      setExporting(true);
      try {
        const res = await fetch("/api/export", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session: meta, items: exportItems }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          flash(body.error || "Could not build the Excel file.", "err");
          return;
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const filename = extractFilename(res.headers.get("content-disposition")) || `${meta.ref || "quote"}.xlsx`;
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        flash("Excel downloaded");
      } catch (err) {
        console.error("Export failed:", err);
        flash("Could not reach the server. Check your connection and try again.", "err");
      } finally {
        setExporting(false);
      }
    },
    [flash]
  );

  const handleExportActive = useCallback(() => {
    runExport(
      { customer: activeMeta.customer, project: activeMeta.project, attn: activeMeta.attn, ref: activeMeta.ref, date: activeMeta.date },
      items
    );
  }, [runExport, activeMeta, items]);

  const handleExportClick = useCallback(() => {
    if (items.length === 0) {
      flash("Nothing to export yet", "warn");
      return;
    }
    if (!activeMeta.customer.trim()) {
      setExportWarningOpen(true);
      return;
    }
    handleExportActive();
  }, [items.length, activeMeta.customer, handleExportActive, flash]);

  const handleAddDetailsFromWarning = useCallback(() => {
    setExportWarningOpen(false);
    setCustomerExpanded(true);
    setCustomerFocusToken((t) => t + 1);
    setScreen("items");
  }, []);

  const handleExportHistoryItem = useCallback(
    (q: Quotation) => {
      if (q.id === activeMeta.id) {
        handleExportActive();
        return;
      }
      const rehydrated = q.items.map((si) => fromStoredItem(si, catalog));
      runExport({ customer: q.customer, project: q.project, attn: q.attn, ref: q.ref, date: q.date }, rehydrated);
    },
    [activeMeta.id, handleExportActive, runExport, catalog]
  );

  const grandTotal = items.reduce((s, it) => s + (lineTotal(it) ?? 0), 0);

  // Every area/sub ever set or used, across every quotation — not just the
  // current one, and not only ones with a committed item — so the location
  // picker's dropdown stays useful quotation after quotation instead of
  // starting empty each time.
  const locationHistory = useMemo(() => {
    const pairs: { area: string; sub: string }[] = [...locationLog];
    if (area) pairs.push({ area, sub });
    for (const q of quotations) {
      for (const it of q.items) pairs.push({ area: it.area, sub: it.sub });
    }
    for (const it of items) pairs.push({ area: it.area, sub: it.sub });
    return pairs;
  }, [locationLog, area, sub, quotations, items]);

  /* ============================ history list ============================ */
  // An empty draft (no items yet) hasn't "joined the list" and stays out of
  // History entirely — nothing to show for it yet, and it would just be
  // noise ahead of every real quotation.
  const historyList = [...quotations]
    .filter((q) => q.items.length > 0)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  const viewingHistory = viewingHistoryId ? historyList.find((q) => q.id === viewingHistoryId) ?? null : null;
  // The full sorted list stays available for lookups (reopen/export/delete
  // by id); only the Setup screen's display is capped to the 20 most recent.
  const displayedHistoryList = historyList.slice(0, 20);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-[44px]">
      <Header
        customer={activeMeta.customer}
        project={activeMeta.project}
        refNo={activeMeta.ref}
        date={activeMeta.date}
        total={grandTotal}
        onNewQuotation={startNewQuotation}
        isAdmin={isAdmin}
        onLoginClick={() => setLoginSheetOpen(true)}
        onAdminBadgeClick={() => setAdminMenuOpen(true)}
      />

      {screen === "capture" && (
        <CaptureScreen
          area={area}
          sub={sub}
          qty={qty}
          disc={disc}
          onQty={setQty}
          onDisc={setDisc}
          busy={busy}
          scanError={scanError}
          onOpenLocation={() => setAreaSheet(true)}
          onCapture={handleCapture}
          onRetryScan={retryScan}
          onDiscardScanError={() => setScanError(null)}
          onManualEntry={() => setNotFound({ sku: "", guessName: "", guessPrice: "", manual: true })}
          catalogLoaded={catalog.length > 0}
          items={items}
        />
      )}

      {screen === "items" && (
        <ItemsScreen
          items={items}
          grandTotal={grandTotal}
          exporting={exporting}
          onChangeItem={updateItem}
          onDeleteItem={removeItem}
          onMoveItem={moveItem}
          onExport={handleExportClick}
          onClearAll={clearAll}
          onGoTo={setScreen}
          customerMeta={activeMeta}
          onChangeCustomerMeta={(patch) => setActiveMeta((m) => ({ ...m, ...patch }))}
          customerExpanded={customerExpanded}
          onCustomerExpandedChange={setCustomerExpanded}
          customerFocusToken={customerFocusToken}
        />
      )}

      {screen === "setup" && (
        <SetupScreen
          catalogCount={catalog.length}
          missingSkus={missingSkus}
          onRemoveMissingSku={removeMissingSku}
          historyList={displayedHistoryList}
          activeId={activeMeta.id}
          onOpenHistory={(q) => setViewingHistoryId(q.id)}
          isAdmin={isAdmin}
          onCredentialsChanged={handleCredentialsChanged}
          onCatalogUpdated={refreshCatalog}
        />
      )}

      {pending && (
        <ConfirmSheet
          pending={pending}
          onChange={(patch) => setPending((p) => (p ? { ...p, ...patch } : p))}
          onClose={() => setPending(null)}
          onCommit={commitPending}
        />
      )}

      {notFound && (
        <NotFoundSheet
          state={notFound}
          catalog={catalog}
          onClose={() => setNotFound(null)}
          onPick={pickFromSearch}
          onBlank={commitBlank}
          onUseTagDetails={useTagDetails}
        />
      )}

      {areaSheet && (
        <LocationSheet
          area={area}
          sub={sub}
          locationHistory={locationHistory}
          onClose={() => setAreaSheet(false)}
          onSave={(a, s) => {
            setArea(a);
            setSub(s);
            recordLocation(a, s);
            setAreaSheet(false);
          }}
        />
      )}

      {exportWarningOpen && (
        <ExportWarningSheet
          onClose={() => setExportWarningOpen(false)}
          onAddDetails={handleAddDetailsFromWarning}
          onExportAnyway={() => {
            setExportWarningOpen(false);
            handleExportActive();
          }}
        />
      )}

      {viewingHistory && (
        <HistorySheet
          quotation={viewingHistory}
          isCurrent={viewingHistory.id === activeMeta.id}
          exporting={exporting}
          onClose={() => setViewingHistoryId(null)}
          onReopen={() => reopenQuotation(viewingHistory)}
          onExport={() => handleExportHistoryItem(viewingHistory)}
          onDelete={() => deleteQuotation(viewingHistory)}
        />
      )}

      {loginSheetOpen && <LoginSheet onClose={() => setLoginSheetOpen(false)} onLoggedIn={handleLoggedIn} />}

      {adminMenuOpen && (
        <AdminMenuSheet username={adminUsername} onClose={() => setAdminMenuOpen(false)} onLogout={handleLogout} />
      )}

      {masterPasswordNoticeOpen && (
        <MasterPasswordNoticeSheet onClose={() => setMasterPasswordNoticeOpen(false)} />
      )}

      {toast && (
        <Toast
          toast={toast}
          onUndo={
            toast.tone !== "warn"
              ? undefined
              : lastDeleted
              ? undoDelete
              : lastDeletedMissingSku
              ? undoMissingSkuDelete
              : undefined
          }
        />
      )}

      <BottomNav screen={screen} onChange={setScreen} itemCount={items.length} />
    </div>
  );
}
