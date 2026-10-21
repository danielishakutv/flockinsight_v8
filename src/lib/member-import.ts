import { unescapeCsvCell } from "@/lib/csv";
import { normalizeBirthday } from "@/lib/birthday";
import { normalizeEmail } from "@/lib/email-address";
import { e164Phone, nationalNumber } from "@/lib/phone-intl";
import {
  headerToField,
  normalizeDate,
  normalizeGender,
  normalizeStatus,
  normalizeYes,
  type MemberFieldKey,
  type MemberStatus,
} from "@/lib/members-data";

/**
 * Turning a members spreadsheet into rows to insert — the decisions, with no
 * database in them, so the round trip "export, edit, import back" can be
 * tested end to end.
 *
 * THREE THINGS THE IMPORT USED TO DO TO A FILE WE HAD EXPORTED OURSELVES:
 *
 * It kept the export's formula-guard apostrophe. `toCsv` writes a phone such
 * as "+234 808 825 6055" as "'+234 808 825 6055" so a spreadsheet will not
 * read it as a formula; the import read the cell raw and saved the apostrophe
 * into the member's phone, notes, anything that began with + - = or @.
 *
 * It ignored the Child, Guardian and Relationship columns the export writes,
 * so every child came back an unlinked adult.
 *
 * It had no idea who was already on the register. Importing the same file
 * twice — or retrying after the response was lost once the transaction had
 * committed — doubled every member, and each copy counted against the plan's
 * member limit. A row that is already on the register (or earlier in the same
 * file) is now skipped and named, and never overwrites anything: an import
 * adds people, it does not edit them.
 *
 * "Already on the register" means the same email, or the same phone AND the
 * same first name. Not the phone alone: a husband and wife, or a mother and
 * her teenage son, very often share one handset, and a phone-only rule
 * skipped the second of them as a duplicate — a real person silently left out
 * of a first-ever import. A shared phone with a different first name is
 * imported, and noted so the church can check it.
 *
 * A row with neither email nor phone — every exported child, and plenty of
 * adults — has no contact to compare, so it is matched on who the person is:
 * the same first and last name AND the same date of birth (or, for a child,
 * the same guardian). A name alone is not enough; two John Smiths are two
 * people. Without this, re-importing an export doubled every such row.
 */

export type ImportedMember = {
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
  lga: string | null;
  state: string | null;
  country: string | null;
  notes: string | null;
  isMinor: boolean;
  relationship: string | null;
};

export type PlannedRow = {
  rowNo: number;
  values: ImportedMember;
  /** The name in the Guardian column, resolved to a member after insert. */
  guardianName: string | null;
};

export type ImportPlan = {
  rows: PlannedRow[];
  errors: string[];
  skipped: number;
  /** How many rows were skipped as already on the register. */
  duplicates: number;
};

/** Error lines kept for the reply. Enough to act on, not a 5,000-line wall. */
export const MAX_IMPORT_ERRORS = 25;

/**
 * The loose shape the import used to accept as an address. A duplicate key
 * only, never what is stored: it lets a member saved under it before the
 * mailer's rule be recognised in their own exported row, without taking
 * "nil", "N/A" or "-" in an empty email column for anybody's address.
 */
const ADDRESS_SHAPED = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clip(v: string | undefined, max: number): string | null {
  const s = (v ?? "").trim();
  return s ? s.slice(0, max) : null;
}

/** How a first name is compared when a phone is shared: case and spacing aside. */
export function firstNameKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Who answers to each phone: national number → the first names on it.
 * Built by the route from the register, and by the plan as it reads the file.
 */
export type PhoneOwners = Map<string, Set<string>>;

/** Add one person to a {@link PhoneOwners} map. */
export function addPhoneOwner(owners: PhoneOwners, national: string, firstName: string): void {
  const names = owners.get(national) ?? new Set<string>();
  names.add(firstNameKey(firstName));
  owners.set(national, names);
}

