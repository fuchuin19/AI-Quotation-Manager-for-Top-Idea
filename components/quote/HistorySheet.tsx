"use client";

import { FileSpreadsheet, RotateCcw, Trash2 } from "lucide-react";
import { Sheet, PrimaryButton, SecondaryButton, GhostButton, Row } from "./ui";
import { money, quotationTotal, type Quotation } from "@/lib/quote-types";

export function HistorySheet({
  quotation,
  isCurrent,
  exporting,
  onClose,
  onReopen,
  onExport,
  onDelete,
}: {
  quotation: Quotation;
  isCurrent: boolean;
  exporting: boolean;
  onClose: () => void;
  onReopen: () => void;
  onExport: () => void;
  onDelete: () => void;
}) {
  const total = quotationTotal(quotation);

  return (
    <Sheet onClose={onClose}>
      <div className="mb-1 flex items-start justify-between gap-3">
        <h2 className="min-w-0 truncate text-headline-sm text-on-surface">
          {quotation.customer.trim() || "Untitled quotation"}
        </h2>
        {isCurrent && (
          <span className="shrink-0 rounded bg-tertiary-fixed px-2 py-0.5 text-[11px] text-on-tertiary-container">
            Current
          </span>
        )}
      </div>
      <p className="mb-6 text-body-md text-on-surface-variant">
        {[quotation.project, quotation.ref, quotation.date].filter((s) => s && s.trim()).join(" · ") || "—"}
      </p>

      <div className="mb-6 flex flex-col gap-1 border-y border-outline-variant py-4">
        <Row l="Attn" r={quotation.attn.trim() || "—"} />
        <Row l="Items" r={String(quotation.items.length)} />
        <div className="mt-2 flex items-center justify-between border-t border-outline-variant pt-3">
          <span className="text-headline-sm font-semibold text-primary">Total</span>
          <span className="tnum text-price-display font-semibold text-primary">{money(total)}</span>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {!isCurrent && (
          <PrimaryButton onClick={onReopen}>
            <RotateCcw className="h-4 w-4" /> Reopen
          </PrimaryButton>
        )}
        <SecondaryButton onClick={onExport} disabled={exporting}>
          <FileSpreadsheet className="h-4 w-4" /> {exporting ? "Building Excel…" : "Download Excel"}
        </SecondaryButton>
        <GhostButton onClick={onDelete} tone="error" className="justify-center">
          <Trash2 className="h-4 w-4" /> Delete
        </GhostButton>
      </div>
    </Sheet>
  );
}
