// One line of transcript, and the one renderer for it (REDESIGN.md §5, "One
// log renderer"): /chat's feed, the DM thread, the inspector's Archive tab and
// the archive-context popup all draw through this.
//
// It draws THE LINE and nothing else — a gutter (the face, or what a
// continuation row shows in its place), a head (name, time, "edited", whatever
// else the surface prints beside a name) and a body. Day dividers, the NEW
// line, the backlog edge, folds, scroll machinery, retry logic, embeds and
// letters all stay with the caller. That seam is what makes "one line
// renderer" true without moving three thousand lines of behaviour.
//
// NOT "use client". It holds no state, no effects and no handlers of its own —
// a verb bar arrives as an already-bound node in `actions`. Every caller today
// is a client component, so a directive would buy nothing and would cost a
// server page the day one prints a transcript (DESIGN-SYSTEM.md §5a, the same
// rule CheckField and Switch follow).
//
// `density` is GEOMETRY ONLY. "thread" and "thread-compact" are the two old
// families' numbers moved verbatim, so this component could become singular
// before the numbers do; phase 5 re-solves them and collapses the variants. A
// variant here is a staging post, not drift.
//
// "feed" draws the mockup's LOG shape instead
// (docs/design/mockups/chat/index.html): one line, no face —
// `Name: what they said` — never a name/time row over a second line with an
// avatar beside it. It has its own branch below rather than sharing the
// gutter/head/body markup the other two densities use, because that shape has
// nothing in this one: no gutter, no per-row clock, no separate head.
//
// /archive is the one log that does NOT come through here. Its row is a
// four-column CSS grid whose children are the columns (clock, who, what, cite),
// which a gutter/body shape cannot reproduce without breaking the grid — so
// ArchiveTranscript keeps .archive-row.
//
// Phase 5 added the two of those it promised: the speaker-name palette rides on
// `roleGroup`, and the intercom block is `variant="block"` — which the decree shares,
// since a PA and a proclamation are the same shape with different heading faces.

/**
 * @param {object} p
 * @param {"speech"|"system"|"block"} [p.variant="speech"]
 *   "speech" draws gutter + head + body. "system" draws one full-width line with
 *   no face and no head — the world talking, a shout, an OOC line. "block" draws
 *   a bordered full-width NOTICE, ruled top and bottom, with a heading over it:
 *   the intercom and the decree (REDESIGN.md §6). Both of those are one shape
 *   with two heading faces, which is the whole point of the variant.
 * @param {import("react").ReactNode} [p.heading=null]
 *   variant="block" only: the line over the notice. "Intercom · Keep".
 * @param {"caps"|"blackletter"} [p.headingFace="caps"]
 *   variant="block" only. "caps" is the PA — a small-caps micro-label, because a
 *   loudspeaker is a machine. "blackletter" is the world speaking in its own
 *   voice, which is the one thing --font-display is for (REDESIGN.md §1).
 * @param {import("react").ReactNode} [p.byline=null]
 *   variant="block" only: a second, quieter line under the heading.
 * @param {string|null} [p.channelKind=null]
 *   The row's channelKind, verbatim off the data. Lands on data-kind and is the
 *   ONLY thing that decides how a system line looks: "shout", "shout-near",
 *   "intercom", "ooc", anything else falls through to subtext. Nothing else may
 *   branch on it.
 * @param {"feed"|"thread"|"thread-compact"} [p.density="feed"]
 *   Geometry only. Lands on data-density.
 * @param {import("react").ReactNode} [p.avatar=null]
 *   The face, already built by the caller with that surface's own size and
 *   zoomable choices. Null leaves the gutter empty, which is what a run
 *   continuation wants — the column keeps its width so the text stays aligned.
 *   IGNORED for density="feed" — the mockup's log has no face at all.
 * @param {boolean} [p.gutter=true]
 *   False drops the gutter element entirely, for a surface that has no faces
 *   at all (the inspector's Archive tab). The body then takes the full width.
 *   Meaningless for density="feed", which never draws a gutter.
 * @param {import("react").ReactNode} [p.gutterAside=null]
 *   What the gutter shows instead of a face — the DM thread's hover-revealed
 *   clock.
 * @param {import("react").ReactNode} [p.name=null]
 *   The shown speaker. Null hides the head.
 * @param {boolean} [p.alias=false] tints the name (data-alias)
 * @param {string|null} [p.roleGroup=null]
 *   The speaker's estate — one of the six coloured role groups
 *   (db/lib/roleGroups.js#roleGroupHue). Lands on data-role-group on the name
 *   and paints it from the estate palette (REDESIGN.md §3). Null for an
 *   Outsider, for Elsewhere, for anybody with no seat, and for a hooded line,
 *   whose row withholds it along with the character id.
 * @param {import("react").ReactNode} [p.meta=null]
 *   Extra head children, printed after the name — a source chip, a place, a
 *   turn number.
 * @param {string|null} [p.time=null] already formatted; this never touches a clock
 * @param {string|null} [p.timeTitle=null] the <time title> long form
 * @param {boolean} [p.edited=false]
 * @param {import("react").ReactNode} p.children the body — a ChatMarkdown, a MarkdownContent, an editor
 * @param {import("react").ReactNode} [p.actions=null] the floating verb bar
 * @param {import("react").ReactNode} [p.trailing=null] under the body — a failed-send row, a ⋯ sheet button
 * @param {"in"|"out"|null} [p.direction=null] data-dir, for the DM thread's outbound name colour
 * @param {boolean} [p.startsRun=false] data-run="start"
 * @param {boolean} [p.pending=false] data-pending — an optimistic row
 * @param {boolean} [p.failed=false] data-failed
 * @param {boolean} [p.live=false] data-live — the arrival fade, only for a line that ARRIVED
 * @param {string|null} [p.id=null] the element id
 * @param {number|string|null} [p.seq=null]
 *   data-seq. Also what /chat's jump-to-a-search-hit finds the row by, and it
 *   writes data-hit onto it imperatively — hence no `hit` prop here.
 * @param {"li"|"div"} [p.as="li"]
 * @param {number} [p.tabIndex] Feed.js passes -1 so a tap can reveal the bar
 * @param {string} [p.className=""] extra classes. Not a styling escape hatch.
 */
