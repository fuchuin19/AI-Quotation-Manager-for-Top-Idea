"use client";

import { AlertTriangle, Check, Circle, CircleDot, Tag } from "lucide-react";
import { Sheet, Stepper, Field, ProductThumb, Row, SecondaryButton, PrimaryButton } from "./ui";
import { impliedDiscount, money, pricesDiffer, roundRM, type PendingItem } from "@/lib/quote-types";

// A single tappable "Tag RM2,100" / "Catalogue RM2,280" option in the unit
// price picker — filled dot when selected, tap anywhere on the row to pick it.
function PriceOption({
  label,
  price,
  selected,
  onSelect,
}: {
  label: string;
  price: number;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`tap flex h-touch w-full items-center justify-between rounded border px-3 text-body-lg transition-colors ${
        selected ? "border-[1.5px] border-primary bg-primary/5" : "border-outline-variant bg-surface-container-lowest"
      }`}
    >
      <span className={`flex items-center gap-2 ${selected ? "font-semibold text-primary" : "text-on-surface-variant"}`}>
        {selected ? <CircleDot className="h-4 w-4 shrink-0" /> : <Circle className="h-4 w-4 shrink-0" />}
        {label}
      </span>
      <span className={`tnum ${selected ? "font-semibold text-primary" : "text-on-surface-variant"}`}>{money(price)}</span>
    </button>
  );
}

