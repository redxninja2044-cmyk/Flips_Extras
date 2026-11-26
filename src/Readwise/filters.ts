// Advanced search for the Readwise library, in the same style as the Hitomi extension:
// sort options plus a filter screen with format, include/exclude tags and an author box.
import { InputRow, LabelRow, Section, TriStateSelectSection } from "@paperback/types";
import {
  SearchFilterForm,
  type SearchFilter,
  type SearchFilterValue,
} from "@paperback/types/lib/compat/0.8/searchFilters";
import { closureSelector } from "@paperback/types/lib/impl/Selector.js";

import { getAllBooks, tagNames, type ReaderDoc } from "./api";

export type { SearchFilterValue };
export type Tri = Record<string, "included" | "excluded">;

// Tag ids can't contain spaces or most symbols, so tags are referenced by an encoded id.
export const tagId = (name: string) => encodeURIComponent(name).replace(/[^A-Za-z0-9._\-%]/g, "_");

export const SORTS = [
  { id: "title", label: "Title A-Z" },
  { id: "title_desc", label: "Title Z-A" },
  { id: "added", label: "Recently Added" },
  { id: "updated", label: "Recently Updated" },
  { id: "author", label: "Author" },
];

const SAVED_KEY = "readwise.searchFilters.v1";
export function getSavedFilters(): Record<string, SearchFilterValue["value"]> {
  return (Application.getState(SAVED_KEY) as Record<string, SearchFilterValue["value"]> | undefined) ?? {};
}
export function saveFilters(values: SearchFilterValue[]): void {
  const out: Record<string, SearchFilterValue["value"]> = {};
  for (const v of values) out[v.id] = v.value;
  Application.setState(out, SAVED_KEY);
}

export async function allTags(): Promise<{ id: string; name: string; count: number }[]> {
  const counts = new Map<string, number>();
  for (const b of await getAllBooks()) for (const t of tagNames(b)) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()]
    .map(([name, count]) => ({ id: tagId(name), name, count }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

export async function buildFilters(): Promise<SearchFilter[]> {
  const saved = getSavedFilters();
  const tags = await allTags();
  const savedTags = (saved.tags as Tri | undefined) ?? {};
  const sorted = [...tags.filter((t) => savedTags[t.id]), ...tags.filter((t) => !savedTags[t.id])];
  return [
    {
      id: "format",
      type: "multiselect",
      title: "Format",
      options: [
        { id: "epub", value: "EPUB" },
        { id: "pdf", value: "PDF" },
      ],
      value: (saved.format as Tri | undefined) ?? {},
      allowExclusion: true,
      allowEmptySelection: true,
      maximum: undefined,
    },
    {
      id: "tags",
      type: "multiselect",
      title: "Series",
      options: sorted.map((t) => ({ id: t.id, value: `${t.name} (${t.count})` })),
      value: savedTags,
      allowExclusion: true,
      allowEmptySelection: true,
      maximum: undefined,
    },
    {
      id: "author",
      type: "input",
      title: "Author",
      placeholder: "",
      value: (saved.author as string | undefined) ?? "",
    },
  ];
}

/** Applies the filter values and sort to the library. */
export function applyFilters(
  books: ReaderDoc[],
  text: string,
  values: Record<string, SearchFilterValue["value"]>,
  sort: string,
): ReaderDoc[] {
  const tri = (id: string) => (values[id] as Tri | undefined) ?? {};
  const pick = (t: Tri, s: string) => Object.keys(t).filter((k) => t[k] === s);
  const fmt = tri("format");
  const tags = tri("tags");
  const incFmt = pick(fmt, "included");
  const excFmt = pick(fmt, "excluded");
  const incTags = pick(tags, "included");
  const excTags = pick(tags, "excluded");
  const authors = String(values.author ?? "")
    .split(",")
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean);
  const incAuth = authors.filter((a) => !a.startsWith("-"));
  const excAuth = authors.filter((a) => a.startsWith("-")).map((a) => a.slice(1).trim());
  const needle = text.toLowerCase().trim();

  const out = books.filter((doc) => {
    const cat = doc.category ?? "";
    if (incFmt.length && !incFmt.includes(cat)) return false;
    if (excFmt.includes(cat)) return false;
    const ids = tagNames(doc).map(tagId);
    if (!incTags.every((t) => ids.includes(t))) return false;
    if (excTags.some((t) => ids.includes(t))) return false;
    const author = (doc.author ?? "").toLowerCase();
    if (incAuth.length && !incAuth.some((a) => author.includes(a))) return false;
    if (excAuth.some((a) => author.includes(a))) return false;
    if (needle && !`${doc.title ?? ""} ${doc.author ?? ""}`.toLowerCase().includes(needle)) return false;
    return true;
  });

  const title = (d: ReaderDoc) => d.title?.trim() || d.source_url || "";
  const byTitle = (a: ReaderDoc, b: ReaderDoc) => title(a).localeCompare(title(b), undefined, { numeric: true });
  const time = (s?: string) => (s ? Date.parse(s) || 0 : 0);
  switch (sort) {
    case "title_desc":
      return out.sort((a, b) => byTitle(b, a));
    case "added":
      return out.sort((a, b) => time(b.created_at) - time(a.created_at));
    case "updated":
      return out.sort((a, b) => time(b.updated_at) - time(a.updated_at));
    case "author":
      return out.sort((a, b) => (a.author ?? "").localeCompare(b.author ?? "") || byTitle(a, b));
    default:
      return out.sort(byTitle);
  }
}

export class ReadwiseFilterForm extends SearchFilterForm {
  override getSections() {
    if (!this.filters) return [Section("loading", [LabelRow("loading", { title: "Loading..." })])];
    if (this.filters instanceof Error)
      return [Section("error", [LabelRow("error", { title: "Error", subtitle: this.filters.message })])];

    return this.filters.map((filter) => {
      if (filter.type === "multiselect") {
        if (!this.selectedFilterValues[filter.id]) this.selectedFilterValues[filter.id] = { ...filter.value };
        return TriStateSelectSection(this, {
          id: filter.id,
          header: filter.title,
          layout: "flow",
          value: this.selectedFilterValues[filter.id] as Tri,
          items: filter.options.map((o) => ({ id: o.id, title: o.value })),
          allowExclusion: filter.allowExclusion,
          allowEmptySelection: filter.allowEmptySelection,
          maximum: filter.maximum ?? undefined,
        });
      }
      if (filter.type === "input") {
        const value = (this.selectedFilterValues[filter.id] ?? filter.value) as string;
        return Section({ id: filter.id, header: filter.title }, [
          InputRow(filter.id, {
            title: filter.title,
            value,
            onValueChange: closureSelector(this, filter.id, async (v: string) => {
              this.selectedFilterValues[filter.id] = v;
            }),
          }),
        ]);
      }
      return Section(filter.id, []);
    });
  }
}
