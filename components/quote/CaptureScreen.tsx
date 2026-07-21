"use client";

import { useRef } from "react";
import { Camera, ChevronRight, Loader2, MapPin, Search, WifiOff, Check } from "lucide-react";
import { Stepper, Field, GhostButton, PrimaryButton, SecondaryButton, ProductThumb } from "./ui";
import { lineTotal, money, type QuoteItem, type ScanErrorState } from "@/lib/quote-types";

export function CaptureScreen({
  area,
  sub,
  qty,
  disc,
  onQty,
  onDisc,
  busy,
  scanError,
  onOpenLocation,
  onCapture,
  onRetryScan,
  onDiscardScanError,
  onManualEntry,
  catalogLoaded,
  items,
}: {
  area: string;
  sub: string;
  qty: number;
  disc: number;
  onQty: (v: number) => void;
  onDisc: (v: number) => void;
  busy: boolean;
  scanError: ScanErrorState | null;
  onOpenLocation: () => void;
  onCapture: (file: File) => void;
  onRetryScan: () => void;
  onDiscardScanError: () => void;
  onManualEntry: () => void;
  catalogLoaded: boolean;
  items: QuoteItem[];
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  const areaItems = items.filter((it) => it.area === area && it.sub === sub);
  const areaTotal = areaItems.reduce((s, it) => s + (lineTotal(it) ?? 0), 0);
  const recent = items.slice(-3).reverse();

  return (
    <main className="flex flex-col gap-6 px-margin-mobile pt-6">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) onCapture(file);
        }}
      />

      {/* location — sticky, set once, every scan goes here. Deliberately
          loud when unset (bordered alert block, not a thin text row) —
          scanning with no area silently mis-groups the item, so this must
          be impossible to miss or forget. */}
      <button
        type="button"
        onClick={onOpenLocation}
        className={`tap group flex w-full items-center justify-between text-left ${
          area
            ? "border-b border-outline-variant py-3"
            : "rounded-md border-2 border-error bg-error-container px-4 py-3.5"
        }`}
      >
        <div className={`flex min-w-0 items-center gap-2.5 ${area ? "text-secondary" : "text-on-error-container"}`}>
          <MapPin className={`h-[18px] w-[18px] shrink-0 ${area ? "" : "animate-pulse"}`} />
          {area ? (
            <span className="truncate text-body-md text-secondary group-hover:text-primary">
              {area}
              {sub && <> &gt; {sub}</>}
            </span>
          ) : (
            <span className="truncate text-body-lg font-semibold text-on-error-container">
              Tap to set area first
            </span>
          )}
        </div>
        <ChevronRight className={`h-5 w-5 shrink-0 ${area ? "text-outline" : "text-on-error-container"}`} />
      </button>

      {!catalogLoaded && (
        <p className="-mt-3 text-body-md text-on-surface-variant">
          Loading the product catalogue — scanning and search will be ready in a moment.
        </p>
      )}

      {/* qty + discount defaults */}
      <div className="flex gap-4">
        <div className="flex-1">
          <Field label="Quantity">
            <Stepper value={qty} onChange={onQty} />
          </Field>
        </div>
        <div className="flex-1">
          <Field label="Discount %">
            <input
              type="number"
              inputMode="decimal"
              value={disc}
              min={0}
              max={100}
              onChange={(e) => onDisc(Math.min(100, Math.max(0, Number(e.target.value) || 0)))}
              className="tnum h-touch w-full rounded border border-outline-variant bg-surface-container-lowest px-3 text-right text-body-lg text-primary outline-none focus:border-[1.5px] focus:border-primary"
            />
          </Field>
        </div>
      </div>
      <p className="-mt-4 text-body-md text-on-surface-variant">
        These stay set for every scan. Change them only when the next item is different.
      </p>

      {/* scan action / processing / offline-retry */}
      {scanError ? (
        <div className="flex flex-col items-center gap-3 rounded-md border border-error-container bg-error-container/40 p-6 text-center">
          <WifiOff className="h-8 w-8 text-error" />
          <p className="text-body-md text-on-surface">{scanError.message}</p>
          <div className="flex w-full gap-2.5">
            <SecondaryButton onClick={onDiscardScanError}>Discard photo</SecondaryButton>
            <PrimaryButton onClick={onRetryScan}>Retry</PrimaryButton>
          </div>
        </div>
      ) : busy ? (
        <div className="flex h-[132px] w-full flex-col items-center justify-center gap-2 rounded bg-primary text-on-primary">
          <Loader2 className="h-7 w-7 animate-spin" />
          <span className="text-body-md">Reading the tag&hellip;</span>
        </div>
      ) : (
        <button
          type="button"
          disabled={!catalogLoaded}
          onClick={() => fileRef.current?.click()}
          className="tap flex h-[132px] w-full flex-col items-center justify-center gap-2 rounded bg-primary text-on-primary transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          <Camera className="h-8 w-8" />
          <span className="text-headline-sm font-medium">Scan price tag</span>
          <span className="text-body-md text-on-primary/60">Fill the frame with one tag</span>
        </button>
      )}

      {!scanError && !busy && (
        <GhostButton
          onClick={onManualEntry}
          disabled={!catalogLoaded}
          className="-mt-2 w-full justify-center underline decoration-outline-variant underline-offset-4"
        >
          <Search className="h-4 w-4" /> Enter code / search
        </GhostButton>
      )}

      {/* current location tally */}
      {area && (
        <div className="flex items-center justify-between rounded-md border border-outline-variant bg-surface-container-low p-4">
          <div>
            <p className="mb-1 text-label-caps font-semibold uppercase tracking-wider text-on-surface-variant">
              Current Location
            </p>
            <p className="text-headline-sm text-primary">
              {areaItems.length} item{areaItems.length === 1 ? "" : "s"}
            </p>
          </div>
          <div className="text-right">
            <p className="mb-1 text-label-caps font-semibold uppercase tracking-wider text-on-surface-variant">
              Subtotal
            </p>
            <p className="tnum text-price-display font-semibold text-primary">{money(areaTotal)}</p>
          </div>
        </div>
      )}

      {/* just added */}
      {recent.length > 0 && (
        <div className="flex flex-col gap-3 pb-8">
          <h2 className="text-label-caps font-semibold uppercase tracking-wider text-on-surface-variant">
            Just Added
          </h2>
          {recent.map((it) => (
            <div
              key={it.id}
              className="flex items-center gap-3 rounded border border-outline-variant bg-surface-container-lowest p-3"
            >
              <Check className="h-4 w-4 shrink-0 text-on-tertiary-container" />
              <ProductThumb src={it.images[0]} alt={it.sku || "Item"} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-body-md font-medium text-primary">
                  {it.sku || "(blank line)"}
                </p>
                <p className="text-label-caps text-on-surface-variant">
                  Qty: {it.qty}
                  {it.discount ? ` • -${it.discount}%` : ""}
                </p>
              </div>
              <span className="tnum shrink-0 text-price-sm text-primary">{money(lineTotal(it))}</span>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
