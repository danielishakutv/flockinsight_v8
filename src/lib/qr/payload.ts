/**
 * What a QR code actually carries.
 *
 * A QR code encodes a string; the useful part is the handful of conventions
 * phones recognise, each of which has its own escaping rules. Those rules are
 * where this kind of feature usually breaks, and silently: a church WiFi
 * password containing a semicolon produces a code that joins the phone to a
 * network with the wrong password, and nothing in the picture looks wrong.
 *
 * So the escaping lives in one tested place, and the types are narrow enough
 * that a caller cannot forget a field. Pure, client-safe, no imports.
 */

export const QR_KINDS = [
  "link",
  "url",
  "text",
  "wifi",
  "phone",
  "sms",
  "whatsapp",
  "email",
  "contact",
  "location",
  "event",
] as const;

export type QrKind = (typeof QR_KINDS)[number];

/**
 * `link` is a short link of ours; `url` is any address typed in directly.
 *
 * They encode identically — a URL either way — and are kept apart because the
 * difference is the whole point of the module: a `link` can be pointed
 * somewhere else after the poster is printed, and a `url` cannot. A church
 * choosing between them is choosing whether this decision is reversible.
 */
export type QrPayload =
  | { kind: "link"; url: string }
  | { kind: "url"; url: string }
  | { kind: "text"; text: string }
  | {
      kind: "wifi";
      ssid: string;
      password: string;
      security: "WPA" | "WEP" | "nopass";
      hidden: boolean;
    }
  | { kind: "phone"; phone: string }
  | { kind: "sms"; phone: string; message: string }
  | { kind: "whatsapp"; phone: string; message: string }
  | { kind: "email"; email: string; subject: string; body: string }
  | {
      kind: "contact";
      name: string;
      org: string;
      title: string;
      phone: string;
      email: string;
      url: string;
      address: string;
    }
  | { kind: "location"; latitude: string; longitude: string; label: string }
  | {
      kind: "event";
      title: string;
      /** Local wall-clock, `YYYY-MM-DDTHH:mm`, as an <input type=datetime-local> gives it. */
      starts: string;
      ends: string;
      location: string;
      description: string;
    };

export const KIND_LABEL: Record<QrKind, string> = {
  link: "One of your short links",
  url: "A web address",
  text: "Plain text",
  wifi: "WiFi network",
  phone: "Phone number",
  sms: "Text message",
  whatsapp: "WhatsApp chat",
  email: "Email",
  contact: "Contact card",
  location: "A place on the map",
  event: "Calendar event",
};

export const KIND_BLURB: Record<QrKind, string> = {
  link: "Scanning opens one of your short links — so you can change where it goes later, without reprinting anything.",
  url: "Scanning opens this address. Fixed: if the address changes, the code has to be reprinted.",
  text: "Scanning shows the words. Good for a verse, a notice or a code word.",
  wifi: "Scanning joins the phone to your network. No password typed out for visitors.",
  phone: "Scanning starts a call to this number.",
  sms: "Scanning opens a text message, already written, ready to send.",
  whatsapp: "Scanning opens WhatsApp with the message already typed.",
  email: "Scanning opens a new email, with the subject and message filled in.",
  contact: "Scanning offers to save the contact — for a pastor's card or the church office.",
  location: "Scanning opens the spot in a maps app, with directions.",
  event: "Scanning offers to add the service or programme to a phone's calendar.",
};

/* ============================================================
 * Escaping
 * ========================================================== */

/**
 * The WiFi scheme's escaping: a backslash before any of `\ ; , : "`.
 *
 * Specified by the scheme, and the reason it matters is that church passwords
 * are exactly the kind that contain a semicolon. Unescaped, the phone reads
 * the rest of the password as the next field and joins with a truncated one.
 */
