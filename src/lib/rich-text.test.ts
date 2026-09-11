import { describe, expect, it } from "vitest";
import {
  richTextToEmailHtml,
  richTextToPlain,
  sanitizeRichText,
} from "@/lib/rich-text";
import { isFullHtmlDocument, isRichText } from "@/lib/rich-text-shared";

describe("isRichText", () => {
  it("recognises a formatted body", () => {
    expect(isRichText("<p>Hello <b>there</b></p>")).toBe(true);
  });

  it("treats a plain body as plain, which is what older notices are", () => {
    expect(isRichText("Hello there")).toBe(false);
    expect(isRichText("Costs < 5 and > 2")).toBe(false);
  });

  it("is not fooled by a tag we do not allow", () => {
    expect(isRichText("<script>alert(1)</script>")).toBe(false);
  });
});

describe("sanitizeRichText — what must not survive", () => {
  it("drops a script tag and everything in it", () => {
    const out = sanitizeRichText("<p>Hi</p><script>alert(1)</script>");
    expect(out).not.toContain("script");
    expect(out).not.toContain("alert");
    expect(out).toContain("Hi");
  });

  it("drops an inline event handler", () => {
    // This is the one that matters: innerHTML will not run a <script>, but it
    // runs onerror without hesitation.
    const out = sanitizeRichText('<p onclick="steal()">Hi</p>');
    expect(out).not.toContain("onclick");
    expect(out).toContain("Hi");
  });

  it("keeps the image but never its onerror", () => {
    // Templates are full of images, so <img> stays. The handler is the
    // payload, and that is what has to go.
    const out = sanitizeRichText('<p>a</p><img src=x onerror="alert(1)">');
    expect(out).not.toContain("onerror");
    expect(out).not.toContain("alert");
    expect(out).toContain("<img");
  });

  it("refuses a javascript: link but keeps the words", () => {
    const out = sanitizeRichText('<a href="javascript:alert(1)">click</a>');
    expect(out).not.toContain("javascript");
    expect(out).toContain("click");
  });

  it("refuses a data: link", () => {
    const out = sanitizeRichText(
      '<a href="data:text/html;base64,PHNjcmlwdD4=">x</a>',
    );
    expect(out).not.toContain("data:");
  });

  it("refuses CSS that fetches or executes, inside a style block", () => {
    // allowedStyles governs inline attributes only — sanitize-html never
    // parses the CSS inside <style>, so this needs its own guard.
    const out = sanitizeRichText(
      "<style>@import url(//evil.test/x.css); a{behavior:url(#x)}</style>",
    );
    expect(out).not.toContain("@import");
    expect(out).not.toContain("behavior:");
    expect(out).toContain("<style>");
  });

  it("refuses expression() in an inline style", () => {
    const out = sanitizeRichText(
      '<p style="width:expression(alert(1))">Hi</p>',
    );
    expect(out).not.toContain("expression");
    expect(out).toContain("Hi");
  });

  it("keeps the text inside a tag it removes", () => {
    expect(sanitizeRichText("<p><span>kept</span></p>")).toContain("kept");
  });

  it("does not let an iframe through", () => {
    const out = sanitizeRichText('<iframe src="https://evil.test"></iframe>');
    expect(out).not.toContain("iframe");
  });
});

describe("sanitizeRichText — what must survive", () => {
  it("keeps the formatting the toolbar produces", () => {
    const html =
      "<p><b>bold</b> <i>italic</i> <u>under</u> <s>struck</s></p>" +
      "<ul><li>one</li></ul><ol><li>two</li></ol><blockquote>q</blockquote>";
    const out = sanitizeRichText(html);
    for (const tag of ["<b>", "<i>", "<u>", "<s>", "<ul>", "<ol>", "<li>", "<blockquote>"]) {
      expect(out).toContain(tag);
    }
  });

  it("keeps a normal link and hardens it", () => {
    const out = sanitizeRichText('<a href="https://flockinsight.com">Open</a>');
    expect(out).toContain('href="https://flockinsight.com"');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain('target="_blank"');
  });

  it("allows mailto and tel, which a church actually uses", () => {
    expect(sanitizeRichText('<a href="mailto:a@b.com">mail</a>')).toContain(
      "mailto:a@b.com",
    );
    expect(sanitizeRichText('<a href="tel:+2348012345678">call</a>')).toContain(
      "tel:+2348012345678",
    );
  });

  it("keeps a div, because a template is built from them", () => {
    expect(sanitizeRichText("<div>line</div>")).toBe("<div>line</div>");
  });

  it("keeps a layout table with its spacing attributes", () => {
    const html =
      '<table cellpadding="0" cellspacing="0" width="600" bgcolor="#FOEEF8">' +
      '<tr><td align="center" style="padding:24px">Hi</td></tr></table>';
    const out = sanitizeRichText(html);
    expect(out).toContain("<table");
    expect(out).toContain('cellpadding="0"');
    expect(out).toContain('width="600"');
    expect(out).toContain("padding:24px");
  });

  it("leaves a plain body completely untouched", () => {
    const plain = "Just words.\nOn two lines.";
    expect(sanitizeRichText(plain)).toBe(plain);
  });

  it("removes the empty paragraphs contentEditable leaves behind", () => {
    expect(sanitizeRichText("<p>real</p><p><br></p>")).toBe("<p>real</p>");
  });

  it("sanitises a body whose only tag is one we disallow", () => {
    // The bypass this closes: nothing here looks "formatted", so deciding
    // whether to sanitise by asking "is this rich text?" waved it straight
    // through into an innerHTML assignment.
    const out = sanitizeRichText('<iframe src="https://evil.test"></iframe>');
    expect(out).not.toContain("iframe");
  });

  it("refuses a form, so an email from us can never ask for a password", () => {
    const out = sanitizeRichText(
      '<form action="https://evil.test"><input name="password"></form>',
    );
    expect(out).not.toContain("<form");
    expect(out).not.toContain("<input");
  });

  it("escapes a stray angle bracket instead of eating the text after it", () => {
    expect(richTextToPlain(sanitizeRichText("Costs < 5 and > 2"))).toBe(
      "Costs < 5 and > 2",
    );
  });
});

