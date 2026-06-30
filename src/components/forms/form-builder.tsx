"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  GripVertical,
  Loader2,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { updateForm } from "@/app/(app)/forms/actions";
import { useLiveCount } from "@/components/forms/use-live-counts";
import {
  FIELD_TYPES,
  FIELD_TYPE_META,
  MAP_OPTIONS,
  mapsForType,
  blankField,
  type FormField,
  type FormFieldType,
  type FormStatus,
} from "@/lib/forms-shared";
import { slugify } from "@/lib/slug";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

type BuilderState = {
  id: string;
  title: string;
  description: string;
  slug: string;
  status: FormStatus;
  fields: FormField[];
  confirmationMessage: string;
  notifyEmail: boolean;
  notifyInApp: boolean;
  createMembers: boolean;
  addToFollowUp: boolean;
  responseCount: number;
};

const STATUSES: { value: FormStatus; label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "open", label: "Live" },
  { value: "closed", label: "Closed" },
];

export function FormBuilder({
  initial,
  baseUrl,
}: {
  initial: BuilderState;
  baseUrl: string;
}) {
  const router = useRouter();
  const [f, setF] = useState<BuilderState>(initial);
  const [saving, startSave] = useTransition();
  const liveCount = useLiveCount(initial.id, initial.responseCount);

  const set = (patch: Partial<BuilderState>) => setF((p) => ({ ...p, ...patch }));

  function updateField(i: number, patch: Partial<FormField>) {
    setF((p) => ({
      ...p,
      fields: p.fields.map((x, j) => (j === i ? { ...x, ...patch } : x)),
    }));
  }
  function move(i: number, dir: -1 | 1) {
    setF((p) => {
      const next = [...p.fields];
      const j = i + dir;
      if (j < 0 || j >= next.length) return p;
      [next[i], next[j]] = [next[j], next[i]];
      return { ...p, fields: next };
    });
  }
  function addField() {
    setF((p) => ({ ...p, fields: [...p.fields, blankField()] }));
  }
  function removeField(i: number) {
    setF((p) => ({ ...p, fields: p.fields.filter((_, j) => j !== i) }));
  }

  const link = `${baseUrl}/f/${f.slug}`;

  function save() {
    if (!f.title.trim()) return toast.error("Give your form a title.");
    startSave(async () => {
      const res = await updateForm({
        id: f.id,
        title: f.title,
        description: f.description,
        slug: f.slug,
        status: f.status,
        fields: f.fields,
        confirmationMessage: f.confirmationMessage,
        notifyEmail: f.notifyEmail,
        notifyInApp: f.notifyInApp,
        createMembers: f.createMembers,
        addToFollowUp: f.addToFollowUp,
      });
      if (res.ok) {
        toast.success("Form saved");
        router.push("/forms");
      } else toast.error(res.error);
    });
  }

  return (
    <div className="space-y-4 pb-24">
      <div className="flex items-center justify-between">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/forms">
            <ArrowLeft className="size-4" /> Forms
          </Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link href={`/forms/${f.id}/responses`}>
            {liveCount} response{liveCount === 1 ? "" : "s"}
          </Link>
        </Button>
      </div>

      {/* Title + description */}
      <Card>
        <CardContent className="space-y-3 py-5">
          <Input
            value={f.title}
            onChange={(e) => set({ title: e.target.value })}
            placeholder="Form title"
            className="h-auto border-0 px-0 text-2xl font-extrabold shadow-none focus-visible:ring-0"
          />
          <Textarea
            value={f.description}
            onChange={(e) => set({ description: e.target.value })}
            placeholder="Add a description (optional)"
            rows={2}
            className="border-0 px-0 shadow-none focus-visible:ring-0"
          />
        </CardContent>
      </Card>

      {/* Fields */}
      <div className="space-y-3">
        {f.fields.map((field, i) => (
          <FieldEditor
            key={field.id}
            field={field}
            index={i}
            total={f.fields.length}
            onChange={(patch) => updateField(i, patch)}
            onMove={(dir) => move(i, dir)}
            onRemove={() => removeField(i)}
          />
        ))}
        <Button variant="outline" className="w-full" onClick={addField}>
          <Plus className="size-4" /> Add question
        </Button>
      </div>

      {/* Share + status */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Share</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>Public link</Label>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground text-sm">{baseUrl}/f/</span>
              <Input
                value={f.slug}
                onChange={(e) => set({ slug: slugify(e.target.value) })}
                className="w-48"
                placeholder="my-form"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  navigator.clipboard
                    .writeText(link)
                    .then(() => toast.success("Link copied"))
                    .catch(() => toast.error("Couldn't copy"))
                }
              >
                <Copy className="size-4" /> Copy
              </Button>
              {f.status !== "draft" && (
                <Button asChild variant="ghost" size="sm">
                  <a href={link} target="_blank" rel="noreferrer">
                    <ExternalLink className="size-4" /> Open
                  </a>
                </Button>
              )}
            </div>
            <p className="text-muted-foreground text-xs">
              Choose the second half of the link. People don&apos;t need an
              account to fill it in.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Status</Label>
            <div className="flex gap-1.5">
              {STATUSES.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => set({ status: s.value })}
                  className={cn(
                    "rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors",
                    f.status === s.value
                      ? "border-primary bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <p className="text-muted-foreground text-xs">
              Draft is private. Live accepts responses. Closed shows a “no longer
              accepting” message.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ToggleRow
            label="In-app notification on each response"
            checked={f.notifyInApp}
            onChange={(v) => set({ notifyInApp: v })}
          />
          <ToggleRow
            label="Email notification on each response"
            checked={f.notifyEmail}
            onChange={(v) => set({ notifyEmail: v })}
          />
          <ToggleRow
            label="Create / match a member from each response"
            description="Uses the fields you mark as Full name, Phone or Email."
            checked={f.createMembers}
            onChange={(v) => set({ createMembers: v })}
          />
          {f.createMembers && (
            <ToggleRow
              label="Add new members to Follow-up"
              checked={f.addToFollowUp}
              onChange={(v) => set({ addToFollowUp: v })}
            />
          )}
          <div className="space-y-1.5">
            <Label htmlFor="confirm">Confirmation message</Label>
            <Textarea
              id="confirm"
              value={f.confirmationMessage}
              onChange={(e) => set({ confirmationMessage: e.target.value })}
              rows={2}
              placeholder="Shown after someone submits the form."
            />
          </div>
        </CardContent>
      </Card>

      {/* Sticky save bar */}
      <div className="bg-background/80 fixed inset-x-0 bottom-0 z-10 border-t p-3 backdrop-blur lg:left-64">
        <div className="mx-auto flex max-w-3xl items-center justify-end gap-3 px-1">
          <Button onClick={save} disabled={saving} size="lg">
            {saving && <Loader2 className="size-4 animate-spin" />}
            Save form
          </Button>
        </div>
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-sm font-medium">{label}</p>
        {description && (
          <p className="text-muted-foreground text-xs">{description}</p>
        )}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function FieldEditor({
  field,
  index,
  total,
  onChange,
  onMove,
  onRemove,
}: {
  field: FormField;
  index: number;
  total: number;
  onChange: (patch: Partial<FormField>) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  const meta = FIELD_TYPE_META[field.type];
  const maps = mapsForType(field.type);

  function changeType(type: FormFieldType) {
    const m = FIELD_TYPE_META[type];
    onChange({
      type,
      options: m.hasOptions ? field.options?.length ? field.options : ["Option 1"] : undefined,
      map: mapsForType(type).includes(field.map ?? "none") ? field.map : "none",
    });
  }

  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <div className="flex items-center gap-2">
          <GripVertical className="text-muted-foreground size-4 shrink-0" />
          <Select value={field.type} onValueChange={(v) => changeType(v as FormFieldType)}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FIELD_TYPES.map((t) => (
                <SelectItem key={t.type} value={t.type}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="ml-auto flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              disabled={index === 0}
              onClick={() => onMove(-1)}
              title="Move up"
            >
              <ChevronUp className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              disabled={index === total - 1}
              onClick={() => onMove(1)}
              title="Move down"
            >
              <ChevronDown className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-destructive size-8"
              onClick={onRemove}
              title="Remove"
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        </div>

        <Input
          value={field.label}
          onChange={(e) => onChange({ label: e.target.value })}
          placeholder="Question"
        />

        {meta.hasOptions && (
          <OptionsEditor
            options={field.options ?? []}
            onChange={(options) => onChange({ options })}
          />
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={field.required}
              onCheckedChange={(v) => onChange({ required: v })}
            />
            Required
          </label>
          {meta.mappable && maps.length > 1 && (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground text-xs">Use as</span>
              <Select
                value={field.map ?? "none"}
                onValueChange={(v) => onChange({ map: v as FormField["map"] })}
              >
                <SelectTrigger className="h-9 w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {maps.map((m) => (
                    <SelectItem key={m} value={m}>
                      {MAP_OPTIONS.find((o) => o.value === m)?.label ?? m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function OptionsEditor({
  options,
  onChange,
}: {
  options: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <div className="space-y-2">
      {options.map((opt, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input
            value={opt}
            onChange={(e) =>
              onChange(options.map((o, j) => (j === i ? e.target.value : o)))
            }
            placeholder={`Option ${i + 1}`}
            className="flex-1"
          />
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-destructive size-8"
            onClick={() => onChange(options.filter((_, j) => j !== i))}
          >
            <X className="size-4" />
          </Button>
        </div>
      ))}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onChange([...options, `Option ${options.length + 1}`])}
      >
        <Plus className="size-4" /> Add option
      </Button>
    </div>
  );
}
