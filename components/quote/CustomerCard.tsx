"use client";

import { useEffect, useRef } from "react";
import { ChevronUp } from "lucide-react";
import { Card, Field, TextField } from "./ui";
import type { QuotationMeta } from "@/lib/quote-types";

type EditableMeta = Pick<QuotationMeta, "customer" | "project" | "attn" | "ref" | "date">;

export function CustomerCard({
  meta,
  onChange,
  expanded,
  onExpandedChange,
  focusToken,
}: {
  meta: EditableMeta;
  onChange: (patch: Partial<EditableMeta>) => void;
  expanded: boolean;
  onExpandedChange: (v: boolean) => void;
  focusToken: number;
}) {
  const customerInputRef = useRef<HTMLInputElement>(null);

  // Bumped by the export-warning dialog's "Add details" button — expands the
  // card (via the same action) and focuses straight into the customer field.
  useEffect(() => {
    if (focusToken > 0 && expanded) customerInputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusToken]);

  // Ref auto-generates immediately, so it must not count as "having
  // details" — only the customer name (same rule the export warning uses)
  // decides whether this still reads as an empty, needs-attention state.
  const hasCustomer = Boolean(meta.customer.trim());
  const summary = [meta.customer, meta.project, meta.ref].filter((s) => s && s.trim()).join(" · ");

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => onExpandedChange(true)}
        className="tap flex w-full items-center justify-between gap-3 rounded border border-outline-variant bg-surface-container-lowest px-4 py-3 text-left"
      >
        {hasCustomer ? (
          <span className="min-w-0 flex-1 truncate text-body-md text-primary">{summary}</span>
        ) : (
          <span className="flex-1 text-body-md text-secondary">Add customer details</span>
        )}
        {hasCustomer && <span className="shrink-0 text-label-caps text-on-surface-variant">tap to edit</span>}
      </button>
    );
  }

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-label-caps font-semibold uppercase tracking-wider text-on-surface-variant">
          Customer details
        </h3>
        <button
          type="button"
          onClick={() => onExpandedChange(false)}
          aria-label="Collapse customer details"
          className="tap text-on-surface-variant hover:text-primary"
        >
          <ChevronUp className="h-5 w-5" />
        </button>
      </div>
      <div className="flex flex-col gap-3">
        <Field label="Customer">
          <input
            ref={customerInputRef}
            value={meta.customer}
            placeholder="PEI WEE"
            onChange={(e) => onChange({ customer: e.target.value })}
            className="h-touch w-full rounded border border-outline-variant bg-surface-container-lowest px-3 text-body-lg text-primary outline-none transition-all placeholder:text-outline focus:border-[1.5px] focus:border-primary"
          />
        </Field>
        <TextField label="Project" value={meta.project} onChange={(v) => onChange({ project: v })} placeholder="NUSA VALLEY" />
        <TextField label="Attn" value={meta.attn} onChange={(v) => onChange({ attn: v })} placeholder="JABLANC - MS KUAY" />
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Our Ref" value={meta.ref} onChange={(v) => onChange({ ref: v })} />
          <TextField label="Date" value={meta.date} onChange={(v) => onChange({ date: v })} />
        </div>
      </div>
    </Card>
  );
}
