"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Button } from "./ui/button";
export function AccountControls() {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  return <section className="mt-8 space-y-4 rounded-xl border border-border bg-white p-6">
    <h2 className="text-xl font-semibold">Аккаунт</h2>
    {message && <p role="status">{message}</p>}
    <Button variant="outline" disabled={busy} onClick={async () => { setBusy(true); try { const result = await authClient.signOut(); if (result.error) setMessage("Не удалось выйти."); else { router.refresh(); router.push("/login"); } } catch { setMessage("Повторите позже."); } finally { setBusy(false); } }}>Выйти</Button>
  </section>;
}
