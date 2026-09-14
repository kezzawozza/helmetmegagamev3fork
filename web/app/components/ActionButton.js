"use client";

import IconButton from "./IconButton";
import Tooltip from "./Tooltip";

// The one player-action button, in the four frames the app draws it in: icon (framed glyph,
// the /character rack), tile (glyph+name full-width row), menu (plain verb in a .chat-menu),
// strip (glyph+name, small, the ledger band). All four share the tooltip: label, then the
// sentence explaining the verb, then — when greyed — the reason. Tooltip wraps the button
// rather than sitting on it, so unlike a native title= it still fires on a disabled element,
// exactly the case that most needs an explanation. `busy` is for an instant verb in flight.
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
  const off = disabled || busy;
  const tooltip = tooltipFor(label, help, disabled ? reason : null);

  if (variant === "icon") {
    return (
      <IconButton
        icon={Icon}
        label={label}
        tooltip={tooltip}
        onClick={onClick}
        disabled={off}
        aria-busy={busy || undefined}
        data-busy={busy ? "true" : undefined}
      />
    );
  }

  if (variant === "strip") {
    return (
      <Tooltip text={tooltip} pinnable={false}>
        <button
          type="button"
          className="action-strip-item"
          aria-busy={busy || undefined}
          data-muted={disabled ? "true" : undefined}
          data-busy={busy ? "true" : undefined}
          disabled={off}
          onClick={onClick}
        >
          {Icon ? <Icon width="15" height="15" /> : null}
          <span>{busy ? "Working…" : label}</span>
        </button>
      </Tooltip>
    );
  }

  if (variant === "menu") {
    return (
      <Tooltip text={tooltip} pinnable={false}>
        <button
          type="button"
          role="menuitem"
          className="menu-item"
          aria-busy={busy || undefined}
          onClick={onClick}
          disabled={off}
        >
          {busy ? "Working…" : label}
        </button>
      </Tooltip>
    );
  }

  return (
    <Tooltip text={tooltip} pinnable={false}>
      <button
        type="button"
        className="action-tile"
        aria-label={label}
        aria-busy={busy || undefined}
        data-busy={busy ? "true" : undefined}
        onClick={onClick}
        disabled={off}
      >
        {Icon ? <Icon width="18" height="18" /> : null}
        <span>{busy ? "Working…" : label}</span>
      </button>
    </Tooltip>
  );
}
