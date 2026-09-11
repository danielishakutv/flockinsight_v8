import "server-only";
import sanitizeHtml from "sanitize-html";
import { RICH_TAGS, stripTagsLoosely } from "@/lib/rich-text-shared";

/**
 * Formatted notification bodies, made safe.
 *
 * A superadmin writes these, so this is not the last line of defence against a
 * stranger — but the result is emailed to every church and rendered inside the
 * app, and "the author is trusted" is exactly the assumption that turns one
 * compromised admin account into stored XSS for everybody. So the body is
 * parsed and rebuilt from an allowlist on the way in, every time, and the
 * editor's output is never trusted as given.
 *
 * Parsed, not pattern-matched: `sanitize-html` runs a real HTML parser.
 * Regex-stripping tags is the classic way to ship a hole.
 */

/** Links are the only place an attribute survives at all. */
const CONFIG: sanitizeHtml.IOptions = {
  allowedTags: [...RICH_TAGS],
  allowedAttributes: { a: ["href", "target", "rel"] },
  // No javascript:, no data: — those are the schemes that carry payloads.
  allowedSchemes: ["http", "https", "mailto", "tel"],
  allowedSchemesAppliedToAttributes: ["href"],
  // A link with no scheme at all resolves against the page it lands on, which
  // for an email client is nowhere useful. Drop it rather than guess.
  allowProtocolRelative: false,
  // Disallowed tags lose the tag, not the words inside them.
  nonTextTags: ["style", "script", "textarea", "option", "noscript"],
  transformTags: {
    // contentEditable emits divs for new paragraphs; a div means nothing in
    // an email client, a paragraph means something in all of them.
    div: "p",
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

/** Tags that already impose their own line structure. */
function hasBlockStructure(html: string): boolean {
  return /<(p|ul|ol|li|blockquote|br)\b/i.test(html);
}

/**
 * Clean a body.
 *
 * Runs on every body, always — never conditionally on "does this look
 * formatted?". Asking that first is a bypass: a body whose only tag is one we
 * disallow (`<iframe>`, `<img onerror=…>`) does not look formatted, and would
 * sail through untouched into an innerHTML assignment. The parser decides what
 * is a tag, not a guess about the string.
 *
 * A plain body survives this unchanged apart from a stray angle bracket being
 * escaped, which is what it should have been all along.
 */
export function sanitizeRichText(body: string): string {
  return (
    sanitizeHtml(body, CONFIG)
      // The editor leaves these behind when you clear a line.
      .replace(/<p>(\s|&nbsp;|<br\s*\/?>)*<\/p>/gi, "")
      .trim()
  );
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
 * Email clients ignore stylesheets, so a link has to carry its colour on
 * itself or it arrives as unreadable default blue on some clients and
 * invisible on others.
 */
export function richTextToEmailHtml(body: string): string {
  const clean = sanitizeRichText(body);
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