export function escapeWifi(value: string): string {
  return value.replace(/([\\;,:"])/g, "\\$1");
}

/** vCard escaping: a backslash before `\ ; ,` and literal newlines as `\n`. */
export function escapeVCard(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** iCalendar escaping — the same shape as vCard's, which is no accident. */
export function escapeICal(value: string): string {
  return escapeVCard(value);
}

/**
 * A phone number as a dialler wants it: digits, with a leading `+` kept.
 *
 * Spaces, dashes and brackets are how a number is written on a poster and are
 * meaningless to a dialler. `0` prefixes are left alone — a Nigerian number
 * written `08088256055` dials correctly at home, and turning it into `+234…`
 * on a guess would be this module deciding which country a church is in.
 */
export function cleanPhone(value: string): string {
  const trimmed = value.trim();
  const plus = trimmed.startsWith("+");
  const digits = trimmed.replace(/[^\d]/g, "");
  return plus ? `+${digits}` : digits;
}

/**
 * A number for a wa.me link, which takes no `+` and no leading zero.
 *
 * WhatsApp requires the full international number with the country code and
 * nothing else — and a Nigerian number is almost always written with the
 * trunk `0` instead, which wa.me silently rejects. So a local number is given
 * its country code, and the default is Nigeria's because that is where most
 * of these churches are; `countryCode` is passed in by the caller from the
 * church's own country profile rather than assumed here.
 */
export function whatsappNumber(value: string, countryCode = "234"): string {
  const digits = cleanPhone(value).replace(/^\+/, "");
  if (digits.startsWith("0")) return countryCode + digits.slice(1);
  return digits;
}

/** `YYYY-MM-DDTHH:mm` to iCalendar's floating local `YYYYMMDDTHHMMSS`. */
export function icalLocal(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(value.trim());
  if (!m) return "";
  return `${m[1]}${m[2]}${m[3]}T${m[4]}${m[5]}00`;
}

/* ============================================================
 * Building the string
 * ========================================================== */

/**
 * Make sure a typed address has a scheme.
 *
 * Without this, "flockinsight.com" encodes as plain text and a phone shows the
 * words instead of opening anything — which looks, to the person who made the
 * code, exactly like a broken QR code.
 */
export function normaliseUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
  return `https://${trimmed.replace(/^\/+/, "")}`;
}

export type PayloadResult =
  | { ok: true; text: string }
  | { ok: false; error: string };

/** The string to encode, or the one thing that is missing. */
export function payloadText(payload: QrPayload, options: { countryCode?: string } = {}): PayloadResult {
  switch (payload.kind) {
    case "link":
    case "url": {
      const url = normaliseUrl(payload.url);
      if (!url) return { ok: false, error: "Add the web address this should open." };
      return { ok: true, text: url };
    }

    case "text": {
      if (!payload.text.trim()) return { ok: false, error: "Add the words to show." };
      return { ok: true, text: payload.text };
    }

    case "wifi": {
      if (!payload.ssid.trim()) return { ok: false, error: "Add the network name." };
      if (payload.security !== "nopass" && !payload.password) {
        return { ok: false, error: "Add the network password, or choose “Open network”." };
      }
      /*
       * Field order is not arbitrary: Android reads T, S, P, H in that order
       * and some versions stop at the first field they do not expect. The
       * trailing `;;` is part of the scheme, not a typo.
       */
      const parts = [`T:${payload.security}`, `S:${escapeWifi(payload.ssid.trim())}`];
      if (payload.security !== "nopass") parts.push(`P:${escapeWifi(payload.password)}`);
      if (payload.hidden) parts.push("H:true");
      return { ok: true, text: `WIFI:${parts.join(";")};;` };
    }

    case "phone": {
      const phone = cleanPhone(payload.phone);
      if (!phone) return { ok: false, error: "Add the phone number." };
      return { ok: true, text: `tel:${phone}` };
    }

    case "sms": {
      const phone = cleanPhone(payload.phone);
      if (!phone) return { ok: false, error: "Add the phone number." };
      // SMSTO: is the form both Android and iOS handle; `sms:?body=` is not.
      return {
        ok: true,
        text: payload.message
          ? `SMSTO:${phone}:${payload.message}`
          : `SMSTO:${phone}`,
      };
    }

    case "whatsapp": {
      const phone = whatsappNumber(payload.phone, options.countryCode);
      if (!phone) return { ok: false, error: "Add the WhatsApp number." };
      const query = payload.message
        ? `?text=${encodeURIComponent(payload.message)}`
        : "";
      return { ok: true, text: `https://wa.me/${phone}${query}` };
    }

    case "email": {
      const email = payload.email.trim();
      if (!email) return { ok: false, error: "Add the email address." };
      const query = [
        payload.subject && `subject=${encodeURIComponent(payload.subject)}`,
        payload.body && `body=${encodeURIComponent(payload.body)}`,
      ]
        .filter(Boolean)
        .join("&");
      return { ok: true, text: `mailto:${email}${query ? `?${query}` : ""}` };
    }

    case "contact": {
      const name = payload.name.trim();
      if (!name) return { ok: false, error: "Add the name on the card." };
      /*
       * vCard 3.0 rather than 4.0, on purpose: 3.0 is what both iOS and
       * Android have read for a decade, and a contact card that a phone cannot
       * open is worse than one with fewer fields.
       *
       * N is the structured name. Everything after the first word is treated
       * as the surname — a full "Pastor Emeka Okafor" would otherwise lose
       * either the first or the last name depending on the phone.
       */
      const [given, ...rest] = name.split(/\s+/);
      const lines = [
        "BEGIN:VCARD",
        "VERSION:3.0",
        `N:${escapeVCard(rest.join(" "))};${escapeVCard(given)};;;`,
        `FN:${escapeVCard(name)}`,
        payload.org && `ORG:${escapeVCard(payload.org)}`,
        payload.title && `TITLE:${escapeVCard(payload.title)}`,
        payload.phone && `TEL;TYPE=CELL:${cleanPhone(payload.phone)}`,
        payload.email && `EMAIL:${escapeVCard(payload.email.trim())}`,
        payload.url && `URL:${escapeVCard(normaliseUrl(payload.url))}`,
        payload.address && `ADR;TYPE=WORK:;;${escapeVCard(payload.address)};;;;`,
        "END:VCARD",
      ].filter(Boolean);
      return { ok: true, text: lines.join("\n") };
    }

    case "location": {
      const lat = payload.latitude.trim();
      const lng = payload.longitude.trim();
      if (!lat || !lng) {
        return { ok: false, error: "Add both the latitude and the longitude." };
      }
      if (!/^-?\d+(\.\d+)?$/.test(lat) || !/^-?\d+(\.\d+)?$/.test(lng)) {
        return {
          ok: false,
          error: "Latitude and longitude should be plain numbers, like 6.5244 and 3.3792.",
        };
      }
      const label = payload.label.trim();
      return {
        ok: true,
        text: `geo:${lat},${lng}${label ? `?q=${lat},${lng}(${encodeURIComponent(label)})` : ""}`,
      };
    }

    case "event": {
      const title = payload.title.trim();
      if (!title) return { ok: false, error: "Add the name of the event." };
      const start = icalLocal(payload.starts);
      if (!start) return { ok: false, error: "Add when the event starts." };
      const end = icalLocal(payload.ends);
      /*
       * No TZID and no trailing Z: a "floating" time, which a phone reads in
       * its own timezone. That is the right answer for a poster on a church
       * wall — everybody reading it is standing in that timezone — and it
       * avoids writing an offset we would have to get right for every country
       * the platform now serves.
       */
      const lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "BEGIN:VEVENT",
        `SUMMARY:${escapeICal(title)}`,
        `DTSTART:${start}`,
        end && `DTEND:${end}`,
        payload.location && `LOCATION:${escapeICal(payload.location)}`,
        payload.description && `DESCRIPTION:${escapeICal(payload.description)}`,
        "END:VEVENT",
        "END:VCALENDAR",
      ].filter(Boolean);
      return { ok: true, text: lines.join("\n") };
    }
  }
}

/** An empty payload of a given kind, for a freshly opened designer. */
export function blankPayload(kind: QrKind): QrPayload {
  switch (kind) {
    case "link":
      return { kind: "link", url: "" };
    case "url":
      return { kind: "url", url: "" };
    case "text":
      return { kind: "text", text: "" };
    case "wifi":
      return { kind: "wifi", ssid: "", password: "", security: "WPA", hidden: false };
    case "phone":
      return { kind: "phone", phone: "" };
    case "sms":
      return { kind: "sms", phone: "", message: "" };
    case "whatsapp":
      return { kind: "whatsapp", phone: "", message: "" };
    case "email":
      return { kind: "email", email: "", subject: "", body: "" };
    case "contact":
      return {
        kind: "contact",
        name: "",
        org: "",
        title: "",
        phone: "",
        email: "",
        url: "",
        address: "",
      };
    case "location":
      return { kind: "location", latitude: "", longitude: "", label: "" };
    case "event":
      return { kind: "event", title: "", starts: "", ends: "", location: "", description: "" };
  }
}

/**
 * Mend a stored payload into a usable one.
 *
 * Rows are jsonb written by an older build, so a field may be missing or the
 * wrong type. Every branch fills what is absent rather than rejecting the row,
 * because a design somebody saved last year must still open.
 */
export function normalisePayload(raw: unknown): QrPayload {
  const o = (raw ?? {}) as Record<string, unknown>;
  const str = (key: string): string => (typeof o[key] === "string" ? (o[key] as string) : "");
  const kind = QR_KINDS.includes(o.kind as QrKind) ? (o.kind as QrKind) : "url";

  switch (kind) {
    case "link":
      return { kind: "link", url: str("url") };
    case "url":
      return { kind: "url", url: str("url") };
    case "text":
      return { kind: "text", text: str("text") };
    case "wifi": {
      const security = (["WPA", "WEP", "nopass"] as const).includes(
        o.security as "WPA",
      )
        ? (o.security as "WPA" | "WEP" | "nopass")
        : "WPA";
      return {
        kind: "wifi",
        ssid: str("ssid"),
        password: str("password"),
        security,
        hidden: o.hidden === true,
      };
    }
    case "phone":
      return { kind: "phone", phone: str("phone") };
    case "sms":
      return { kind: "sms", phone: str("phone"), message: str("message") };
    case "whatsapp":
      return { kind: "whatsapp", phone: str("phone"), message: str("message") };
    case "email":
      return {
        kind: "email",
        email: str("email"),
        subject: str("subject"),
        body: str("body"),
      };
    case "contact":
      return {
        kind: "contact",
        name: str("name"),
        org: str("org"),
        title: str("title"),
        phone: str("phone"),
        email: str("email"),
        url: str("url"),
        address: str("address"),
      };
    case "location":
      return {
        kind: "location",
        latitude: str("latitude"),
        longitude: str("longitude"),
        label: str("label"),
      };
    case "event":
      return {
        kind: "event",
        title: str("title"),
        starts: str("starts"),
        ends: str("ends"),
        location: str("location"),
        description: str("description"),
      };
  }
}

/**
 * One line describing where a code points, for a list of them.
 *
 * Never the encoded string: "WIFI:T:WPA;S:Grace House Guest;P:…" in a table is
 * both unreadable and a password on screen.
 */
export function payloadSummary(payload: QrPayload): string {
  switch (payload.kind) {
    case "link":
    case "url":
      return payload.url || "No address yet";
    case "text": {
      /*
       * "No words yet" rather than "". An empty cell in a list is the reader
       * guessing: it means a code with nothing in it, a code whose summary
       * failed, and a code of a kind this function forgot — three different
       * problems with one appearance. Every branch here says something.
       */
      const trimmed = payload.text.trim();
      if (!trimmed) return "No words yet";
      return trimmed.length > 60 ? `${trimmed.slice(0, 60)}…` : trimmed;
    }
    case "wifi":
      return payload.ssid ? `Joins “${payload.ssid}”` : "No network yet";
    case "phone":
      return payload.phone ? `Calls ${payload.phone}` : "No number yet";
    case "sms":
      return payload.phone ? `Texts ${payload.phone}` : "No number yet";
    case "whatsapp":
      return payload.phone ? `WhatsApp to ${payload.phone}` : "No number yet";
    case "email":
      return payload.email ? `Emails ${payload.email}` : "No address yet";
    case "contact":
      return payload.name || "No name yet";
    case "location": {
      if (payload.label.trim()) return payload.label.trim();
      const lat = payload.latitude.trim();
      const lng = payload.longitude.trim();
      return lat && lng ? `${lat}, ${lng}` : "No place yet";
    }
    case "event":
      return payload.title || "No event yet";
  }
}

/** Does this payload hide something that should not be shown on a screen? */
export function payloadIsSensitive(payload: QrPayload): boolean {
  return payload.kind === "wifi" && payload.security !== "nopass";
}
