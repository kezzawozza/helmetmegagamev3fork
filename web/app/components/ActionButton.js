"use client";

import IconButton from "./IconButton";
import Tooltip from "./Tooltip";
import { useIsCoarsePointer } from "./useIsCoarsePointer";

// The one player-action button, in the four frames the app draws it in: icon (framed glyph,
// the /character rack), tile (glyph+name full-width row), menu (plain verb in a .chat-menu),
// strip (glyph+name, small, the ledger band). All four share the tooltip: label, then the
// sentence explaining the verb, then — when greyed — the reason. Tooltip wraps the button
// rather than sitting on it, so unlike a native title= it still fires on a disabled element,
// exactly the case that most needs an explanation. `busy` is for an instant verb in flight.
//
// ON A TOUCH SCREEN THE TOOLTIP IS THE BUTTON. There is no hover on a phone, and
// `pinnable={false}` used to switch off the one tap path HoverCard has — so the tap
// fell straight through to onClick and the panel could never be read at all. For the
// instant verbs that ask nothing first (actions/index.js) that tap WAS the action, and
// Break restraints reasons about skipping its confirm on the grounds that "the tooltip
// already says what pressing it does", which on a phone had never once been true.
//
// So on a coarse pointer the first tap pins the panel, and the panel carries a real
// button at its foot that does the thing. Read, then act — the same two taps /chat's
// Things drawer asks for, and the same shape TagChip has always had with its Consume
// button sitting inside the panel rather than on the chip.
function tooltipFor(label, help, reason) {
  if (!help && !reason) return label;
  return (
    <>
      <p>
        <strong>{label}</strong>
      </p>
      {typeof help === "string" ? <p>{help}</p> : help}
      {reason ? <p>{reason}</p> : null}
    </>
  );
}

export default function ActionButton({
  icon: Icon = null,
  label,
  help = null,
  reason = null,
  variant = "tile",
  disabled = false,
  busy = false,
  onClick,
}) {
  const touch = useIsCoarsePointer();
  const off = disabled || busy;
  const tooltip = tooltipFor(label, help, disabled ? reason : null);

  // Two verbs in the registry carry no help sentence (birdReply, purchase), and
  // both open a dialog rather than committing, so a panel there would say the
  // label back and then offer a button wearing the same word. And `menu` is
  // left out on purpose: it is already the inside of a menu somebody opened on
  // purpose, its items are spelled-out verbs rather than glyphs, and every one
  // of them opens a dialog — a second panel portaled over the first would be a
  // pile, not a safeguard.
  const coarse = touch && variant !== "menu" && Boolean(help || (disabled && reason));

  // A greyed verb must NOT carry the `disabled` attribute on a coarse pointer: a
  // disabled button dispatches no click at all, so HoverCard would never see one and
  // the panel — which is the only place the REASON it is greyed is written down —
  // could not be opened. aria-disabled says the same thing to a screen reader, the
  // existing data-muted/data-off styling says it to an eye, and the handler below
  // refuses. The panel's own button carries the real `disabled`.
  const gate = coarse
    ? { "aria-disabled": off || undefined, "data-off": off ? "true" : undefined }
    : { disabled: off };
  // On coarse the wrapper's click is what pins the panel, so the button itself does
  // nothing. Passing a handler that refuses would be the same thing with more words.
  const fire = coarse ? undefined : onClick;

  // `close` first: the action may open a dialog, and a tooltip pinned over it is a pile.
  const panel = coarse
    ? (close) => (
        <>
          {tooltip}
          <button
            type="button"
            className="btn tag-tooltip-do"
            disabled={off}
            onClick={() => {
              close();
              onClick?.();
            }}
          >
            {busy ? "Working…" : label}
          </button>
        </>
      )
    : tooltip;

  if (variant === "icon") {
    return (
      <IconButton
        icon={Icon}
        label={label}
        tooltip={panel}
        onClick={fire}
        pinnable={coarse}
        {...gate}
        aria-busy={busy || undefined}
        data-busy={busy ? "true" : undefined}
      />
    );
  }

  if (variant === "strip") {
    return (
      <Tooltip text={panel} pinnable={coarse}>
        <button
          type="button"
          // A bevelled .btn-secondary with the strip's own spacing on top: the
          // bevel, the press and the dashed gated state all come from that one
          // class, so a verb here looks like every other button in the app
          // rather than like a family of its own (REDESIGN.md §5).
          className="btn-secondary action-strip-item"
          aria-busy={busy || undefined}
          data-muted={disabled ? "true" : undefined}
          data-busy={busy ? "true" : undefined}
          {...gate}
          onClick={fire}
        >
          {Icon ? <Icon width="15" height="15" /> : null}
          <span>{busy ? "Working…" : label}</span>
        </button>
      </Tooltip>
    );
  }

  if (variant === "menu") {
    return (
      <Tooltip text={panel} pinnable={coarse}>
        <button
          type="button"
          role="menuitem"
          className="menu-item"
          aria-busy={busy || undefined}
          onClick={fire}
          {...gate}
        >
          {busy ? "Working…" : label}
        </button>
      </Tooltip>
    );
  }

  return (
    <Tooltip text={panel} pinnable={coarse}>
      <button
        type="button"
        className="action-tile"
        aria-label={label}
        aria-busy={busy || undefined}
        data-busy={busy ? "true" : undefined}
        onClick={fire}
        {...gate}
      >
        {Icon ? <Icon width="18" height="18" /> : null}
        <span>{busy ? "Working…" : label}</span>
      </button>
    </Tooltip>
  );
}
