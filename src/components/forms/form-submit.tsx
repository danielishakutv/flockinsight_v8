"use client";

import { useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { submitForm } from "@/app/f/[slug]/actions";
import {
  validateSubmission,
  type FormField,
  type FieldValue,
} from "@/lib/forms-shared";
import { Button } from "@/components/ui/button";
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
import { cn } from "@/lib/utils";

export function FormSubmit({
  slug,
  fields,
}: {
  slug: string;
  fields: FormField[];
}) {
  const [values, setValues] = useState<Record<string, FieldValue>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [hp, setHp] = useState("");

  function set(id: string, v: FieldValue) {
    setValues((p) => ({ ...p, [id]: v }));
    if (errors[id]) setErrors((p) => ({ ...p, [id]: "" }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validateSubmission(fields, values);
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    setSubmitting(true);
    const res = await submitForm({ slug, values, hp });
    setSubmitting(false);
    if (res.ok) {
      setDone(res.message);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      if (res.errors) setErrors(res.errors);
    }
  }

  if (done) {
    return (
      <div className="rounded-2xl border bg-card p-8 text-center">
        <CheckCircle2 className="text-success mx-auto mb-3 size-10" />
        <p className="text-lg font-semibold">{done}</p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {/* Honeypot — hidden from real users */}
      <input
        type="text"
        tabIndex={-1}
        autoComplete="off"
        value={hp}
        onChange={(e) => setHp(e.target.value)}
        className="absolute left-[-9999px] h-0 w-0 opacity-0"
        aria-hidden="true"
      />

      {fields.map((field) => (
        <div key={field.id} className="rounded-2xl border bg-card p-4">
          <Label className="text-base font-semibold">
            {field.label}
            {field.required && <span className="text-destructive"> *</span>}
          </Label>
          {field.description && (
            <p className="text-muted-foreground mb-2 text-sm">{field.description}</p>
          )}
          <div className="mt-2">
            <FieldInput field={field} value={values[field.id]} onChange={(v) => set(field.id, v)} />
          </div>
          {errors[field.id] && (
            <p className="text-destructive mt-1.5 text-sm">{errors[field.id]}</p>
          )}
        </div>
      ))}

      <Button type="submit" size="lg" disabled={submitting} className="w-full sm:w-auto">
        {submitting && <Loader2 className="size-4 animate-spin" />}
        Submit
      </Button>
    </form>
  );
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: FormField;
  value: FieldValue;
  onChange: (v: FieldValue) => void;
}) {
  switch (field.type) {
    case "long_text":
      return (
        <Textarea
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
        />
      );
    case "email":
      return (
        <Input
          type="email"
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "phone":
      return (
        <Input
          type="tel"
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "number":
      return (
        <Input
          type="number"
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "date":
      return (
        <Input
          type="date"
          className="h-11"
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "select":
      return (
        <Select value={(value as string) ?? ""} onValueChange={(v) => onChange(v)}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Choose one" />
          </SelectTrigger>
          <SelectContent>
            {(field.options ?? []).map((o) => (
              <SelectItem key={o} value={o}>
                {o}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case "radio":
      return (
        <div className="space-y-2">
          {(field.options ?? []).map((o) => (
            <Choice
              key={o}
              type="radio"
              checked={value === o}
              onChange={() => onChange(o)}
              label={o}
            />
          ))}
        </div>
      );
    case "checkboxes": {
      const arr = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className="space-y-2">
          {(field.options ?? []).map((o) => (
            <Choice
              key={o}
              type="checkbox"
              checked={arr.includes(o)}
              onChange={() =>
                onChange(arr.includes(o) ? arr.filter((x) => x !== o) : [...arr, o])
              }
              label={o}
            />
          ))}
        </div>
      );
    }
    case "yesno":
      return (
        <div className="flex gap-2">
          {[
            { v: true, label: "Yes" },
            { v: false, label: "No" },
          ].map((opt) => (
            <button
              key={opt.label}
              type="button"
              onClick={() => onChange(opt.v)}
              className={cn(
                "rounded-lg border px-4 py-2 text-sm font-medium transition-colors",
                value === opt.v
                  ? "border-primary bg-primary/10 text-primary"
                  : "hover:bg-muted",
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      );
    default:
      return (
        <Input
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}

function Choice({
  type,
  checked,
  onChange,
  label,
}: {
  type: "radio" | "checkbox";
  checked: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-3 text-sm">
      <input
        type={type}
        checked={checked}
        onChange={onChange}
        className="accent-primary size-4"
      />
      {label}
    </label>
  );
}
