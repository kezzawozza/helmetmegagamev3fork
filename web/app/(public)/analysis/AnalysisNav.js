const SECTIONS = [
  { id: "summary", label: "Summary" },
  { id: "by-character", label: "By person" },
  { id: "most-powerful", label: "Most powerful" },
  { id: "coverage", label: "Coverage" },
  { id: "by-family", label: "Families" },
  { id: "by-tier", label: "Tiers" },
  { id: "over-time", label: "Over time" },
  { id: "concentration", label: "Concentration" },
  { id: "rejected", label: "Rejected" },
  { id: "once-ever", label: "Once per life" },
  { id: "freeform", label: "Freeform" },
  { id: "raw", label: "Raw claims" },
];

// Plain anchor-link jump nav — this page is one long scrolling report, not a
// ?s= tab switcher (there's nothing here expensive enough to want to avoid
// loading), so this is just a way to skip to a section, not a route change.
export default function AnalysisNav() {
  return (
    <nav className="panel flex flex-wrap gap-3 p-3 text-sm" aria-label="Jump to section">
      {SECTIONS.map((s) => (
        <a key={s.id} href={`#${s.id}`} className="menu-item">
          {s.label}
        </a>
      ))}
    </nav>
  );
}
