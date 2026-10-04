import { describe, expect, it } from "vitest";
import {
  QR_KINDS,
  blankPayload,
  cleanPhone,
  escapeWifi,
  icalLocal,
  normalisePayload,
  normaliseUrl,
  payloadIsSensitive,
  payloadSummary,
  payloadText,
  whatsappNumber,
  type QrPayload,
} from "@/lib/qr/payload";

/**
 * The escaping, mostly.
 *
 * Everything else about a QR code fails loudly — too long, nothing to encode.
 * The escaping fails silently: the picture looks perfect and the phone joins
 * the wrong network, or saves half a surname, or shows a mailto with the
 * subject missing. None of that is visible in a preview, which is why it is
 * tested rather than looked at.
 */

function text(payload: QrPayload): string {
  const res = payloadText(payload);
  if (!res.ok) throw new Error(res.error);
  return res.text;
}

describe("web addresses", () => {
  it("adds a scheme, because text without one shows as words", () => {
    expect(normaliseUrl("flockinsight.com")).toBe("https://flockinsight.com");
    expect(normaliseUrl("  grace.church/give  ")).toBe("https://grace.church/give");
  });

  it("leaves an address that already has one alone", () => {
    expect(normaliseUrl("http://example.com")).toBe("http://example.com");
    expect(normaliseUrl("https://example.com")).toBe("https://example.com");
    expect(normaliseUrl("mailto:a@b.com")).toBe("mailto:a@b.com");
  });

  it("is empty for empty, rather than inventing https://", () => {
    expect(normaliseUrl("")).toBe("");
    expect(normaliseUrl("   ")).toBe("");
  });

  it("refuses an empty address with something to do about it", () => {
    const res = payloadText({ kind: "url", url: "" });
    expect(res).toMatchObject({ ok: false });
    if (!res.ok) expect(res.error).toContain("web address");
  });
});

describe("WiFi", () => {
  it("escapes the five characters the scheme reserves", () => {
    // The bug this prevents: a password with a semicolon in it joins the phone
    // to the network with a truncated password, and the code looks perfect.
    expect(escapeWifi("pass;word")).toBe("pass\\;word");
    expect(escapeWifi('a"b')).toBe('a\\"b');
    expect(escapeWifi("a,b")).toBe("a\\,b");
    expect(escapeWifi("a:b")).toBe("a\\:b");
    expect(escapeWifi("a\\b")).toBe("a\\\\b");
  });

  it("builds the scheme in the order phones read it", () => {
    expect(
      text({
        kind: "wifi",
        ssid: "Grace House Guest",
        password: "Welcome2026",
        security: "WPA",
        hidden: false,
      }),
    ).toBe("WIFI:T:WPA;S:Grace House Guest;P:Welcome2026;;");
  });

  it("carries a semicolon in a password through intact", () => {
    expect(
      text({
        kind: "wifi",
        ssid: "Grace;House",
        password: "a;b:c",
        security: "WPA",
        hidden: true,
      }),
    ).toBe("WIFI:T:WPA;S:Grace\\;House;P:a\\;b\\:c;H:true;;");
  });

  it("omits the password entirely on an open network", () => {
    const out = text({
      kind: "wifi",
      ssid: "Church Guest",
      password: "ignored",
      security: "nopass",
      hidden: false,
    });
    expect(out).toBe("WIFI:T:nopass;S:Church Guest;;");
    expect(out).not.toContain("ignored");
  });

  it("will not build a locked network with no password", () => {
    const res = payloadText({
      kind: "wifi",
      ssid: "Church",
      password: "",
      security: "WPA",
      hidden: false,
    });
    expect(res.ok).toBe(false);
  });

  it("is the one payload treated as a secret on screen", () => {
    expect(
      payloadIsSensitive({
        kind: "wifi",
        ssid: "a",
        password: "b",
        security: "WPA",
        hidden: false,
      }),
    ).toBe(true);
    expect(
      payloadIsSensitive({
        kind: "wifi",
        ssid: "a",
        password: "",
        security: "nopass",
        hidden: false,
      }),
    ).toBe(false);
    expect(payloadIsSensitive({ kind: "url", url: "x" })).toBe(false);
  });

  it("never puts a password in the one-line summary", () => {
    const summary = payloadSummary({
      kind: "wifi",
      ssid: "Grace House",
      password: "Welcome2026",
      security: "WPA",
      hidden: false,
    });
    expect(summary).not.toContain("Welcome2026");
    expect(summary).toContain("Grace House");
  });
});

