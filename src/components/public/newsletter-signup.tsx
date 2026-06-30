"use client";

import { useState } from "react";
import { CheckCircle2, Loader2, Mail } from "lucide-react";
import { subscribeNewsletter } from "@/app/c/[handle]/actions";

export function NewsletterSignup({
  handle,
  churchName,
}: {
  handle: string;
  churchName: string;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!email.trim()) return setError("Enter your email.");
    setBusy(true);
    const res = await subscribeNewsletter({ handle, name, email });
    setBusy(false);
    if (res.ok) setDone(true);
    else setError(res.error);
  }

  if (done) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-white/20 bg-white/10 p-5 text-white backdrop-blur">
        <CheckCircle2 className="size-7 shrink-0" />
        <div>
          <p className="font-semibold">You&apos;re subscribed!</p>
          <p className="text-sm text-white/80">
            You&apos;ll get devotionals & updates from {churchName}.
          </p>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name (optional)"
          className="h-12 flex-1 rounded-xl border border-white/25 bg-white/10 px-4 text-white placeholder:text-white/60 focus:border-white/60 focus:outline-none"
        />
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@email.com"
          className="h-12 flex-1 rounded-xl border border-white/25 bg-white/10 px-4 text-white placeholder:text-white/60 focus:border-white/60 focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy}
          className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-white px-6 font-bold text-[var(--brand)] transition hover:bg-white/90 disabled:opacity-70"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />}
          Subscribe
        </button>
      </div>
      {error && <p className="text-sm text-white/90">{error}</p>}
    </form>
  );
}
