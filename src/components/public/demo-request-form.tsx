"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { requestDemo } from "@/app/demo/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function DemoRequestForm() {
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const [form, setForm] = useState({
    churchName: "",
    contactName: "",
    phone: "",
    email: "",
    city: "",
    size: "",
    note: "",
    website: "", // honeypot
  });

  const set = (k: keyof typeof form, v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await requestDemo(form);
      if (!res.ok) return void toast.error(res.error);
      setDone(true);
    });
  }

  if (done) {
    return (
      <div className="bg-card rounded-2xl border p-8 text-center shadow-sm">
        <CheckCircle2 className="text-success mx-auto size-10" />
        <h2 className="mt-3 text-xl font-extrabold">We&rsquo;ve got it</h2>
        <p className="text-muted-foreground mt-2 text-sm">
          Someone from FlockInsight will call you within one working day. If it
          is urgent, WhatsApp us on{" "}
          <a href="https://wa.me/2348088256055" className="text-primary font-semibold">
            0808 825 6055
          </a>
          .
        </p>
        <Button className="mt-5" asChild>
          <a href="/signup">Or start free right now</a>
        </Button>
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="bg-card space-y-4 rounded-2xl border p-6 shadow-sm sm:p-8"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="d-church">Church name</Label>
          <Input
            id="d-church"
            value={form.churchName}
            onChange={(e) => set("churchName", e.target.value)}
            placeholder="Grace Chapel"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="d-name">Your name</Label>
          <Input
            id="d-name"
            value={form.contactName}
            onChange={(e) => set("contactName", e.target.value)}
            placeholder="Pastor Daniel"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="d-phone">Phone / WhatsApp</Label>
          <Input
            id="d-phone"
            value={form.phone}
            onChange={(e) => set("phone", e.target.value)}
            placeholder="0808 825 6055"
            inputMode="tel"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="d-email">Email (optional)</Label>
          <Input
            id="d-email"
            type="email"
            value={form.email}
            onChange={(e) => set("email", e.target.value)}
            placeholder="pastor@church.org"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="d-city">City</Label>
          <Input
            id="d-city"
            value={form.city}
            onChange={(e) => set("city", e.target.value)}
            placeholder="Yola"
          />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="d-size">Roughly how many members?</Label>
          <Input
            id="d-size"
            value={form.size}
            onChange={(e) => set("size", e.target.value.replace(/\D/g, ""))}
            placeholder="250"
            inputMode="numeric"
          />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="d-note">
            What takes the most time at your church right now?
          </Label>
          <Textarea
            id="d-note"
            value={form.note}
            onChange={(e) => set("note", e.target.value)}
            rows={3}
            placeholder="Counting attendance across three services and chasing first-timers."
          />
        </div>
      </div>

      {/* Honeypot — hidden from people, catnip for bots. */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        value={form.website}
        onChange={(e) => set("website", e.target.value)}
        className="absolute left-[-9999px] size-0 opacity-0"
      />

      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending && <Loader2 className="size-4 animate-spin" />}
        Book my walkthrough
      </Button>
      <p className="text-muted-foreground text-center text-xs">
        No card, no obligation. We&rsquo;ll call, set the church up with you, and
        you keep the first 7 Sundays free.
      </p>
    </form>
  );
}
