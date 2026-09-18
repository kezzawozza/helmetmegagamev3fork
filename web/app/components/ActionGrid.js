"use client";

import ActionButton from "./ActionButton";
import { useRequestActions } from "./RequestActionsProvider";
import { ACTION_SECTIONS, ACTION_HELP, labelFor, reasonFor } from "./actionRegistry";

// Everything a player can do to a sheet, as captioned rows of buttons. The
// list itself lives in actionRegistry.js; this only lays it out, and
// ActionButton.js draws each one.
//
// Rows, not a fixed grid. The old four-across grid left one icon stranded
// on its own row whenever the count wasn't a multiple of four, and the
// count is about to keep growing. Each section is a `flex-wrap` row under a
// small caption, so any number of icons fills left to right and wraps
// wherever the width says; a section with nothing to show (no bird, no
// literacy) is left out entirely.
//
// `variant` picks the frame, not the contents. "rack" is a captioned row of
// framed glyphs, capped narrow, which is what /character's column fits.
// "columns" is /ledger's: one column per section with a rule between them,
// each holding the glyph AND its name as a full-width row — /ledger has a
// whole screen, and a labelled verb is one fewer thing to hover to understand.
// `children` rides at the end of the strip: the Trumpet, which commits on the
// spot rather than opening a dialog, and so is not in the registry.
export default function ActionGrid({ variant = "rack", children = null }) {
  const actions = useRequestActions();
  if (!actions) return null;
  const { open, pools, busy } = actions;
  const columns = variant === "columns";

  const sections = ACTION_SECTIONS.map((section) => ({
    ...section,
    visible: section.actions.filter((a) => (a.show ? pools[a.show] : true)),
  })).filter((s) => s.visible.length > 0);

  // One builder for all three frames: only the frame differs, and every one of
  // them carries the same tooltip (label, what the verb does, why it is greyed).
  const frame = variant === "strip" ? "strip" : columns ? "tile" : "icon";

  const button = (a) => (
    <ActionButton
      key={a.mode}
      variant={frame}
      icon={a.icon}
      label={labelFor(a, pools)}
      help={ACTION_HELP[a.mode] ?? null}
      reason={reasonFor(a, pools)}
      disabled={a.gate ? !pools[a.gate] : false}
      busy={busy === a.mode}
      onClick={() => open(a.mode)}
    />
  );

  if (variant === "strip") {
    // The mockup draws this as ONE wrapping row of buttons with a rule
    // between sections, not a row of sections that each wrap as their own
    // unit. `.action-strip-group` used to be a flex box in its own right,
    // which meant a section that didn't fit the remaining width moved to the
    // next line WHOLE — an orphan row of one icon whenever a section's count
    // didn't divide evenly, and the divider between sections stopped reading
    // once each section was already starting its own line. `display:
    // contents` drops the group's own box (and its wrapping) while keeping
    // its `role="group"`/`aria-label` in the accessibility tree, so its
    // buttons become direct flex items of `.action-strip` and wrap
    // individually; `.action-strip-sep` — a real element, not the group's
    // border — draws the 1px rule the border used to.
    const groups = children ? [...sections, { key: "extra", label: null, visible: null }] : sections;
    return (
      <div className="action-strip">
        {groups.flatMap((section, i) => {
          const group = (
            <div
              key={section.key}
              className="action-strip-group"
              // The trailing children group (the Trumpet) carries no section
              // label, so it wears no role — same as before this pass.
              role={section.label ? "group" : undefined}
              aria-label={section.label ?? undefined}
            >
              {section.visible ? section.visible.map(button) : children}
            </div>
          );
          // The separator has to sit IN BETWEEN the two groups' buttons in
          // the DOM, not after all of them — `display: contents` means each
          // group's own box is gone, so it's document order, not nesting,
          // that decides where a rule lands once everything is flowing as
          // one row of flex items.
          if (i === groups.length - 1) return [group];
          return [group, <span key={`sep-${section.key}`} className="action-strip-sep" aria-hidden="true" />];
        })}
      </div>
    );
  }

  if (columns) {
    return (
      <div className="action-columns">
        {sections.map((section) => (
          <div key={section.key} className="action-column">
            <p className="field-label mb-2">{section.label}</p>
            <div className="flex flex-col gap-1">{section.visible.map(button)}</div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {sections.map((section) => (
        <div key={section.key}>
          <p className="field-label mb-1">{section.label}</p>
          <div className="flex flex-wrap gap-1" style={{ maxWidth: "12rem" }}>
            {section.visible.map(button)}
          </div>
        </div>
      ))}
    </div>
  );
}
