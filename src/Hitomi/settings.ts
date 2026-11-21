import { Form, InputRow, LabelRow, Section, SelectRow } from "@paperback/types";

export const TYPES = [
  { id: "artistcg", title: "Artist CG" },
  { id: "gamecg", title: "Game CG" },
  { id: "imageset", title: "Image Set (galleries)" },
  { id: "doujinshi", title: "Doujinshi" },
  { id: "manga", title: "Manga" },
  { id: "anime", title: "Anime" },
];
const DEFAULT_TYPES = ["artistcg", "gamecg", "imageset"];

export const LANGUAGES = [
  { id: "english", title: "English" },
  { id: "all", title: "All languages" },
  { id: "japanese", title: "Japanese" },
  { id: "korean", title: "Korean" },
  { id: "chinese", title: "Chinese" },
  { id: "spanish", title: "Spanish" },
];

const K_TYPES = "hitomi.types";
const K_LANG = "hitomi.language";
const K_BLOCK = "hitomi.blocklist";

export function getTypes(): string[] {
  const v = Application.getState(K_TYPES) as string[] | undefined;
  return v?.length ? v : DEFAULT_TYPES;
}
export function getLanguage(): string {
  return (Application.getState(K_LANG) as string | undefined) ?? "english";
}
export function getBlocklistText(): string {
  return (Application.getState(K_BLOCK) as string | undefined) ?? "";
}
/** Blocklist entries like "yaoi", "female:pregnant", "artist:someone". Lowercase, spaces normalised. */
export function getBlocklist(): string[] {
  return getBlocklistText()
    .split(/[,\n]/)
    .map((t) => t.trim().toLowerCase().replace(/_/g, " ").replace(/\s+/g, " "))
    .filter(Boolean);
}

export class HitomiSettingsForm extends Form {
  override getSections() {
    return [
      Section({ id: "content", header: "What to show", footer: "Default is CGs and image galleries only." }, [
        SelectRow("types", {
          title: "Gallery types",
          value: getTypes(),
          minItemCount: 1,
          maxItemCount: TYPES.length,
          layout: "list",
          items: TYPES,
          onValueChange: Application.Selector(this as HitomiSettingsForm, "setTypes"),
        }),
        SelectRow("lang", {
          title: "Language",
          value: [getLanguage()],
          minItemCount: 1,
          maxItemCount: 1,
          layout: "list",
          items: LANGUAGES,
          onValueChange: Application.Selector(this as HitomiSettingsForm, "setLang"),
        }),
      ]),
      Section(
        {
          id: "block",
          header: "Blocked tags",
          footer: "Comma separated. Plain tags (yaoi), or with a prefix: female:x, male:x, artist:x, group:x, series:x, character:x.",
        },
        [
          InputRow("blocklist", {
            title: "Block",
            value: getBlocklistText(),
            onValueChange: Application.Selector(this as HitomiSettingsForm, "setBlock"),
          }),
          LabelRow("note", { title: "Changes apply next time a page loads." }),
        ],
      ),
    ];
  }

  async setTypes(v: string[]): Promise<void> {
    Application.setState(v, K_TYPES);
  }
  async setLang(v: string[]): Promise<void> {
    Application.setState(v[0] ?? "english", K_LANG);
  }
  async setBlock(v: string): Promise<void> {
    Application.setState(v, K_BLOCK);
  }
}
