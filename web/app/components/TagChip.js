import ChipLabel from "./ChipLabel";
import HoverCard from "./HoverCard";
import TagDetails, { tagDurationFor } from "./TagDetails";

// A tag as a chip with its details on hover. The details themselves live in
// TagDetails.js, which the sheet's rows also render inline — so the chip and
// the row say exactly the same things about a tag.
//
// `onConsume` is set only for a consumable tag on your own sheet (see
// TagRail.js), which puts a Consume button beside the tag. The action and its
// pending/error state stay in the client parent so this component keeps
// rendering fine on the server everywhere else it's used — and so it never
// says a word about what the thing turns into.
export default function TagChip({
  tag,
  quantity = 1,
  onConsume = null,
  consumeBusy = false,
  consumeError = null,
  expiresTurn = null,
  currentTurn = null,
  // The Nuclear Device only: the turn it fires on, from GameState.nukeArmedTurn
  // (db/lib/nuke.js). Armed state is world state rather than a tag, so the
  // chip has to be told; null means not armed and the row simply isn't there.
  armedTurn = null,
  // "· smells wrong" (the medical pass, M4) — whether THIS held stack is
  // actually poisoned, already gated server-side to poison-sense holders /
  // poison-snooper holders before it ever reaches this component (see
  // TagRail.js). Never the raw poisonedCount or which poison — this prop
  // carries only the yes/no doctor's-eye reads.
  poisonMarker = false,
  // `data-tone` on the face, for a chip that is bad news rather than news —
  // Overburdened, Dying, Catatonic on the chat rail's status strip. The chip
  // is otherwise identical; only the colour says so.
  tone = null,
  // Passed through to HoverCard. A call site whose chip already sits inside a
  // control of its own turns pinning off, so a click does one thing rather
  // than two — same reasoning as Tooltip.js's own IconButton precedent.
  pinnable = true,
}) {
  const duration = tagDurationFor({ tag, expiresTurn, currentTurn, armedTurn });

  const panel = (
    <TagDetails
      tag={tag}
      quantity={quantity}
      expiresTurn={expiresTurn}
      currentTurn={currentTurn}
      armedTurn={armedTurn}
      poisonMarker={poisonMarker}
      inTooltip
    >
      {typeof onConsume === "function" && (
        <button type="button" className="btn-quiet" onClick={onConsume} disabled={consumeBusy}>
          {/* A poison opens its own three-option dialog (lace it, dose
              someone, drink it), so the button must not promise "Consume"
              — the click routes on Tag.poison in the caller. */}
          {tag.poison ? "Poison" : "Consume"}
        </button>
      )}
      {consumeError && <p className="text-muted text-xs">{consumeError}</p>}
    </TagDetails>
  );

  return (
    <HoverCard panel={panel} pinnable={pinnable}>
      <ChipLabel tag={tag} quantity={quantity} duration={duration} data-tone={tone ?? undefined} />
    </HoverCard>
  );
}
