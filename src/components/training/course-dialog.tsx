"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { saveCourse, type CourseInput } from "@/app/(app)/training/actions";
import {
  BADGE_COLOR_KEYS,
  TRAINING_BADGE_ICONS,
  TRAINING_KINDS,
  TRAINING_BADGE_COLORS,
  badgeColor,
  badgeLabelFor,
  type TrainingKind,
} from "@/lib/training-shared";
import { BadgeIcon } from "@/components/training/training-badge";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type CourseFormValues = {
  id?: string;
  name: string;
  kind: TrainingKind;
  description: string;
  level: number;
  badgeLabel: string;
  badgeColor: string;
  badgeIcon: string;
  showBadge: boolean;
  passMark: string;
  issuesCertificate: boolean;
  isActive: boolean;
};

export const emptyCourse: CourseFormValues = {
  name: "",
  kind: "class",
  description: "",
  level: 1,
  badgeLabel: "",
  badgeColor: "indigo",
  badgeIcon: "check",
  showBadge: true,
  passMark: "",
  issuesCertificate: false,
  isActive: true,
};

/** Live preview of the chip that will sit beside a member's name. */
function BadgePreview({ form }: { form: CourseFormValues }) {
  const color = badgeColor(form.badgeColor);
  const label = badgeLabelFor({
    name: form.name || "New course",
    badgeLabel: form.badgeLabel,
  });

  return (
    <div className="flex items-center gap-2 rounded-lg border px-3 py-2.5">
      <span className="text-muted-foreground text-xs font-semibold">
        Beside a name:
      </span>
      <span className="text-sm font-bold">Grace Adeyemi</span>
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] leading-none font-bold ring-1 ring-inset",
          color.className,
        )}
      >
        <BadgeIcon icon={form.badgeIcon} className="size-2.5" strokeWidth={2.75} />
        {label}
      </span>
    </div>
  );
}

export function CourseDialog({
  open,
  onOpenChange,
  initial,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial: CourseFormValues;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<CourseFormValues>(initial);

  // Re-seed whenever the dialog is opened for a different course.
  const [seed, setSeed] = useState(initial);
  if (seed !== initial) {
    setSeed(initial);
    setForm(initial);
  }

  function save() {
    const payload: CourseInput = {
      id: form.id,
      name: form.name,
      kind: form.kind,
      description: form.description || null,
      level: form.level,
      badgeLabel: form.badgeLabel || null,
      badgeColor: form.badgeColor,
      badgeIcon: form.badgeIcon as CourseInput["badgeIcon"],
      showBadge: form.showBadge,
      passMark: form.passMark === "" ? null : Number(form.passMark),
      issuesCertificate: form.issuesCertificate,
      isActive: form.isActive,
    };

    startTransition(async () => {
      const res = await saveCourse(payload);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(form.id ? "Saved" : "Course created");
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{form.id ? "Edit course" : "New course"}</DialogTitle>
          <DialogDescription>
            A course is the thing itself — Foundation, Baptism, Leadership. You
            run it as one or more classes, and people enrol in those.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="c-name">Name</Label>
            <Input
              id="c-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Foundation Class"
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label>Type</Label>
            <Select
              value={form.kind}
              onValueChange={(v) =>
                setForm({ ...form, kind: v as TrainingKind })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TRAINING_KINDS.map((k) => (
                  <SelectItem key={k.value} value={k.value}>
                    {k.label} — {k.hint}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="c-desc">Description</Label>
            <Textarea
              id="c-desc"
              rows={3}
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
              placeholder="What it covers, and who it's for."
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="c-level">Level</Label>
              <Input
                id="c-level"
                type="number"
                min={1}
                max={20}
                value={form.level}
                onChange={(e) =>
                  setForm({ ...form, level: Number(e.target.value) || 1 })
                }
              />
              <p className="text-muted-foreground text-[11px]">
                Higher wins. A member&rsquo;s standing is their highest
                completed level.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="c-pass">Pass mark</Label>
              <Input
                id="c-pass"
                type="number"
                min={0}
                max={100}
                value={form.passMark}
                onChange={(e) => setForm({ ...form, passMark: e.target.value })}
                placeholder="Leave blank if not scored"
              />
            </div>
          </div>

          <div className="space-y-2 rounded-lg border p-3">
            <p className="text-sm font-bold">Badge</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="c-badge">Short label</Label>
                <Input
                  id="c-badge"
                  maxLength={20}
                  value={form.badgeLabel}
                  onChange={(e) =>
                    setForm({ ...form, badgeLabel: e.target.value })
                  }
                  placeholder={badgeLabelFor({ name: form.name || "" })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Icon</Label>
                <Select
                  value={form.badgeIcon}
                  onValueChange={(v) => setForm({ ...form, badgeIcon: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TRAINING_BADGE_ICONS.map((i) => (
                      <SelectItem key={i} value={i}>
                        {i === "none" ? "No icon" : i}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Colour</Label>
              <div className="flex flex-wrap gap-1.5">
                {BADGE_COLOR_KEYS.map((key) => (
                  <button
                    key={key}
                    type="button"
                    aria-label={TRAINING_BADGE_COLORS[key].label}
                    aria-pressed={form.badgeColor === key}
                    onClick={() => setForm({ ...form, badgeColor: key })}
                    className={cn(
                      "size-7 rounded-full ring-offset-2 transition",
                      TRAINING_BADGE_COLORS[key].dot,
                      form.badgeColor === key &&
                        "ring-foreground ring-2 ring-offset-background",
                    )}
                  />
                ))}
              </div>
            </div>

            <BadgePreview form={form} />

            <div className="flex items-center gap-3">
              <Switch
                id="c-showbadge"
                checked={form.showBadge}
                onCheckedChange={(v) => setForm({ ...form, showBadge: v })}
              />
              <Label htmlFor="c-showbadge" className="cursor-pointer">
                Show this badge beside members&rsquo; names
              </Label>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Switch
              id="c-cert"
              checked={form.issuesCertificate}
              onCheckedChange={(v) =>
                setForm({ ...form, issuesCertificate: v })
              }
            />
            <Label htmlFor="c-cert" className="cursor-pointer">
              Issues a certificate
            </Label>
          </div>

          <div className="flex items-center gap-3">
            <Switch
              id="c-active"
              checked={form.isActive}
              onCheckedChange={(v) => setForm({ ...form, isActive: v })}
            />
            <Label htmlFor="c-active" className="cursor-pointer">
              Active — still being run
            </Label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={pending || !form.name.trim()}>
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Check className="size-4" />
            )}
            {form.id ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
