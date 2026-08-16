"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { createLead, updateLead } from "@/app/superadmin/growth/actions";
import { LEAD_SOURCES } from "@/lib/growth-shared";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type LeadFormValues = {
  id?: string;
  churchName: string;
  contactName: string;
  role: string;
  email: string;
  phone: string;
  whatsapp: string;
  country: string;
  state: string;
  city: string;
  denomination: string;
  size: string;
  source: string;
  notes: string;
  nextFollowUpAt: string;
};

const BLANK: LeadFormValues = {
  churchName: "",
  contactName: "",
  role: "",
  email: "",
  phone: "",
  whatsapp: "",
  country: "Nigeria",
  state: "",
  city: "",
  denomination: "",
  size: "",
  source: "manual",
  notes: "",
  nextFollowUpAt: "",
};

/** yyyy-MM-dd for a date input, n days from now. */
function inDays(n: number): string {
  return new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
}

export function LeadDialog({
  initial,
  trigger,
}: {
  initial?: LeadFormValues;
  trigger?: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<LeadFormValues>(
    initial ?? { ...BLANK, nextFollowUpAt: inDays(2) },
  );
  const editing = !!initial?.id;

  const set = <K extends keyof LeadFormValues>(k: K, v: LeadFormValues[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  function submit() {
    if (!form.churchName.trim()) return toast.error("Add the church's name.");
    if (!form.email.trim() && !form.phone.trim())
      return toast.error("Add an email or a phone number.");

    startTransition(async () => {
      const payload = {
        ...form,
        size: form.size,
        nextFollowUpAt: form.nextFollowUpAt
          ? new Date(form.nextFollowUpAt).toISOString()
          : "",
      };
      const res = editing
        ? await updateLead(initial!.id!, payload)
        : await createLead(payload);
      if (!res.ok) return void toast.error(res.error);
      toast.success(editing ? "Lead updated." : "Lead added to the pipeline.");
      setOpen(false);
      if (!editing) setForm({ ...BLANK, nextFollowUpAt: inDays(2) });
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus className="size-4" /> Add lead
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit lead" : "Add a lead"}</DialogTitle>
          <DialogDescription>
            A church you want on FlockInsight. Name plus one way to reach them is
            enough to start.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="l-church">Church name</Label>
            <Input
              id="l-church"
              value={form.churchName}
              onChange={(e) => set("churchName", e.target.value)}
              placeholder="Grace Chapel, Yola"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="l-contact">Contact person</Label>
            <Input
              id="l-contact"
              value={form.contactName}
              onChange={(e) => set("contactName", e.target.value)}
              placeholder="Pastor Daniel Ishaku"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="l-role">Their role</Label>
            <Input
              id="l-role"
              value={form.role}
              onChange={(e) => set("role", e.target.value)}
              placeholder="Senior pastor"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="l-phone">Phone</Label>
            <Input
              id="l-phone"
              value={form.phone}
              onChange={(e) => set("phone", e.target.value)}
              placeholder="08088256055"
              inputMode="tel"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="l-email">Email</Label>
            <Input
              id="l-email"
              type="email"
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
              placeholder="pastor@church.org"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="l-whatsapp">WhatsApp (if different)</Label>
            <Input
              id="l-whatsapp"
              value={form.whatsapp}
              onChange={(e) => set("whatsapp", e.target.value)}
              inputMode="tel"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="l-size">Congregation size</Label>
            <Input
              id="l-size"
              value={form.size}
              onChange={(e) => set("size", e.target.value.replace(/\D/g, ""))}
              placeholder="250"
              inputMode="numeric"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="l-city">City / town</Label>
            <Input
              id="l-city"
              value={form.city}
              onChange={(e) => set("city", e.target.value)}
              placeholder="Yola"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="l-state">State</Label>
            <Input
              id="l-state"
              value={form.state}
              onChange={(e) => set("state", e.target.value)}
              placeholder="Adamawa"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="l-denom">Denomination</Label>
            <Input
              id="l-denom"
              value={form.denomination}
              onChange={(e) => set("denomination", e.target.value)}
              placeholder="Pentecostal"
            />
          </div>
          <div className="space-y-2">
            <Label>Where did they come from?</Label>
            <Select value={form.source} onValueChange={(v) => set("source", v)}>
              <SelectTrigger className="w-full" aria-label="Source">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LEAD_SOURCES.map((s) => (
                  <SelectItem key={s} value={s} className="capitalize">
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="l-follow">Follow up on</Label>
            <Input
              id="l-follow"
              type="date"
              value={form.nextFollowUpAt}
              onChange={(e) => set("nextFollowUpAt", e.target.value)}
            />
            <p className="text-muted-foreground text-xs">
              Leads with a date show up in &ldquo;Due now&rdquo; — that list is the
              day&rsquo;s work.
            </p>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="l-notes">Notes</Label>
            <Textarea
              id="l-notes"
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
              rows={3}
              placeholder="Met at the pastors' conference. Uses paper registers, 3 services on Sunday."
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            {editing ? "Save changes" : "Add to pipeline"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
