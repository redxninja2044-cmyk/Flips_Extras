import { ContentRating, SourceIntents, type ExtensionInfo } from "@paperback/types";

export default {
  name: "Readwise Reader",
  description:
    "Read your own Readwise Reader library (books: EPUBs and PDFs) in Paperback. Needs your Readwise access token.",
  version: "1.0.0-alpha.5",
  icon: "icon.png",
  language: "en",
  contentRating: ContentRating.EVERYONE,
  capabilities: [
    SourceIntents.CHAPTER_PROVIDING,
    SourceIntents.DISCOVER_SECTION_PROVIDING,
    SourceIntents.SEARCH_RESULT_PROVIDING,
    SourceIntents.SETTINGS_FORM_PROVIDING,
  ],
  badges: [],
  developers: [{ name: "redxninja2044-cmyk", github: "https://github.com/redxninja2044-cmyk" }],
} satisfies ExtensionInfo;
