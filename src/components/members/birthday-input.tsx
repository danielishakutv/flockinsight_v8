"use client";

import { useState } from "react";
import { buildBirthday, daysInBirthMonth, splitBirthday } from "@/lib/birthday";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const MONTHS = [
  { value: "01", label: "January" },
  { value: "02", label: "February" },
  { value: "03", label: "March" },
  { value: "04", label: "April" },
  { value: "05", label: "May" },
  { value: "06", label: "June" },
  { value: "07", label: "July" },
  { value: "08", label: "August" },
  { value: "09", label: "September" },
  { value: "10", label: "October" },
  { value: "11", label: "November" },
  { value: "12", label: "December" },
];

/**
 * Day + Month + optional Year picker for a birthday. The year is optional: leave
 * it blank to record just the day & month. Emits a stored ISO string (with a
 * sentinel year when the year is omitted) via `onChange`, or "" when the day or
 * month is missing.
 */
export function BirthdayInput({
  value,
  onChange,
  id,
}: {
  value: string;
  onChange: (iso: string) => void;
  id?: string;
}) {
  const [parts, setParts] = useState(() => splitBirthday(value));
  const [seenValue, setSeenValue] = useState(value);

  // Reseed from the parent only when it changes to a *different* date than our
  // parts (e.g. the form was reset, or a saved member loaded). Keeping our own
  // draft means a partial entry — a day/year with no month yet — isn't lost.
  // Adjusting state during render (vs. an effect) avoids a wasted re-render.
  if (value !== seenValue) {
    setSeenValue(value);
    if ((value || "") !== buildBirthday(parts.month, parts.day, parts.year)) {
      setParts(splitBirthday(value));
    }
  }

  function update(next: Partial<typeof parts>) {
    const merged = { ...parts, ...next };
    // Clamp the day if the new month is shorter (e.g. 31 → 30 Sep, 31 → 29 Feb).
    const maxDay = daysInBirthMonth(merged.month);
    if (Number(merged.day) > maxDay) merged.day = String(maxDay).padStart(2, "0");
    setParts(merged);
    onChange(buildBirthday(merged.month, merged.day, merged.year));
  }

  const maxDay = daysInBirthMonth(parts.month);
  const days = Array.from({ length: maxDay }, (_, i) =>
    String(i + 1).padStart(2, "0"),
  );

  return (
    // Day / Month / Year share the row proportionally and all shrink together,
    // so the picker stays usable from a full-width field down to a cramped one
    // (Month keeps the largest share since its labels are the longest).
    <div className="flex gap-2">
      <Select
        value={parts.day || undefined}
        onValueChange={(v) => update({ day: v })}
      >
        <SelectTrigger id={id} className="h-11 min-w-0 flex-[0_1_4.5rem]">
          <SelectValue placeholder="Day" />
        </SelectTrigger>
        <SelectContent className="max-h-64">
          {days.map((d) => (
            <SelectItem key={d} value={d}>
              {Number(d)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={parts.month || undefined}
        onValueChange={(v) => update({ month: v })}
      >
        <SelectTrigger className="h-11 min-w-0 flex-[1_1_7rem]">
          <SelectValue placeholder="Month" />
        </SelectTrigger>
        <SelectContent className="max-h-64">
          {MONTHS.map((m) => (
            <SelectItem key={m.value} value={m.value}>
              {m.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Input
        type="text"
        inputMode="numeric"
        placeholder="Year"
        aria-label="Year (optional)"
        maxLength={4}
        value={parts.year}
        onChange={(e) =>
          update({ year: e.target.value.replace(/\D/g, "").slice(0, 4) })
        }
        className="h-11 min-w-0 flex-[0_1_4.5rem]"
      />
    </div>
  );
}
