/* SPDX-License-Identifier: GPL-3.0-or-later */
import { ContentRating, ExtensionInfo, SourceIntents } from "@paperback/types";

export default {
  name: "Hitomi (CGs + Galleries)",
  description: "pisshammy's Hitomi extension plus CGs, image sets and a gallery type picker. 18+ only.",
  version: "2.2.0",
  icon: "icon.png",
  language: "multi",
  contentRating: ContentRating.ADULT,
  capabilities: [
    SourceIntents.DISCOVER_SECTION_PROVIDING,
    SourceIntents.SEARCH_RESULT_PROVIDING,
    SourceIntents.CHAPTER_PROVIDING,
    SourceIntents.SETTINGS_FORM_PROVIDING,
    SourceIntents.CLOUDFLARE_BYPASS_PROVIDING,
  ],
  badges: [],
  developers: [
    { name: "Flips Extras (CG/gallery additions)" },
    {
      name: "pisshammy",
      website: "cashapp: $0hammy0",
    },
  ],
} satisfies ExtensionInfo;
