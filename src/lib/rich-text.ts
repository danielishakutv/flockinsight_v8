import "server-only";
import sanitizeHtml from "sanitize-html";
import { isFullHtmlDocument, stripTagsLoosely } from "@/lib/rich-text-shared";

/**
 * Notification bodies, made safe.
 *
 * A superadmin writes these, so this is not the last line of defence against a
 * stranger — but the result is emailed to every church, and "the author is
 * trusted" is exactly the assumption that turns one compromised admin account
 * into stored XSS for everybody. So the body is parsed and rebuilt from an
 * allowlist on the way in, every time, and never trusted as given.
 *
 * Parsed, not pattern-matched: `sanitize-html` runs a real HTML parser.
 * Regex-stripping tags is the classic way to ship a hole.
 *
 * The allowlist is deliberately wide, because a real email template is built
 * from tables, inline styles and a <style> block for the media queries, and a
 * narrow list does not strip a design so much as ruin it. Width is not the
 * risk here. What executes is the risk, so what is refused is absolute:
 * scripts, event handlers, javascript:/vbscript: URLs, and the tags that embed
 * someone else's page or collect a password.
 */

/** Structure and styling an email is actually built from. */
const ALLOWED_TAGS = [
  // Document, so a complete pasted template survives intact.
  "html", "head", "body", "meta", "title", "style",
  // Layout. Email clients still lay out with tables in 2026.
  "table", "thead", "tbody", "tfoot", "tr", "td", "th", "caption",
  "div", "span", "center", "section", "article", "header", "footer", "main",
  // Text.
  "p", "br", "hr", "h1", "h2", "h3", "h4", "h5", "h6",
  "b", "strong", "i", "em", "u", "s", "strike", "small", "sub", "sup",
  "blockquote", "pre", "code", "ul", "ol", "li", "dl", "dt", "dd",
  "a", "img", "figure", "figcaption", "font",
];

/**
 * Never allowed, whatever else changes.
 *
 * `script` and `noscript` execute. `iframe`, `object`, `embed` and `frame`
 * host somebody else's page inside ours. `form`, `input` and `button` turn an
 * announcement into something that can ask a church for a password — an email
 * from us is the last place that should be possible.
 */
const NEVER = [
  "script", "noscript", "iframe", "object", "embed", "frame", "frameset",
  "form", "input", "button", "select", "textarea", "option", "base", "link",
];

const COMMON_ATTRS = [
  "style", "class", "id", "title", "lang", "dir", "role", "aria-hidden",
  "width", "height", "align", "valign", "bgcolor", "background",
  "border", "cellpadding", "cellspacing", "colspan", "rowspan",
];

const CONFIG: sanitizeHtml.IOptions = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: {
    "*": COMMON_ATTRS,
    a: [...COMMON_ATTRS, "href", "target", "rel"],
    img: [...COMMON_ATTRS, "src", "alt", "srcset", "loading"],
    meta: ["charset", "name", "content", "http-equiv"],
  },
  allowedSchemes: ["http", "https", "mailto", "tel"],
  // An inline logo as a data: URI is ordinary in email, and an image cannot
  // execute. Everywhere else data: is how a payload travels, so it stays out.
  allowedSchemesByTag: { img: ["http", "https", "data", "cid"] },
  allowedSchemesAppliedToAttributes: ["href", "src", "background"],
  allowProtocolRelative: false,
  // A disallowed tag normally loses the tag and keeps its words. For these,
  // the words ARE the payload — CSS text or script source dumped into the
  // middle of a sentence — so the contents go with it.
  nonTextTags: [...NEVER, "head"],
  /*
   * No `allowedStyles` here on purpose.
   *
   * It is keyed by property NAME and has no wildcard for one, so listing
   * anything means silently dropping every property not listed — which for a
   * designed template is the whole design. A template uses hundreds of
   * properties and invents new ones every year, so CSS is allowed wholesale
   * and the few constructs that fetch or execute are stripped afterwards, by
   * value rather than by name. See hardenCss.
   */
  transformTags: {
    a: (tagName, attribs) => ({
      tagName,
      attribs: {
        ...attribs,
        // Someone else's inbox is not our tab to reuse, and noopener closes
        // the reverse-tabnabbing door that target="_blank" opens.
        target: "_blank",
        rel: "noopener noreferrer",
      },
    }),
  },
};

/*
 * sanitize-html drops every attribute starting "on" only if we say so — it
 * has no special knowledge of event handlers. The allowlist above already
 * excludes them by not listing them, and this is the belt to that braces: if
 * COMMON_ATTRS ever grows a wildcard, handlers still cannot ride in.
 */
