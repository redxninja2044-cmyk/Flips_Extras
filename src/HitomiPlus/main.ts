import {
  BasicRateLimiter,
  ContentRating,
  DiscoverSectionType,
  PaperbackInterceptor,
  type Chapter,
  type ChapterDetails,
  type DiscoverSection,
  type DiscoverSectionItem,
  type ExtensionImpl,
  type JSONValue,
  type PagedResults,
  type Request,
  type Response,
  type SearchQuery,
  type SearchResultItem,
  type SourceManga,
  type SortingOption,
} from "@paperback/types";

import {
  BASE,
  lang,
  typeIds,
  isHidden,
  LTN,
  PAGE_SIZE,
  coverUrl,
  getGalleries,
  getGallery,
  nozomiAll,
  nozomiForTerm,
  nozomiPage,
  pageUrls,
  searchWord,
  tagLabel,
  type Gallery,
} from "./api";
import type HitomiConfig from "./pbconfig";
import { buildFilters, getSavedFilters, HitomiFilterForm, lengthOk, saveFilters, tagRef, type SearchFilterValue } from "./filters";
import { getTypes, HitomiSettingsForm } from "./settings";

type Tri = Record<string, "included" | "excluded">;
// Filter tag ids are like "female:big_breasts" or "sole_female"; plain tags need the tag: prefix for lookup.
const withPrefix = (id: string) => {
  const ref = tagRef(id);
  return (/^(female|male|artist|group|series|character|type|tag):/.test(ref) ? ref : `tag:${ref}`).replace(/ /g, "_");
};

type Page = { page?: number; offset?: number } | undefined;

class RefererInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    request.headers = { ...request.headers, referer: `${BASE}/`, origin: BASE };
    return request;
  }
  override async interceptResponse(_req: Request, _res: Response, data: ArrayBuffer): Promise<ArrayBuffer> {
    return data;
  }
}

const SECTIONS: Record<string, { title: string; url: () => string }> = {
  today: { title: "Popular Today", url: () => `${LTN}/popular/today-${lang()}.nozomi` },
  week: { title: "Popular This Week", url: () => `${LTN}/popular/week-${lang()}.nozomi` },
  latest: { title: "Latest", url: () => `${LTN}/index-${lang()}.nozomi` },
  month: { title: "Popular This Month", url: () => `${LTN}/popular/month-${lang()}.nozomi` },
  year: { title: "Popular This Year", url: () => `${LTN}/popular/year-${lang()}.nozomi` },
};

const searchCache = new Map<string, number[]>();

function artistLine(g: Gallery): string {
  const names = [...(g.artists ?? []).map((a) => a.artist), ...(g.groups ?? []).map((x) => x.group)];
  return names.join(", ");
}

export class HitomiExtension implements ExtensionImpl<typeof HitomiConfig> {
  rateLimiter = new BasicRateLimiter("hitomi", { numberOfRequests: 15, bufferInterval: 1, ignoreImages: true });
  interceptor = new RefererInterceptor("hitomi-referer");

  async getSettingsForm() {
    return new HitomiSettingsForm();
  }

  async initialise(): Promise<void> {
    this.rateLimiter.registerInterceptor();
    this.interceptor.registerInterceptor();
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return Object.entries(SECTIONS).map(([id, s]) => ({
      id,
      title: s.title,
      type: DiscoverSectionType.simpleCarousel,
    }));
  }

  async getDiscoverSectionItems(section: DiscoverSection, metadata: Page): Promise<PagedResults<DiscoverSectionItem>> {
    const { ids, next } = await nozomiPage(SECTIONS[section.id]!.url(), metadata?.offset ?? 0);
    const items: DiscoverSectionItem[] = (await getGalleries(ids)).map((g) => ({
      type: "simpleCarouselItem",
      mangaId: String(g.id),
      title: g.title,
      imageUrl: coverUrl(g),
      subtitle: artistLine(g) || undefined,
    }));
    return { items, metadata: next !== undefined ? { offset: next } : undefined };
  }

  async getSortingOptions(): Promise<SortingOption[]> {
    return [
      { id: "latest", label: "Date Added" },
      { id: "today", label: "Popular Today" },
      { id: "week", label: "Popular This Week" },
      { id: "month", label: "Popular This Month" },
      { id: "year", label: "Popular This Year" },
    ];
  }

  async getAdvancedSearchForm(query: SearchQuery<SearchFilterValue[]>): Promise<HitomiFilterForm> {
    return new HitomiFilterForm(query.metadata, buildFilters());
  }

  async supportsTagExclusion(): Promise<boolean> {
    return true;
  }

