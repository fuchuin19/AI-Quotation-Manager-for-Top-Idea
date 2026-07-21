"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Sheet, PrimaryButton } from "./ui";
import { ComboField } from "./ComboField";

interface LocationPair {
  area: string;
  sub: string;
}

export function LocationSheet({
  area: initialArea,
  sub: initialSub,
  locationHistory,
  onClose,
  onSave,
}: {
  area: string;
  sub: string;
  locationHistory: LocationPair[];
  onClose: () => void;
  onSave: (area: string, sub: string) => void;
}) {
  const [area, setArea] = useState(initialArea);
  const [sub, setSub] = useState(initialSub);

  const areaOptions = locationHistory.map((p) => p.area).filter(Boolean);
  const subOptions = locationHistory
    .filter((p) => p.area.trim().toLowerCase() === area.trim().toLowerCase())
    .map((p) => p.sub)
    .filter(Boolean);

  return (
    <Sheet onClose={onClose}>
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-headline-sm text-on-surface">Set Location</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="tap text-on-surface-variant hover:text-primary">
          <X className="h-5 w-5" />
        </button>
      </div>
      <p className="-mt-4 mb-6 text-body-md text-on-surface-variant">
        Everything you scan goes here until you change it. Pick from the list, type to search, or type a new one.
      </p>

      <div className="mb-6 flex flex-col gap-4">
        <ComboField label="Area" value={area} onChange={setArea} options={areaOptions} placeholder="e.g. Master Bathroom" autoFocus />
        <ComboField label="Sub-area (optional)" value={sub} onChange={setSub} options={subOptions} placeholder="e.g. Shower Enclosure" />
      </div>

      <div className="flex gap-gutter">
        <button
          type="button"
          onClick={onClose}
          className="tap flex h-touch flex-1 items-center justify-center text-body-lg text-on-surface-variant hover:bg-surface-container-low"
        >
          Cancel
        </button>
        <div className="flex-[2]">
          <PrimaryButton onClick={() => onSave(area.trim(), sub.trim())} disabled={!area.trim()}>
            Set location
          </PrimaryButton>
        </div>
      </div>
    </Sheet>
  );
}
