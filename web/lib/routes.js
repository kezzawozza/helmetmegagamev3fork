// Route patterns for revalidatePath: it needs the ROUTE, not a matching literal URL, once a route
// has a dynamic segment — otherwise a GM with a Move open never receives the invalidation.

export const TURNS_PATH = "/gm/turns/[[...selection]]";

// The adjudication desk's selection is a SEARCH PARAM, not a path segment (see page.js — a path
// param changing under router.refresh() remounts the whole desk). Build every Move/Caving href here.
export function turnsSelectionHref(sel) {
  return sel ? `/gm/turns?sel=${sel.type}/${sel.id}` : "/gm/turns";
}
