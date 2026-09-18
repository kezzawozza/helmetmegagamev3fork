// A budgeted sample of one zone's chat for the Oracle's CHAT section. See
// docs/systemdocs/ORACLE.md §3. Pure — no Prisma, no requires — so
// db/lib/oracleInput.js is the only thing that wires it to real data.

// A 2000-token slice of one zone's day, spread across the rooms that spoke.
// Cheap estimate on purpose: characters / 4. It is within ~20% for English
// and the budget is a comfort limit, not an accounting one — paying a
// tokenizer dependency to be exact here would buy nothing.
const CHAT_TOKEN_BUDGET = 2000;

function estimateTokens(text) {
  return Math.ceil(String(text ?? "").length / 4);
}

// Fisher-Yates over a COPY, driven by the injected `random` so a seeded one
// gives the same sample twice.
function shuffled(rows, random) {
  const copy = [...rows];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Group by placeKey, spread the budget evenly across places, take lines in a
// shuffled order until a place's share is spent — skipping (never
// truncating) a single line that would overflow it, so a short line further
// down the shuffle can still fit. Whatever a place's share leaves unspent is
// then redistributed across places that still hold unsampled lines, so one
// quiet room does not waste the budget a busy one could have used.
function sampleChat(rows, { budget = CHAT_TOKEN_BUDGET, random = Math.random } = {}) {
  if (!Array.isArray(rows) || !rows.length) return [];

  const places = new Map();
  for (const row of rows) {
    const key = row.placeKey ?? "unknown";
    if (!places.has(key)) {
      places.set(key, { label: row.threadName ?? key, rows: [] });
    }
    places.get(key).rows.push(row);
  }

  const keys = [...places.keys()];
  const share = Math.floor(budget / keys.length);

  // First pass: take up to `share` tokens per place, from a shuffled order.
  const state = new Map(); // key -> { taken: [...], leftover: [...unsampled shuffled], spent }
  for (const key of keys) {
    const { rows: placeRows } = places.get(key);
    const order = shuffled(placeRows, random);
    const taken = [];
    const skipped = [];
    let spent = 0;
    for (const row of order) {
      const cost = estimateTokens(row.content);
      if (spent + cost <= share) {
        taken.push(row);
        spent += cost;
      } else {
        skipped.push(row);
      }
    }
    state.set(key, { taken, skipped, spent });
  }

  // Second pass: redistribute whatever the first pass left unspent across
  // places that still hold unsampled (skipped) lines, in the same shuffled
  // order they were already put in, cheapest-fitting-first is not needed —
  // skipping-not-truncating already means order alone decides what fits.
  let pool = keys.reduce((sum, key) => sum + (share - state.get(key).spent), 0);
  if (pool > 0) {
    let progressed = true;
    while (pool > 0 && progressed) {
      progressed = false;
      for (const key of keys) {
        const entry = state.get(key);
        while (entry.skipped.length) {
          const next = entry.skipped[0];
          const cost = estimateTokens(next.content);
          if (cost > pool) break;
          entry.taken.push(entry.skipped.shift());
          entry.spent += cost;
          pool -= cost;
          progressed = true;
        }
      }
    }
  }

  return keys.map((key) => {
    const { label, rows: placeRows } = places.get(key);
    const { taken } = state.get(key);
    const sorted = [...taken].sort((a, b) => new Date(a.sentAt ?? 0) - new Date(b.sentAt ?? 0));
    return {
      label,
      taken: sorted,
      sampledCount: sorted.length,
      totalCount: placeRows.length,
    };
  });
}

module.exports = { CHAT_TOKEN_BUDGET, estimateTokens, sampleChat };