  // Search box: plain words, namespaced terms like female:glasses / artist:name / series:name, and -term to exclude.
  async getSearchResults(
    query: SearchQuery<SearchFilterValue[]>,
    metadata: Page,
    sorting: SortingOption | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const page = metadata?.page ?? 0;
    const values = Array.isArray(query.metadata) ? query.metadata : undefined;
    if (values && page === 0) saveFilters(values);
    const saved = getSavedFilters();
    const pick = (id: string) => values?.find((v) => v.id === id)?.value ?? saved[id];
    const types = (pick("types") as Tri | undefined) ?? {};
    const tags = (pick("tags") as Tri | undefined) ?? {};
    const length = (pick("length") as string | undefined) ?? "all";

    const text = (query.title ?? "").trim().toLowerCase();
    const terms = text.split(/\s+/).filter(Boolean);
    const include = [
      ...terms.filter((t) => !t.startsWith("-")),
      ...Object.keys(tags).filter((k) => tags[k] === "included").map(withPrefix),
    ];
    const exclude = [
      ...terms.filter((t) => t.startsWith("-")).map((t) => t.slice(1)),
      ...Object.keys(tags).filter((k) => tags[k] === "excluded").map(withPrefix),
    ];
    const incTypes = Object.keys(types).filter((k) => types[k] === "included");
    const excTypes = Object.keys(types).filter((k) => types[k] === "excluded");
    const sortId = sorting?.id && SECTIONS[sorting.id] ? sorting.id : "latest";

    const key = JSON.stringify([include, exclude, incTypes, excTypes, sortId, lang()]);
    let all = searchCache.get(key);
    if (!all) {
      all = await this.runSearch(include, exclude, incTypes, excTypes, SECTIONS[sortId]!.url());
      if (searchCache.size > 20) searchCache.clear();
      searchCache.set(key, all);
    }
    const ids = all.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    const allowedTypes = incTypes.length ? incTypes : getTypes();
    const items: SearchResultItem[] = (await getGalleries(ids, allowedTypes))
      .filter((g) => lengthOk(length, g.files.length))
      .map((g) => ({
        mangaId: String(g.id),
        title: g.title,
        imageUrl: coverUrl(g),
        subtitle: artistLine(g) || undefined,
      }));
    return { items, metadata: ids.length === PAGE_SIZE ? { page: page + 1 } : undefined };
  }

  private async runSearch(
    include: string[],
    exclude: string[],
    incTypes: string[],
    excTypes: string[],
    sortUrl: string,
  ): Promise<number[]> {
    const fetchTerm = (t: string) => {
      const url = nozomiForTerm(t);
      return url ? nozomiAll(url) : searchWord(t).catch(() => [] as number[]);
    };
    const typeList = (incTypes.length ? incTypes : getTypes()).filter((t) => !excTypes.includes(t));
    const [base, typeSets, incSets, excSets] = await Promise.all([
      nozomiAll(sortUrl),
      Promise.all(typeList.map((t) => nozomiAll(`${LTN}/type/${t}-${lang()}.nozomi`))),
      Promise.all(include.map(fetchTerm)),
      Promise.all(exclude.map(fetchTerm)),
    ]);
    const typeSet = new Set(typeSets.flat());
    const must = incSets.map((s) => new Set(s));
    const banned = new Set(excSets.flat());
    const seen = new Set<number>();
    // Keep the sort order of the chosen list (newest or most popular first).
    return base.filter((id) => {
      if (seen.has(id)) return false;
      seen.add(id);
      return typeSet.has(id) && !banned.has(id) && must.every((m) => m.has(id));
    });
  }

  getMangaShareUrl(mangaId: string): string {
    return `${BASE}/reader/${mangaId}.html`;
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const g = await getGallery(mangaId);
    if (isHidden(g)) throw new Error("This gallery is hidden by your settings.");
    const extra = [
      g.japanese_title ? `Japanese title: ${g.japanese_title}` : "",
      `Type: ${g.type}`,
      `Pages: ${g.files.length}`,
      g.parodys?.length ? `Series: ${g.parodys.map((p) => p.parody).join(", ")}` : "",
      g.characters?.length ? `Characters: ${g.characters.map((c) => c.character).join(", ")}` : "",
    ].filter(Boolean);
    return {
      mangaId,
      mangaInfo: {
        primaryTitle: g.title,
        secondaryTitles: g.japanese_title ? [g.japanese_title] : [],
        thumbnailUrl: coverUrl(g),
        author: artistLine(g),
        artist: (g.artists ?? []).map((a) => a.artist).join(", "),
        synopsis: extra.join("\n"),
        status: "Completed",
        contentRating: ContentRating.ADULT,
        tagGroups: [
          {
            id: "tags",
            title: "Tags",
            tags: (g.tags ?? []).map((t) => ({ id: tagLabel(t).replace(/\s+/g, "_").replace(/[^A-Za-z0-9._\-@()\[\]%?#+=/&:]/g, ""), title: tagLabel(t) })),
          },
        ],
        shareUrl: this.getMangaShareUrl(mangaId),
      },
    };
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const g = await getGallery(sourceManga.mangaId);
    return [
      {
        chapterId: String(g.id),
        title: g.title,
        chapNum: 1,
        volume: 0,
        langCode: "en",
        publishDate: new Date(g.date.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00")),
        sourceManga,
      },
    ];
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const g = await getGallery(chapter.chapterId);
    if (isHidden(g)) throw new Error("This gallery isn't available in this extension.");
    return { id: chapter.chapterId, mangaId: chapter.sourceManga.mangaId, pages: await pageUrls(g) };
  }
}

export const HitomiPlus = new HitomiExtension();
