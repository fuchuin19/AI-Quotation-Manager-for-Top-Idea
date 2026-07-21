"use client";

import { ScanLine, ListChecks, Settings } from "lucide-react";
import type { ScreenKey } from "@/lib/quote-types";

const TABS: { key: ScreenKey; label: string; Icon: typeof ScanLine }[] = [
  { key: "capture", label: "Capture", Icon: ScanLine },
  { key: "items", label: "Items", Icon: ListChecks },
  { key: "setup", label: "Setup", Icon: Settings },
];

export function BottomNav({
  screen,
  onChange,
  itemCount,
}: {
  screen: ScreenKey;
  onChange: (s: ScreenKey) => void;
  itemCount: number;
}) {
  return (
    <nav className="fixed bottom-0 left-0 z-50 flex h-touch w-full items-stretch justify-around border-t border-outline-variant bg-surface">
      {TABS.map(({ key, label, Icon }) => {
        const active = screen === key;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            className={`tap relative flex flex-1 flex-col items-center justify-center gap-1 pt-1 text-label-caps font-semibold transition-colors ${
              active ? "border-t-2 border-primary text-primary" : "border-t-2 border-transparent text-secondary hover:text-primary"
            }`}
          >
            <Icon className="h-5 w-5" />
            <span>{label}</span>
            {key === "items" && itemCount > 0 && (
              <span className="absolute right-[28%] top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-on-primary">
                {itemCount}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
