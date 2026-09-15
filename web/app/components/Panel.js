// A card with a heading on it — the shell fifty-odd surfaces were writing out
// by hand, four utilities at a time, in a handful of subtly different spellings.
//
// Two cascade traps it exists to stop repeating. `.panel` carries NO padding of
// its own, so every call site had to remember a `p-*`; and `.panel` is
// unlayered while Tailwind's utilities live in @layer utilities, so a utility
// that looks like it should win here sometimes does not. Both are handled once,
// here.
//
// `.panel-header` is the heading a card wears; `.section-title` is the heading
// a SECTION wears, and they are not interchangeable (DESIGN-SYSTEM.md §5) — so
// this component only ever writes the first, and a section head stays the
// caller's own markup.
//
// No "use client": a plain wrapper, so a server component can use it too.
export default function Panel({ title, actions, children, className = "", pad = "p-3" }) {
  return (
    <section className={`panel flex flex-col gap-3 ${pad} ${className}`.trim()}>
      {title || actions ? (
        <div className="flex flex-wrap items-center gap-3">
          {title ? <h2 className="panel-header">{title}</h2> : null}
          {/* A wrapper carries ml-auto, never the button: every .btn* is
              `all: unset`, which clears a margin utility put on it directly. */}
          {actions ? <div className="ml-auto flex flex-wrap gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}
