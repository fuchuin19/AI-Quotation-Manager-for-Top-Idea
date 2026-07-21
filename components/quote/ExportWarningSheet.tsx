"use client";

import { AlertTriangle } from "lucide-react";
import { Sheet, PrimaryButton, SecondaryButton } from "./ui";

export function ExportWarningSheet({
  onClose,
  onAddDetails,
  onExportAnyway,
}: {
  onClose: () => void;
  onAddDetails: () => void;
  onExportAnyway: () => void;
}) {
  return (
    <Sheet onClose={onClose}>
      <div className="mb-6 flex flex-col items-center gap-3 py-2 text-center">
        <AlertTriangle className="h-8 w-8 text-secondary" />
        <p className="text-body-lg text-primary">No customer name set. This quotation will be saved as Untitled.</p>
      </div>
      <div className="flex gap-gutter">
        <SecondaryButton onClick={onAddDetails}>Add details</SecondaryButton>
        <PrimaryButton onClick={onExportAnyway}>Export anyway</PrimaryButton>
      </div>
    </Sheet>
  );
}
