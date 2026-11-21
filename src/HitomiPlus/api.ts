// Talks to Hitomi's static data files (the same ones hitomi.la's own site uses).

export const BASE = "https://hitomi.la";
export const LTN = "https://ltn.gold-usergeneratedcontent.net";
const CDN = "gold-usergeneratedcontent.net";
export const PAGE_SIZE = 25;
import { getBlocklist, getLanguage, getTypes, TYPES } from "./settings";

export const lang = () => getLanguage();

// Galleries with any of these tags are never shown.
const BLOCKED = ["loli", "shota", "toddler", "lolicon", "shotacon", "toddlercon", "oppai loli", "low lolicon", "low shotacon"];

export type HTag = { tag: string; female?: string | number; male?: string | number };
export type Gallery = {
  id: string | number;
  title: string;
  japanese_title?: string | null;
  type: string;
  language?: string | null;
  date: string;
  files: { hash: string; haswebp?: number; hasavif?: number }[];
  artists?: { artist: string }[] | null;
  groups?: { group: string }[] | null;
  parodys?: { parody: string }[] | null;
  characters?: { character: string }[] | null;
  tags?: HTag[] | null;
};

async function get(url: string, range?: string): Promise<ArrayBuffer> {
  const headers: Record<string, string> = { referer: `${BASE}/` };
  if (range) headers["range"] = range;
  const [res, buf] = await Application.scheduleRequest({ url, method: "GET", headers });
  if (res.status >= 400) throw new Error(`Hitomi returned ${res.status} for ${url}`);
  return buf;
}

async function getText(url: string): Promise<string> {
  return Application.arrayBufferToUTF8String(await get(url));
}

function readIds(buf: ArrayBuffer, skip = 0): number[] {
  const v = new DataView(buf);
  const out: number[] = [];
  for (let i = skip; i + 4 <= buf.byteLength; i += 4) out.push(v.getUint32(i, false));
  return out;
}

export function tagLabel(t: HTag): string {
  if (String(t.female) === "1") return `female:${t.tag}`;
  if (String(t.male) === "1") return `male:${t.tag}`;
  return t.tag;
}

export function isBlocked(g: Gallery): boolean {
  return (g.tags ?? []).some((t) => {
    const n = t.tag.toLowerCase();
    return BLOCKED.includes(n) || n.includes("loli") || n.includes("shota");
  });
}

function labels(g: Gallery): Set<string> {
  const out = new Set<string>();
  for (const t of g.tags ?? []) {
    out.add(t.tag.toLowerCase());
    out.add(tagLabel(t).toLowerCase());
  }
  for (const a of g.artists ?? []) out.add(`artist:${a.artist}`.toLowerCase());
  for (const x of g.groups ?? []) out.add(`group:${x.group}`.toLowerCase());
  for (const x of g.parodys ?? []) out.add(`series:${x.parody}`.toLowerCase());
  for (const x of g.characters ?? []) out.add(`character:${x.character}`.toLowerCase());
  return out;
}

/** Hidden by the built-in block, the user's blocklist, or the type filter. */
export function isHidden(g: Gallery, types: string[] = getTypes()): boolean {
  if (isBlocked(g)) return true;
  if (!types.includes(g.type)) return true;
  const block = getBlocklist();
  if (!block.length) return false;
  const have = labels(g);
  return block.some((b) => have.has(b));
}

// Ids of every gallery of the chosen types, so lists can be filtered before downloading gallery info.
let typeCache: { key: string; ids: Set<number> } | undefined;
export async function typeIds(): Promise<Set<number> | undefined> {
  const types = getTypes();
  if (types.length >= TYPES.length) return undefined;
  const key = `${types.join(",")}|${lang()}`;
  if (typeCache?.key === key) return typeCache.ids;
  const lists = await Promise.all(types.map((t) => nozomiAll(`${LTN}/type/${t}-${lang()}.nozomi`)));
  typeCache = { key, ids: new Set(lists.flat()) };
  return typeCache.ids;
}

