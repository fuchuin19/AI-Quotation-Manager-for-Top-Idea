"use client";

import { Undo2 } from "lucide-react";
import type { ToastState } from "@/lib/quote-types";

export function Toast({ toast, onUndo }: { toast: ToastState; onUndo?: () => void }) {
  const bg = toast.tone === "err" ? "bg-error" : "bg-inverse-surface";
  return (
    <div
      className={`fixed bottom-[60px] left-4 right-4 z-50 mx-auto flex h-12 max-w-[440px] items-center justify-between rounded px-4 shadow-sheet ${bg}`}
    >
      <span className="truncate pr-4 text-body-md text-inverse-on-surface">{toast.msg}</span>
      {onUndo && (
        <button
          type="button"
          onClick={onUndo}
          className="tap flex shrink-0 items-center gap-1 text-label-caps font-semibold uppercase tracking-wider text-tertiary-fixed hover:opacity-80"
        >
          <Undo2 className="h-3.5 w-3.5" /> Undo
        </button>
      )}
    </div>
  );
}
