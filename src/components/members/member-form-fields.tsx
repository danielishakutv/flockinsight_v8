"use client";

import type { MemberInput } from "@/app/(app)/members/actions";
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

export type MemberStatus = "active" | "inactive" | "visitor" | "new_convert";

export type MemberFormState = {
  id?: string;
  firstName: string;
  middleName: string;
  lastName: string;
  gender: string; // NONE | "male" | "female"
  status: MemberStatus;
  phone: string;
  email: string;
  dateOfBirth: string;
  joinedAt: string;
  house: string;
  street: string;
  city: string;
  state: string;
  country: string;
  notes: string;
};

export const GENDER_NONE = "none";

export const EMPTY_MEMBER: MemberFormState = {
  firstName: "",
  middleName: "",
  lastName: "",
  gender: GENDER_NONE,
  status: "active",
  phone: "",
  email: "",
  dateOfBirth: "",
  joinedAt: "",
  house: "",
  street: "",
  city: "",
  state: "",
  country: "",
  notes: "",
};

/** Build a form state from a saved member record (nulls → empty strings). */
export function memberToForm(m: {
  id: string;
  firstName: string;
  middleName: string | null;
  lastName: string | null;
  gender: "male" | "female" | null;
  status: MemberStatus;
  phone: string | null;
  email: string | null;
  dateOfBirth: string | null;
  joinedAt: string | null;
  house: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  notes: string | null;
}): MemberFormState {
  return {
    id: m.id,
    firstName: m.firstName,
    middleName: m.middleName ?? "",
    lastName: m.lastName ?? "",
    gender: m.gender ?? GENDER_NONE,
    status: m.status,
    phone: m.phone ?? "",
    email: m.email ?? "",
    dateOfBirth: m.dateOfBirth ?? "",
    joinedAt: m.joinedAt ?? "",
    house: m.house ?? "",
    street: m.street ?? "",
    city: m.city ?? "",
    state: m.state ?? "",
    country: m.country ?? "",
    notes: m.notes ?? "",
  };
}

/** Convert form state to the saveMember action input. */
export function memberFormToInput(form: MemberFormState): MemberInput {
  return {
    id: form.id,
    firstName: form.firstName,
    middleName: form.middleName,
    lastName: form.lastName,
    gender: form.gender === GENDER_NONE ? null : (form.gender as "male" | "female"),
    status: form.status,
    phone: form.phone,
    email: form.email,
    dateOfBirth: form.dateOfBirth,
    joinedAt: form.joinedAt,
    house: form.house,
    street: form.street,
    city: form.city,
    state: form.state,
    country: form.country,
    notes: form.notes,
  };
}

export function MemberFormFields({
  form,
  set,
}: {
  form: MemberFormState;
  set: (patch: Partial<MemberFormState>) => void;
}) {
  return (
    <div className="space-y-4">
      {/* Names */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="fn">First name</Label>
          <Input
            id="fn"
            value={form.firstName}
            onChange={(e) => set({ firstName: e.target.value })}
            autoFocus
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="mn">Middle name</Label>
          <Input
            id="mn"
            value={form.middleName}
            onChange={(e) => set({ middleName: e.target.value })}
            placeholder="Optional"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ln">Last name</Label>
          <Input
            id="ln"
            value={form.lastName}
            onChange={(e) => set({ lastName: e.target.value })}
          />
        </div>
      </div>

      {/* Gender + status */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="gender">Gender</Label>
          <Select value={form.gender} onValueChange={(v) => set({ gender: v })}>
            <SelectTrigger id="gender" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={GENDER_NONE}>—</SelectItem>
              <SelectItem value="male">Male</SelectItem>
              <SelectItem value="female">Female</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="status">Status</Label>
          <Select
            value={form.status}
            onValueChange={(v) => set({ status: v as MemberStatus })}
          >
            <SelectTrigger id="status" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="visitor">Visitor</SelectItem>
              <SelectItem value="new_convert">New convert</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Contact */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="phone">Phone</Label>
          <Input
            id="phone"
            value={form.phone}
            onChange={(e) => set({ phone: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            value={form.email}
            onChange={(e) => set({ email: e.target.value })}
          />
        </div>
      </div>

      {/* Dates */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="dob">Date of birth</Label>
          <Input
            id="dob"
            type="date"
            value={form.dateOfBirth}
            onChange={(e) => set({ dateOfBirth: e.target.value })}
            className="h-11"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="joined">Date joined</Label>
          <Input
            id="joined"
            type="date"
            value={form.joinedAt}
            onChange={(e) => set({ joinedAt: e.target.value })}
            className="h-11"
          />
        </div>
      </div>

      {/* Address */}
      <div className="space-y-3 rounded-xl border p-3">
        <p className="text-muted-foreground text-xs font-bold uppercase tracking-wide">
          Address
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="house">House / No.</Label>
            <Input
              id="house"
              value={form.house}
              onChange={(e) => set({ house: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="street">Street</Label>
            <Input
              id="street"
              value={form.street}
              onChange={(e) => set({ street: e.target.value })}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="city">City</Label>
            <Input
              id="city"
              value={form.city}
              onChange={(e) => set({ city: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="state">State</Label>
            <Input
              id="state"
              value={form.state}
              onChange={(e) => set({ state: e.target.value })}
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="country">Country</Label>
          <Input
            id="country"
            value={form.country}
            onChange={(e) => set({ country: e.target.value })}
          />
        </div>
      </div>

      {/* Notes */}
      <div className="space-y-2">
        <Label htmlFor="notes">Notes</Label>
        <Textarea
          id="notes"
          value={form.notes}
          onChange={(e) => set({ notes: e.target.value })}
        />
      </div>
    </div>
  );
}