// ---------- lists (.nozomi files are big-endian uint32 gallery ids) ----------

const CHUNK = 500;

/** Reads a list from `offset`, keeping only ids of the chosen types, until a page is full. */
export async function nozomiPage(url: string, offset: number): Promise<{ ids: number[]; next?: number }> {
  const allowed = await typeIds();
  const ids: number[] = [];
  let pos = offset;
  for (let round = 0; round < 6 && ids.length < PAGE_SIZE; round++) {
    const want = allowed ? CHUNK : PAGE_SIZE - ids.length;
    const buf = await get(url, `bytes=${pos * 4}-${(pos + want) * 4 - 1}`);
    const chunk = readIds(buf);
    for (const id of chunk) {
      pos++;
      if (!allowed || allowed.has(id)) ids.push(id);
      if (ids.length >= PAGE_SIZE) break;
    }
    if (chunk.length < want && ids.length < PAGE_SIZE) return { ids };
  }
  return { ids, next: pos };
}

export async function nozomiAll(url: string): Promise<number[]> {
  try {
    return readIds(await get(url));
  } catch {
    return [];
  }
}

export function nozomiForTerm(term: string): string | undefined {
  const q = term.replace(/_/g, " ");
  const i = q.indexOf(":");
  if (i < 0) return undefined;
  const ns = q.slice(0, i).trim().toLowerCase();
  const tag = encodeURIComponent(q.slice(i + 1).trim().toLowerCase());
  if (ns === "female" || ns === "male") return `${LTN}/tag/${ns}:${tag}-${lang()}.nozomi`;
  if (["artist", "group", "series", "character", "tag", "type"].includes(ns)) return `${LTN}/${ns}/${tag}-${lang()}.nozomi`;
  return undefined;
}

// ---------- galleries ----------

const galleryCache = new Map<string, Gallery>();

export async function getGallery(id: string | number): Promise<Gallery> {
  const key = String(id);
  const hit = galleryCache.get(key);
  if (hit) return hit;
  const js = await getText(`${LTN}/galleries/${key}.js`);
  const g = JSON.parse(js.slice(js.indexOf("{")).replace(/;\s*$/, "")) as Gallery;
  if (galleryCache.size > 300) galleryCache.clear();
  galleryCache.set(key, g);
  return g;
}

export async function getGalleries(ids: number[], types?: string[]): Promise<Gallery[]> {
  const res = await Promise.all(ids.map((id) => getGallery(id).catch(() => undefined)));
  return res.filter((g): g is Gallery => !!g && !isHidden(g, types));
}

export function coverUrl(g: Gallery): string {
  const h = g.files[0]?.hash ?? "";
  if (h.length < 3) return `${BASE}/favicon.ico`;
  return `https://atn.${CDN}/avifbigtn/${h.slice(-1)}/${h.slice(-3, -1)}/${h}.avif`;
}

// ---------- image routing (gg.js changes often, so it is re-read every few minutes) ----------

type GG = { b: string; cases: Set<number>; switchO: number; defaultO: number; at: number };
let gg: GG | undefined;

async function getGG(): Promise<GG> {
  if (gg && Date.now() - gg.at < 5 * 60_000) return gg;
  const js = await getText(`${LTN}/gg.js?_=${Date.now()}`);
  const b = /b:\s*'([^']+)'/.exec(js)?.[1] ?? "";
  const defaultO = Number(/var o = (\d+)/.exec(js)?.[1] ?? 0);
  const switchO = Number(/o = (\d+); break;/.exec(js)?.[1] ?? 1);
  const cases = new Set([...js.matchAll(/case (\d+):/g)].map((m) => Number(m[1])));
  gg = { b, cases, switchO, defaultO, at: Date.now() };
  return gg;
}

