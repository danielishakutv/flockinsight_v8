// Pure form helpers + types — safe to import from client OR server.
// (No DB/session here; server logic lives in the form actions.)

export type FormFieldType =
  | "short_text"
  | "long_text"
  | "email"
  | "phone"
  | "number"
  | "date"
  | "select" // single choice, dropdown
  | "radio" // single choice, buttons
  | "checkboxes" // multiple choice
  | "yesno";

/** Optional mapping of a field to a member attribute (for match-or-create). */
export type FieldMap =
  | "none"
  | "firstName"
  | "lastName"
  | "fullName"
  | "phone"
  | "email";

export type FormField = {
  id: string;
  type: FormFieldType;
  label: string;
  description?: string;
  required: boolean;
  options?: string[]; // select | radio | checkboxes
  map?: FieldMap;
};

export type FormStatus = "draft" | "open" | "closed";

/** A submitted value can be text, a number, a list (checkboxes), or a boolean. */
export type FieldValue = string | string[] | number | boolean | null;

export const FIELD_TYPES: {
  type: FormFieldType;
  label: string;
  hasOptions: boolean;
  mappable: boolean;
}[] = [
  { type: "short_text", label: "Short text", hasOptions: false, mappable: true },
  { type: "long_text", label: "Paragraph", hasOptions: false, mappable: false },
  { type: "email", label: "Email", hasOptions: false, mappable: true },
  { type: "phone", label: "Phone", hasOptions: false, mappable: true },
  { type: "number", label: "Number", hasOptions: false, mappable: false },
  { type: "date", label: "Date", hasOptions: false, mappable: false },
  { type: "select", label: "Dropdown", hasOptions: true, mappable: false },
  { type: "radio", label: "Multiple choice", hasOptions: true, mappable: false },
  { type: "checkboxes", label: "Checkboxes", hasOptions: true, mappable: false },
  { type: "yesno", label: "Yes / No", hasOptions: false, mappable: false },
];

export const FIELD_TYPE_META: Record<
  FormFieldType,
  { label: string; hasOptions: boolean; mappable: boolean }
> = Object.fromEntries(
  FIELD_TYPES.map((f) => [f.type, { label: f.label, hasOptions: f.hasOptions, mappable: f.mappable }]),
) as Record<FormFieldType, { label: string; hasOptions: boolean; mappable: boolean }>;

export const MAP_OPTIONS: { value: FieldMap; label: string }[] = [
  { value: "none", label: "Nothing" },
  { value: "fullName", label: "Full name" },
  { value: "firstName", label: "First name" },
  { value: "lastName", label: "Last name" },
  { value: "phone", label: "Phone" },
  { value: "email", label: "Email" },
];

/** Map options offered for a given field type. */
export function mapsForType(type: FormFieldType): FieldMap[] {
  if (type === "email") return ["none", "email"];
  if (type === "phone") return ["none", "phone"];
  if (type === "short_text")
    return ["none", "fullName", "firstName", "lastName"];
  return ["none"];
}

let nextId = 0;
/** A reasonably-unique field id (client-side, for new fields). */
export function newFieldId(): string {
  nextId += 1;
  return `f${nextId}_${Math.random().toString(36).slice(2, 8)}`;
}

export function blankField(type: FormFieldType = "short_text"): FormField {
  return {
    id: newFieldId(),
    type,
    label: "",
    required: false,
    options: FIELD_TYPE_META[type].hasOptions ? ["Option 1"] : undefined,
    map: "none",
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validate a set of submitted values against the form's fields.
 * Returns a map of fieldId -> error message (empty = valid). Used on both the
 * client (live feedback) and the server (integrity).
 */
export function validateSubmission(
  fields: FormField[],
  values: Record<string, FieldValue>,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const f of fields) {
    const v = values[f.id];
    const empty =
      v == null ||
      v === "" ||
      (Array.isArray(v) && v.length === 0) ||
      (f.type === "yesno" && v == null);
    if (f.required && empty) {
      errors[f.id] = "This field is required.";
      continue;
    }
    if (empty) continue;
    if (f.type === "email" && typeof v === "string" && !EMAIL_RE.test(v.trim()))
      errors[f.id] = "Enter a valid email address.";
    if (f.type === "number" && typeof v === "string" && v !== "" && isNaN(Number(v)))
      errors[f.id] = "Enter a number.";
    if (
      (f.type === "select" || f.type === "radio") &&
      typeof v === "string" &&
      f.options &&
      !f.options.includes(v)
    )
      errors[f.id] = "Choose one of the options.";
  }
  return errors;
}

/** Human-readable answer for display/CSV. */
export function displayValue(v: FieldValue): string {
  if (v == null) return "";
  if (Array.isArray(v)) return v.join("; ");
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}
