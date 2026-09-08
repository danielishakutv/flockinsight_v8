"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ChevronRight,
  GraduationCap,
  Pencil,
  Plus,
  Search,
} from "lucide-react";
import {
  CourseDialog,
  emptyCourse,
  type CourseFormValues,
} from "@/components/training/course-dialog";
import { BadgeIcon } from "@/components/training/training-badge";
import {
  TRAINING_KINDS,
  badgeColor,
  badgeLabelFor,
  type TrainingKind,
} from "@/lib/training-shared";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export type CourseListRow = {
  id: string;
  name: string;
  kind: TrainingKind;
  description: string | null;
  level: number;
  badgeLabel: string | null;
  badgeColor: string;
  badgeIcon: string;
  showBadge: boolean;
  passMark: number | null;
  issuesCertificate: boolean;
  isActive: boolean;
  cohorts: number;
  enrolled: number;
  completed: number;
};

function toForm(c: CourseListRow): CourseFormValues {
  return {
    id: c.id,
    name: c.name,
    kind: c.kind,
    description: c.description ?? "",
    level: c.level,
    badgeLabel: c.badgeLabel ?? "",
    badgeColor: c.badgeColor,
    badgeIcon: c.badgeIcon,
    showBadge: c.showBadge,
    passMark: c.passMark == null ? "" : String(c.passMark),
    issuesCertificate: c.issuesCertificate,
    isActive: c.isActive,
  };
}

const KIND_LABEL: Record<TrainingKind, string> = Object.fromEntries(
  TRAINING_KINDS.map((k) => [k.value, k.label]),
) as Record<TrainingKind, string>;

export function CoursesList({
  courses,
  canManage,
}: {
  courses: CourseListRow[];
  canManage: boolean;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [initial, setInitial] = useState<CourseFormValues>(emptyCourse);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return courses;
    return courses.filter((c) =>
      [c.name, c.description, KIND_LABEL[c.kind]]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(q)),
    );
  }, [courses, query]);

  function openNew() {
    setInitial({ ...emptyCourse });
    setOpen(true);
  }

  function openEdit(c: CourseListRow) {
    setInitial(toForm(c));
    setOpen(true);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:max-w-xs sm:flex-1">
          <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search courses"
            className="pl-9"
          />
        </div>
        {canManage && (
          <Button onClick={openNew} className="shrink-0">
            <Plus className="size-4" /> New course
          </Button>
        )}
      </div>

      {filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <GraduationCap className="text-muted-foreground/50 mx-auto size-10" />
            <p className="mt-3 font-bold">
              {courses.length === 0 ? "No courses yet" : "Nothing matches"}
            </p>
            <p className="text-muted-foreground mx-auto mt-1 max-w-sm text-sm">
              {courses.length === 0
                ? "Add Foundation, Baptism, Pre-Marital — whatever your church runs. Then create a class for each time you run one."
                : "Try a different search."}
            </p>
            {canManage && courses.length === 0 && (
              <Button onClick={openNew} className="mt-4">
                <Plus className="size-4" /> New course
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {filtered.map((c) => {
            const color = badgeColor(c.badgeColor);
            return (
              <Card key={c.id} className={cn(!c.isActive && "opacity-60")}>
                <CardContent className="flex items-start gap-3">
                  <Link
                    href={`/training/courses/${c.id}`}
                    className="flex min-w-0 flex-1 items-start gap-3"
                  >
                    <span
                      className={cn(
                        "grid size-10 shrink-0 place-items-center rounded-xl ring-1 ring-inset",
                        color.className,
                      )}
                    >
                      {/* A tile always shows something, so "no icon" falls
                          back to the module's own mark rather than a hole. */}
                      <BadgeIcon
                        icon={c.badgeIcon === "none" ? "graduation" : c.badgeIcon}
                        className="size-5"
                        strokeWidth={2.4}
                      />
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className="truncate font-bold">{c.name}</p>
                        <span className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[10px] font-bold">
                          {KIND_LABEL[c.kind]}
                        </span>
                        {c.showBadge && (
                          <span
                            className={cn(
                              "rounded-full px-1.5 py-0.5 text-[10px] leading-none font-bold ring-1 ring-inset",
                              color.className,
                            )}
                          >
                            {badgeLabelFor(c)}
                          </span>
                        )}
                        {!c.isActive && (
                          <span className="text-muted-foreground text-[10px] font-bold uppercase">
                            Inactive
                          </span>
                        )}
                      </div>
                      {c.description && (
                        <p className="text-muted-foreground mt-0.5 line-clamp-1 text-xs">
                          {c.description}
                        </p>
                      )}
                      <p className="text-muted-foreground mt-1.5 text-[11px] font-semibold">
                        Level {c.level} · {c.cohorts} class
                        {c.cohorts === 1 ? "" : "es"} · {c.enrolled} enrolled ·{" "}
                        <span className="text-emerald-600 dark:text-emerald-400">
                          {c.completed} completed
                        </span>
                      </p>
                    </div>
                    <ChevronRight className="text-muted-foreground/60 mt-1 size-4 shrink-0" />
                  </Link>

                  {canManage && (
                    <button
                      type="button"
                      onClick={() => openEdit(c)}
                      aria-label={`Edit ${c.name}`}
                      className="hover:bg-accent text-muted-foreground shrink-0 rounded-md p-1.5"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <CourseDialog open={open} onOpenChange={setOpen} initial={initial} />
    </div>
  );
}
