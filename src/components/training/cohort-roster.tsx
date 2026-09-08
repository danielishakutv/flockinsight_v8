"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Check,
  CheckCheck,
  Loader2,
  Medal,
  Plus,
  Search,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  addInstructor,
  completeAll,
  enrolMembers,
  removeEnrollment,
  removeInstructor,
  saveResult,
  type ResultInput,
} from "@/app/(app)/training/actions";
import {
  ENROLLMENT_STATUSES,
  passed,
  rankScores,
  type EnrollmentStatus,
} from "@/lib/training-shared";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

export type RosterRow = {
  id: string;
  memberId: string;
  firstName: string;
  lastName: string | null;
  phone: string | null;
  status: EnrollmentStatus;
  score: number | null;
  grade: string | null;
  certificateNo: string | null;
  completedAt: string | null;
  notes: string | null;
};

export type PickerMember = {
  id: string;
  firstName: string;
  lastName: string | null;
  phone: string | null;
};

export type InstructorView = {
  id: string;
  memberId: string | null;
  name: string;
  role: string | null;
};

const STATUS_CLASS: Record<EnrollmentStatus, string> = {
  enrolled: "bg-sky-500/12 text-sky-700 dark:text-sky-300",
  in_progress: "bg-amber-500/12 text-amber-700 dark:text-amber-300",
  completed: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
  withdrawn: "bg-slate-500/12 text-slate-600 dark:text-slate-400",
  failed: "bg-rose-500/12 text-rose-700 dark:text-rose-300",
};

function nameOf(p: { firstName: string; lastName: string | null }) {
  return [p.firstName, p.lastName].filter(Boolean).join(" ");
}
function initialsOf(p: { firstName: string; lastName: string | null }) {
  return [p.firstName?.[0], p.lastName?.[0]].filter(Boolean).join("").toUpperCase();
}

type ResultForm = {
  id: string;
  name: string;
  status: EnrollmentStatus;
  score: string;
  grade: string;
  certificateNo: string;
  completedAt: string;
  notes: string;
};

