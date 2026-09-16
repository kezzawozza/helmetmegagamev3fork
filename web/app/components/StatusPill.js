// One way to show a state. The tone is the vocabulary, not the colour: callers say what a state MEANS and the
// stylesheet decides what that looks like, so a status cannot pick a colour the theme hasn't solved (--accent is a
// fill token that fails AA as text). Colour comes from a data-tone attribute, not an inline style. Per-domain
// label/tone maps stay separate — a Move's and a Request's are different vocabularies. `title` passes through
// since several states are only half a sentence on their own.
export default function StatusPill({ tone = "neutral", children, className = "", title }) {
  return (
    <span className={`status-pill ${className}`.trim()} data-tone={tone} title={title}>
      {children}
    </span>
  );
}

// The DB enums, in one place, so a raw ALIVE/DEAD/FULFILLED can never reach a player again.
export const CHARACTER_STATUS = {
  ALIVE: { label: "Alive", tone: "good" },
  DEAD: { label: "Dead", tone: "bad" },
  CURSED: { label: "Cursed", tone: "muted" },
};

export const DESIRE_STATUS = {
  ACTIVE: { label: "Active", tone: "neutral" },
  FULFILLED: { label: "Fulfilled", tone: "good" },
  CANCELLED: { label: "Cancelled", tone: "muted" },
};

// Falls back to the raw value rather than to nothing — an unmapped enum should look wrong in review, not vanish in production.
export function EnumPill({ map, value, className = "" }) {
  const entry = map[value];
  return (
    <StatusPill tone={entry?.tone ?? "neutral"} className={className}>
      {entry?.label ?? value}
    </StatusPill>
  );
}

// LobbyEntry.status: the seat's own words, not the enum's — "Seat offered" for ASSIGNED.
export const LOBBY_STATUS = {
  READY: { label: "Ready", tone: "good" },
  ASSIGNED: { label: "Seat offered", tone: "neutral" },
  CREATED: { label: "Created", tone: "good" },
  DECLINED: { label: "Declined", tone: "muted" },
  EXPIRED: { label: "Expired", tone: "warn" },
  UNASSIGNED: { label: "In the lobby", tone: "muted" },
};

// AdminNote.severity. Monochromatic on purpose: severity is a WEIGHT, not a
// kind, so it rides the --text -> --muted ladder rather than borrowing the
// good/warn/bad vocabulary, which would make a Low note read as "fine". High
// is the default tone (full-strength ink), Low is the existing muted grey, and
// only the middle rung needed adding.
export const ADMIN_NOTE_SEVERITY = {
  HIGH: { label: "High", tone: "neutral" },
  MEDIUM: { label: "Medium", tone: "subdued" },
  LOW: { label: "Low", tone: "muted" },
};