export function ConfirmSheet({
  pending,
  onChange,
  onClose,
  onCommit,
}: {
  pending: PendingItem;
  onChange: (patch: Partial<PendingItem>) => void;
  onClose: () => void;
  onCommit: () => void;
}) {
  const effectivePrice = pending.priceMissing ? roundRM(Number(pending.enteredPrice) || 0) : pending.price ?? 0;
  const computedNet = roundRM(effectivePrice * (1 - pending.discount / 100));
  const effectiveNet = pending.netPriceOverride !== null ? pending.netPriceOverride : computedNet;
  const discountAmount = effectivePrice - effectiveNet;
  const total = effectiveNet * pending.qty;
  const canAdd = (!pending.priceMissing || effectivePrice > 0) && effectiveNet > 0;

  // Editing discount % is the normal path: net is derived from it, any
  // earlier manual override is superseded.
  function handleDiscountChange(raw: string) {
    const v = Math.min(100, Math.max(0, Number(raw) || 0));
    onChange({ discount: v, netPriceOverride: null });
  }

  // Editing net price directly is an override: it becomes authoritative, and
  // the discount % shown is only ever the implied value for display — it is
  // never fed back into the formula (that could reproduce a different net
  // price than the one he actually typed, after two rounding passes).
  function handleNetPriceChange(raw: string) {
    const n = Number(raw) || 0;
    onChange({ netPriceOverride: n, discount: effectivePrice > 0 ? impliedDiscount(effectivePrice, n) : 0 });
  }

  return (
    <Sheet onClose={onClose}>
      <div className="flex gap-gutter border-b border-outline-variant pb-6">
        <ProductThumb src={pending.images[0]} alt={pending.sku} size="lg" />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {pending.fromTag ? (
            <div className="flex items-center gap-2">
              <Tag className="h-4 w-4 shrink-0 text-secondary" />
              <span className="text-label-caps font-semibold uppercase tracking-wider text-secondary">
                From price tag — not in catalogue
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Check className="h-4 w-4 shrink-0 text-on-tertiary-container" />
              <span className="text-label-caps font-semibold uppercase tracking-wider text-on-tertiary-container">
                Found in library
              </span>
            </div>
          )}

          {pending.fromTag ? (
            <>
              <Field label="SKU">
                <input
                  value={pending.sku}
                  onChange={(e) => onChange({ sku: e.target.value })}
                  placeholder="Code as printed on the tag"
                  className="h-11 w-full rounded border border-outline-variant bg-surface-container-lowest px-3 text-body-lg text-primary outline-none focus:border-[1.5px] focus:border-primary"
                />
              </Field>
              <Field label="Description">
                <textarea
                  value={pending.desc}
                  onChange={(e) => onChange({ desc: e.target.value })}
                  rows={2}
                  placeholder="Product name as printed on the tag"
                  className="w-full resize-none rounded border border-outline-variant bg-surface-container-lowest p-3 text-body-lg text-primary outline-none focus:border-[1.5px] focus:border-primary"
                />
              </Field>
            </>
          ) : (
            <>
              <h2 className="tnum text-headline-md leading-tight text-primary">{pending.sku}</h2>
              <p className="line-clamp-3 whitespace-pre-line text-body-md text-on-surface-variant">{pending.desc}</p>
            </>
          )}
        </div>
      </div>

      {pending.tagPrice != null && pending.catalogPrice != null && (
        <div className="flex flex-col gap-2 border-b border-outline-variant py-6">
          <Field label="Unit Price">
            <div className="flex flex-col gap-2">
              <PriceOption
                label="Tag"
                price={pending.tagPrice}
                selected={pending.priceSource === "tag"}
                onSelect={() => onChange({ price: pending.tagPrice!, priceSource: "tag" })}
              />
              <PriceOption
                label="Catalogue"
                price={pending.catalogPrice}
                selected={pending.priceSource === "catalog"}
                onSelect={() => onChange({ price: pending.catalogPrice!, priceSource: "catalog" })}
              />
            </div>
          </Field>
          {pricesDiffer(pending.tagPrice, pending.catalogPrice) && (
            <p className="flex items-start gap-2 text-body-md text-secondary">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              Tag and catalogue prices differ — check this is right.
            </p>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-gutter border-b border-outline-variant py-6">
        <Field label="Quantity">
          <Stepper value={pending.qty} onChange={(v) => onChange({ qty: v })} />
        </Field>
        <Field label="Discount %">
          <input
            type="number"
            inputMode="decimal"
            value={pending.discount}
            min={0}
            max={100}
            onChange={(e) => handleDiscountChange(e.target.value)}
            className="tnum h-touch w-full rounded border border-outline-variant bg-surface-container-lowest px-3 text-right text-body-lg text-primary outline-none focus:border-[1.5px] focus:border-primary"
          />
        </Field>
      </div>

      <div className="border-b border-outline-variant py-6">
        <Field label="Net Unit Price (RM)">
          <input
            type="number"
            inputMode="decimal"
            value={effectiveNet}
            onChange={(e) => handleNetPriceChange(e.target.value)}
            className="tnum h-touch w-full rounded border border-outline-variant bg-surface-container-lowest px-3 text-right text-body-lg text-primary outline-none focus:border-[1.5px] focus:border-primary"
          />
        </Field>
        {pending.netPriceOverride !== null && (
          <p className="mt-1.5 text-label-caps text-secondary">
            Price adjusted manually — the discount % above now just reflects it.
          </p>
        )}
      </div>

      {pending.priceMissing && (
        <div className="flex flex-col gap-2 border-b border-outline-variant py-4">
          <div className={`flex items-start gap-2 ${canAdd ? "text-on-surface-variant" : "text-error"}`}>
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="text-body-md">
              {pending.fromTag
                ? "Confirm the price read from the tag before adding it."
                : "This product has no price in the catalogue. Type one in before adding it."}
            </p>
          </div>
          <Field label="Unit Price (RM)">
            <input
              type="number"
              inputMode="decimal"
              autoFocus={!pending.fromTag}
              value={pending.enteredPrice}
              placeholder="0.00"
              onChange={(e) => onChange({ enteredPrice: e.target.value })}
              className={`tnum h-touch w-full rounded border bg-surface-container-lowest px-3 text-body-lg text-primary outline-none focus:border-[1.5px] ${canAdd ? "border-outline-variant" : "border-error"}`}
            />
          </Field>
        </div>
      )}

      <div className="flex flex-col gap-3 py-6">
        <Row l="Unit Price" r={money(effectivePrice)} />
        {pending.discount > 0 && <Row l={`Discount (${pending.discount}%)`} r={"−" + money(discountAmount)} negative />}
        <div className="mt-2 flex items-center justify-between border-t border-outline-variant pt-4">
          <span className="text-headline-sm font-semibold text-primary">Line Total</span>
          <span className="tnum text-price-display font-semibold text-primary">{money(total)}</span>
        </div>
      </div>

      <div className="flex gap-gutter">
        <SecondaryButton onClick={onClose}>Discard</SecondaryButton>
        <PrimaryButton onClick={onCommit} disabled={!canAdd}>
          Add to Quotation
        </PrimaryButton>
      </div>
    </Sheet>
  );
}
