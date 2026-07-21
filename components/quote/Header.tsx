"use client";

import { FilePlus, Lock, Menu, ShieldCheck } from "lucide-react";
import { money } from "@/lib/quote-types";

export function Header({
  customer,
  project,
  refNo,
  date,
  total,
  onNewQuotation,
  isAdmin,
  onLoginClick,
  onAdminBadgeClick,
}: {
  customer: string;
  project: string;
  refNo: string;
  date: string;
  total: number;
  onNewQuotation: () => void;
  isAdmin: boolean;
  onLoginClick: () => void;
  onAdminBadgeClick: () => void;
}) {
  const line1 = customer.trim() || "Untitled quotation";
  const line2 = [project, refNo, date].filter((s) => s && s.trim()).join(" · ");

  return (
    <header className="sticky top-0 z-30 border-b border-outline-variant bg-surface">
      <div className="flex items-center justify-between gap-3 px-margin-mobile pt-3">
        <div className="flex min-w-0 items-center gap-3">
          <Menu className="h-6 w-6 shrink-0 text-primary" aria-hidden="true" />
          <div className="min-w-0">
            <h1 className="truncate text-headline-md font-semibold leading-tight text-primary">{line1}</h1>
            {line2 && <p className="truncate text-label-caps leading-tight text-on-surface-variant">{line2}</p>}
          </div>
        </div>
        <div className="tnum shrink-0 text-price-display font-semibold text-primary">{money(total)}</div>
      </div>

      <div className="flex items-center justify-end gap-2 px-margin-mobile pb-3 pt-2">
        <button
          type="button"
          onClick={onNewQuotation}
          aria-label="New quotation"
          className="tap flex h-9 shrink-0 items-center gap-1.5 rounded border border-outline-variant bg-surface-container-lowest px-2.5 text-label-caps font-semibold text-primary hover:bg-surface-container-low"
        >
          <FilePlus className="h-3.5 w-3.5" />
          New
        </button>
        {isAdmin ? (
          <button
            type="button"
            onClick={onAdminBadgeClick}
            aria-label="Admin — tap to log out"
            className="tap flex h-9 shrink-0 items-center gap-1.5 rounded bg-tertiary-fixed px-2.5 text-label-caps font-semibold text-on-tertiary-container hover:opacity-90"
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            Admin
          </button>
        ) : (
          <button
            type="button"
            onClick={onLoginClick}
            aria-label="Login as admin"
            className="tap flex h-9 shrink-0 items-center gap-1.5 rounded border border-outline-variant bg-surface-container-lowest px-2.5 text-label-caps font-semibold text-primary hover:bg-surface-container-low"
          >
            <Lock className="h-3.5 w-3.5" />
            Login
          </button>
        )}
      </div>
    </header>
  );
}
