"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { Field } from "./ui";

// A searchable dropdown that's also a free-text field: type to filter the
// existing options (sorted A→Z), pick one, or just keep typing something new
// — there's no separate "other" mode, whatever's in the box is the value.
export function ComboField({
  label,
  value,
  onChange,
  options,
  placeholder,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onPointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  const sorted = useMemo(
    () => [...new Set(options.map((o) => o.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [options]
  );
  const query = value.trim().toLowerCase();
  const filtered = query ? sorted.filter((o) => o.toLowerCase().includes(query)) : sorted;
  const exactMatch = sorted.some((o) => o.toLowerCase() === query);
  const showAddOption = value.trim() !== "" && !exactMatch;
  const showDropdown = open && (filtered.length > 0 || showAddOption);

  return (
    <div ref={containerRef} className="relative">
      <Field label={label}>
        <input
          value={value}
          placeholder={placeholder}
          autoFocus={autoFocus}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape" || e.key === "Enter") {
              setOpen(false);
              (e.target as HTMLInputElement).blur();
            }
          }}
          className="h-touch w-full rounded border border-outline-variant bg-surface-container-lowest px-3 text-body-lg text-primary outline-none transition-all placeholder:text-outline focus:border-[1.5px] focus:border-primary"
        />
      </Field>

      {showDropdown && (
        <div className="absolute left-0 right-0 top-[calc(100%+2px)] z-10 max-h-56 overflow-y-auto rounded border border-outline-variant bg-surface-container-lowest shadow-sheet">
          {showAddOption && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setOpen(false)}
              className="tap flex w-full items-center gap-2 border-b border-outline-variant px-3 py-3 text-left text-body-md text-primary hover:bg-surface-container-low"
            >
              <Plus className="h-4 w-4 shrink-0 text-secondary" />
              Add &ldquo;{value.trim()}&rdquo;
            </button>
          )}
          {filtered.map((o) => (
            <button
              key={o}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange(o);
                setOpen(false);
              }}
              className="tap block w-full px-3 py-3 text-left text-body-md text-primary hover:bg-surface-container-low"
            >
              {o}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
