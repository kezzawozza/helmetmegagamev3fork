import Link from "next/link";

// The desk rail — the left column of every (desk) page. One shell and one
// .desk-* family for all six of them (REDESIGN.md §5, "Desk chrome"): the
// adjudication desk, the player desk, the audit log, the Dev Panel, the
// economy desk and the Oracle. /gm/dev's .ops-nav and /gm/audit's
// .audit-filters were the same rail written twice more, and they fold in here.
//
// NOT "use client": /gm/dev/page.js and /gm/economy/page.js are server
// components that render their rail directly, and a directive here would drag
// the whole Dev Panel into the client bundle. Same rule as CheckField and
// Switch (DESIGN-SYSTEM.md §5a). Nothing in this file holds state.
//
// NEVER give this, or anything inside it, position / z-index / transform /
// filter / contain / will-change. Modal.js renders .modal-overlay IN-TREE, so
// a stacking context here traps every desk dialog at this element's level —
// under the 720px nav bar's z-index 30. The inspector overlay's z-index 40 is
// the one sanctioned stacking context in the family, and it exists precisely to
// clear that 30 (globals.css, DESIGN-SYSTEM.md §6).

/**
 * @param {object} p
 * @param {"queue"|"sections"} [p.variant="queue"]
 *   "queue" — a scrolling list of selectable rows, with whatever filter band
 *   and hint line the desk puts around it (/gm/turns, /gm/players, /gm/oracle).
 *   "sections" — a padded stack of titled groups (/gm/dev, /gm/economy, and
 *   /gm/audit's filter groups). Lands on data-variant.
 * @param {React.ReactNode} [p.children] the rail's contents, in order
 * @param {"aside"|"nav"|"div"} [p.as="aside"]
 * @param {string} [p.ariaLabel]
 * @param {import("react").Ref} [p.scrollRef]
 *   QueueRail restores its scroll position through this.
 * @param {string} [p.className=""]
 */
export default function DeskRail({
  variant = "queue",
  children = null,
  as = "aside",
  ariaLabel,
  scrollRef,
  className = "",
}) {
  const Tag = as;
  return (
    <Tag
      className={`desk-rail${className ? ` ${className}` : ""}`}
      data-variant={variant === "sections" ? "sections" : undefined}
      aria-label={ariaLabel}
      ref={scrollRef}
    >
      {children}
    </Tag>
  );
}

/**
 * A titled group inside a "sections" rail. This was .ops-nav-group +
 * .ops-nav-title and .audit-group + .audit-group-title — the same two rules
 * written twice, and the CSS said so out loud.
 *
 * @param {object} p
 * @param {string} p.title
 * @param {"h2"|"h3"|"span"} [p.titleAs="span"]
 *   The audit filters use h2 and the nav rails a span. The semantics differ;
 *   the look does not.
 * @param {boolean} [p.dense=false]
 *   The nav rails sit their links almost on top of each other (2px); a filter
 *   group breathes (8px). Two gaps, not an average of them.
 * @param {React.ReactNode} p.children
 */
export function DeskRailGroup({ title, titleAs = "span", dense = false, children }) {
  const Title = titleAs;
  return (
    <section className="desk-rail-group" data-dense={dense ? "true" : undefined}>
      <Title className="group-label">{title}</Title>
      {children}
    </section>
  );
}

/**
 * One row of a "sections" rail: a link, or a button. This was .ops-nav-item.
 *
 * @param {object} p
 * @param {string} [p.href] renders a next/link when present, a <button> otherwise
 * @param {() => void} [p.onClick]
 * @param {boolean} [p.active] data-active="true" — the "you are here" bar
 * @param {boolean} [p.away] the muted tone for a link that leaves the panel
 * @param {React.ReactNode} p.children
 */
export function DeskRailItem({ href, onClick, active = false, away = false, children }) {
  const props = {
    className: `desk-rail-item${away ? " desk-rail-item--away" : ""}`,
    "data-active": active ? "true" : undefined,
  };
  if (href) {
    return (
      <Link href={href} {...props}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} {...props}>
      {children}
    </button>
  );
}
