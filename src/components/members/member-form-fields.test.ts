import { describe, expect, it } from "vitest";
import { emptyMember } from "@/components/members/member-form-fields";
import { DEFAULT_COUNTRY, DEFAULT_STATE } from "@/lib/geo";

/**
 * What a blank member starts as.
 *
 * Every church used to start its members in Nigeria, Adamawa State. For a
 * church in Maputo that is its whole membership filed under another continent
 * unless somebody corrects two dropdowns for every person they ever add.
 */

describe("a new member", () => {
  it("starts in the church's country", () => {
    expect(emptyMember("Mozambique").country).toBe("Mozambique");
    expect(emptyMember("Kenya").country).toBe("Kenya");
  });

  it("falls back to Nigeria when the church has no country recorded", () => {
    // Every church predating the country field. Unchanged for them.
    expect(emptyMember().country).toBe(DEFAULT_COUNTRY);
    expect(emptyMember(undefined).country).toBe(DEFAULT_COUNTRY);
  });

  it("only pre-fills a state where the state list actually exists", () => {
    /*
     * State -> LGA cascades from the Nigerian list; everywhere else the field
     * is free text, where "Adamawa" would be nonsense a church has to delete.
     */
    expect(emptyMember(DEFAULT_COUNTRY).state).toBe(DEFAULT_STATE);
    expect(emptyMember("Mozambique").state).toBe("");
  });
});
