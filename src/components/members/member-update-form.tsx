"use client";

import { useState } from "react";
import { Baby, CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { submitMemberUpdate } from "@/app/m/[token]/actions";
import type { MemberUpdateData } from "@/lib/member-update";
import { BirthdayInput } from "@/components/members/birthday-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Child = { firstName: string; gender: "male" | "female" | ""; dateOfBirth: string };

type Values = {
  firstName: string;
  lastName: string;
  gender: "male" | "female" | "";
  phone: string;
  email: string;
  dateOfBirth: string;
  weddingDate: string;
  address: string;
  city: string;
  state: string;
  groupIds: string[];
  children: Child[];
};

/**
 * Pre-filled personal update form (public, token-gated). Shows the member's
 * current details for review/correction, their existing children, and lets
 * them add more. Reuses the sign-up submit pipeline (no OTP — the token is the
 * credential).
 */
export function MemberUpdateForm({ data }: { data: MemberUpdateData }) {
  const { config } = data;
  const [values, setValues] = useState<Values>({
    ...data.member,
    groupIds: data.myGroupIds,
    children: [],
  });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  function set<K extends keyof Values>(k: K, v: Values[K]) {
    setValues((p) => ({ ...p, [k]: v }));
  }
  function toggleGroup(id: string) {
    setValues((p) => ({
      ...p,
      groupIds: p.groupIds.includes(id)
        ? p.groupIds.filter((x) => x !== id)
        : [...p.groupIds, id],
    }));
  }
  function addChild() {
    setValues((p) =>
      p.children.length >= 15
        ? p
        : { ...p, children: [...p.children, { firstName: "", gender: "", dateOfBirth: "" }] },
    );
  }
  function setChild(i: number, patch: Partial<Child>) {
    setValues((p) => {
      const children = [...p.children];
      children[i] = { ...children[i], ...patch };
      return { ...p, children };
    });
  }
  function removeChild(i: number) {
    setValues((p) => ({ ...p, children: p.children.filter((_, j) => j !== i) }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!values.firstName.trim()) {
      toast.error("Please enter your first name.");
      return;
    }
    setBusy(true);
    const res = await submitMemberUpdate({ token: data.token, values });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setDone(res.message);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (done) {
    return (
      <div className="bg-card rounded-2xl border p-8 text-center">
        <CheckCircle2 className="text-success mx-auto mb-3 size-10" />
        <p className="text-lg font-semibold">{done}</p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Section title="Your details">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name" required>
            <Input value={values.firstName} onChange={(e) => set("firstName", e.target.value)} />
          </Field>
          <Field label="Last name">
            <Input value={values.lastName} onChange={(e) => set("lastName", e.target.value)} />
          </Field>
          <Field label="Gender">
            <Select
              value={values.gender || undefined}
              onValueChange={(v) => set("gender", v as Values["gender"])}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="male">Male</SelectItem>
                <SelectItem value="female">Female</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {config.collectBirthday && (
            <Field label="Date of birth" hint="Year optional">
              <BirthdayInput
                value={values.dateOfBirth}
                onChange={(v) => set("dateOfBirth", v)}
              />
            </Field>
          )}
        </div>
      </Section>

      <Section title="How we reach you" hint="Keep at least an email or phone number so we can stay in touch.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Phone">
            <Input type="tel" value={values.phone} onChange={(e) => set("phone", e.target.value)} />
          </Field>
          <Field label="Email">
            <Input type="email" value={values.email} onChange={(e) => set("email", e.target.value)} />
          </Field>
        </div>
      </Section>

      {config.collectChildren && (
        <Section
          title="Your children"
          hint="Add your children so they're part of the family and celebrated too."
        >
          {data.children.length > 0 && (
            <div className="mb-3 space-y-1.5">
              <p className="text-muted-foreground text-xs font-semibold uppercase">
                Already registered
              </p>
              <div className="flex flex-wrap gap-2">
                {data.children.map((ch) => (
                  <span
                    key={ch.id}
                    className="bg-muted inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm"
                  >
                    <Baby className="size-3.5" /> {ch.name}
                  </span>
                ))}
              </div>
            </div>
          )}
          <div className="space-y-3">
            {values.children.map((c, i) => (
              <div key={i} className="rounded-xl border p-3">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-semibold">New child {i + 1}</p>
                  <button
                    type="button"
                    onClick={() => removeChild(i)}
                    className="text-muted-foreground hover:text-destructive text-sm"
                  >
                    Remove
                  </button>
                </div>
                <div className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="First name">
                      <Input
                        value={c.firstName}
                        onChange={(e) => setChild(i, { firstName: e.target.value })}
                      />
                    </Field>
                    <Field label="Gender">
                      <Select
                        value={c.gender || undefined}
                        onValueChange={(v) => setChild(i, { gender: v as Child["gender"] })}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="male">Male</SelectItem>
                          <SelectItem value="female">Female</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                  </div>
                  <Field label="Date of birth" hint="Year optional">
                    <BirthdayInput
                      value={c.dateOfBirth}
                      onChange={(v) => setChild(i, { dateOfBirth: v })}
                    />
                  </Field>
                </div>
              </div>
            ))}
            {values.children.length < 15 && (
              <Button type="button" variant="outline" onClick={addChild}>
                + Add a child
              </Button>
            )}
          </div>
        </Section>
      )}

      {config.collectAnniversary && (
        <Section title="Milestones" hint="Optional — so we can celebrate with you.">
          <Field label="Wedding anniversary">
            <Input
              type="date"
              className="h-11"
              value={values.weddingDate}
              onChange={(e) => set("weddingDate", e.target.value)}
            />
          </Field>
        </Section>
      )}

      {config.collectAddress && (
        <Section title="Where you live" hint="Optional.">
          <div className="grid gap-4">
            <Field label="Address">
              <Input value={values.address} onChange={(e) => set("address", e.target.value)} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="City / town">
                <Input value={values.city} onChange={(e) => set("city", e.target.value)} />
              </Field>
              <Field label="State">
                <Input value={values.state} onChange={(e) => set("state", e.target.value)} />
              </Field>
            </div>
          </div>
        </Section>
      )}

      {config.allowGroupSelect && data.groups.length > 0 && (
        <Section title="Ministries & groups" hint="Tick any you belong to (or would like to join).">
          <div className="grid gap-2 sm:grid-cols-2">
            {data.groups.map((g) => (
              <label
                key={g.id}
                className="hover:bg-muted flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm"
              >
                <input
                  type="checkbox"
                  checked={values.groupIds.includes(g.id)}
                  onChange={() => toggleGroup(g.id)}
                  className="accent-primary size-4"
                />
                <span className="truncate">{g.name}</span>
              </label>
            ))}
          </div>
        </Section>
      )}

      <Button type="submit" size="lg" disabled={busy} className="w-full sm:w-auto">
        {busy && <Loader2 className="size-4 animate-spin" />}
        Save my details
      </Button>
    </form>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-card rounded-2xl border p-5">
      <h2 className="font-bold">{title}</h2>
      {hint && <p className="text-muted-foreground mb-3 text-sm">{hint}</p>}
      <div className={hint ? "" : "mt-3"}>{children}</div>
    </div>
  );
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label className="mb-1 block">
        {label}
        {required && <span className="text-destructive"> *</span>}
        {hint && <span className="text-muted-foreground ml-1 font-normal">({hint})</span>}
      </Label>
      {children}
    </div>
  );
}