export function CohortRoster({
  cohortId,
  passMark,
  issuesCertificate,
  roster,
  instructors,
  enrollable,
  allMembers,
  canManage,
}: {
  cohortId: string;
  passMark: number | null;
  issuesCertificate: boolean;
  roster: RosterRow[];
  instructors: InstructorView[];
  /** Members not yet on this register — the enrol picker. */
  enrollable: PickerMember[];
  /** The whole congregation — an instructor may also be a student. */
  allMembers: PickerMember[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [addOpen, setAddOpen] = useState(false);
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [pickQuery, setPickQuery] = useState("");

  const [instrOpen, setInstrOpen] = useState(false);
  const [instrMemberId, setInstrMemberId] = useState("__guest__");
  const [instrName, setInstrName] = useState("");
  const [instrRole, setInstrRole] = useState("");

  const [result, setResult] = useState<ResultForm | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [query, setQuery] = useState("");

  // Ranking only means something once results exist, so it appears with them.
  const ranked = useMemo(() => rankScores(roster), [roster]);
  const scored = roster.some((r) => r.score != null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ranked;
    return ranked.filter((r) =>
      [nameOf(r), r.phone, r.grade]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(q)),
    );
  }, [ranked, query]);

  const pickable = useMemo(() => {
    const q = pickQuery.trim().toLowerCase();
    if (!q) return enrollable;
    return enrollable.filter((m) =>
      [nameOf(m), m.phone].filter(Boolean).some((v) => v!.toLowerCase().includes(q)),
    );
  }, [enrollable, pickQuery]);

  const completedCount = roster.filter((r) => r.status === "completed").length;
  const outstanding = roster.filter(
    (r) => r.status === "enrolled" || r.status === "in_progress",
  ).length;

  function togglePick(id: string) {
    setPick((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function doEnrol() {
    const ids = [...pick];
    if (ids.length === 0) return;
    startTransition(async () => {
      const res = await enrolMembers(cohortId, ids);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`Enrolled ${ids.length} ${ids.length === 1 ? "person" : "people"}`);
      setPick(new Set());
      setPickQuery("");
      setAddOpen(false);
      router.refresh();
    });
  }

  function doAddInstructor() {
    const isGuest = instrMemberId === "__guest__";
    startTransition(async () => {
      const res = await addInstructor({
        cohortId,
        memberId: isGuest ? null : instrMemberId,
        name: isGuest ? instrName : null,
        role: instrRole || null,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Instructor added");
      setInstrOpen(false);
      setInstrMemberId("__guest__");
      setInstrName("");
      setInstrRole("");
      router.refresh();
    });
  }

  function dropInstructor(id: string) {
    startTransition(async () => {
      const res = await removeInstructor(id, cohortId);
      if (!res.ok) toast.error(res.error);
      else router.refresh();
    });
  }

  function openResult(r: RosterRow) {
    setResult({
      id: r.id,
      name: nameOf(r),
      status: r.status,
      score: r.score == null ? "" : String(r.score),
      grade: r.grade ?? "",
      certificateNo: r.certificateNo ?? "",
      completedAt: r.completedAt ?? "",
      notes: r.notes ?? "",
    });
  }

  function saveTheResult() {
    if (!result) return;
    const payload: ResultInput = {
      id: result.id,
      cohortId,
      status: result.status,
      score: result.score === "" ? null : Number(result.score),
      grade: result.grade || null,
      certificateNo: result.certificateNo || null,
      completedAt: result.completedAt || null,
      notes: result.notes || null,
    };
    startTransition(async () => {
      const res = await saveResult(payload);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Recorded");
      setResult(null);
      router.refresh();
    });
  }

  function drop(id: string) {
    startTransition(async () => {
      const res = await removeEnrollment(id, cohortId);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Removed from the class");
      setConfirmId(null);
      router.refresh();
    });
  }

  function doCompleteAll() {
    startTransition(async () => {
      const res = await completeAll(cohortId);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Everyone still taking it is marked complete");
      setConfirmAll(false);
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      {/* ---------- Instructors ---------- */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-base">Instructors</CardTitle>
          {canManage && (
            <Button size="sm" variant="outline" onClick={() => setInstrOpen(true)}>
              <Plus className="size-4" /> Add
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {instructors.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Nobody listed yet.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {instructors.map((i) => (
                <span
                  key={i.id}
                  className="bg-muted/60 inline-flex items-center gap-2 rounded-full py-1 pr-1 pl-3 text-sm font-semibold"
                >
                  {i.memberId ? (
                    <Link
                      href={`/members/${i.memberId}`}
                      className="hover:underline"
                    >
                      {i.name}
                    </Link>
                  ) : (
                    i.name
                  )}
                  {i.role && (
                    <span className="text-muted-foreground text-xs font-medium">
                      {i.role}
                    </span>
                  )}
                  {canManage && (
                    <button
                      type="button"
                      onClick={() => dropInstructor(i.id)}
                      aria-label={`Remove ${i.name}`}
                      className="hover:bg-background text-muted-foreground rounded-full p-1"
                    >
                      <X className="size-3" />
                    </button>
                  )}
                </span>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ---------- Roster ---------- */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:max-w-xs sm:flex-1">
          <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search the register"
            className="pl-9"
          />
        </div>
        {canManage && (
          <>
            <Button onClick={() => setAddOpen(true)} className="shrink-0">
              <Plus className="size-4" /> Enrol people
            </Button>
            {outstanding > 0 && (
              <Button
                variant="outline"
                onClick={() => setConfirmAll(true)}
                className="shrink-0"
              >
                <CheckCheck className="size-4" /> Mark all complete
              </Button>
            )}
          </>
        )}
      </div>

      {confirmAll && (
        <Card className="border-dashed">
          <CardContent className="flex flex-wrap items-center gap-3">
            <p className="min-w-0 flex-1 text-sm font-medium">
              Mark all {outstanding} {outstanding === 1 ? "person" : "people"}{" "}
              still taking this as completed? Anyone who withdrew or did not
              pass stays as they are.
            </p>
            <Button onClick={doCompleteAll} disabled={pending}>
              {pending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <CheckCheck className="size-4" />
              )}
              Confirm
            </Button>
            <Button variant="ghost" onClick={() => setConfirmAll(false)}>
              Cancel
            </Button>
          </CardContent>
        </Card>
      )}

      <p className="text-muted-foreground text-xs">
        {roster.length} on the register · {completedCount} completed
      </p>

      {filtered.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <UserRound className="text-muted-foreground/50 mx-auto size-8" />
            <p className="mt-2 font-bold">
              {roster.length === 0 ? "Nobody enrolled yet" : "Nothing matches"}
            </p>
            {roster.length === 0 && canManage && (
              <Button onClick={() => setAddOpen(true)} className="mt-3">
                <Plus className="size-4" /> Enrol people
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="divide-y p-0">
            {filtered.map((r) => {
              const didPass = passed(r.score, passMark);
              return (
                <div key={r.id} className="flex items-center gap-3 px-4 py-3">
                  <Link
                    href={`/members/${r.memberId}`}
                    className="flex min-w-0 flex-1 items-center gap-3"
                  >
                    <Avatar className="size-9">
                      <AvatarFallback className="bg-primary/15 text-primary text-xs font-bold">
                        {initialsOf(r) || "?"}
                      </AvatarFallback>
                    </Avatar>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className="truncate font-semibold">{nameOf(r)}</p>
                        <span
                          className={cn(
                            "rounded px-1.5 py-0.5 text-[10px] font-bold",
                            STATUS_CLASS[r.status],
                          )}
                        >
                          {
                            ENROLLMENT_STATUSES.find((s) => s.value === r.status)
                              ?.label
                          }
                        </span>
                        {scored && r.rank != null && r.rank <= 3 && (
                          <span
                            title={`Position ${r.rank}`}
                            className="inline-flex items-center gap-0.5 rounded bg-amber-500/12 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-300"
                          >
                            <Medal className="size-2.5" /> #{r.rank}
                          </span>
                        )}
                      </div>
                      <p className="text-muted-foreground truncate text-xs">
                        {r.score != null && (
                          <span
                            className={cn(
                              "font-semibold",
                              !didPass && "text-rose-600 dark:text-rose-400",
                            )}
                          >
                            {r.score}
                            {passMark != null && `/100`}
                            {r.grade && ` · ${r.grade}`}
                          </span>
                        )}
                        {r.score == null && r.grade && (
                          <span className="font-semibold">{r.grade}</span>
                        )}
                        {r.completedAt && (
                          <>
                            {(r.score != null || r.grade) && " · "}
                            Completed {r.completedAt}
                          </>
                        )}
                        {!r.completedAt && r.score == null && !r.grade && r.phone}
                      </p>
                    </div>
                  </Link>

                  {canManage &&
                    (confirmId === r.id ? (
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => drop(r.id)}
                          disabled={pending}
                        >
                          Remove
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setConfirmId(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openResult(r)}
                        >
                          Record
                        </Button>
                        <button
                          type="button"
                          onClick={() => setConfirmId(r.id)}
                          aria-label={`Remove ${nameOf(r)}`}
                          className="hover:bg-destructive/10 hover:text-destructive text-muted-foreground rounded-md p-1.5"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    ))}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* ---------- Enrol dialog ---------- */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="flex max-h-[85dvh] flex-col sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Enrol people</DialogTitle>
            <DialogDescription>
              Everyone in your church who isn&rsquo;t already on this register.
            </DialogDescription>
          </DialogHeader>

          <div className="relative">
            <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input
              value={pickQuery}
              onChange={(e) => setPickQuery(e.target.value)}
              placeholder="Search members"
              className="pl-9"
            />
          </div>

          <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
            {pickable.length === 0 ? (
              <p className="text-muted-foreground py-8 text-center text-sm">
                {enrollable.length === 0
                  ? "Everyone is already enrolled."
                  : "Nobody matches that search."}
              </p>
            ) : (
              pickable.map((m) => {
                const on = pick.has(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => togglePick(m.id)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors",
                      on ? "bg-primary/10" : "hover:bg-accent/60",
                    )}
                  >
                    <span
                      className={cn(
                        "grid size-5 shrink-0 place-items-center rounded border",
                        on
                          ? "bg-primary border-primary text-primary-foreground"
                          : "border-input",
                      )}
                    >
                      {on && <Check className="size-3.5" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">
                        {nameOf(m)}
                      </span>
                      {m.phone && (
                        <span className="text-muted-foreground block truncate text-xs">
                          {m.phone}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })
            )}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button onClick={doEnrol} disabled={pending || pick.size === 0}>
              {pending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Check className="size-4" />
              )}
              Enrol {pick.size > 0 && pick.size}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- Instructor dialog ---------- */}
      <Dialog open={instrOpen} onOpenChange={setInstrOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add an instructor</DialogTitle>
            <DialogDescription>
              Pick a member, or type a name for a guest who isn&rsquo;t one.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Member</Label>
              <Select value={instrMemberId} onValueChange={setInstrMemberId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__guest__">
                    Not a member — type a name
                  </SelectItem>
                  {allMembers.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {nameOf(m)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {instrMemberId === "__guest__" && (
              <div className="space-y-1.5">
                <Label htmlFor="i-name">Name</Label>
                <Input
                  id="i-name"
                  value={instrName}
                  onChange={(e) => setInstrName(e.target.value)}
                  placeholder="Pastor Emeka Obi"
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="i-role">Role</Label>
              <Input
                id="i-role"
                value={instrRole}
                onChange={(e) => setInstrRole(e.target.value)}
                placeholder="Instructor"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setInstrOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={doAddInstructor}
              disabled={
                pending ||
                (instrMemberId === "__guest__" && !instrName.trim())
              }
            >
              {pending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Check className="size-4" />
              )}
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- Result dialog ---------- */}
      <Dialog open={!!result} onOpenChange={(v) => !v && setResult(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{result?.name}</DialogTitle>
            <DialogDescription>
              Marking someone completed is what earns them the badge beside
              their name.
            </DialogDescription>
          </DialogHeader>

          {result && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select
                  value={result.status}
                  onValueChange={(v) =>
                    setResult({ ...result, status: v as EnrollmentStatus })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ENROLLMENT_STATUSES.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="r-score">
                    Score{passMark != null && ` (pass ${passMark})`}
                  </Label>
                  <Input
                    id="r-score"
                    type="number"
                    min={0}
                    max={100}
                    value={result.score}
                    onChange={(e) =>
                      setResult({ ...result, score: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="r-grade">Grade</Label>
                  <Input
                    id="r-grade"
                    value={result.grade}
                    onChange={(e) =>
                      setResult({ ...result, grade: e.target.value })
                    }
                    placeholder="A / Distinction"
                  />
                </div>
              </div>

              {result.status === "completed" && (
                <div className="space-y-1.5">
                  <Label htmlFor="r-date">Completed on</Label>
                  <Input
                    id="r-date"
                    type="date"
                    value={result.completedAt}
                    onChange={(e) =>
                      setResult({ ...result, completedAt: e.target.value })
                    }
                  />
                  <p className="text-muted-foreground text-[11px]">
                    Left blank, today&rsquo;s date is used.
                  </p>
                </div>
              )}

              {issuesCertificate && (
                <div className="space-y-1.5">
                  <Label htmlFor="r-cert">Certificate number</Label>
                  <Input
                    id="r-cert"
                    value={result.certificateNo}
                    onChange={(e) =>
                      setResult({ ...result, certificateNo: e.target.value })
                    }
                  />
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="r-notes">Notes</Label>
                <Textarea
                  id="r-notes"
                  rows={3}
                  value={result.notes}
                  onChange={(e) =>
                    setResult({ ...result, notes: e.target.value })
                  }
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setResult(null)}>
              Cancel
            </Button>
            <Button onClick={saveTheResult} disabled={pending}>
              {pending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Check className="size-4" />
              )}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
