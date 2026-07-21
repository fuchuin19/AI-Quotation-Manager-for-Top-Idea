"use client";

import { useState } from "react";
import { AlertTriangle, Camera, Info, Plus, Search, Tag } from "lucide-react";
import { Sheet, PrimaryButton, SecondaryButton } from "./ui";
import { money, normSku, type NotFoundState, type Product } from "@/lib/quote-types";

export function NotFoundSheet({
  state,
  catalog,
  onClose,
  onPick,
  onBlank,
  onUseTagDetails,
}: {
  state: NotFoundState;
  catalog: Product[];
  onClose: () => void;
  onPick: (p: Product) => void;
  onBlank: () => void;
  onUseTagDetails: () => void;
}) {
  const [q, setQ] = useState(state.sku || "");
  const term = q.trim().toUpperCase();
  const results =
    term.length >= 2
      ? catalog
          .filter((p) => normSku(p.sku).includes(normSku(term)) || String(p.desc).toUpperCase().includes(term))
          .slice(0, 25)
      : [];

  // Only offer "use tag details" when a real price was actually read off
  // the tag — his showroom regularly has products that aren't in the price
  // list yet, and this is the escape for that, not a way to guess a price.
  const tagPrice = Number(state.guessPrice);
  const canUseTagDetails = !state.manual && state.guessPrice.trim() !== "" && Number.isFinite(tagPrice) && tagPrice > 0;

  return (
    <Sheet onClose={onClose}>
      <h2 className="mb-2 text-headline-sm text-on-surface">Item not recognized</h2>

      {!state.manual && (
        <p className="mb-4 flex items-start gap-2 text-body-md text-on-surface-variant">
          <Info className="mt-0.5 h-[18px] w-[18px] shrink-0" />
          {state.sku ? (
            <span>
              Read from the tag: <b className="tnum text-primary">{state.sku}</b>
              {state.guessName ? ` · ${state.guessName}` : ""}
              {state.guessPrice ? ` · guessed price RM${state.guessPrice}` : ""}
              — it isn&apos;t in the catalogue.{" "}
              {canUseTagDetails
                ? "Use the details from the tag below, search the catalogue, or add it manually."
                : "Search below or add it manually."}
            </span>
          ) : (
            <span>The tag couldn&apos;t be read automatically. Search the catalogue or add it manually.</span>
          )}
        </p>
      )}

      <div className="mb-6">
        <label className="mb-2 block text-label-caps font-semibold uppercase tracking-wider text-on-surface-variant">
          Type the code or product name
        </label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-outline" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="27222000 or basin mixer"
            className="h-touch w-full rounded border border-outline-variant bg-surface-container-lowest pl-10 pr-4 text-body-lg text-primary outline-none placeholder:text-outline focus:border-[1.5px] focus:border-primary"
          />
        </div>
      </div>

      <div className="mb-6 max-h-72 overflow-y-auto">
        {results.length > 0 && (
          <label className="mb-2 block text-label-caps font-semibold uppercase tracking-wider text-on-surface-variant">
            Suggestions
          </label>
        )}
        <div className="flex flex-col gap-2">
          {results.map((p) => (
            <button
              key={p.sku}
              type="button"
              onClick={() => onPick(p)}
              className="tap w-full rounded border border-outline-variant bg-surface-container-low p-3 text-left hover:border-primary"
            >
              <div className="flex justify-between gap-3">
                <div className="min-w-0">
                  <div className="tnum text-body-md font-medium text-primary">{p.sku}</div>
                  <div className="truncate text-label-caps text-on-surface-variant">{p.brand}</div>
                  <div className="line-clamp-2 text-body-md text-on-surface-variant">{p.desc}</div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="tnum text-price-sm font-medium text-primary">
                    {p.priceMissing ? "No price" : money(p.price)}
                  </div>
                </div>
              </div>
            </button>
          ))}
          {term.length >= 2 && results.length === 0 && (
            <p className="flex items-center gap-2 py-4 text-center text-body-md text-on-surface-variant">
              <AlertTriangle className="h-4 w-4 shrink-0" /> Nothing matches &ldquo;{q}&rdquo;.
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {canUseTagDetails && (
          <PrimaryButton onClick={onUseTagDetails}>
            <Tag className="h-[18px] w-[18px]" /> Use details from the tag
          </PrimaryButton>
        )}
        {canUseTagDetails ? (
          <SecondaryButton onClick={onBlank}>
            <Plus className="h-[18px] w-[18px]" /> Add blank line
          </SecondaryButton>
        ) : (
          <PrimaryButton onClick={onBlank}>
            <Plus className="h-[18px] w-[18px]" /> Add blank line
          </PrimaryButton>
        )}
        <SecondaryButton onClick={onClose}>
          <Camera className="h-[18px] w-[18px]" /> Retake photo
        </SecondaryButton>
      </div>
      <p className="mt-2.5 text-center text-body-md text-on-surface-variant">
        {canUseTagDetails
          ? "Using the tag also logs this SKU so it can be added to the price list."
          : "A blank line keeps the spot in the quotation so you can fill it in later."}
      </p>
    </Sheet>
  );
}
