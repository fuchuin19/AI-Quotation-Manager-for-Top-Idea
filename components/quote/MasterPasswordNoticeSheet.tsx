"use client";

import { Info } from "lucide-react";
import { Sheet, PrimaryButton } from "./ui";

export function MasterPasswordNoticeSheet({ onClose }: { onClose: () => void }) {
  return (
    <Sheet onClose={onClose}>
      <div className="mb-6 flex flex-col items-center gap-3 py-2 text-center">
        <Info className="h-8 w-8 text-secondary" />
        <p className="text-body-lg text-primary">You logged in with the master password. Set a new password in Setup.</p>
      </div>
      <PrimaryButton onClick={onClose}>Got it</PrimaryButton>
    </Sheet>
  );
}