describe("phone numbers", () => {
  it("strips how a number is written, keeping a leading +", () => {
    expect(cleanPhone("0808 825 6055")).toBe("08088256055");
    expect(cleanPhone("+234 (808) 825-6055")).toBe("+2348088256055");
    expect(cleanPhone("  0808-825-6055  ")).toBe("08088256055");
  });

  it("leaves a local 0 prefix alone rather than guessing a country", () => {
    // Guessing would mean this module deciding which country a church is in;
    // 08088256055 dials correctly where it was written.
    expect(cleanPhone("08088256055")).toBe("08088256055");
  });

  it("gives WhatsApp the country code it insists on", () => {
    // wa.me rejects a trunk zero silently — the link opens and finds nobody.
    expect(whatsappNumber("08088256055")).toBe("2348088256055");
    expect(whatsappNumber("+2348088256055")).toBe("2348088256055");
    expect(whatsappNumber("2348088256055")).toBe("2348088256055");
    // A church outside Nigeria passes its own code in.
    expect(whatsappNumber("07700 900123", "44")).toBe("447700900123");
  });

  it("builds tel:, SMSTO: and wa.me links", () => {
    expect(text({ kind: "phone", phone: "0808 825 6055" })).toBe("tel:08088256055");
    expect(text({ kind: "sms", phone: "08088256055", message: "I'm new" })).toBe(
      "SMSTO:08088256055:I'm new",
    );
    expect(text({ kind: "sms", phone: "08088256055", message: "" })).toBe(
      "SMSTO:08088256055",
    );
    expect(
      text({ kind: "whatsapp", phone: "08088256055", message: "Hello & welcome" }),
    ).toBe("https://wa.me/2348088256055?text=Hello%20%26%20welcome");
  });
});

describe("email", () => {
  it("encodes the subject and body as query parameters", () => {
    expect(
      text({
        kind: "email",
        email: "office@grace.church",
        subject: "Prayer request",
        body: "Hello,\nPlease pray for…",
      }),
    ).toBe(
      "mailto:office@grace.church?subject=Prayer%20request&body=Hello%2C%0APlease%20pray%20for%E2%80%A6",
    );
  });

  it("leaves the query off when there is nothing to put in it", () => {
    expect(text({ kind: "email", email: "a@b.com", subject: "", body: "" })).toBe(
      "mailto:a@b.com",
    );
  });
});

describe("contact cards", () => {
  it("splits a name so neither half is lost", () => {
    const out = text({
      kind: "contact",
      name: "Pastor Emeka Okafor",
      org: "Grace House",
      title: "Senior Pastor",
      phone: "08088256055",
      email: "emeka@grace.church",
      url: "grace.church",
      address: "12 Church Road, Jos",
    });
    expect(out).toContain("N:Emeka Okafor;Pastor;;;");
    expect(out).toContain("FN:Pastor Emeka Okafor");
    expect(out).toContain("TEL;TYPE=CELL:08088256055");
    // A typed address gets its scheme here too.
    expect(out).toContain("URL:https://grace.church");
    expect(out.startsWith("BEGIN:VCARD")).toBe(true);
    expect(out.endsWith("END:VCARD")).toBe(true);
  });

  it("escapes the comma in an address, which every address has", () => {
    const out = text({
      kind: "contact",
      name: "Grace House",
      org: "",
      title: "",
      phone: "",
      email: "",
      url: "",
      address: "12 Church Road, Jos; Plateau",
    });
    expect(out).toContain("ADR;TYPE=WORK:;;12 Church Road\\, Jos\\; Plateau;;;;");
  });

  it("leaves out the lines with nothing in them", () => {
    const out = text({
      kind: "contact",
      name: "Grace House",
      org: "",
      title: "",
      phone: "",
      email: "",
      url: "",
      address: "",
    });
    expect(out).not.toContain("ORG:");
    expect(out).not.toContain("TEL");
    expect(out.split("\n")).toHaveLength(5);
  });
});

