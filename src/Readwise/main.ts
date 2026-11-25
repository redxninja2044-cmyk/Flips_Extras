import {
  BasicRateLimiter,
  ContentRating,
  DiscoverSectionType,
  type Chapter,
  type ChapterDetails,
  type DiscoverSection,
  type DiscoverSectionItem,
  type ExtensionImpl,
  type Form,
  type PagedResults,
  type SearchQuery,
  type JSONValue,
  type SearchResultItem,
  type SourceManga,
  type SortingOption,
} from "@paperback/types";

import { BOOK_CATEGORIES, getAllBooks, getDoc, isDocument, listDocs, tagNames, type ReaderDoc } from "./api";
import { toXhtmlBody } from "./html";
import type ReadwiseConfig from "./pbconfig";
import { ReadwiseSettingsForm } from "./settings";
import {
  applyFilters,
  buildFilters,
  getSavedFilters,
  ReadwiseFilterForm,
  saveFilters,
  SORTS,
  tagId,
  type SearchFilterValue,
} from "./filters";

type BookCursor = { cat: number; cursor?: string } | undefined;
type TagFilter = { tags?: Record<string, string> };

const CATEGORY_LABEL: Record<string, string> = {
  article: "Article", email: "Email", rss: "Feed", pdf: "Novel", epub: "Novel",
  tweet: "Tweet", video: "Video",
};

// Only hand Paperback absolute web URLs; EPUBs often have relative ones like ../media/cover.jpg.
const PLACEHOLDER = "https://redxninja2044-cmyk.github.io/Flips_Extras/Readwise/static/icon.png";

function cover(doc: ReaderDoc): string {
  const url = doc.image_url ?? "";
  return /^https?:\/\//i.test(url) ? url : PLACEHOLDER;
}

function docTitle(doc: ReaderDoc): string {
  return doc.title?.trim() || doc.source_url || "Untitled";
}

export class ReadwiseExtension implements ExtensionImpl<typeof ReadwiseConfig> {
  // Readwise allows about 20 list requests per minute.
  rateLimiter = new BasicRateLimiter("readwise", {
    numberOfRequests: 1,
    bufferInterval: 3,
    ignoreImages: true,
  });

  async initialise(): Promise<void> {
    this.rateLimiter.registerInterceptor();
  }

  async getSettingsForm(): Promise<Form> {
    return new ReadwiseSettingsForm();
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [
      { id: "books", title: "Novels", type: DiscoverSectionType.simpleCarousel },
      { id: "tags", title: "Series", type: DiscoverSectionType.genres },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: BookCursor,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    if (section.id === "tags") {
      const names = new Set<string>();
      for (const book of await getAllBooks()) tagNames(book).forEach((t) => names.add(t));
      return {
        items: [...names].sort((x, y) => x.localeCompare(y)).map((name) => ({
          type: "genresCarouselItem",
          searchQuery: { title: "", metadata: { tags: { [name]: "included" } } },
          name,
          metadata: undefined,
        })),
        metadata: undefined,
      };
    }

    // Books = EPUBs first, then PDFs, paged through Readwise's cursors.
    const cat = metadata?.cat ?? 0;
    const res = await listDocs({ category: BOOK_CATEGORIES[cat], pageCursor: metadata?.cursor });
    const items: DiscoverSectionItem[] = res.results.filter(isDocument).map((doc) => ({
      type: "simpleCarouselItem",
      mangaId: doc.id,
      title: docTitle(doc),
      imageUrl: cover(doc),
      subtitle: doc.author ?? undefined,
    }));
    let next: BookCursor;
    if (res.nextPageCursor) next = { cat, cursor: res.nextPageCursor };
    else if (cat + 1 < BOOK_CATEGORIES.length) next = { cat: cat + 1 };
    return { items, metadata: next };
  }

  async getSortingOptions(): Promise<SortingOption[]> {
    return SORTS;
  }

  async getAdvancedSearchForm(query: SearchQuery<SearchFilterValue[]>): Promise<ReadwiseFilterForm> {
    const meta = Array.isArray(query.metadata) ? query.metadata : undefined;
    return new ReadwiseFilterForm(meta, buildFilters());
  }

  async getSearchResults(
    query: SearchQuery<JSONValue>,
    _metadata: JSONValue | undefined,
    sorting?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    let values: Record<string, SearchFilterValue["value"]>;
    if (Array.isArray(query.metadata)) {
      // Submitted from the filter screen; remembered for next time, like the Hitomi extension.
      const submitted = query.metadata as SearchFilterValue[];
      saveFilters(submitted);
      values = Object.fromEntries(submitted.map((v) => [v.id, v.value]));
    } else if (query.metadata && (query.metadata as TagFilter).tags) {
      // Tapped a Series tile on the home page: show just that series, ignoring saved filters.
      const names = Object.keys((query.metadata as TagFilter).tags ?? {});
      values = { tags: Object.fromEntries(names.map((n) => [tagId(n), "included" as const])) };
    } else {
      values = getSavedFilters();
    }

    const items: SearchResultItem[] = applyFilters(
      await getAllBooks(),
      query.title ?? "",
      values,
      sorting?.id ?? "title",
    ).map((doc) => ({
      mangaId: doc.id,
      title: docTitle(doc),
      imageUrl: cover(doc),
      subtitle: doc.author ?? undefined,
    }));
    return { items, metadata: undefined };
  }

  getMangaShareUrl(mangaId: string): string {
    return `https://read.readwise.io/read/${mangaId}`;
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const doc = await getDoc(mangaId, false);
    const category = CATEGORY_LABEL[doc.category ?? ""] ?? "Document";
    return {
      mangaId,
      mangaInfo: {
        primaryTitle: docTitle(doc),
        secondaryTitles: [],
        contentType: "novel",
        status: category,
        author: doc.author ?? "",
        tagGroups: [
          {
            id: "tags",
            title: "Series",
            tags: tagNames(doc).map((t) => ({ id: tagId(t), title: t })),
          },
        ],
        synopsis: doc.summary ?? "",
        thumbnailUrl: cover(doc),
        contentRating: ContentRating.EVERYONE,
        shareUrl: this.getMangaShareUrl(mangaId),
      },
    };
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    // One long chapter per document so Paperback keeps your scroll position.
    const doc = await getDoc(sourceManga.mangaId, false);
    return [
      {
        chapterId: doc.id,
        title: docTitle(doc),
        chapNum: 1,
        volume: 0,
        langCode: "en",
        publishDate: new Date(doc.updated_at ?? doc.created_at ?? Date.now()),
        sourceManga,
      },
    ];
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const docId = chapter.chapterId.split("::")[0]!;
    const doc = await getDoc(docId, true);
    const html = doc.html_content ?? "";
    if (!html) {
      throw new Error("Readwise has no readable text for this document (it may be a video or scanned PDF).");
    }
    const body = toXhtmlBody(`<h2>${docTitle(doc)}</h2>\n` + html);
    return {
      id: chapter.chapterId,
      mangaId: docId,
      type: "html",
      html: `<html xmlns="http://www.w3.org/1999/xhtml"><head></head><body>${body}</body></html>`,
    };
  }
}

export const Readwise = new ReadwiseExtension();
