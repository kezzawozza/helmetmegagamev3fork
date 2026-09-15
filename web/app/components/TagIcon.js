"use client";

import { TAG_GROUP_ICONS, TAG_CATEGORY_ICONS } from "@/lib/tagIcons";

// A tag's glyph: its TagGroup's, or its category's when the group has none.
//
// The ONE place that resolves a tag to an icon, and the reason it is a
// component rather than a `tagIconFor(tag)` helper the callers invoke: a
// function that returns a component reads to react-hooks/static-components
// (an error in this repo) as a component being created during render, since
// the rule cannot see that every value in these maps is module-level and
// stable. Indexing the map right where it is rendered is the same lookup and
// is plainly static.
//
// Null when neither the group nor the category has a mark — Meta tags, say.
// That is a normal answer, not a failure; a chip without a glyph is a chip.
export default function TagIcon({ tag, size = 12, className = "chip-icon" }) {
  const slug = tag?.group?.slug ?? null;
  const category = String(tag?.category ?? "").toLowerCase();
  const Icon = (slug ? TAG_GROUP_ICONS[slug] : null) ?? TAG_CATEGORY_ICONS[category] ?? null;
  return Icon ? <Icon className={className} size={size} aria-hidden="true" /> : null;
}
