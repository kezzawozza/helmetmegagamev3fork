import HoverCard from "./HoverCard";

// Thin wrapper for a flat-text tooltip (InfoIcon's "?" glyph). Shares HoverCard with TagChip so both escape their
// scrolling ancestors. `pinnable` passes through; IconButton turns it off since a button is already a control.
export default function Tooltip({ text, children, className = "", pinnable = true }) {
  return (
    <HoverCard panel={text} className={className} pinnable={pinnable}>
      {children}
    </HoverCard>
  );
}