/**
 * Who somebody with no contact on file is, for duplicate detection: their
 * name and their date of birth, or their name and their guardian's name.
 * Null when there is only a name to go on — not enough to call two rows one
 * person.
 */
export function personKey(
  firstName: string,
  lastName: string | null,
  dateOfBirth: string | null,
  guardianName: string | null,
): string | null {
  const name = `${firstNameKey(firstName)}|${firstNameKey(lastName ?? "")}`;
  if (dateOfBirth) return `${name}|dob:${dateOfBirth}`;
  if (guardianName) return `${name}|guardian:${firstNameKey(guardianName)}`;
  return null;
}

/**
 * Plan an import from parsed CSV rows (header first).
 *
 * `existingEmails` are lower-cased; `existingPhones` maps each national number
 * (as `nationalNumber(phone, dial)` gives it) to the first names of the members
 * who have it. A row is a duplicate on the same email, or on the same phone
 * held by somebody of the same first name. `existingPeople` holds a
 * {@link personKey} for every member on file (both the date-of-birth and the
 * guardian form where they apply), for rows that carry no contact at all.
 */
export function planMemberImport(
  rows: string[][],
  opts: {
    dial: string;
    existingEmails: Set<string>;
    existingPhones: PhoneOwners;
    existingPeople?: Set<string>;
    maxRows: number;
  },
): ImportPlan {
  const colMap: (MemberFieldKey | null)[] = rows[0].map(headerToField);
  const errors: string[] = [];
  const note = (msg: string) => {
    if (errors.length < MAX_IMPORT_ERRORS) errors.push(msg);
  };
  /*
   * The register's addresses as stored AND as normalizeEmail reads them. A
   * row's address is normalised before it is compared, so without the second
   * form a member stored as "ada@example.com." would no longer match the
   * "ada@example.com" their own exported row now becomes, and re-importing
   * the export would add them twice.
   */
  const seenEmails = new Set(opts.existingEmails);
  for (const stored of opts.existingEmails) {
    const normal = normalizeEmail(stored);
    if (normal) seenEmails.add(normal);
  }
  // A copy, so planning never changes the caller's map.
  const seenPhones: PhoneOwners = new Map(
    [...opts.existingPhones].map(([k, v]) => [k, new Set(v)]),
  );
  const seenPeople = new Set(opts.existingPeople ?? []);
  const planned: PlannedRow[] = [];
  let skipped = 0;
  let duplicates = 0;

  rows.slice(1, 1 + opts.maxRows).forEach((cells, idx) => {
    const rowNo = idx + 2; // +1 header, +1 to 1-base
    const get = (key: MemberFieldKey): string => {
      const col = colMap.indexOf(key);
      // Every cell, not just the phone: notes and names can start with a
      // character the export guarded too.
      return col >= 0 ? unescapeCsvCell((cells[col] ?? "").trim()) : "";
    };

    const firstName = get("firstName").trim();
    if (!firstName) {
      skipped++;
      note(`Row ${rowNo}: missing first name`);
      return;
    }

    const emailRaw = get("email").trim();
    // The mailer's rule, so nothing is imported that every email would then
    // be refused at. Lower-cased by normalizeEmail, so it is its own key.
    const email = emailRaw ? normalizeEmail(emailRaw) : null;
    /*
     * The cell as written still counts for duplicates, when it is shaped like
     * an address. A member already stored with an address the mailer refuses
     * exports it as it is; matched only on the normalised form, that row
     * would come back in as a second person. Without the shape test, "nil" in
     * the email column made every later row saying "nil" a duplicate of the
     * first, and they were skipped.
     */
    const emailAsWritten =
      emailRaw && ADDRESS_SHAPED.test(emailRaw) ? emailRaw.toLowerCase() : null;
    const phoneRaw = get("phone").trim();
    const phoneKey = phoneRaw ? nationalNumber(phoneRaw, opts.dial) : null;
    const emailKey = email;
    const phoneNames = phoneKey ? seenPhones.get(phoneKey) : undefined;

    const sameEmail =
      (!!emailKey && seenEmails.has(emailKey)) ||
      (!!emailAsWritten && seenEmails.has(emailAsWritten));
    const samePhoneAndName = !!phoneNames && phoneNames.has(firstNameKey(firstName));
    if (sameEmail || samePhoneAndName) {
      skipped++;
      duplicates++;
      note(
        `Row ${rowNo}: ${firstName} is already on the register (same ${
          sameEmail ? "email" : "phone and first name"
        }) — not added again`,
      );
      return;
    }
    if (phoneNames && phoneNames.size > 0) {
      // Imported: a shared family phone is common. Said, so it can be checked.
      note(
        `Row ${rowNo}: ${firstName} shares a phone number with somebody already on the register — added`,
      );
    }
    const dobRaw = get("dateOfBirth").trim();
    const dateOfBirth = dobRaw ? normalizeBirthday(dobRaw) : null;
    const isMinor = normalizeYes(get("isMinor"));
    const guardianName = isMinor ? clip(get("guardianName"), 200) : null;
    const lastName = clip(get("lastName"), 80);

    // No contact to compare: who they are has to do instead.
    const who =
      !emailKey && !phoneKey ? personKey(firstName, lastName, dateOfBirth, guardianName) : null;
    if (who && seenPeople.has(who)) {
      skipped++;
      duplicates++;
      note(
        `Row ${rowNo}: ${firstName} is already on the register (same name and ${
          dateOfBirth ? "date of birth" : "guardian"
        }) — not added again`,
      );
      return;
    }

    if (emailKey) seenEmails.add(emailKey);
    if (emailAsWritten) seenEmails.add(emailAsWritten);
    if (phoneKey) addPhoneOwner(seenPhones, phoneKey, firstName);
    if (who) seenPeople.add(who);

    /*
     * A date that is not a real day is left blank and named, and the row is
     * kept. One "29 Feb 1990" used to reach Postgres and abort the whole
     * file's transaction, with no row number to go and fix.
     */
    if (dobRaw && !dateOfBirth)
      note(`Row ${rowNo}: date of birth "${dobRaw}" is not a date we can read — left blank`);
    // Named for the same reason: dropping it without a word left a member
    // nobody could email and no row number to go and correct.
    if (emailRaw && !email)
      note(`Row ${rowNo}: email "${emailRaw.slice(0, 80)}" is not an address we can send to — left blank`);
    const joinedRaw = get("joinedAt").trim();
    const joinedAt = joinedRaw ? normalizeDate(joinedRaw) : null;
    if (joinedRaw && !joinedAt)
      note(`Row ${rowNo}: date joined "${joinedRaw}" is not a real date — left blank`);

    planned.push({
      rowNo,
      guardianName,
      values: {
        firstName: firstName.slice(0, 80),
        middleName: clip(get("middleName"), 80),
        lastName,
        gender: normalizeGender(get("gender")),
        status: normalizeStatus(get("status")),
        // E.164 against the church's own country when it reads as a number;
        // kept as written (clipped) when it does not, rather than dropped.
        phone: phoneRaw ? (e164Phone(phoneRaw, opts.dial) ?? clip(phoneRaw, 40)) : null,
        email,
        dateOfBirth,
        joinedAt,
        house: clip(get("house"), 120),
        street: clip(get("street"), 160),
        city: clip(get("city"), 120),
        lga: clip(get("lga"), 120),
        state: clip(get("state"), 120),
        country: clip(get("country"), 120),
        notes: clip(get("notes"), 1000),
        isMinor,
        relationship: isMinor ? clip(get("relationship"), 40) : null,
      },
    });
  });

  return { rows: planned, errors, skipped, duplicates };
}

/** How a full name is compared when a Guardian column is resolved. */
export function guardianKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}
