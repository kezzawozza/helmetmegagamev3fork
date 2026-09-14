import PageShell from "@/app/components/PageShell";

// The generic body skeleton for a page with no shaped one of its own. Renders no title — it can't know whose page
// it stands in for. Not a route-level loading.js (see PageShell.js#SkeletonPage): only a Suspense fallback inside a page.
export default function Loading() {
  return (
    <PageShell>
      <div className="panel animate-pulse p-4" style={{ height: 96 }} />
      <div className="panel animate-pulse p-4" style={{ height: 220 }} />
    </PageShell>
  );
}
