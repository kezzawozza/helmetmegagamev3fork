import AvatarZoom from "./AvatarZoom";
import Tooltip from "./Tooltip";

// The little face next to a character's name wherever a GM scans a list of
// them, served by /api/avatar/[characterId] — see PORTRAITS.md.
//
// `version` should be the character's updatedAt.getTime(): the avatar route
// answers with an immutable Cache-Control, so a stale version keeps a GM
// looking at a face from before the last rename or portrait change.
//
// A plain <img>, not next/image: the route serves arbitrary uploaded bytes at
// an unknown intrinsic size, which next/image would refuse without explicit
// dimensions.

// A thin ring around the whole face — the mobile signal (name text may not
// show in a cramped column, but the portrait always does) and a second,
// at-a-glance cue on desktop beside HereList's own "online" subtext.
// Absolutely positioned to exactly overlay the face inside wrap()'s relative
// span, so it works whether or not CatatonicDot is also present. --accent
// rather than --positive: a ring is a rule, one of the two things --accent is
// ever allowed to be (DESIGN-SYSTEM.md), and it already carries its own value
// per theme (dusk/dawn) rather than one green fixed everywhere.
function OnlineRing({ size }) {
  return (
    <span
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        width: size,
        height: size,
        borderRadius: "var(--r-full)",
        boxShadow: "0 0 0 1px var(--accent)",
        pointerEvents: "none",
      }}
    />
  );
}

function CatatonicDot({ size }) {
  const dot = Math.max(7, Math.round(size * 0.4));
  return (
    <span
      aria-hidden="true"
      style={{
        position: "absolute",
        right: -1,
        bottom: -1,
        width: dot,
        height: dot,
        borderRadius: "var(--r-full)",
        background: "var(--muted)",
        // Ringed with the surface it sits on so it reads as a badge rather
        // than a smudge on the portrait, whatever the portrait's colours.
        border: "1px solid var(--surface)",
      }}
    />
  );
}

export default function CharacterAvatar({
  characterId,
  name,
  version,
  src,
  size = 20,
  catatonic = false,
  // Used the website or sent a Discord message in the last hour
  // (Character.lastSeenAt, db/lib/whosHere.js#isOnline). The one universal
  // signal for both faces: a glow here, plus HereList's own text subtext
  // where there's room to show it.
  online = false,
  // A face you have not earned. Set for somebody standing here you have not
  // watched speak this turn, and for an archived line said before the game
  // recorded what was over the speaker's face.
  unknown = false,
  // Click the face to see it at the size it is actually stored (AvatarZoom).
  //
  // Opt-in rather than on by default, because half the call sites in the app
  // draw this INSIDE a control — a queue row, a mention-menu item, a link in a
  // table — where a nested <button> is invalid markup and the click already
  // means something else. Set it where the face is the subject, not where it
  // is a decoration on somebody else's button.
  zoomable = false,
}) {
  const wrap = (face) =>
    catatonic || online ? (
      <span style={{ position: "relative", display: "inline-flex", flexShrink: 0, verticalAlign: "middle" }}>
        {face}
        {online && <OnlineRing size={size} />}
        {catatonic && <CatatonicDot size={size} />}
      </span>
    ) : (
      face
    );

  // The tooltip is the accessible name for the whole marker, so a status
  // rides it rather than a second stop for a screen reader. Catatonic and
  // online are never both true in practice (AFK is the opposite of active),
  // but neither branch assumes the other is absent.
  const statusLabel = [catatonic ? "Catatonic (AFK)" : null, online ? "Online" : null].filter(Boolean).join(", ");
  const label = statusLabel ? `${name} — ${statusLabel}` : name;

  // The question-mark plate. It must never fall back to an initial the way the
  // bare branch below does: "a young man" would draw an A, and one letter is
  // enough to tell two hoods apart, which is the entire thing this withholds.
  // The tooltip still carries the alias, so a screen reader hears the name the
  // room hears rather than "unknown".
  if (unknown) {
    return (
      <Tooltip text={label}>
        {wrap(
          <span
            aria-hidden="true"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: size,
              height: size,
              borderRadius: "var(--r-full)",
              background: "var(--field-bg)",
              border: "1px solid var(--border)",
              color: "var(--muted)",
              fontSize: `${Math.max(0.55, size / 32)}rem`,
              flexShrink: 0,
              verticalAlign: "middle",
            }}
          >
            ?
          </span>,
        )}
      </Tooltip>
    );
  }

  if (!characterId && !src) {
    return wrap(
      <span
        aria-hidden="true"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: size,
          height: size,
          borderRadius: "var(--r-full)",
          background: "var(--field-bg)",
          border: "1px solid var(--border)",
          fontSize: "0.6rem",
          flexShrink: 0,
          verticalAlign: "middle",
        }}
      >
        {name?.[0]?.toUpperCase() ?? "?"}
      </span>,
    );
  }

  // An explicit src is a face somebody else already decided — the mask sprite
  // or letter plaque presentedIdentity resolved, frozen onto an archive row or
  // re-derived for a live roster. Used verbatim, with no `?v=`: the file is
  // the same for every wearer and never changes, so cache-busting it would be
  // both pointless and a fingerprint (PROXYING.md §5).
  //
  // Without one this builds the character's own URL, and that route is
  // identity-BLIND — it serves the real face whatever is over it. Never send a
  // concealed character down that branch.
  const imageSrc = src ?? `/api/avatar/${characterId}${version ? `?v=${version}` : ""}`;

  // `pinnable={!zoomable}` is load-bearing, not tidiness: Tooltip is a
  // HoverCard, and a HoverCard PINS its panel on click. Without this one click
  // would both open the dialog and leave a pinned name card sitting behind it.
  // IconButton turns it off for the same reason — a button is already a
  // control.
  const face = (
    <Tooltip text={label} pinnable={!zoomable}>
      {wrap(
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageSrc}
          alt=""
          width={size}
          height={size}
          style={{
            width: size,
            height: size,
            borderRadius: "var(--r-full)",
            objectFit: "cover",
            flexShrink: 0,
            verticalAlign: "middle",
          }}
        />,
      )}
    </Tooltip>
  );

  // Deliberately here and nowhere earlier: the two branches above — the `?`
  // plate and the bare initial — have already returned, so a face with nothing
  // behind it is never clickable. Enlarging a question mark would be pointless,
  // and that plate exists to withhold.
  if (!zoomable) return face;
  return (
    <AvatarZoom src={imageSrc} name={label}>
      {face}
    </AvatarZoom>
  );
}
