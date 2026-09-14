// The Appraisal skill's per-viewer projection: whether a tag object grows a `valueObols` key. Each
// loader shipping tag data to a browser calls this once it knows whether ITS viewer holds Appraisal
// — TagDetails.js has no viewer context of its own, so the gate lives here, not at render time.
// Three states: key ABSENT for a non-appraiser, `null` for no sellablePrice, a number otherwise.
export function appraise(tag, canAppraise) {
  if (!tag) return tag;
  // Always drops the raw `sellablePrice` column — leaving it in the payload would leak it via dev tools.
  const { sellablePrice, ...rest } = tag;
  if (!canAppraise) return rest;
  return { ...rest, valueObols: sellablePrice ?? null };
}
