// Tag.expiresInto / Tag.removesInto as a {tag:…} token string for ChipText. `dead` is the reserved
// expiry token (db/lib/tagShapes.js) — no catalog row, written as the plain word.
export function chainTokens(chain, bySlug = null) {
  const entries = Array.isArray(chain) ? chain : null;
  if (!entries?.length) return null;
  return entries
    .map((entry) =>
      (entry?.oneOf ?? [])
        .filter((slug) => slug === "dead" || !bySlug || bySlug.has(slug))
        .map((slug) => (slug === "dead" ? "dead" : `{tag:${slug}}`))
        .join(" or "),
    )
    .filter(Boolean)
    .join(" and ");
}