describe("places and events", () => {
  it("refuses coordinates that are not numbers", () => {
    const res = payloadText({
      kind: "location",
      latitude: "Jos",
      longitude: "Plateau",
      label: "",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("plain numbers");
  });

  it("builds a geo: link with a label a maps app will show", () => {
    expect(
      text({ kind: "location", latitude: "9.8965", longitude: "8.8583", label: "Grace House" }),
    ).toBe("geo:9.8965,8.8583?q=9.8965,8.8583(Grace%20House)");
    expect(
      text({ kind: "location", latitude: "-6.5", longitude: "3.37", label: "" }),
    ).toBe("geo:-6.5,3.37");
  });

  it("turns a datetime-local value into a floating iCalendar time", () => {
    expect(icalLocal("2026-12-24T18:30")).toBe("20261224T183000");
    expect(icalLocal("2026-12-24 18:30")).toBe("20261224T183000");
    expect(icalLocal("")).toBe("");
    expect(icalLocal("next Sunday")).toBe("");
  });

  it("writes an event with no timezone, so a phone reads it locally", () => {
    const out = text({
      kind: "event",
      title: "Carol Service",
      starts: "2026-12-24T18:30",
      ends: "2026-12-24T20:30",
      location: "Grace House, Jos",
      description: "Bring a friend",
    });
    expect(out).toContain("DTSTART:20261224T183000");
    expect(out).toContain("DTEND:20261224T203000");
    expect(out).toContain("LOCATION:Grace House\\, Jos");
    // No TZID and no trailing Z: the time floats to wherever it is scanned.
    expect(out).not.toContain("TZID");
    expect(out).not.toMatch(/DTSTART:[0-9T]+Z/);
  });

  it("will not build an event with no start", () => {
    expect(
      payloadText({
        kind: "event",
        title: "Carol Service",
        starts: "",
        ends: "",
        location: "",
        description: "",
      }),
    ).toMatchObject({ ok: false });
  });
});

describe("stored payloads", () => {
  it("has a blank and a summary for every kind, with none forgotten", () => {
    for (const kind of QR_KINDS) {
      const blank = blankPayload(kind);
      expect(blank.kind).toBe(kind);
      // A blank is incomplete by definition, so it must refuse rather than
      // encode something empty — except text kinds, which say what is missing.
      expect(payloadText(blank).ok).toBe(false);
      expect(typeof payloadSummary(blank)).toBe("string");
      expect(payloadSummary(blank).length).toBeGreaterThan(0);
    }
  });

  it("mends a row written by an older build instead of rejecting it", () => {
    // The shape a jsonb column actually produces: fields missing, a boolean
    // that arrived as a string, an unknown kind.
    expect(normalisePayload({ kind: "wifi", ssid: "Church" })).toEqual({
      kind: "wifi",
      ssid: "Church",
      password: "",
      security: "WPA",
      hidden: false,
    });
    expect(normalisePayload({ kind: "wifi", hidden: "true" })).toMatchObject({
      hidden: false,
    });
    expect(normalisePayload({ kind: "nonsense" })).toEqual({ kind: "url", url: "" });
    expect(normalisePayload(null)).toEqual({ kind: "url", url: "" });
    expect(normalisePayload({ kind: "url", url: 42 })).toEqual({ kind: "url", url: "" });
  });

  it("round-trips every blank through storage unchanged", () => {
    for (const kind of QR_KINDS) {
      const blank = blankPayload(kind);
      expect(normalisePayload(JSON.parse(JSON.stringify(blank)))).toEqual(blank);
    }
  });
});