export async function pageUrls(g: Gallery): Promise<string[]> {
  const s = await getGG();
  const b = s.b.replace(/\/+$/, "");
  return g.files.map((f) => {
    const h = f.hash;
    const imageId = parseInt(h.slice(-1) + h.slice(-3, -1), 16);
    const o = s.cases.has(imageId) ? s.switchO : s.defaultO;
    const ext = f.haswebp === 1 && !f.hasavif ? "webp" : "avif"; // animated pages only come as webp
    return `https://a${o + 1}.${CDN}/${b}/${imageId}/${h}.${ext}`;
  });
}

// ---------- plain-text search (B-tree index keyed by sha256 of the word) ----------

function sha256First4(text: string): Uint8Array {
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
    0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
    0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
    0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
    0xc67178f2,
  ];
  const bytes = Array.from(new TextEncoder().encode(text));
  const bitLen = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (let i = 7; i >= 0; i--) bytes.push(i >= 4 ? 0 : (bitLen >>> (i * 8)) & 0xff);
  const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  const w = new Array<number>(64);
  for (let off = 0; off < bytes.length; off += 64) {
    for (let i = 0; i < 16; i++)
      w[i] = (bytes[off + i * 4]! << 24) | (bytes[off + i * 4 + 1]! << 16) | (bytes[off + i * 4 + 2]! << 8) | bytes[off + i * 4 + 3]!;
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15]!, 7) ^ rotr(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3);
      const s1 = rotr(w[i - 2]!, 17) ^ rotr(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) | 0;
    }
    let [a, b, c, d, e, f, g, h] = H as [number, number, number, number, number, number, number, number];
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i]! + w[i]!) | 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    const add = [a, b, c, d, e, f, g, h];
    for (let i = 0; i < 8; i++) H[i] = (H[i]! + add[i]!) | 0;
  }
  const h0 = H[0]!;
  return new Uint8Array([(h0 >>> 24) & 0xff, (h0 >>> 16) & 0xff, (h0 >>> 8) & 0xff, h0 & 0xff]);
}

type Node = { keys: Uint8Array[]; datas: [number, number][]; subs: number[] };

function decodeNode(buf: ArrayBuffer): Node {
  const v = new DataView(buf);
  let p = 0;
  const u32 = () => { const x = v.getUint32(p, false); p += 4; return x; };
  const u64 = () => { const hi = v.getUint32(p, false); const lo = v.getUint32(p + 4, false); p += 8; return hi * 2 ** 32 + lo; };
  const keys: Uint8Array[] = [];
  const nk = u32();
  for (let i = 0; i < nk; i++) { const n = u32(); keys.push(new Uint8Array(buf.slice(p, p + n))); p += n; }
  const datas: [number, number][] = [];
  const nd = u32();
  for (let i = 0; i < nd; i++) { const o = u64(); datas.push([o, u32()]); }
  const subs: number[] = [];
  for (let i = 0; i < 17; i++) subs.push(u64());
  return { keys, datas, subs };
}

function cmp(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i]! < b[i]! ? -1 : 1;
  return 0;
}

export async function searchWord(word: string): Promise<number[]> {
  const key = sha256First4(word.replace(/_/g, " ").toLowerCase());
  const version = (await getText(`${LTN}/galleriesindex/version?_=${Date.now()}`)).trim();
  const idx = `${LTN}/galleriesindex/galleries.${version}.index`;
  let addr = 0;
  for (let depth = 0; depth < 20; depth++) {
    const node = decodeNode(await get(idx, `bytes=${addr}-${addr + 463}`));
    if (!node.keys.length) return [];
    let at = node.keys.length;
    let found = false;
    for (let i = 0; i < node.keys.length; i++) {
      const c = cmp(key, node.keys[i]!);
      if (c <= 0) { at = i; found = c === 0; break; }
    }
    if (found) {
      const [off, len] = node.datas[at]!;
      if (!len) return [];
      const data = await get(`${LTN}/galleriesindex/galleries.${version}.data`, `bytes=${off}-${off + len - 1}`);
      return readIds(data, 4);
    }
    if (node.subs.every((s) => s === 0) || !node.subs[at]) return [];
    addr = node.subs[at]!;
  }
  return [];
}
