"use client";

import { LogOut, ShieldCheck, X } from "lucide-react";
import { Sheet, GhostButton } from "./ui";

export function AdminMenuSheet({
  username,
  onClose,
  onLogout,
}: {
  username: string;
  onClose: () => void;
  onLogout: () => void;
}) {
  return (
    <Sheet onClose={onClose}>
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-headline-sm text-on-surface">Admin</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="tap text-on-surface-variant hover:text-primary">
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="mb-6 flex items-center gap-3 rounded border border-outline-variant bg-surface-container-low p-4">
        <ShieldCheck className="h-5 w-5 shrink-0 text-on-tertiary-container" />
        <div className="min-w-0">
          <div className="text-label-caps text-on-surface-variant">Logged in as</div>
          <div className="truncate text-body-lg font-medium text-primary">{username}</div>
        </div>
      </div>

      <GhostButton onClick={onLogout} tone="error" className="w-full justify-center">
        <LogOut className="h-4 w-4" /> Log out
      </GhostButton>
    </Sheet>
  );
}
