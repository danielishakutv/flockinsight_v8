"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, HardHat, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { saveProject, type ProjectInput } from "@/app/(app)/giving/projects/actions";
import type { ProjectListItem } from "@/lib/projects";
import { formatMoney } from "@/lib/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ProgressBar } from "@/components/giving/progress-bar";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const STATUS: Record<
  ProjectListItem["status"],
  { label: string; variant: "success" | "secondary" | "outline" }
> = {
  active: { label: "Active", variant: "success" },
  completed: { label: "Completed", variant: "secondary" },
  archived: { label: "Archived", variant: "outline" },
};

type FormState = {
  id?: string;
  name: string;
  description: string;
  targetAmount: string;
  status: "active" | "completed" | "archived";
  startDate: string;
  endDate: string;
};

const empty = (): FormState => ({
  name: "",
  description: "",
  targetAmount: "",
  status: "active",
  startDate: "",
  endDate: "",
});

export function ProjectsManager({
  projects,
  canManage,
  currency,
}: {
  projects: ProjectListItem[];
  canManage: boolean;
  currency: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(empty());
  const set = (p: Partial<FormState>) => setForm((f) => ({ ...f, ...p }));

  function openNew() {
    setForm(empty());
    setOpen(true);
  }

  function save() {
    start(async () => {
      const input: ProjectInput = {
        id: form.id,
        name: form.name,
        description: form.description,
        targetAmount: form.targetAmount,
        status: form.status,
        startDate: form.startDate,
        endDate: form.endDate,
      };
      const res = await saveProject(input);
      if (!res.ok) return void toast.error(res.error);
      toast.success("Project saved");
      setOpen(false);
      router.push(`/giving/projects/${res.id}`);
    });
  }

  return (
    <div className="space-y-4">
      {canManage && (
        <div className="flex justify-end">
          <Button onClick={openNew}>
            <Plus className="size-4" /> New project
          </Button>
        </div>
      )}

      {projects.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <div className="bg-primary/10 text-primary grid size-14 place-items-center rounded-2xl">
              <HardHat className="size-7" />
            </div>
            <p className="text-muted-foreground max-w-sm">
              No projects yet. Create one — like a building fund — then add
              pledges and record payments toward it.
            </p>
            {canManage && (
              <Button onClick={openNew}>
                <Plus className="size-4" /> New project
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {projects.map((p) => {
            const goal = p.targetAmount ?? (p.pledged || 0);
            return (
              <Link key={p.id} href={`/giving/projects/${p.id}`} className="block">
                <Card className="hover:border-primary/40 transition-colors">
                  <CardContent className="space-y-2 py-4">
                    <div className="flex items-center gap-2">
                      <p className="min-w-0 flex-1 truncate font-bold">{p.name}</p>
                      <Badge variant={STATUS[p.status].variant}>
                        {STATUS[p.status].label}
                      </Badge>
                      <ChevronRight className="text-muted-foreground size-5 shrink-0" />
                    </div>
                    <ProgressBar
                      value={p.raised}
                      target={goal > 0 ? goal : null}
                      currency={currency}
                    />
                    <p className="text-muted-foreground text-xs">
                      {formatMoney(p.raised, currency)} raised
                      {p.targetAmount
                        ? ` of ${formatMoney(p.targetAmount, currency)} target`
                        : ""}{" "}
                      · {formatMoney(p.pledged, currency)} pledged ·{" "}
                      {p.pledgeCount} pledge{p.pledgeCount === 1 ? "" : "s"}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent
          className="max-h-[90dvh] overflow-y-auto sm:max-w-lg"
          aria-describedby={undefined}
        >
          <DialogHeader>
            <DialogTitle>{form.id ? "Edit project" : "New project"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="pr-name">Name</Label>
              <Input
                id="pr-name"
                value={form.name}
                onChange={(e) => set({ name: e.target.value })}
                placeholder="e.g. Building Project"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pr-target">Target amount (optional)</Label>
              <Input
                id="pr-target"
                inputMode="decimal"
                value={form.targetAmount}
                onChange={(e) => set({ targetAmount: e.target.value })}
                placeholder="e.g. 50,000,000"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="pr-start">Start date</Label>
                <Input
                  id="pr-start"
                  type="date"
                  className="h-11"
                  value={form.startDate}
                  onChange={(e) => set({ startDate: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pr-end">Target end date</Label>
                <Input
                  id="pr-end"
                  type="date"
                  className="h-11"
                  value={form.endDate}
                  onChange={(e) => set({ endDate: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="pr-desc">Description</Label>
              <Textarea
                id="pr-desc"
                rows={3}
                value={form.description}
                onChange={(e) => set({ description: e.target.value })}
                placeholder="What is this project for?"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={save} disabled={pending || !form.name.trim()}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              Save project
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
