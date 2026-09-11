import { describe, expect, it } from "vitest";
import {
  richTextToEmailHtml,
  richTextToPlain,
  sanitizeRichText,
} from "@/lib/rich-text";
import { isRichText } from "@/lib/rich-text-shared";

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

  it("drops an img with an onerror payload entirely", () => {
    const out = sanitizeRichText('<p>a</p><img src=x onerror="alert(1)">');
    expect(out).not.toContain("onerror");
    expect(out).not.toContain("<img");
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

  it("strips style attributes and style blocks", () => {
    const out = sanitizeRichText(
      '<style>body{display:none}</style><p style="position:fixed">Hi</p>',
    );
    expect(out).not.toContain("style");
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

  it("turns the editor's divs into paragraphs", () => {
    expect(sanitizeRichText("<div>line</div>")).toBe("<p>line</p>");
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
    const out = sanitizeRichText('<img src=x onerror="alert(1)">');
    expect(out).not.toContain("onerror");
    expect(out).not.toContain("<img");
  });

  it("escapes a stray angle bracket instead of eating the text after it", () => {
    expect(richTextToPlain(sanitizeRichText("Costs < 5 and > 2"))).toBe(
      "Costs < 5 and > 2",
    );
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
