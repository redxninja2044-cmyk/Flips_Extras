const VOID = "area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr";
const VOID_RE = new RegExp(`<(${VOID})((?:\\s+[^>]*?)?)\\s*/?>`, "gi");

const ENTITIES: Record<string, string> = {
  nbsp: "&#160;", mdash: "&#8212;", ndash: "&#8211;", hellip: "&#8230;",
  lsquo: "&#8216;", rsquo: "&#8217;", ldquo: "&#8220;", rdquo: "&#8221;",
  copy: "&#169;", reg: "&#174;", trade: "&#8482;", middot: "&#183;",
  bull: "&#8226;", deg: "&#176;", times: "&#215;", laquo: "&#171;", raquo: "&#187;",
};

// Readium parses chapters as XHTML: close void tags, drop scripts/styles,
// and turn named entities (other than the XML five) into numeric ones.
export function toXhtmlBody(html: string): string {
  return html
    .replace(/<(script|style|iframe|noscript)[\s\S]*?<\/\1>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    // Drop images whose src isn't an absolute web URL (EPUB-internal paths can't load).
    .replace(/<img\b[^>]*>/gi, (tag) => (/\ssrc\s*=\s*["']https?:\/\//i.test(tag) ? tag : ""))
    .replace(/<(svg)[\s\S]*?<\/svg>/gi, "")
    .replace(VOID_RE, (_m, tag: string, attrs: string) => {
      const a = attrs.trim();
      return a ? `<${tag.toLowerCase()} ${a} />` : `<${tag.toLowerCase()} />`;
    })
    .replace(/&([a-zA-Z]+);/g, (m, name: string) => {
      if (["amp", "lt", "gt", "quot", "apos"].includes(name)) return m;
      return ENTITIES[name] ?? "";
    });
}

