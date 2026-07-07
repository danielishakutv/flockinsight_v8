import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { member } from "@/db/schema";

/** CSV column order for export and the template. */
export const MEMBER_CSV_HEADERS = [
  "First name",
  "Middle name",
  "Last name",
  "Gender",
  "Status",
  "Phone",
  "Email",
  "Date of birth",
  "Date joined",
  "House",
  "Street",
  "City",
  "LGA",
  "State",
  "Country",
  "Notes",
] as const;

/** One illustrative row shown in the downloadable template. */
export const MEMBER_CSV_SAMPLE: string[] = [
  "John",
  "",
  "Doe",
  "male",
  "active",
  "08012345678",
  "john@example.com",
  "1990-04-12",
  "2026-01-05",
  "12",
  "Church Road",
  "Yola",
  "Yola North",
  "Adamawa",
  "Nigeria",
  "",
];

export type MemberFieldKey =
  | "firstName"
  | "middleName"
  | "lastName"
  | "gender"
  | "status"
  | "phone"
  | "email"
  | "dateOfBirth"
  | "joinedAt"
  | "house"
  | "street"
  | "city"
  | "lga"
  | "state"
  | "country"
  | "notes";

/** Normalize a header for tolerant matching ("First Name" → "firstname"). */
export function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Recognized header aliases → member field key. */
const HEADER_ALIASES: Record<string, MemberFieldKey> = {
  firstname: "firstName",
  first: "firstName",
  middlename: "middleName",
  middle: "middleName",
  lastname: "lastName",
  surname: "lastName",
  gender: "gender",
  sex: "gender",
  status: "status",
  phone: "phone",
  phonenumber: "phone",
  mobile: "phone",
  email: "email",
  emailaddress: "email",
  dateofbirth: "dateOfBirth",
  dob: "dateOfBirth",
  birthday: "dateOfBirth",
  datejoined: "joinedAt",
  joined: "joinedAt",
  joindate: "joinedAt",
  house: "house",
  houseno: "house",
  housenumber: "house",
  street: "street",
  address: "street",
  city: "city",
  town: "city",
  lga: "lga",
  localgovernment: "lga",
  localgovernmentarea: "lga",
  state: "state",
  country: "country",
  notes: "notes",
  note: "notes",
};

export function headerToField(header: string): MemberFieldKey | null {
  return HEADER_ALIASES[normalizeHeader(header)] ?? null;
}

export function normalizeGender(v: string): "male" | "female" | null {
  const s = v.trim().toLowerCase();
  if (s === "male" || s === "m") return "male";
  if (s === "female" || s === "f") return "female";
  return null;
}

const STATUSES = ["active", "inactive", "visitor", "new_convert"] as const;
export type MemberStatus = (typeof STATUSES)[number];

export function normalizeStatus(v: string): MemberStatus {
  const s = v.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return (STATUSES as readonly string[]).includes(s)
    ? (s as MemberStatus)
    : "active";
}

/** Accept YYYY-MM-DD or YYYY/MM/DD; otherwise null. */
export function normalizeDate(v: string): string | null {
  const s = v.trim();
  if (!s) return null;
  const m = s.match(/^(\d{4})[-/](\d{2})[-/](\d{2})$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/**
 * Members of a church as CSV rows (matching MEMBER_CSV_HEADERS). Pass `ids` to
 * export only a selection; omit for the whole church.
 */
export async function getMemberExportRows(
  churchId: string,
  ids?: string[],
): Promise<(string | null)[][]> {
  const scope =
    ids && ids.length > 0
      ? and(eq(member.churchId, churchId), inArray(member.id, ids))
      : eq(member.churchId, churchId);
  const rows = await db
    .select({
      firstName: member.firstName,
      middleName: member.middleName,
      lastName: member.lastName,
      gender: member.gender,
      status: member.status,
      phone: member.phone,
      email: member.email,
      dateOfBirth: member.dateOfBirth,
      joinedAt: member.joinedAt,
      house: member.house,
      street: member.street,
      city: member.city,
      lga: member.lga,
      state: member.state,
      country: member.country,
      notes: member.notes,
    })
    .from(member)
    .where(scope)
    .orderBy(asc(member.firstName), asc(member.lastName));

  return rows.map((m) => [
    m.firstName,
    m.middleName,
    m.lastName,
    m.gender,
    m.status,
    m.phone,
    m.email,
    m.dateOfBirth,
    m.joinedAt,
    m.house,
    m.street,
    m.city,
    m.lga,
    m.state,
    m.country,
    m.notes,
  ]);
}
