import { deployVersion } from "@/lib/deployVersion";

// The adjudication desk's pre-flight check (useDeskVersion.js): "is the server still the build I loaded?" Polled
// every 45s, touches no database, no session. A route with no dynamic API could get prerendered and the version
// would bake at build time — `force-dynamic` makes that impossible, so a stale build always shows its reload chip.
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(
    { version: deployVersion() },
    { headers: { "cache-control": "no-store" } },
  );
}
