"use client";

import Tooltip from "./Tooltip";

// The one framed icon button. `.icon-btn` already carries the frame and the
// accent-on-hover fill every other button in the app uses; this just spares
// each call site from repeating the a11y wiring and the glyph sizing.
// `label` is the accessible name and must stay a plain string — it goes
// straight into aria-label, where JSX would read as "[object Object]".
// `tooltip` is the optional rich version for sighted hover (ActionGrid.js
// passes the action's name plus a sentence on what it does); without one the
// tooltip is just the label, which is what every older call site wants.
// `pinnable` is passed through to the tooltip: off by default, because a button
// is already a control and a pin would fight its click. ActionButton.js turns it
// ON for a touch screen, where the pin is the only way the panel can be read at
// all — see the header there.
// `size` names the DESKTOP size — `sm` (15, default) or `lg` (20) — written to `data-size` for `.icon-btn[data-size]` to read. A coarse
// pointer inside /chat floors every one of these at 44px regardless (CSS);
// `size` only decides what a fine pointer sees.
const GLYPH_SIZE = { sm: 15, lg: 20 };

export default function IconButton({
  icon: Icon,
  label,
  tooltip = null,
  onClick,
  disabled = false,
  pinnable = false,
  size = "sm",
  ...rest
}) {
  const glyph = GLYPH_SIZE[size] ?? GLYPH_SIZE.sm;
  return (
    <Tooltip text={tooltip ?? label} pinnable={pinnable}>
      <button
        type="button"
        className="icon-btn"
        aria-label={label}
        data-size={size}
        onClick={onClick}
        disabled={disabled}
        {...rest}
      >
        <Icon width={glyph} height={glyph} />
      </button>
    </Tooltip>
  );
}
