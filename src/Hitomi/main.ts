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
} from "@paperback/types";

import {
  BASE,
  LANG,
  LTN,
  PAGE_SIZE,
  coverUrl,
  getGalleries,
  getGallery,
  isBlocked,
  nozomiAll,
  nozomiForTerm,
  nozomiPage,
  pageUrls,
  searchWord,
  tagLabel,
  type Gallery,
} from "./api";
import type HitomiConfig from "./pbconfig";

type Page = { page: number } | undefined;

class RefererInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    request.headers = { ...request.headers, referer: `${BASE}/`, origin: BASE };
    return request;
  }
  override async interceptResponse(_req: Request, _res: Response, data: ArrayBuffer): Promise<ArrayBuffer> {
    return data;
  }
}

const SECTIONS: Record<string, { title: string; url: string }> = {
  today: { title: "Popular Today", url: `${LTN}/popular/today-${LANG}.nozomi` },
  week: { title: "Popular This Week", url: `${LTN}/popular/week-${LANG}.nozomi` },
  latest: { title: "Latest", url: `${LTN}/index-${LANG}.nozomi` },
  month: { title: "Popular This Month", url: `${LTN}/popular/month-${LANG}.nozomi` },
};

const searchCache = new Map<string, number[]>();

function artistLine(g: Gallery): string {
  const names = [...(g.artists ?? []).map((a) => a.artist), ...(g.groups ?? []).map((x) => x.group)];
  return names.join(", ");
}

export class HitomiExtension implements ExtensionImpl<typeof HitomiConfig> {
  rateLimiter = new BasicRateLimiter("hitomi", { numberOfRequests: 15, bufferInterval: 1, ignoreImages: true });
  interceptor = new RefererInterceptor("hitomi-referer");

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
    const page = metadata?.page ?? 0;
    const { ids, more } = await nozomiPage(SECTIONS[section.id]!.url, page);
    const items: DiscoverSectionItem[] = (await getGalleries(ids)).map((g) => ({
      type: "simpleCarouselItem",
      mangaId: String(g.id),
      title: g.title,
      imageUrl: coverUrl(g),
      subtitle: artistLine(g) || undefined,
    }));
    return { items, metadata: more ? { page: page + 1 } : undefined };
  }

  // Search box: plain words, namespaced terms like female:glasses / artist:name / series:name, and -term to exclude.
  async getSearchResults(query: SearchQuery<JSONValue>, metadata: Page): Promise<PagedResults<SearchResultItem>> {
    const page = metadata?.page ?? 0;
    const text = (query.title ?? "").trim().toLowerCase();
    let ids: number[];

    if (!text) {
      ({ ids } = await nozomiPage(SECTIONS.latest!.url, page));
    } else {
      let all = searchCache.get(text);
      if (!all) {
        all = await this.runSearch(text);
        searchCache.set(text, all);
      }
      ids = all.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    }

    const items: SearchResultItem[] = (await getGalleries(ids)).map((g) => ({
      mangaId: String(g.id),
      title: g.title,
      imageUrl: coverUrl(g),
      subtitle: artistLine(g) || undefined,
    }));
    return { items, metadata: ids.length === PAGE_SIZE ? { page: page + 1 } : undefined };
  }

  private async runSearch(text: string): Promise<number[]> {
    const terms = text.split(/\s+/).filter(Boolean);
    const include = terms.filter((t) => !t.startsWith("-"));
    const exclude = terms.filter((t) => t.startsWith("-")).map((t) => t.slice(1));
    const fetchTerm = (t: string) => {
      const url = nozomiForTerm(t);
      return url ? nozomiAll(url) : searchWord(t).catch(() => []);
    };

    // A gallery id must be English to show up.
    const sets = await Promise.all([...include.map(fetchTerm), nozomiAll(`${LTN}/index-${LANG}.nozomi`)]);
    let result = sets[0] ?? [];
    for (const s of sets.slice(1)) {
      const keep = new Set(s);
      result = result.filter((id) => keep.has(id));
    }
    const banned = new Set((await Promise.all(exclude.map(fetchTerm))).flat());
    return [...new Set(result)].filter((id) => !banned.has(id)).sort((a, b) => b - a);
  }

  getMangaShareUrl(mangaId: string): string {
    return `${BASE}/reader/${mangaId}.html`;
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const g = await getGallery(mangaId);
    if (isBlocked(g)) throw new Error("This gallery isn't available in this extension.");
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
            tags: (g.tags ?? []).map((t) => ({ id: tagLabel(t), title: tagLabel(t) })),
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
    if (isBlocked(g)) throw new Error("This gallery isn't available in this extension.");
    return { id: chapter.chapterId, mangaId: chapter.sourceManga.mangaId, pages: await pageUrls(g) };
  }
}

export const Hitomi = new HitomiExtension();
