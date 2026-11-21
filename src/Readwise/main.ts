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
} from "@paperback/types";

import { BOOK_CATEGORIES, getAllBooks, getDoc, isDocument, listDocs, tagNames, type ReaderDoc } from "./api";
import { toXhtmlBody } from "./html";
import type ReadwiseConfig from "./pbconfig";
import { ReadwiseSettingsForm } from "./settings";

type BookCursor = { cat: number; cursor?: string } | undefined;
type TagFilter = { tags?: Record<string, string> };

const CATEGORY_LABEL: Record<string, string> = {
  article: "Article", email: "Email", rss: "Feed", pdf: "Novel", epub: "Novel",
  tweet: "Tweet", video: "Video",
};

// Only hand Paperback absolute web URLs; EPUBs often have relative ones like ../media/cover.jpg.
const PLACEHOLDER = "https://redxninja2044-cmyk.github.io/PaperBack_Readwise/Readwise/static/icon.png";

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

  async getSearchResults(
    query: SearchQuery<JSONValue>,
    _metadata: JSONValue | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const needle = (query.title ?? "").toLowerCase().trim();
    const filter = (query.metadata ?? {}) as TagFilter;
    const included = Object.entries(filter.tags ?? {})
      .filter(([, v]) => v === "included")
      .map(([k]) => k);

    const items: SearchResultItem[] = (await getAllBooks())
      .filter((doc) => {
        const hay = `${doc.title ?? ""} ${doc.author ?? ""}`.toLowerCase();
        if (needle && !hay.includes(needle)) return false;
        const tags = tagNames(doc);
        return included.every((t) => tags.includes(t));
      })
      .map((doc) => ({
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
            tags: tagNames(doc).map((t) => ({ id: t, title: t })),
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
