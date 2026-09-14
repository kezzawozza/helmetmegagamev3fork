// Validation errors must come back from a server action as *data*, never a thrown Error —
// production Next.js redacts a thrown error to React error #441. Callers branch on `ok`, never try/catch, for validation.
import { deployVersion } from "@/lib/deployVersion";

export class UserError extends Error {
  constructor(message) {
    super(message);
    this.name = "UserError";
  }
}

// Anything but UserError rethrows untouched — `redirect()`/`notFound()` keep working. `version` is
// written FIRST so an action's own still wins; read by noteActionVersion() (useDeskVersion.js).
export async function guarded(fn) {
  try {
    const out = await fn();
    return { ok: true, version: deployVersion(), ...(out ?? {}) };
  } catch (e) {
    if (e instanceof UserError) return { ok: false, version: deployVersion(), error: e.message };
    throw e;
  }
}
