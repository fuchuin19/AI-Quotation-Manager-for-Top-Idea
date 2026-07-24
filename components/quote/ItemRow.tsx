"use client";

import { useState } from "react";
import { ChevronUp, ChevronDown, PencilLine, Tag, Trash2 } from "lucide-react";
import { Field, IconButton, ProductThumb } from "./ui";
import { impliedDiscount, lineTotal, money, netUnitPrice, roundRM, type QuoteItem } from "@/lib/quote-types";

export function ItemRow({
  it,
  onChange,
  onDelete,
  onUp,
  onDown,
}: {
  it: QuoteItem;
  onChange: (patch: Partial<QuoteItem>) => void;
  onDelete: () => void;
  onUp: () => void;
  onDown: () => void;
}) {
  const [open, setOpen] = useState(false);
  const priceAdjusted = it.netPriceOverride !== null;
  const currentNet = netUnitPrice(it.price, it.discount, it.netPriceOverride);

  // Same rule as the confirmation sheet: editing discount % derives net and
  // drops any earlier override; editing net price directly is the override
  // and just updates the displayed discount % to match, never the reverse.
  function handleDiscountChange(raw: string) {
    const v = Math.min(100, Math.max(0, Number(raw) || 0));
    onChange({ discount: v, netPriceOverride: null });
  }

  function handleNetPriceChange(raw: string) {
    if (it.price === null) return;
    const n = Number(raw) || 0;
    onChange({ netPriceOverride: n, discount: it.price > 0 ? impliedDiscount(it.price, n) : 0 });
  }

  return (
    <div className="mb-2 overflow-hidden rounded-md border border-outline-variant bg-surface-container-lowest">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="tap flex w-full items-start gap-3 p-3 text-left"
      >
        <ProductThumb src={it.images[0]} alt={it.sku || "Item"} />
        <div className="min-w-0 flex-1">
          <div className="tnum text-label-caps text-on-surface-variant">SKU: {it.sku || "—"}</div>
          <p className="truncate text-body-md text-primary">{String(it.desc).split("\n")[0]}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-label-caps text-on-surface-variant">
            <span>Qty: {it.qty}</span>
            {it.discount > 0 && (
              <span className="rounded bg-tertiary-fixed px-2 py-0.5 text-[11px] text-on-tertiary-container">
                -{it.discount}%
              </span>
            )}
            {priceAdjusted && (
              <span className="flex items-center gap-1 rounded bg-secondary-container px-2 py-0.5 text-[11px] text-on-secondary-container">
                <PencilLine className="h-2.5 w-2.5" /> Price adjusted
              </span>
            )}
            {it.fromTag && (
              <span className="flex items-center gap-1 rounded bg-secondary-container px-2 py-0.5 text-[11px] text-on-secondary-container">
                <Tag className="h-2.5 w-2.5" /> From tag
              </span>
            )}
          </div>
        </div>
        <span className="tnum shrink-0 text-price-sm text-primary">{money(lineTotal(it))}</span>
      </button>

      {open && (
        <div className="border-t border-outline-variant px-3 pb-3 pt-3">
          <div className="mb-3 grid grid-cols-2 gap-3">
            <Field label="Quantity">
              <input
                type="number"
                inputMode="numeric"
                value={it.qty}
                min={1}
                onFocus={(e) => e.target.select()}
                onChange={(e) => onChange({ qty: Math.max(1, Number(e.target.value) || 1) })}
                className="tnum h-11 w-full rounded border border-outline-variant bg-surface-container-lowest text-center text-body-lg font-medium text-primary outline-none focus:border-[1.5px] focus:border-primary"
              />
            </Field>
            <Field label="Discount %">
              <input
                type="number"
                inputMode="decimal"
                value={it.discount}
                min={0}
                max={100}
                onFocus={(e) => e.target.select()}
                onChange={(e) => handleDiscountChange(e.target.value)}
                className="tnum h-11 w-full rounded border border-outline-variant bg-surface-container-lowest text-center text-body-lg font-medium text-primary outline-none focus:border-[1.5px] focus:border-primary"
              />
            </Field>
          </div>

          {it.price !== null && (
            <div className="mb-3">
              <Field label="Net Unit Price (RM)">
                <input
                  type="number"
                  inputMode="decimal"
                  value={currentNet ?? 0}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => handleNetPriceChange(e.target.value)}
                  className="tnum h-11 w-full rounded border border-outline-variant bg-surface-container-lowest px-3 text-right text-body-lg font-medium text-primary outline-none focus:border-[1.5px] focus:border-primary"
                />
              </Field>
              {priceAdjusted && (
                <p className="mt-1.5 text-label-caps text-secondary">
                  Price adjusted manually — unit price {money(roundRM(it.price))} stays the reference.
                </p>
              )}
            </div>
          )}

          <div className="flex gap-2">
            <IconButton onClick={onUp} label="Move up">
              <ChevronUp className="h-4 w-4" />
            </IconButton>
            <IconButton onClick={onDown} label="Move down">
              <ChevronDown className="h-4 w-4" />
            </IconButton>
            <button
              type="button"
              onClick={onDelete}
              className="tap flex h-11 flex-1 items-center justify-center gap-1.5 rounded border border-error-container bg-error-container/40 text-body-md font-medium text-error hover:bg-error-container"
            >
              <Trash2 className="h-3.5 w-3.5" /> Remove
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
