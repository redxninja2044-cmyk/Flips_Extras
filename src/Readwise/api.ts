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
};

type ListResponse = {
  count: number;
  nextPageCursor: string | null;
  results: ReaderDoc[];
};

export async function listDocs(params: Record<string, string | undefined>): Promise<ListResponse> {
  const token = getToken();
  if (!token) {
    throw new Error("Add your Readwise access token in this extension's settings first.");
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
    throw new Error("Readwise rejected the token. Check it in this extension's settings.");
  }
  if (response.status === 429) {
    throw new Error("Readwise rate limit hit. Wait a minute and try again.");
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