const EVENT_ATTR = /\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;

/**
 * The CSS constructs that do something other than style.
 *
 * `expression()` executes (old IE), `behavior`/`-moz-binding` attach code,
 * `@import` and a `javascript:`/`vbscript:` URL fetch or run. Everything else
 * — every colour, every padding, every property invented since — is just
 * styling and is left alone.
 */
const DANGEROUS_CSS =
  /(@import|expression\s*\(|behaviou?r\s*:|-moz-binding|javascript\s*:|vbscript\s*:)/gi;

function hardenCss(html: string): string {
  return (
    html
      // Inside a <style> block. sanitize-html never parses this CSS at all,
      // so without this everything refused elsewhere walks in through here.
      .replace(
        /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi,
        (_m, open: string, css: string, close: string) =>
          open + css.replace(DANGEROUS_CSS, "/* removed */") + close,
      )
      /*
       * And in an inline style attribute.
       *
       * Replaced unconditionally rather than only when it looks dangerous:
       * DANGEROUS_CSS is a /g/ regex, and .test() on one advances lastIndex,
       * so testing before replacing would skip every other attribute.
       */
      .replace(
        /style\s*=\s*"([^"]*)"/gi,
        (_m, css: string) => `style="${css.replace(DANGEROUS_CSS, "")}"`,
      )
  );
}

/** Tags that already impose their own line structure. */
function hasBlockStructure(html: string): boolean {
  return /<(p|div|table|ul|ol|li|blockquote|br|h[1-6])\b/i.test(html);
}

/**
 * Clean a body.
 *
 * Runs on every body, always — never conditionally on "does this look
 * formatted?". Asking that first is a bypass: a body whose only tag is one we
 * disallow (`<img src=x onerror=…>`) does not look formatted, and would sail
 * through untouched into an innerHTML assignment. The parser decides what is a
 * tag, not a guess about the string.
 *
 * A plain body survives unchanged apart from a stray angle bracket being
 * escaped, which is what it should have been all along.
 */
export function sanitizeRichText(body: string): string {
  const doc = isFullHtmlDocument(body);
  const cleaned = hardenCss(
    sanitizeHtml(body, CONFIG).replace(EVENT_ATTR, ""),
  );

  // A doctype is not a tag and the parser discards it; a full template that
  // arrived with one is put back together with one, because some clients
  // render quirks-mode differently.
  const withDoctype =
    doc && !/^\s*<!doctype/i.test(cleaned)
      ? `<!DOCTYPE html>\n${cleaned}`
      : cleaned;

  return doc
    ? withDoctype.trim()
    : withDoctype
        // The editor leaves these behind when you clear a line.
        .replace(/<p>(\s|&nbsp;|<br\s*\/?>)*<\/p>/gi, "")
        .trim();
}

/**
 * The body as words, for the places that cannot show formatting: push
 * notifications, SMS, the preview line in a list, and the plain-text half of
 * every email (which is what a screen reader and a text-only client read).
 */
export function richTextToPlain(body: string): string {
  // Sanitise first so the structure is known, then turn that structure into
  // line breaks — stripping tags outright would run every paragraph into the
  // one after it.
  return stripTagsLoosely(sanitizeHtml(body, CONFIG));
}

/**
 * The body as HTML for an email.
 *
 * Email clients ignore stylesheets, so a link written in the toolbar has to
 * carry its colour on itself or it arrives as unreadable default blue. A
 * pasted template is left exactly as its designer wrote it.
 */
export function richTextToEmailHtml(body: string): string {
  const clean = sanitizeRichText(body);

  // A designed template brings its own everything. Restyling its links would
  // undo the design it was pasted in for.
  if (isFullHtmlDocument(clean)) return clean;

  // An older, unformatted notice has no tags to give it shape; its newlines
  // are the shape, and email needs those spelled out.
  const shaped = hasBlockStructure(clean)
    ? clean
    : `<p>${clean.replace(/\n/g, "<br/>")}</p>`;

  return shaped
    .replace(/<a /gi, '<a style="color:#5b3df5;text-decoration:underline" ')
    .replace(/<p>/gi, '<p style="margin:0 0 12px">')
    .replace(/<ul>/gi, '<ul style="margin:0 0 12px;padding-left:20px">')
    .replace(/<ol>/gi, '<ol style="margin:0 0 12px;padding-left:20px">')
    .replace(
      /<blockquote>/gi,
      '<blockquote style="margin:0 0 12px;padding-left:12px;border-left:3px solid #e2e8f0;color:#6b6880">',
    );
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