export default function TranscriptLine({
  variant = "speech",
  heading = null,
  headingFace = "caps",
  byline = null,
  channelKind = null,
  density = "feed",
  avatar = null,
  gutter = true,
  gutterAside = null,
  name = null,
  alias = false,
  roleGroup = null,
  meta = null,
  time = null,
  timeTitle = null,
  edited = false,
  children,
  actions = null,
  trailing = null,
  direction = null,
  startsRun = false,
  pending = false,
  failed = false,
  live = false,
  id = null,
  seq = null,
  as = "li",
  tabIndex,
  className = "",
}) {
  const Tag = as;

  // A bordered notice in the middle of the log, scrolling with it (REDESIGN.md
  // §6). The intercom and the GM's decree are the SAME component with different
  // heading faces — a PA and a proclamation are both "the world interrupting",
  // and drawing them twice is how the two drift apart.
  if (variant === "block") {
    return (
      <Tag
        className={`tline tline--block${className ? ` ${className}` : ""}`}
        data-kind={channelKind ?? undefined}
        data-face={headingFace}
        data-seq={seq ?? undefined}
        id={id ?? undefined}
      >
        {heading != null ? <p className="tline-block-head">{heading}</p> : null}
        {byline != null ? <p className="tline-block-by">{byline}</p> : null}
        <div className="tline-block-body">{children}</div>
      </Tag>
    );
  }

  if (variant === "system") {
    return (
      <Tag
        className={`tline tline--system${className ? ` ${className}` : ""}`}
        data-kind={channelKind ?? undefined}
        data-seq={seq ?? undefined}
        id={id ?? undefined}
      >
        {children}
      </Tag>
    );
  }

  // "feed" is the mockup's LOG shape, not Discord's message shape (CHAT.md):
  // one line, no face, the name and the body run on together —
  // `Marrow Vance: Second tithe…` — rather than a name/time row over a
  // second line with an avatar beside it. "thread" and "thread-compact" keep
  // the gutter/head/body shape below exactly as they were; only this branch
  // changed.
  if (density === "feed") {
    return (
      <Tag
        className={`tline${className ? ` ${className}` : ""}`}
        data-density={density}
        data-kind={channelKind ?? undefined}
        data-run={startsRun ? "start" : undefined}
        data-pending={pending ? "true" : undefined}
        data-failed={failed ? "true" : undefined}
        data-live={live ? "true" : undefined}
        data-dir={direction ?? undefined}
        data-seq={seq ?? undefined}
        id={id ?? undefined}
        tabIndex={tabIndex}
      >
        {name != null ? (
          <span
            className="tline-name"
            data-alias={alias ? "true" : undefined}
            data-role-group={roleGroup ?? undefined}
          >
            {name}
          </span>
        ) : null}
        {name != null ? <span className="tline-sep">: </span> : null}
        {children}
        {edited ? <span className="tline-edited"> (edited)</span> : null}
        {actions ? <div className="tline-actions">{actions}</div> : null}
        {trailing}
      </Tag>
    );
  }

  return (
    <Tag
      className={`tline${className ? ` ${className}` : ""}`}
      data-density={density}
      data-kind={channelKind ?? undefined}
      data-run={startsRun ? "start" : undefined}
      data-pending={pending ? "true" : undefined}
      data-failed={failed ? "true" : undefined}
      data-live={live ? "true" : undefined}
      data-dir={direction ?? undefined}
      data-seq={seq ?? undefined}
      id={id ?? undefined}
      tabIndex={tabIndex}
    >
      {gutter ? (
        <div className="tline-gutter" aria-hidden={avatar ? undefined : "true"}>
          {avatar ?? gutterAside}
        </div>
      ) : null}
      <div className="tline-body">
        {name != null ? (
          <div className="tline-head">
            <span
              className="tline-name"
              data-alias={alias ? "true" : undefined}
              data-role-group={roleGroup ?? undefined}
            >
              {name}
            </span>
            {meta}
            {time != null ? (
              <time className="tline-time mono" title={timeTitle ?? undefined}>
                {time}
              </time>
            ) : null}
            {edited ? <span className="tline-edited">(edited)</span> : null}
          </div>
        ) : null}
        {children}
        {actions ? <div className="tline-actions">{actions}</div> : null}
        {trailing}
      </div>
    </Tag>
  );
}
