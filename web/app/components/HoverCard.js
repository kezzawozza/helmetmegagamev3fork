"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { placePanel } from "./portalPlacement";

// Hover/focus panel portaled to document.body — escapes scrolling-ancestor
// clipping (.doc-sheet, .table-scroll, etc) and .doc-card's hover transform,
// which becomes a containing block even position:fixed can't escape in place.
// Click/Enter/Space pins it open so the reader can reach into it; `pinnable={false}`
// wraps an already-interactive child (Chat's places column rows) — no tab stop, click
// and keys pass through to the child untouched, hover/focus still open the panel.
//
// `panel` may be a FUNCTION of `close` rather than a node, for a panel that
// carries a control of its own and has to put itself away once it is used —
// ActionButton.js's touch path, where the pinned panel IS the button. An
// outside tap already unpins, but a tap on the panel's own button is inside it
// by definition, so there has to be a way to ask.
export default function HoverCard({ children, panel, className = "", pinnable = true, ...triggerProps }) {
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const [hovering, setHovering] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [pos, setPos] = useState(null);
  const id = useId();
  const open = hovering || pinned;

  const { onClick: triggerOnClick, onKeyDown: triggerOnKeyDown, ...restTriggerProps } = triggerProps;

  const closePin = useCallback(() => setPinned(false), []);

  const togglePin = useCallback(
    (e) => {
      triggerOnClick?.(e);
      if (pinnable) setPinned((p) => !p);
    },
    [triggerOnClick, pinnable],
  );

  const handleTriggerKeyDown = useCallback(
    (e) => {
      triggerOnKeyDown?.(e);
      if (pinnable && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        setPinned((p) => !p);
      }
    },
    [triggerOnKeyDown, pinnable],
  );

  const place = useCallback(() => {
    const trigger = triggerRef.current;
    const el = panelRef.current;
    if (!trigger || !el) return;
    setPos(placePanel(trigger, el));
  }, []);

  // Layout effect so the first paint is already in the right place — with a
  // plain effect the panel flashes at 0,0 before settling.
  useLayoutEffect(() => {
    if (open) place();
  }, [open, pinned, place]);

  useEffect(() => {
    if (!open) return;
    // Fixed positioning detaches on scroll: unpinned, close rather than chase it; pinned, reposition instead.
    const onScrollOrResize = () => {
      if (pinned) place();
      else setHovering(false);
    };
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      setHovering(false);
      setPinned(false);
    };
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, pinned, place]);

  // While pinned, a click outside the trigger and the portaled panel unpins it.
  useEffect(() => {
    if (!pinned) return;
    const onPointerDown = (e) => {
      if (triggerRef.current?.contains(e.target)) return;
      if (panelRef.current?.contains(e.target)) return;
      setPinned(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [pinned]);

  const panelNode = typeof panel === "function" ? panel(closePin) : panel;

  return (
    <>
      <span
        {...restTriggerProps}
        ref={triggerRef}
        className={`tag-hover ${className}`.trim()}
        tabIndex={pinnable ? 0 : undefined}
        aria-describedby={open ? id : undefined}
        onPointerEnter={() => setHovering(true)}
        onPointerLeave={() => setHovering(false)}
        onFocus={() => setHovering(true)}
        onBlur={() => setHovering(false)}
        onClick={togglePin}
        onKeyDown={handleTriggerKeyDown}
      >
        {children}
      </span>
      {/* `panelNode &&`: without it, no panel content renders an empty tooltip box. */}
      {open &&
        panelNode &&
        createPortal(
          <span
            ref={panelRef}
            id={id}
            role="tooltip"
            className="tag-tooltip"
            data-pinned={pinned || undefined}
            style={
              pos
                ? { top: pos.top, left: pos.left, maxHeight: pos.maxHeight }
                : // Off-screen until the first layout pass measures it.
                  { top: 0, left: 0, visibility: "hidden" }
            }
          >
            {pinned && (
              <button
                type="button"
                className="tag-tooltip-close"
                aria-label="Close"
                onClick={closePin}
              >
                ✕
              </button>
            )}
            {panelNode}
          </span>,
          document.body,
        )}
    </>
  );
}
