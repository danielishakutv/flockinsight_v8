"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronUp, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { saveSurvey } from "@/app/superadmin/surveys/actions";
import {
  FIELD_TYPES,
  FIELD_TYPE_META,
  blankField,
  type FormField,
  type FormFieldType,
  type FormStatus,
} from "@/lib/forms-shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * A survey's questions and audience.
 *
 * Its own component rather than the church form builder generalised: that one
 * carries slugs, member matching, event links and confirmation messages, none
 * of which apply here, and bending it into shape would put every church's
 * Forms page in the blast radius of a superadmin change. The question TYPES
 * are shared, which is the part worth sharing.
 */

type Survey = {
  id: string;
  title: string;
  description: string | null;
  status: FormStatus;
  anonymous: boolean;
  audience: string;
  targetPlan: string | null;
  targetCountry: string | null;
  churchIds: string[];
  fields: FormField[];
};

export function SurveyEditor({
  survey,
  audienceSize,
}: {
  survey: Survey;
  audienceSize: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const [title, setTitle] = useState(survey.title);
  const [description, setDescription] = useState(survey.description ?? "");
  const [status, setStatus] = useState<FormStatus>(survey.status);
  const [anonymous, setAnonymous] = useState(survey.anonymous);
  const [audience, setAudience] = useState(survey.audience);
  const [targetPlan, setTargetPlan] = useState(survey.targetPlan ?? "starter");
  const [fields, setFields] = useState<FormField[]>(survey.fields);

  const patch = (id: string, next: Partial<FormField>) =>
    setFields((prev) => prev.map((f) => (f.id === id ? { ...f, ...next } : f)));

  const move = (index: number, by: number) =>
    setFields((prev) => {
      const next = [...prev];
      const to = index + by;
      if (to < 0 || to >= next.length) return prev;
      [next[index], next[to]] = [next[to], next[index]];
      return next;
    });

  const save = () =>
    start(async () => {
      const res = await saveSurvey({
        id: survey.id,
        title: title.trim(),
        description: description.trim() || undefined,
        status,
        anonymous,
        audience,
        targetPlan: audience === "plan" ? targetPlan : null,
        targetCountry: survey.targetCountry,
        churchIds: survey.churchIds,
        fields,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Saved.");
      router.refresh();
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Questions &amp; audience</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="s-title">Title</Label>
            <Input
              id="s-title"
              value={title}
              maxLength={160}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="s-status">Status</Label>
            <Select
              value={status}
              onValueChange={(v) => setStatus(v as FormStatus)}
            >
              <SelectTrigger id="s-status" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">Draft — nobody can answer</SelectItem>
                <SelectItem value="open">Open — accepting answers</SelectItem>
                <SelectItem value="closed">Closed — no more answers</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="s-desc">Introduction</Label>
            <Textarea
              id="s-desc"
              value={description}
              maxLength={600}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="One line explaining why you are asking."
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="s-audience">Who gets it</Label>
            <Select value={audience} onValueChange={setAudience}>
              <SelectTrigger id="s-audience" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Every church</SelectItem>
                <SelectItem value="plan">One plan</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-xs">
              Reaches {audienceSize} {audienceSize === 1 ? "church" : "churches"}.
            </p>
          </div>

          {audience === "plan" && (
            <div className="space-y-2">
              <Label htmlFor="s-plan">Plan</Label>
              <Select value={targetPlan} onValueChange={setTargetPlan}>
                <SelectTrigger id="s-plan" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="starter">Starter</SelectItem>
                  <SelectItem value="growth">Growth</SelectItem>
                  <SelectItem value="pro">Pro</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <label className="flex items-start gap-3 rounded-xl border p-3">
          <Switch
            checked={anonymous}
            onCheckedChange={setAnonymous}
            aria-label="Record answers anonymously"
            className="mt-0.5 shrink-0"
          />
          <span className="min-w-0">
            <span className="block text-sm font-semibold">Anonymous</span>
            <span className="text-muted-foreground block text-xs leading-relaxed">
              No church and no person is recorded against the answer. It is the
              difference between &ldquo;how are we doing?&rdquo; and &ldquo;how
              are YOU doing?&rdquo;, and a church that knows it is identified
              answers the second question.
            </span>
          </span>
        </label>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold">
              {fields.length} question{fields.length === 1 ? "" : "s"}
            </h3>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setFields((p) => [...p, blankField("short_text")])}
            >
              <Plus />
              Add
            </Button>
          </div>

          {fields.map((f, i) => (
            <div key={f.id} className="space-y-2 rounded-xl border p-3">
              <div className="flex items-start gap-2">
                <Input
                  value={f.label}
                  maxLength={200}
                  onChange={(e) => patch(f.id, { label: e.target.value })}
                  placeholder="Your question"
                  className="font-medium"
                />
                <div className="flex shrink-0 gap-1">
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={`Move question ${i + 1} up`}
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                  >
                    <ChevronUp />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={`Move question ${i + 1} down`}
                    disabled={i === fields.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    <ChevronDown />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={`Remove question ${i + 1}`}
                    onClick={() =>
                      setFields((p) => p.filter((x) => x.id !== f.id))
                    }
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <Select
                  value={f.type}
                  onValueChange={(v) =>
                    patch(f.id, { type: v as FormFieldType, options: [] })
                  }
                >
                  <SelectTrigger className="w-full" aria-label="Question type">
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

                <label className="flex items-center gap-2 text-sm font-medium">
                  <Switch
                    checked={f.required}
                    onCheckedChange={(v) => patch(f.id, { required: v })}
                    aria-label={`Make question ${i + 1} required`}
                  />
                  Required
                </label>
              </div>

              {FIELD_TYPE_META[f.type].hasOptions && (
                <Textarea
                  value={(f.options ?? []).join("\n")}
                  onChange={(e) =>
                    patch(f.id, {
                      options: e.target.value.split("\n").filter(Boolean),
                    })
                  }
                  placeholder="One choice per line"
                  rows={3}
                />
              )}
            </div>
          ))}
        </div>

        <Button type="button" onClick={save} disabled={pending}>
          {pending && <Loader2 className="animate-spin" />}
          Save survey
        </Button>
      </CardContent>
    </Card>
  );
}
