// Rendered as layout.js's `{children}` below the AppHeader; holds still the
// band's height (300, matching the identity cluster's face+name, SHEET.md §2)
// and the three-column body. Traces the sheet layout since that's the common
// case, even though it can't know which of the four kinds is really arriving.
export default function Loading() {
  return (
    <div className="sheet-body" aria-hidden="true">
      <div className="sheet-band panel animate-pulse" style={{ minHeight: 300 }} />
      <div className="ledger-body">
        <div className="ledger-col">
          <div className="panel animate-pulse" style={{ height: 320 }} />
        </div>
        <div className="ledger-col">
          <div className="panel animate-pulse" style={{ height: 200 }} />
          <div className="panel animate-pulse" style={{ height: 160 }} />
        </div>
        <div className="ledger-col">
          <div className="panel animate-pulse" style={{ height: 240 }} />
          <div className="panel animate-pulse" style={{ height: 240 }} />
        </div>
      </div>
    </div>
  );
}
