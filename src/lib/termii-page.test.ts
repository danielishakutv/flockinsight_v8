import { describe, expect, it } from "vitest";
import { readPage } from "@/lib/termii-sender";

/**
 * Reading Termii's sender-ID list, whichever envelope they send.
 *
 * On 2026-09-27 a church's sender ID could not be submitted and never reached
 * Termii. The cause was not the submission at all: Termii had rewritten the
 * service, the list endpoint had changed shape, and the submit path asks the
 * list first — deliberately, because guessing there means registering the same
 * ID twice. The guard did its job; the thing it guarded on had moved.
 *
 * Both fixtures below are real responses from the live API.
 */

/** The rewritten service: a Spring page. */
const SPRING = {
  content: [{ sender_id: "RPM MAGAMI", status: "active" }],
  empty: false,
  first: true,
  last: false,
  number: 0,
  numberOfElements: 1,
  size: 15,
  totalElements: 12,
  totalPages: 2,
};

/** What it used to send. */
const LARAVEL = {
  data: [{ sender_id: "FlockInsght", status: "active" }],
  current_page: 1,
  last_page: 2,
  next_page_url: "https://v3.api.termii.com/api/sender-id?page=2",
};

describe("readPage", () => {
  it("reads the new envelope", () => {
    const out = readPage(SPRING, 0);
    expect(out?.rows).toHaveLength(1);
    expect(out?.rows[0].sender_id).toBe("RPM MAGAMI");
  });

  it("still reads the old envelope", () => {
    // Kept on purpose: some accounts may still be served the old shape, and a
    // reader that understands both cannot be broken by whichever arrives.
    const out = readPage(LARAVEL, 1);
    expect(out?.rows[0].sender_id).toBe("FlockInsght");
  });

  it("knows there is another page to fetch", () => {
    expect(readPage(SPRING, 0)?.hasNext).toBe(true);
    expect(readPage(LARAVEL, 1)?.hasNext).toBe(true);
  });

  it("stops at the last page rather than looping", () => {
    expect(readPage({ ...SPRING, last: true }, 1)?.hasNext).toBe(false);
    expect(
      readPage({ ...LARAVEL, current_page: 2, next_page_url: null }, 2)?.hasNext,
    ).toBe(false);
  });

  it("falls back to the page count when `last` is absent", () => {
    const noLast = { content: SPRING.content, number: 1, totalPages: 2 };
    // Page numbers start at zero, so page 1 of 2 IS the last one. Reading it
    // as "1 < 2, fetch another" would loop over a page that does not exist.
    expect(readPage(noLast, 1)?.hasNext).toBe(false);
    expect(readPage({ ...noLast, number: 0 }, 0)?.hasNext).toBe(true);
  });

  it("reports an empty page as empty, not as a failure", () => {
    // An account with no sender IDs is a fact, not an error — and treating it
    // as one is what stopped a submission reaching the network at all.
    const out = readPage({ content: [], last: true, number: 0, totalPages: 0 }, 0);
    expect(out).not.toBeNull();
    expect(out?.rows).toEqual([]);
    expect(out?.hasNext).toBe(false);
  });

  it("returns null for a shape it does not recognise", () => {
    // The caller turns this into "unexpected response" and REFUSES to submit,
    // which is right: not knowing what is registered must never be read as
    // nothing being registered.
    expect(readPage({ message: "Unauthorized" }, 0)).toBeNull();
  });
});
