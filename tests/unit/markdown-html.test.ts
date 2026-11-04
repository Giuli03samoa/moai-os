import { describe, expect, it } from "vitest";
import { emailLayout, markdownToHtml } from "@/server/notify/markdown-html";

describe("markdown → email html", () => {
  it("renders headings, bold, lists and tables and escapes html", () => {
    const html = markdownToHtml("## Numeri\n| A | B |\n|---|---|\n| 1 | **2** |\n\n- uno\n- due <script>x</script>\n\nTesto `codice`.");
    expect(html).toContain("<h3");
    expect(html).toContain("<table");
    expect(html).toContain("<strong>2</strong>");
    expect(html).toContain("<li");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("<code>codice</code>");
  });
  it("wraps the body in the MOAI layout with an escaped title", () => {
    const out = emailLayout("Briefing <1>", "<p>x</p>");
    expect(out).toContain("Briefing &lt;1&gt;");
    expect(out).toContain("<p>x</p>");
  });
});
