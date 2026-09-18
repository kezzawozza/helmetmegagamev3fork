"use client";

import { TAG_GROUP_ICONS, TAG_CATEGORY_ICONS } from "@/lib/tagIcons";

// A tag's mark: its OWN sprite if the catalog gave it one, else its TagGroup's
// glyph, else its category's.
//
// The ONE place that resolves a tag to an icon, and the reason it is a
// component rather than a `tagIconFor(tag)` helper the callers invoke: a
// function that returns a component reads to react-hooks/static-components
// (an error in this repo) as a component being created during render, since
// the rule cannot see that every value in these maps is module-level and
// stable. Indexing the map right where it is rendered is the same lookup and
// is plainly static.
//
// `Tag.sprite` is a basename under web/public/assets/items — pixel art from
// OpenSourceWeb (see that folder's ATTRIBUTION.md). It only ever REPLACES the
// glyph below; most of the catalog has none and is drawn exactly as it was
// before sprites existed.
//
// Sprites ignore the caller's `size` and render in a fixed 16px box. The files
// are cropped to their own content and squared, so their natural sizes run
// 5-32px rather than a uniform 32: OpenSourceWeb draws an item small inside a
// tile-sized frame, and mapping that whole frame to 16px left a bottle as a
// five-pixel speck. Cropping is what makes them legible, and it means most are
// NOT an exact halving — `image-rendering: pixelated` is doing the real work
// here, keeping an odd ratio chunky instead of blurry. The lucide glyphs keep
// their own 11/12/13.
//
// Null when the tag has no sprite, no group mark and no category mark — Meta
// tags, say. That is a normal answer, not a failure; a chip without a glyph is
// a chip.
export default function TagIcon({ tag, size = 12, className = "chip-icon" }) {
  const sprite = tag?.sprite ?? null;
  if (sprite) {
    // A plain <img>, not next/image: this is a small file off our own origin,
    // so the optimizer would cost a loader round trip to serve an image
    // smaller than the request header asking for it — and would resample the
    // pixel art doing it, which is the one thing §3a forbids.
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`/assets/items/${sprite}.png`}
        className={`${className} chip-sprite`}
        width={16}
        height={16}
        alt=""
        aria-hidden="true"
        draggable="false"
      />
    );
  }
  const slug = tag?.group?.slug ?? null;
  const category = String(tag?.category ?? "").toLowerCase();
  const Icon = (slug ? TAG_GROUP_ICONS[slug] : null) ?? TAG_CATEGORY_ICONS[category] ?? null;
  return Icon ? <Icon className={className} size={size} aria-hidden="true" /> : null;
}
