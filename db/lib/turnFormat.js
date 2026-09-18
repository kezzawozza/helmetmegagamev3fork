// Hand-duplicated in web/lib/turnFormat.js so client components can import it dependency-free. Null when either side is unknown. Inclusive of the open turn (`expiresTurn` is the last live turn), so a tag expiring this turn has 1 left, not 0.
function turnsLeft(expiresTurn, currentTurn) {
  if (expiresTurn == null || currentTurn == null) return null;
  return Math.max(0, expiresTurn - currentTurn + 1);
}

function formatTurnsLeft(n) {
  if (n == null) return null;
  if (n <= 1) return "expires this turn";
  return `${n} turns left`;
}

function tagDuration(left, defaultDurationTurns) {
  if (left != null) {
    return left <= 1
      ? { label: "Expires this turn", badge: "last" }
      : { label: `${left} turns left`, badge: `${left}t` };
  }
  if (defaultDurationTurns) {
    const n = defaultDurationTurns;
    return {
      label: `Lasts ${n} turn${n === 1 ? "" : "s"} once granted`,
      badge: `${n}t`,
    };
  }
  return null;
}

// Last live turn from the first live turn, inclusive; null for a duration of 0/null. The sweep matches `expiresTurn <= turn.number`, so "-1" keeps a timed tag from getting N+1 turns. A pass granting at turn end must pass `turn.number + 1`.
function expiryFrom(firstLiveTurnNumber, durationTurns) {
  if (!durationTurns || firstLiveTurnNumber == null) return null;
  return firstLiveTurnNumber + durationTurns - 1;
}

// For reading a turn you already have. If granting from `findFirst({ status: "OPEN" })`, use grantExpiry.js#expiryForGrant instead — openTurn can be null mid-advance and this would silently grant a permanent tag.
function expiryFor(tag, openTurn) {
  if (!openTurn) return null;
  return expiryFrom(openTurn.number, tag?.defaultDurationTurns);
}

// Which in-game day a turn belongs to. STAMPED on the row at open (Turn.dayNumber), never derived — a turn is 6, 8, 12 or
// 24 hours now, so ceil(number / 2) would renumber every past day the moment a GM changed the length, including the day keys
// the Bird and Fast Travel claim once a day against (CARRY.md §2a). The fallback is only for rows written before the column.
function turnDay(turn) {
  return turn?.dayNumber ?? Math.ceil(turn.number / 2);
}

module.exports = { turnsLeft, formatTurnsLeft, tagDuration, expiryFrom, expiryFor, turnDay };
