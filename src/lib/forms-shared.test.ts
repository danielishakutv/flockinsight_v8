import { describe, expect, it } from "vitest";
import { validateSubmission, type FormField } from "@/lib/forms-shared";

/**
 * A public form's Email field can create a member, so it holds the mailer's
 * rule. The old regex took "name@gmail.com1"; that address was stored, and
 * every email to it was then refused at send time with nobody told.
 */

const emailField: FormField = { id: "e", type: "email", label: "Email", required: false };

describe("validateSubmission: an email field", () => {
  it("refuses what the mailer would refuse", () => {
    for (const v of ["ephraim@gmail.com1", "ada@gmail..com", "ada@gmail", "not an email"]) {
      expect(validateSubmission([emailField], { e: v }).e).toMatch(/valid email/);
    }
  });

  it("accepts a good address, and the damage the mailer repairs", () => {
    for (const v of ["ada@example.com", " Ada@Example.com. ", "<ada@example.com>"]) {
      expect(validateSubmission([emailField], { e: v })).toEqual({});
    }
  });

  it("leaves an optional field that was left empty alone", () => {
    expect(validateSubmission([emailField], { e: "" })).toEqual({});
  });
});
