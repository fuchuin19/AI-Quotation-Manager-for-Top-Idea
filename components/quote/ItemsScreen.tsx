"use client";

import { FileSpreadsheet, Package } from "lucide-react";
import { Empty, PrimaryButton } from "./ui";
import { ItemRow } from "./ItemRow";
import { CustomerCard } from "./CustomerCard";
import { LETTERS, ROMAN, lineTotal, money, type QuotationMeta, type QuoteItem, type ScreenKey } from "@/lib/quote-types";

type EditableMeta = Pick<QuotationMeta, "customer" | "project" | "attn" | "ref" | "date">;

interface GroupedSub {
  name: string;
  rows: QuoteItem[];
}
interface GroupedArea {
  name: string;
  subs: GroupedSub[];
}

function groupItems(items: QuoteItem[]): GroupedArea[] {
  const areas: GroupedArea[] = [];
  for (const it of items) {
    let area = areas.find((a) => a.name === it.area);
    if (!area) {
      area = { name: it.area, subs: [] };
      areas.push(area);
    }
    let sub = area.subs.find((s) => s.name === it.sub);
    if (!sub) {
      sub = { name: it.sub, rows: [] };
      area.subs.push(sub);
    }
    sub.rows.push(it);
  }
  return areas;
}

export function ItemsScreen({
  items,
  grandTotal,
  exporting,
  onChangeItem,
  onDeleteItem,
  onMoveItem,
  onExport,
  onClearAll,
  onGoTo,
  customerMeta,
  onChangeCustomerMeta,
  customerExpanded,
  onCustomerExpandedChange,
  customerFocusToken,
}: {
  items: QuoteItem[];
  grandTotal: number;
  exporting: boolean;
  onChangeItem: (id: string, patch: Partial<QuoteItem>) => void;
  onDeleteItem: (id: string) => void;
  onMoveItem: (id: string, dir: 1 | -1) => void;
  onExport: () => void;
  onClearAll: () => void;
  onGoTo: (s: ScreenKey) => void;
  customerMeta: EditableMeta;
  onChangeCustomerMeta: (patch: Partial<EditableMeta>) => void;
  customerExpanded: boolean;
  onCustomerExpandedChange: (v: boolean) => void;
  customerFocusToken: number;
}) {
  const customerCard = (
    <CustomerCard
      meta={customerMeta}
      onChange={onChangeCustomerMeta}
      expanded={customerExpanded}
      onExpandedChange={onCustomerExpandedChange}
      focusToken={customerFocusToken}
    />
  );

  if (items.length === 0) {
    return (
      <main className="flex flex-col gap-6 px-margin-mobile pt-6">
        {customerCard}
        <Empty
          icon={Package}
          title="No items yet"
          body="Scan a price tag on the Capture tab and the item lands here."
          action={
            <div className="flex w-48">
              <PrimaryButton onClick={() => onGoTo("capture")}>Go to Capture</PrimaryButton>
            </div>
          }
        />
      </main>
    );
  }

  const grouped = groupItems(items);

  return (
    <main className="flex flex-col gap-6 px-margin-mobile py-6 pb-40">
      {customerCard}
      {grouped.map((area, ai) => {
        const areaTotal = area.subs.flatMap((s) => s.rows).reduce((s, it) => s + (lineTotal(it) ?? 0), 0);
        const areaCount = area.subs.reduce((n, s) => n + s.rows.length, 0);
        return (
          <section key={area.name || ai} className="flex flex-col gap-4">
            <div className="flex items-end justify-between border-b border-outline-variant pb-2">
              <div>
                <h2 className="text-headline-sm text-on-surface">
                  {LETTERS[ai] || "?"}) {area.name || "Unassigned"}
                </h2>
                <span className="text-label-caps font-semibold uppercase tracking-wider text-on-surface-variant">
                  {areaCount} item{areaCount === 1 ? "" : "s"}
                </span>
              </div>
              <span className="tnum text-price-sm text-on-surface">{money(areaTotal)}</span>
            </div>

            {area.subs.map((sub, si) => (
              <div key={sub.name || si} className="flex flex-col gap-3 border-l border-outline-variant pl-4">
                {sub.name && (
                  <h3 className="text-label-caps font-semibold uppercase tracking-wider text-on-surface-variant">
                    {ROMAN[si] || si + 1}) {sub.name}
                  </h3>
                )}
                {sub.rows.map((it) => (
                  <ItemRow
                    key={it.id}
                    it={it}
                    onChange={(patch) => onChangeItem(it.id, patch)}
                    onDelete={() => onDeleteItem(it.id)}
                    onUp={() => onMoveItem(it.id, -1)}
                    onDown={() => onMoveItem(it.id, 1)}
                  />
                ))}
              </div>
            ))}
          </section>
        );
      })}

      <button
        type="button"
        onClick={onClearAll}
        className="tap py-3 text-center text-body-md text-error"
      >
        Clear all items
      </button>

      {/* total bar + export, pinned above the bottom nav */}
      <div className="fixed bottom-touch left-0 z-40 w-full border-t border-outline-variant bg-surface p-margin-mobile">
        <div className="mb-4 flex items-center justify-between">
          <span className="text-headline-sm text-on-surface">Total</span>
          <span className="tnum text-display-lg font-semibold text-primary">{money(grandTotal)}</span>
        </div>
        <PrimaryButton onClick={onExport} disabled={exporting} className="w-full">
          <FileSpreadsheet className="h-4 w-4" />
          {exporting ? "Building Excel…" : "Download Excel"}
        </PrimaryButton>
      </div>
    </main>
  );
}
