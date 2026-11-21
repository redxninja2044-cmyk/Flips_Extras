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
    .replace(VOID_RE, (_m, tag: string, attrs: string) => {
      const a = attrs.trim();
      return a ? `<${tag.toLowerCase()} ${a} />` : `<${tag.toLowerCase()} />`;
    })
    .replace(/&([a-zA-Z]+);/g, (m, name: string) => {
      if (["amp", "lt", "gt", "quot", "apos"].includes(name)) return m;
      return ENTITIES[name] ?? "";
    });
}

export type Part = { title: string; html: string };

// Split long documents (mostly EPUBs) into chapters at h1/h2 headings.
// Short articles or documents without headings stay as a single chapter.
export function splitIntoParts(html: string, fallbackTitle: string): Part[] {
  const re = /<h([12])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  const marks: { index: number; title: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const title = (m[2] ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    marks.push({ index: m.index, title });
  }

  if (marks.length < 2 || html.length < 30000) {
    return [{ title: fallbackTitle, html }];
  }

  const parts: Part[] = [];
  const intro = html.slice(0, marks[0]!.index);
  if (intro.replace(/<[^>]+>/g, "").trim().length > 200) {
    parts.push({ title: "Start", html: intro });
  }
  marks.forEach((mark, i) => {
    const end = i + 1 < marks.length ? marks[i + 1]!.index : html.length;
    parts.push({ title: mark.title || `Part ${parts.length + 1}`, html: html.slice(mark.index, end) });
  });
  return parts;
}
