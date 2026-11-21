// Search filter screen in the same style as pisshammy's Hitomi extension:
// a Type picker, a Length dropdown and a big include/exclude Tags list.
import { LabelRow, Section, TriStateSelectSection } from "@paperback/types";
import {
  SearchFilterForm,
  type SearchFilter,
  type SearchFilterValue,
} from "@paperback/types/lib/compat/0.8/searchFilters";
import { closureSelector } from "@paperback/types/lib/impl/Selector.js";

import { BASE } from "./api";
import { getTypes, TYPES } from "./settings";

export type { SearchFilterValue };
type Tri = Record<string, "included" | "excluded">;

export const LENGTHS = [
  { id: "all", value: "All" },
  { id: "le20", value: "20 pages or less" },
  { id: "gt20", value: "More than 20 pages" },
  { id: "gt50", value: "More than 50 pages" },
  { id: "gt100", value: "More than 100 pages" },
  { id: "gt200", value: "More than 200 pages" },
];

export function lengthOk(id: string, pages: number): boolean {
  if (id === "le20") return pages <= 20;
  const n = /^gt(\d+)$/.exec(id)?.[1];
  return n ? pages > Number(n) : true;
}

// ---------- tag list, read from hitomi.la/alltags-*.html and kept for a week ----------

type TagEntry = { id: string; title: string; count: number };
const TAG_KEY = "hitomi.tagList.v1";
const NEVER_LIST = /loli|shota|toddler/i;
let tagList: TagEntry[] | undefined;

// Tag ids must avoid spaces, so "female:big breasts" is stored as "female:big_breasts".
export const tagId = (ref: string) => ref.replace(/\s+/g, "_");
export const tagRef = (id: string) => id.replace(/_/g, " ");

async function fetchTags(): Promise<TagEntry[]> {
  const chars = [..."abcdefghijklmnopqrstuvwxyz", "123"];
  const pages = await Promise.all(
    chars.map(async (c) => {
      try {
        const [, buf] = await Application.scheduleRequest({ url: `${BASE}/alltags-${c}.html`, method: "GET" });
        return Application.arrayBufferToUTF8String(buf);
      } catch {
        return "";
      }
    }),
  );
  const out = new Map<string, TagEntry>();
  const re = /<a\b[^>]*href="(?:https?:\/\/hitomi\.la)?\/tag\/([^"]+)\.html"[^>]*>([\s\S]*?)<\/a>\s*\(([\d,]+)\)/g;
  for (const html of pages) {
    for (const m of html.matchAll(re)) {
      const ref = decodeURIComponent(m[1]!).replace(/-all$/, "").trim();
      const count = parseInt(m[3]!.replace(/,/g, ""), 10);
      if (!ref || NEVER_LIST.test(ref) || count < 300) continue;
      const pretty = ref.startsWith("female:") ? `${ref.slice(7)} ♀` : ref.startsWith("male:") ? `${ref.slice(5)} ♂` : ref;
      out.set(ref, { id: tagId(ref), title: pretty, count });
    }
  }
  return [...out.values()].sort((a, b) => b.count - a.count);
}

export async function getTagList(): Promise<TagEntry[]> {
  if (tagList?.length) return tagList;
  const saved = Application.getState(TAG_KEY) as { at: number; tags: TagEntry[] } | undefined;
  if (saved?.tags?.length && Date.now() - saved.at < 7 * 86400_000) return (tagList = saved.tags);
  const fresh = await fetchTags();
  if (fresh.length) {
    Application.setState({ at: Date.now(), tags: fresh }, TAG_KEY);
    tagList = fresh;
  }
  return fresh;
}

// ---------- remembered filter choices (they stick between searches, like the original) ----------

const SAVED_KEY = "hitomi.searchFilters.v1";
export function getSavedFilters(): Record<string, SearchFilterValue["value"]> {
  return (Application.getState(SAVED_KEY) as Record<string, SearchFilterValue["value"]> | undefined) ?? {};
}
export function saveFilters(values: SearchFilterValue[]): void {
  const out: Record<string, SearchFilterValue["value"]> = {};
  for (const v of values) out[v.id] = v.value;
  Application.setState(out, SAVED_KEY);
}

export async function buildFilters(): Promise<SearchFilter[]> {
  const saved = getSavedFilters();
  const defaultTypes: Tri = {};
  for (const t of getTypes()) defaultTypes[t] = "included";
  const tags = await getTagList().catch(() => []);
  const savedTags = (saved.tags as Tri | undefined) ?? {};
  // Selected tags first, then the most used.
  const sorted = [...tags.filter((t) => savedTags[t.id]), ...tags.filter((t) => !savedTags[t.id])];
  for (const id of Object.keys(savedTags)) {
    if (!tags.some((t) => t.id === id)) sorted.unshift({ id, title: tagRef(id), count: 0 });
  }
  return [
    {
      id: "types",
      type: "multiselect",
      title: "Type",
      options: TYPES.map((t) => ({ id: t.id, value: t.title })),
      value: (saved.types as Tri | undefined) ?? defaultTypes,
      allowExclusion: true,
      allowEmptySelection: true,
      maximum: undefined,
    },
    {
      id: "length",
      type: "dropdown",
      title: "Length",
      options: LENGTHS,
      value: (saved.length as string | undefined) ?? "all",
    },
    {
      id: "tags",
      type: "multiselect",
      title: "Tags (tap once to include, twice to exclude)",
      options: sorted.map((t) => ({ id: t.id, value: t.title })),
      value: savedTags,
      allowExclusion: true,
      allowEmptySelection: true,
      maximum: undefined,
    },
  ];
}

export class HitomiFilterForm extends SearchFilterForm {
  override getSections() {
    if (!this.filters) return [Section("loading", [LabelRow("loading", { title: "Loading filters..." })])];
    if (this.filters instanceof Error)
      return [Section("error", [LabelRow("error", { title: "Couldn't load filters", subtitle: this.filters.message })])];

    return this.filters.map((filter) => {
      if (filter.type === "dropdown") {
        const selected = (this.selectedFilterValues[filter.id] ?? filter.value) as string;
        return Section(
          { id: filter.id, header: filter.title },
          filter.options.map((o) =>
            LabelRow(o.id, {
              title: o.value,
              value: selected === o.id ? "✓" : undefined,
              onSelect: closureSelector(this, `${filter.id}#${o.id}`, async () => {
                this.selectedFilterValues[filter.id] = o.id;
                this.reloadForm();
              }),
            }),
          ),
        );
      }
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
      return Section(filter.id, []);
    });
  }
}
