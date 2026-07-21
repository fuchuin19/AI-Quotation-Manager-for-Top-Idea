"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Card, PrimaryButton, TextField } from "./ui";

export function AdminCredentialsCard({ onChanged }: { onChanged: () => void }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const showWeakWarning = newPassword.length > 0 && newPassword.length < 8;
  const mismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!currentPassword || !newUsername.trim() || !newPassword) {
      setError("Fill in all fields.");
      return;
    }
    if (newPassword.length < 4) {
      setError("New password must be at least 4 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New password and confirmation don't match.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/change-credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newUsername: newUsername.trim(), newPassword }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error || "Could not update credentials.");
        return;
      }
      onChanged();
    } catch (err) {
      console.error("Change credentials failed:", err);
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Admin login">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <TextField label="Current password" type="password" value={currentPassword} onChange={setCurrentPassword} />
        <TextField label="New username" value={newUsername} onChange={setNewUsername} />
        <TextField label="New password" type="password" value={newPassword} onChange={setNewPassword} />
        {showWeakWarning && (
          <p className="-mt-1 flex items-start gap-2 text-body-md text-secondary">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            Short passwords are easy to guess. Consider something longer before sharing this with other staff.
          </p>
        )}
        <TextField label="Confirm new password" type="password" value={confirmPassword} onChange={setConfirmPassword} />
        {mismatch && <p className="-mt-1 text-body-md text-error">Passwords don&apos;t match.</p>}
        {error && <p className="text-body-md text-error">{error}</p>}
        <PrimaryButton type="submit" disabled={busy}>
          {busy ? "Updating…" : "Update credentials"}
        </PrimaryButton>
      </form>
    </Card>
  );
}
