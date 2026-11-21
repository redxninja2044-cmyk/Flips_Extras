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

import { getDoc, isDocument, listDocs, type ReaderDoc } from "./api";
import { toXhtmlBody } from "./html";
import type ReadwiseConfig from "./pbconfig";
import { ReadwiseSettingsForm } from "./settings";

type Cursor = { cursor?: string } | undefined;

const SECTIONS: { id: string; title: string; params: Record<string, string> }[] = [
  { id: "later", title: "Later", params: { location: "later" } },
  { id: "new", title: "Inbox", params: { location: "new" } },
  { id: "shortlist", title: "Shortlist", params: { location: "shortlist" } },
  { id: "epub", title: "Books (EPUB)", params: { category: "epub" } },
  { id: "archive", title: "Archive", params: { location: "archive" } },
];

const CATEGORY_LABEL: Record<string, string> = {
  article: "Article", email: "Email", rss: "Feed", pdf: "PDF", epub: "Book",
  tweet: "Tweet", video: "Video",
};

// Only hand Paperback absolute web URLs; EPUBs often have relative ones like ../media/cover.jpg.
function cover(doc: ReaderDoc): string {
  const url = doc.image_url ?? "";
  return /^https?:\/\//i.test(url) ? url : "";
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
    return SECTIONS.map((s) => ({
      id: s.id,
      title: s.title,
      type: DiscoverSectionType.simpleCarousel,
    }));
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: Cursor,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const def = SECTIONS.find((s) => s.id === section.id);
    if (!def) return { items: [], metadata: undefined };

    const res = await listDocs({ ...def.params, pageCursor: metadata?.cursor });
    const items: DiscoverSectionItem[] = res.results.filter(isDocument).map((doc) => ({
      type: "simpleCarouselItem",
      mangaId: doc.id,
      title: docTitle(doc),
      imageUrl: cover(doc),
      subtitle: doc.author ?? undefined,
    }));
    return {
      items,
      metadata: res.nextPageCursor ? { cursor: res.nextPageCursor } : undefined,
    };
  }

  async getSearchResults(
    query: SearchQuery<JSONValue>,
    metadata: Cursor,
  ): Promise<PagedResults<SearchResultItem>> {
    // The Reader API has no text search, so scan a few pages of the library
    // and match title/author locally.
    const needle = (query.title ?? "").toLowerCase().trim();
    let cursor = metadata?.cursor;
    const items: SearchResultItem[] = [];

    for (let i = 0; i < 3; i++) {
      const res = await listDocs({ pageCursor: cursor });
      for (const doc of res.results.filter(isDocument)) {
        const hay = `${doc.title ?? ""} ${doc.author ?? ""}`.toLowerCase();
        if (!needle || hay.includes(needle)) {
          items.push({
            mangaId: doc.id,
            title: docTitle(doc),
            imageUrl: cover(doc),
            subtitle: doc.author ?? undefined,
          });
        }
      }
      cursor = res.nextPageCursor ?? undefined;
      if (!cursor) break;
    }
    return { items, metadata: cursor ? { cursor } : undefined };
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
        status: doc.location ? `${category} (${doc.location})` : category,
        author: doc.author ?? "",
        tagGroups: [],
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
