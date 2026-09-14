// Tag.expiresInto / Tag.removesInto as a {tag:…} token string for ChipText to resolve. Entries are
// normalised to { oneOf: [...] } by db/lib/syncTags.js: several entries land at once ("and"), a
// multi-slug oneOf rolls between them ("or"). `bySlug`, if passed, drops a slug not actually shipped
// to the surface. `dead` is the reserved expiry token (db/lib/tagShapes.js) — has no catalog row, so
// it's written as the plain word and skips the bySlug filter.
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
