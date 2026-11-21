// Flips Extras additions on top of pisshammy's Hitomi extension:
// gallery type choice (CGs and image sets by default) and a fixed block on content involving minors.
import type { HitomiGallery } from "./model";

export const GALLERY_TYPES = [
  { id: "artistcg", title: "Artist CG" },
  { id: "gamecg", title: "Game CG" },
  { id: "imageset", title: "Image Set" },
  { id: "doujinshi", title: "Doujinshi" },
  { id: "manga", title: "Manga" },
  { id: "anime", title: "Anime" },
];
// Default: everything on (same as the original). Narrow it in settings or the search filter.
const DEFAULT_TYPES = ["artistcg", "gamecg", "imageset", "doujinshi", "manga", "anime"];
const TYPES_KEY = "hitomiplus.types.v2";

/** Ids of galleries hidden by the type choice or the minors block; filtered out of every list. */
export const hiddenIds = new Set<string>();

export function getTypesSetting(): string[] {
  const v = Application.getState(TYPES_KEY) as string[] | undefined;
  return Array.isArray(v) && v.length ? v : DEFAULT_TYPES;
}
export function setTypesSetting(v: string[]): void {
  Application.setState(v.length ? v : DEFAULT_TYPES, TYPES_KEY);
  hiddenIds.clear();
}
export function typesRestricted(types = getTypesSetting()): boolean {
  return GALLERY_TYPES.some((t) => !types.includes(t.id));
}

const MINOR = /loli|shota|toddler/i;
export function isMinorTag(name: string): boolean {
  return MINOR.test(name);
}
export function isHiddenGallery(g: HitomiGallery): boolean {
  if (typesRestricted() && !getTypesSetting().includes(g.type)) return true;
  return (g.tags ?? []).some((t) => isMinorTag(t?.name ?? ""));
}
