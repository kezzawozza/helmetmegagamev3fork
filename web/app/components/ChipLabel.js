// The bare `.chip` face — group icon, name, optional ×N — with no tooltip and
// nothing interactive of its own.
//
// Split out of TagChip so it can be rendered where an interactive chip can't
// go: inside another chip's hover tooltip (un-hoverable), or inside the
// <button> a point-buy row is (a role="button" inside a button is invalid
// markup).
//
// `as` is the third of those cases, and the reason it exists: the /chat rail's
// chips are ALREADY buttons — a room stash chip opens Transfer, a pocket chip
// opens its verb menu — so they cannot wrap this span without nesting one
// `.chip` box inside another. They render `as="button"` instead and pass their
// own handlers straight through, which is what lets the rail wear the real
// chip face (icon, category rule, mastery star, duration) without giving up its click.
//
// `icon` is the one opt-out: a surface already grouping BY that same group
// (the point-buy's group sections) would draw the same glyph down a whole
// column, saying nothing.
import TagIcon from "./TagIcon";

export default function ChipLabel({
  tag,
  quantity = 1,
  duration = null,
  as: As = "span",
  icon = true,
  children = null,
  className = "",
  style,
  ...rest
}) {
  // Only a stack says how many; an ordinary tag reads as a bare name, which
  // is every tag outside Items today.
  const stack = quantity > 1 ? quantity : null;
  // Two levels, two signals: the CATEGORY paints the left rule (one --tag-*
  // token each, globals.css) and the GROUP draws the glyph. Splitting them is
  // the point — colour used to be a freeform per-group hex, so a sheet was
  // forty stripes with no key. Lower-cased because the attribute selector is
  // case-sensitive and the catalog stores "Items", not "items".
  const category = tag.category ? String(tag.category).toLowerCase() : null;
  // A mastery tag wears a star wherever its name is drawn — the sheet and the
  // store both, so the mark says "this one is a capstone" on a tag somebody
  // already holds and not only on the offer. Kept out of Tag.name on purpose:
  // the name is a match key in more than one place (purchasableTags compares
  // granted tags by name, forcedName stands in for a first name), so a glyph
  // living in it would break a lookup rather than decorate one.
  const star = tag.mastery ? "★ " : null;

  return (
    <As
      // The caller's own classes ride ALONGSIDE `.chip` rather than replacing
      // it — a chip that dropped its own class to take a modifier would stop
      // being a chip.
      className={className ? `chip ${className}` : "chip"}
      data-tag-category={category ?? undefined}
      style={style}
      {...rest}
    >
      {icon && <TagIcon tag={tag} size={12} />}
      {star}
      {tag.name}
      {stack && <span className="text-muted"> &times;{stack}</span>}
      {/* Compact on the face, spelled out in TagChip's tooltip — a chip has no
          room for "2 turns left". aria-hidden because the tooltip carries the
          readable version. The badge comes from the same tagDuration() the
          tooltip uses, so the two can't disagree; a tag on its final turn
          reads "last" rather than "0t", which looked like it had already
          gone. Null when the tag has no duration at all. */}
      {/* Anything the FACE has to say that the tag itself does not — the
          drawer's equipped dot, its doctor's-eye "smells wrong". Kept as
          children rather than props so the chip does not grow a vocabulary of
          one caller's markers. */}
      {children}
      {duration && (
        <span className={duration.armed ? "text-accent" : "text-muted"} aria-hidden="true">
          {" "}&middot; {duration.badge}
        </span>
      )}
    </As>
  );
}