describe("a whole pasted email template", () => {
  const template = `<!DOCTYPE html>
<html lang="en" style="margin:0; padding:0;">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Refer a church, earn &#8358;2,000</title>
<style>@media (max-width:600px){ .wrap{width:100%!important} }</style>
</head>
<body style="margin:0; padding:0; background-color:#FOEEF8;">
<table class="wrap" width="600" cellpadding="0" cellspacing="0">
<tr><td style="padding:24px">
<h1 style="color:#5b3df5">Refer a church</h1>
<p>Earn <b>&#8358;2,000</b> when they subscribe.</p>
<a href="https://flockinsight.com/r/grace" style="color:#fff">Share your link</a>
</td></tr>
</table>
</body>
</html>`;

  it("is recognised as a document", () => {
    expect(isFullHtmlDocument(template)).toBe(true);
    expect(isFullHtmlDocument("<p>just a notice</p>")).toBe(false);
  });

  it("survives sanitising with its structure and styling intact", () => {
    const out = sanitizeRichText(template);
    expect(out).toContain("<!DOCTYPE html>");
    expect(out).toContain("<table");
    expect(out).toContain('width="600"');
    expect(out).toContain("background-color:#FOEEF8");
    expect(out).toContain("color:#5b3df5");
    expect(out).toContain("@media");
  });

  it("keeps its media query, which is what makes it readable on a phone", () => {
    expect(sanitizeRichText(template)).toContain("max-width:600px");
  });

  it("is sent as the whole email rather than nested in our frame", () => {
    // A document inside our layout div is invalid, and would staple our header
    // and CTA onto a design that already has both.
    const out = richTextToEmailHtml(template);
    expect(isFullHtmlDocument(out)).toBe(true);
    expect(out).not.toContain("Open FlockInsight");
  });

  it("reduces to readable words for push, with no CSS and no <title>", () => {
    const plain = richTextToPlain(template);
    expect(plain).toContain("Refer a church");
    expect(plain).toContain("Earn ₦2,000 when they subscribe");
    expect(plain).not.toContain("@media");
    expect(plain).not.toContain("max-width");
    expect(plain).not.toMatch(/[<>]/);
  });

  it("still drops a script hidden inside the template", () => {
    const out = sanitizeRichText(
      template.replace("</body>", "<script>steal()</script></body>"),
    );
    expect(out).not.toContain("steal");
    expect(out).not.toContain("<script");
  });

  it("still drops an event handler hidden on a table cell", () => {
    const out = sanitizeRichText(
      template.replace('<td style="padding:24px">', '<td onmouseover="x()">'),
    );
    expect(out).not.toContain("onmouseover");
  });
});

describe("richTextToPlain", () => {
  it("returns words for a push notification", () => {
    expect(richTextToPlain("<p>Hello <b>there</b></p>")).toBe("Hello there");
  });

  it("keeps paragraphs apart instead of running them together", () => {
    expect(richTextToPlain("<p>One</p><p>Two</p>")).toBe("One\nTwo");
  });

  it("marks list items so a list still reads as a list", () => {
    expect(richTextToPlain("<ul><li>a</li><li>b</li></ul>")).toContain("• a");
  });

  it("turns a line break into a line break", () => {
    expect(richTextToPlain("<p>a<br>b</p>")).toBe("a\nb");
  });

  it("decodes entities rather than showing them raw", () => {
    expect(richTextToPlain("<p>Tom &amp; Jerry &lt;3</p>")).toBe(
      "Tom & Jerry <3",
    );
  });

  it("passes a plain body straight through", () => {
    expect(richTextToPlain("Already plain")).toBe("Already plain");
  });

  it("never leaks a tag into a push banner", () => {
    const out = richTextToPlain('<p onclick="x()"><b>Hi</b></p><script>y()</script>');
    expect(out).not.toMatch(/[<>]/);
  });
});

describe("richTextToEmailHtml", () => {
  it("gives links a colour, since email ignores stylesheets", () => {
    const out = richTextToEmailHtml('<a href="https://x.test">go</a>');
    expect(out).toContain("color:#5b3df5");
  });

  it("spaces paragraphs, which email clients do not do themselves", () => {
    expect(richTextToEmailHtml("<p>a</p>")).toContain("margin:0 0 12px");
  });

  it("still renders a plain body with its line breaks", () => {
    const out = richTextToEmailHtml("one\ntwo");
    expect(out).toContain("<br/>");
    expect(out).toContain("one");
  });

  it("escapes a plain body rather than trusting it as markup", () => {
    const out = richTextToEmailHtml("5 < 6 & <script>x</script>");
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;");
  });

  it("sanitises on the way out too, for rows written before the editor", () => {
    const out = richTextToEmailHtml('<p onclick="x()">Hi</p>');
    expect(out).not.toContain("onclick");
  });
});
