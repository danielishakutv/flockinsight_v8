/**
 * Turning a link somebody pasted into an embeddable player.
 *
 * The free way to livestream: the church broadcasts to YouTube or Facebook the
 * way it probably already does, and FlockInsight shows that player on its own
 * page. Nothing is ingested, nothing is transcoded, nothing is delivered by us
 * — which is the whole point, because delivery is the only part of streaming
 * that ever costs real money.
 *
 * Pure, so it can run on the server when the row is saved and on the client
 * while somebody is still typing.
 */

export type EmbedProvider = "youtube" | "facebook" | "vimeo" | "unknown";

export type ParsedEmbed = {
  provider: EmbedProvider;
  /** What goes in the iframe. Null when we cannot make one. */
  embedUrl: string | null;
  /** What to show the person if we cannot. */
  error: string | null;
};

/**
 * Pull a YouTube video id out of any of the shapes people actually paste.
 *
 * Six forms, because a pastor copies whatever the browser or the app gave
 * them: the watch page, the share link, the embed, the live path, the shorts
 * path, or a channel's permanent "live" address. Only the last is not a video
 * id at all, and it needs a different embed url.
 */
function youtube(u: URL): ParsedEmbed {
  const host = u.hostname.replace(/^www\./, "");
  const path = u.pathname.replace(/\/+$/, "");

  // youtu.be/<id>
  if (host === "youtu.be") {
    const id = path.slice(1);
    return id ? ok("youtube", `https://www.youtube.com/embed/${id}`) : bad();
  }

  // /watch?v=<id>
  const v = u.searchParams.get("v");
  if (v) return ok("youtube", `https://www.youtube.com/embed/${v}`);

  // /embed/<id>, /live/<id>, /shorts/<id>
  const m = path.match(/^\/(embed|live|shorts|v)\/([^/?#]+)/);
  if (m) return ok("youtube", `https://www.youtube.com/embed/${m[2]}`);

  /*
   * A channel's standing live URL — /@handle/live or /channel/<id>/live.
   * There is no video id until the broadcast starts, so the embed has to be
   * built from the channel instead. This is the link a church that streams
   * every Sunday actually wants, because it never changes.
   */
  const handle = path.match(/^\/@([^/]+)\/live$/);
  if (handle) {
    return ok(
      "youtube",
      `https://www.youtube.com/embed/live_stream?channel=&user=${encodeURIComponent(handle[1])}`,
    );
  }
  const channel = path.match(/^\/channel\/([^/]+)\/live$/);
  if (channel) {
    return ok("youtube", `https://www.youtube.com/embed/live_stream?channel=${channel[1]}`);
  }

  return bad(
    "That looks like a YouTube link, but not one with a video in it. Use the watch link, or your channel's /live address.",
  );
}

/**
 * Facebook has no id to extract — its player takes the whole post URL as a
 * parameter, so anything on the domain is passed through as-is.
 */
function facebook(u: URL): ParsedEmbed {
  return ok(
    "facebook",
    `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(u.toString())}&show_text=false&autoplay=true`,
  );
}

function vimeo(u: URL): ParsedEmbed {
  /*
   * Events first. A Vimeo livestream lives at /event/<id>, and that id is
   * numeric — so checking for a plain video id first would match it and embed
   * a live service as an on-demand video that does not play.
   */
  const event = u.pathname.match(/\/event\/([^/?#]+)/)?.[1];
  if (event) return ok("vimeo", `https://vimeo.com/event/${event}/embed`);
  const id = u.pathname.match(/\/(\d+)/)?.[1];
  if (id) return ok("vimeo", `https://player.vimeo.com/video/${id}`);
  return bad("That Vimeo link doesn't have a video in it.");
}

function ok(provider: EmbedProvider, embedUrl: string): ParsedEmbed {
  return { provider, embedUrl, error: null };
}

function bad(error = "Paste the link to your stream on YouTube, Facebook or Vimeo."): ParsedEmbed {
  return { provider: "unknown", embedUrl: null, error };
}

export function parseEmbed(raw: string): ParsedEmbed {
  const text = raw.trim();
  if (!text) return bad();

  let u: URL;
  try {
    // People paste "youtube.com/..." without a scheme far more often than not.
    u = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return bad("That isn't a web address.");
  }

  /*
   * https only, and never a bare IP. An embed runs inside our page, so a
   * pasted http url would break the padlock on a page the church sends its
   * congregation to — and an arbitrary host is somebody else's javascript
   * inside our origin's frame.
   */
  if (u.protocol !== "https:") return bad("The link has to start with https.");

  const host = u.hostname.replace(/^www\./, "").toLowerCase();

  if (host === "youtube.com" || host === "youtu.be" || host === "m.youtube.com") {
    return youtube(u);
  }
  if (host === "facebook.com" || host === "fb.watch" || host === "m.facebook.com") {
    return facebook(u);
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") return vimeo(u);

  return bad(
    "We can only embed YouTube, Facebook or Vimeo. Paste the link to your stream on one of those.",
  );
}

/** A friendly name for the provider, for the UI. */
export const PROVIDER_LABEL: Record<EmbedProvider, string> = {
  youtube: "YouTube",
  facebook: "Facebook",
  vimeo: "Vimeo",
  unknown: "Unknown",
};
