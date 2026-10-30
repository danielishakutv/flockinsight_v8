import { describe, expect, it } from "vitest";
import { en } from "@/lib/i18n/dictionaries";
import {
  DEFAULT_ORG_TYPE,
  ORG_TYPES,
  ORG_TYPE_LABELS,
  cleanOrgType,
  orgTypeLabel,
} from "@/lib/org-type";

describe("organisation types", () => {
  it("reads anything unknown as a church, which every older account is", () => {
    expect(DEFAULT_ORG_TYPE).toBe("church");
    expect(cleanOrgType(undefined)).toBe("church");
    expect(cleanOrgType(null)).toBe("church");
    expect(cleanOrgType("")).toBe("church");
    expect(cleanOrgType("Fellowship")).toBe("church"); // case matters
    expect(cleanOrgType("<script>")).toBe("church");
    expect(cleanOrgType("mission")).toBe("mission");
    expect(orgTypeLabel("nonsense")).toBe("Church");
  });

  it("has an English label and every dictionary string for every type", () => {
    // A type added to the list without its strings would render the key.
    for (const type of ORG_TYPES) {
      expect(ORG_TYPE_LABELS[type].trim(), type).not.toBe("");
      const words = en.orgType[type];
      expect(words, type).toBeDefined();
      for (const key of ["label", "hint", "name", "placeholder"] as const) {
        expect(words[key].trim(), `${type}.${key}`).not.toBe("");
      }
    }
  });
});
