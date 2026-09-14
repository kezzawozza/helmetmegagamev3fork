// Validation errors must come back from a server action as *data*, never a thrown Error — production
// Next.js redacts a thrown error to React error #441, so a throwing action shows the player a code
// instead of "You don't have that many ⬢". Contract: `{ ok: true, ...payload }` or
// `{ ok: false, error }`. Callers branch on `ok`, never try/catch, for validation.

import { deployVersion } from "@/lib/deployVersion";

export class UserError extends Error {
  constructor(message) {
    super(message);
    this.name = "UserError";
  }
}

// Runs `fn` and converts a UserError into a failed result. Anything else rethrows untouched — genuine
// faults keep their log entry, and `redirect()`/`notFound()` (which work by throwing) keep working.
// Every result also carries `version` (the build that answered it), read by noteActionVersion()
// (useDeskVersion.js) to latch a desk's stale flag on the first post-deploy mutation. Written FIRST
// so an action's own `version` still wins.
export async function guarded(fn) {
  try {
    const out = await fn();
    return { ok: true, version: deployVersion(), ...(out ?? {}) };
  } catch (e) {
    if (e instanceof UserError) return { ok: false, version: deployVersion(), error: e.message };
    throw e;
  }
}
