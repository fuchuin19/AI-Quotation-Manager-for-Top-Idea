"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Sheet, TextField, PrimaryButton } from "./ui";

export function LoginSheet({
  onClose,
  onLoggedIn,
}: {
  onClose: () => void;
  onLoggedIn: (info: { username: string; usedMasterPassword: boolean }) => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError("Enter both username and password.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        username?: string;
        usedMasterPassword?: boolean;
      };
      if (!res.ok) {
        setError(data.error || "Could not log in.");
        return;
      }
      onLoggedIn({ username: data.username || username.trim(), usedMasterPassword: !!data.usedMasterPassword });
    } catch (err) {
      console.error("Login failed:", err);
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet onClose={onClose}>
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-headline-sm text-on-surface">Login as admin</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="tap text-on-surface-variant hover:text-primary">
          <X className="h-5 w-5" />
        </button>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="mb-6 flex flex-col gap-4">
          <TextField label="Username" value={username} onChange={setUsername} autoFocus />
          <TextField label="Password" value={password} onChange={setPassword} type="password" />
        </div>

        {error && <p className="mb-4 text-body-md text-error">{error}</p>}

        <div className="flex gap-gutter">
          <button
            type="button"
            onClick={onClose}
            className="tap flex h-touch flex-1 items-center justify-center text-body-lg text-on-surface-variant hover:bg-surface-container-low"
          >
            Cancel
          </button>
          <div className="flex-[2]">
            <PrimaryButton type="submit" disabled={busy}>
              {busy ? "Logging in…" : "Log in"}
            </PrimaryButton>
          </div>
        </div>
      </form>
    </Sheet>
  );
}
