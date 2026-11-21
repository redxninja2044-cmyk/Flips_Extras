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
const DEFAULT_TYPES = ["artistcg", "gamecg", "imageset"];
const TYPES_KEY = "hitomiplus.types";

export function getTypesSetting(): string[] {
  const v = Application.getState(TYPES_KEY) as string[] | undefined;
  return Array.isArray(v) && v.length ? v : DEFAULT_TYPES;
}
export function setTypesSetting(v: string[]): void {
  Application.setState(v.length ? v : DEFAULT_TYPES, TYPES_KEY);
}
export function typesRestricted(types = getTypesSetting()): boolean {
  return GALLERY_TYPES.some((t) => !types.includes(t.id));
}

const MINOR = /loli|shota|toddler/i;
export function isMinorTag(name: string): boolean {
  return MINOR.test(name);
}
export function isHiddenGallery(g: HitomiGallery): boolean {
  if (!getTypesSetting().includes(g.type)) return true;
  return (g.tags ?? []).some((t) => isMinorTag(t?.name ?? ""));
}
