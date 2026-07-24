"use client";

import { ImageOff } from "lucide-react";
import { useState, type ReactNode } from "react";

/* ============================ bottom sheet ============================ */
// The one shadow the design permits: a diffused shadow on mobile sheets to
// signal "temporary overlay". rounded-t-lg = 16px per DESIGN.md's radius scale.
export function Sheet({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-primary/20 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="max-h-[92vh] w-full max-w-[600px] overflow-y-auto rounded-t-lg bg-surface-container-lowest p-5 pb-8 shadow-sheet md:mb-auto md:rounded-lg md:border md:border-outline-variant"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-4 h-1 w-10 shrink-0 rounded-full bg-outline-variant" />
        {children}
      </div>
    </div>
  );
}

/* ============================ form controls ============================ */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-label-caps font-semibold uppercase tracking-wider text-on-surface-variant">
        {label}
      </label>
      {children}
    </div>
  );
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  autoFocus?: boolean;
}) {
  return (
    <Field label={label}>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        className="h-touch w-full rounded border border-outline-variant bg-surface-container-lowest px-3 text-body-lg text-primary outline-none transition-all placeholder:text-outline focus:border-[1.5px] focus:border-primary"
      />
    </Field>
  );
}

export function Stepper({
  value,
  onChange,
  min = 1,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
}) {
  return (
    <div className="flex h-touch items-center rounded border border-outline-variant bg-surface-container-lowest focus-within:border-[1.5px] focus-within:border-primary">
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - 1))}
        aria-label="Decrease"
        className="tap flex h-full w-11 shrink-0 items-center justify-center text-on-surface-variant hover:text-primary"
      >
        &minus;
      </button>
      <input
        type="number"
        inputMode="numeric"
        value={value}
        min={min}
        onFocus={(e) => e.target.select()}
        onChange={(e) => onChange(Math.max(min, Number(e.target.value) || min))}
        className="tnum w-full min-w-0 flex-1 border-none bg-transparent p-0 text-center text-body-lg font-semibold text-primary outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
      />
      <button
        type="button"
        onClick={() => onChange(value + 1)}
        aria-label="Increase"
        className="tap flex h-full w-11 shrink-0 items-center justify-center text-on-surface-variant hover:text-primary"
      >
        +
      </button>
    </div>
  );
}

/* ============================ buttons ============================ */
const buttonBase =
  "tap flex h-touch items-center justify-center gap-2 rounded text-body-md font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40";

export function PrimaryButton({
  children,
  onClick,
  disabled,
  className = "",
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`${buttonBase} flex-1 bg-primary px-4 text-on-primary hover:opacity-90 ${className}`}
    >
      {children}
    </button>
  );
}

export function SecondaryButton({
  children,
  onClick,
  disabled,
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${buttonBase} flex-1 border border-outline-variant bg-transparent px-4 text-primary hover:bg-surface-container-low ${className}`}
    >
      {children}
    </button>
  );
}

export function GhostButton({
  children,
  onClick,
  tone = "default",
  disabled = false,
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  tone?: "default" | "error";
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`tap flex h-touch items-center justify-center gap-1.5 text-body-md font-medium disabled:cursor-not-allowed disabled:opacity-40 ${
        tone === "error" ? "text-error" : "text-on-surface-variant hover:text-primary"
      } ${className}`}
    >
      {children}
    </button>
  );
}

export function IconButton({
  children,
  onClick,
  tone = "default",
  label,
}: {
  children: ReactNode;
  onClick?: () => void;
  tone?: "default" | "error";
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`tap flex h-11 w-11 shrink-0 items-center justify-center rounded border ${
        tone === "error"
          ? "border-error-container text-error hover:bg-error-container"
          : "border-outline-variant text-on-surface-variant hover:bg-surface-container-high"
      }`}
    >
      {children}
    </button>
  );
}

/* ============================ layout ============================ */
export function Card({ title, children, className = "" }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded border border-outline-variant bg-surface-container-lowest p-4 ${className}`}>
      {title && (
        <h3 className="mb-3 text-label-caps font-semibold uppercase tracking-wider text-on-surface-variant">
          {title}
        </h3>
      )}
      {children}
    </section>
  );
}

export function Chip({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="tap rounded-full border border-outline-variant bg-surface-container-lowest px-4 py-2 text-body-md text-on-surface-variant transition-colors hover:border-primary hover:text-primary"
    >
      {children}
    </button>
  );
}

export function Empty({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-md border border-outline-variant bg-surface-container-lowest px-8 py-16 text-center">
      <Icon className="mb-4 h-10 w-10 text-outline-variant" />
      <h3 className="mb-2 text-headline-sm font-medium text-primary">{title}</h3>
      <p className="mb-6 max-w-[240px] text-body-md text-on-surface-variant">{body}</p>
      {action}
    </div>
  );
}

/* ============================ product image ============================ */
// Some products genuinely have no photo — this never errors, it just falls
// back to a neutral placeholder instead of a broken image icon.
export function ProductThumb({
  src,
  alt,
  size = "sm",
}: {
  src?: string;
  alt: string;
  size?: "sm" | "lg";
}) {
  const [broken, setBroken] = useState(false);
  const dims = size === "lg" ? "h-24 w-24" : "h-12 w-12";
  if (!src || broken) {
    return (
      <div className={`flex ${dims} shrink-0 items-center justify-center rounded-md border border-outline-variant bg-surface-variant`}>
        <ImageOff className="h-5 w-5 text-outline" />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- R2 image host is only known at runtime via env var
    <img
      src={src}
      alt={alt}
      loading="lazy"
      className={`${dims} shrink-0 rounded-md border border-outline-variant bg-surface-container-low object-cover`}
      onError={() => setBroken(true)}
    />
  );
}

export function Row({ l, r, negative = false }: { l: ReactNode; r: ReactNode; negative?: boolean }) {
  return (
    <div className="flex items-center justify-between py-0.5 text-body-md">
      <span className="text-on-surface-variant">{l}</span>
      <span className={`tnum ${negative ? "text-error" : "text-primary"}`}>{r}</span>
    </div>
  );
}
