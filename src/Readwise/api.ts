import { getToken } from "./settings";

export const API = "https://readwise.io/api/v3";

export type ReaderDoc = {
  id: string;
  url?: string;
  source_url?: string | null;
  title?: string | null;
  author?: string | null;
  category?: string;
  location?: string;
  summary?: string | null;
  image_url?: string | null;
  parent_id?: string | null;
  published_date?: string | number | null;
  created_at?: string;
  updated_at?: string;
  html_content?: string | null;
  content?: string | null;
  tags?: Record<string, { name?: string }> | string[] | null;
};

type ListResponse = {
  count: number;
  nextPageCursor: string | null;
  results: ReaderDoc[];
};

export async function listDocs(params: Record<string, string | undefined>): Promise<ListResponse> {
  const token = getToken();
  if (!token) {
    throw new Error("No access token set.");
  }
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`)
    .join("&");

  const [response, buffer] = await Application.scheduleRequest({
    url: `${API}/list/${qs ? `?${qs}` : ""}`,
    method: "GET",
    headers: { Authorization: `Token ${token}` },
  });

  if (response.status === 401 || response.status === 403) {
    throw new Error("Invalid access token.");
  }
  if (response.status === 429) {
    throw new Error("Rate limited. Try again in a minute.");
  }
  if (response.status >= 400) {
    throw new Error(`Readwise returned HTTP ${response.status}.`);
  }
  return JSON.parse(Application.arrayBufferToUTF8String(buffer)) as ListResponse;
}

export async function getDoc(id: string, withHtml: boolean): Promise<ReaderDoc> {
  const res = await listDocs({ id, withHtmlContent: withHtml ? "true" : undefined });
  const doc = res.results[0];
  if (!doc) throw new Error(`Document ${id} not found in your Readwise library.`);
  return doc;
}

// Highlights and notes are also returned by /list; they have a parent_id.
export function isDocument(doc: ReaderDoc): boolean {
  return !doc.parent_id && doc.category !== "highlight" && doc.category !== "note";
}

export const BOOK_CATEGORIES = ["epub", "pdf"];

export function tagNames(doc: ReaderDoc): string[] {
  const t = doc.tags;
  if (!t) return [];
  if (Array.isArray(t)) return t;
  return Object.entries(t).map(([k, v]) => v?.name ?? k);
}

// Small in-memory cache of the whole book list, used by Tags and Search.
let cache: { at: number; books: ReaderDoc[] } | undefined;

export async function getAllBooks(): Promise<ReaderDoc[]> {
  if (cache && Date.now() - cache.at < 5 * 60 * 1000) return cache.books;
  const books: ReaderDoc[] = [];
  for (const category of BOOK_CATEGORIES) {
    let cursor: string | undefined;
    // 100 docs per page; 12 pages covers 1,200 per category. The extension's rate limiter
    // spaces requests 3 seconds apart, which keeps this under Readwise's 20 list requests per minute.
    for (let i = 0; i < 12; i++) {
      const res = await listDocs({ category, pageCursor: cursor });
      books.push(...res.results.filter(isDocument));
      cursor = res.nextPageCursor ?? undefined;
      if (!cursor) break;
    }
  }
  cache = { at: Date.now(), books };
  return books;
}
