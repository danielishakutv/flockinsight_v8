"use client";

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
import { todayIso } from "@/lib/calendar-date";
import type { FirstTimerIntake } from "@/lib/first-timer-shared";

/**
 * The short form, and the whole argument of this module is its length.
 *
 * The membership form asks twenty-five questions, including household,
 * baptism date, wedding anniversary and a four-way status dropdown that
 * defaults to Active. At a welcome desk on a Sunday morning, with somebody
 * standing in front of you, that form is why first-timers were being filed as
 * members and never followed up.
 *
 * So: a name, a way to reach them, and four things the welcome team actually
 * knows. There is NO status field — everything here is a visitor by
 * construction, decided in `registerFirstTimer`, not by whoever is holding the
 * biro.
 */

export type FirstTimerFormState = {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  gender: string;
  firstVisitDate: string;
  invitedById: string;
  invitedByName: string;
  address: string;
  city: string;
  state: string;
  notes: string;
};

export function emptyFirstTimer(now: Date = new Date()): FirstTimerFormState {
  return {
    firstName: "",
    lastName: "",
    phone: "",
    email: "",
    gender: "",
    // Today, because that is nearly always the answer and nobody should have
    // to open a date picker to say so.
    firstVisitDate: todayIso(now),
    invitedById: "",
    invitedByName: "",
    address: "",
    city: "",
    state: "",
    notes: "",
  };
}

export function toIntake(f: FirstTimerFormState): FirstTimerIntake {
  return {
    firstName: f.firstName,
    lastName: f.lastName,
    phone: f.phone,
    email: f.email,
    gender: f.gender,
    firstVisitDate: f.firstVisitDate,
    invitedById: f.invitedById || null,
    invitedByName: f.invitedByName,
    address: f.address,
    city: f.city,
    state: f.state,
    notes: f.notes,
  };
}

export type MemberOption = { id: string; name: string };

export function FirstTimerFields({
  form,
  set,
  members,
  showEmail = true,
  showAddress = true,
  showInvitedBy = true,
  showVisitDate = true,
  showNotes = true,
}: {
  form: FirstTimerFormState;
  set: (patch: Partial<FirstTimerFormState>) => void;
  /** The register, for "who invited them". Empty on the public page. */
  members?: MemberOption[];
  showEmail?: boolean;
  showAddress?: boolean;
  showInvitedBy?: boolean;
  showVisitDate?: boolean;
  showNotes?: boolean;
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="ft-first">First name</Label>
          <Input
            id="ft-first"
            value={form.firstName}
            onChange={(e) => set({ firstName: e.target.value })}
            autoComplete="given-name"
            enterKeyHint="next"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ft-last">Last name</Label>
          <Input
            id="ft-last"
            value={form.lastName}
            onChange={(e) => set({ lastName: e.target.value })}
            autoComplete="family-name"
            enterKeyHint="next"
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="ft-phone">Phone</Label>
          {/*
            `type="tel"`, so a phone shows the number pad. The mobile audit
            script checks for exactly this; a text keyboard here is three extra
            taps for every single person registered.
          */}
          <Input
            id="ft-phone"
            type="tel"
            inputMode="tel"
            value={form.phone}
            onChange={(e) => set({ phone: e.target.value })}
            autoComplete="tel"
            placeholder="0803 000 0000"
          />
        </div>
        {showEmail && (
          <div className="space-y-1.5">
            <Label htmlFor="ft-email">Email</Label>
            <Input
              id="ft-email"
              type="email"
              inputMode="email"
              value={form.email}
              onChange={(e) => set({ email: e.target.value })}
              autoComplete="email"
            />
          </div>
        )}
      </div>

      <p className="text-muted-foreground text-xs">
        A phone number or an email — one of the two, so somebody can actually
        reach them this week.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="ft-gender">Gender</Label>
          <Select
            value={form.gender || "unknown"}
            onValueChange={(v) => set({ gender: v === "unknown" ? "" : v })}
          >
            <SelectTrigger id="ft-gender" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="unknown">Rather not say</SelectItem>
              <SelectItem value="male">Male</SelectItem>
              <SelectItem value="female">Female</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {showVisitDate && (
          <div className="space-y-1.5">
            <Label htmlFor="ft-visit">First visited</Label>
            <Input
              id="ft-visit"
              type="date"
              value={form.firstVisitDate}
              max={todayIso()}
              onChange={(e) => set({ firstVisitDate: e.target.value })}
            />
          </div>
        )}
      </div>

      {showInvitedBy && (
        <div className="space-y-1.5">
          <Label htmlFor="ft-invited">Who invited them?</Label>
          {members && members.length > 0 ? (
            <>
              {/*
                A datalist rather than a dropdown: a church with 2,000 members
                cannot scroll a select, and whoever is typing usually knows the
                name. Picking from the list stores the member id so the inviter
                can be counted later; typing a name that is not on it still
                gets recorded, as text.
              */}
              <Input
                id="ft-invited"
                list="ft-members"
                value={form.invitedByName}
                onChange={(e) => {
                  const typed = e.target.value;
                  const match = members.find((m) => m.name === typed);
                  set({
                    invitedByName: typed,
                    invitedById: match ? match.id : "",
                  });
                }}
                placeholder="Start typing a member's name"
              />
              <datalist id="ft-members">
                {members.map((m) => (
                  <option key={m.id} value={m.name} />
                ))}
              </datalist>
            </>
          ) : (
            <Input
              id="ft-invited"
              value={form.invitedByName}
              onChange={(e) => set({ invitedByName: e.target.value })}
              placeholder="A friend, a member, an advert…"
            />
          )}
        </div>
      )}

      {showAddress && (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="ft-address">Address</Label>
            <Input
              id="ft-address"
              value={form.address}
              onChange={(e) => set({ address: e.target.value })}
              autoComplete="street-address"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ft-city">City or town</Label>
              <Input
                id="ft-city"
                value={form.city}
                onChange={(e) => set({ city: e.target.value })}
                autoComplete="address-level2"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ft-state">State</Label>
              <Input
                id="ft-state"
                value={form.state}
                onChange={(e) => set({ state: e.target.value })}
                autoComplete="address-level1"
              />
            </div>
          </div>
        </div>
      )}

      {showNotes && (
        <div className="space-y-1.5">
          <Label htmlFor="ft-notes">Anything worth remembering</Label>
          <Textarea
            id="ft-notes"
            rows={3}
            value={form.notes}
            onChange={(e) => set({ notes: e.target.value })}
            placeholder="New to the area, asked about the children's church, wants a visit…"
          />
        </div>
      )}
    </div>
  );
}
