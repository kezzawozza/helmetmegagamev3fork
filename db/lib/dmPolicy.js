// One policy for the three sendDm transports (bot/src/lib/dm.js, web/lib/discordGuild.js,
// db/lib/dm.js — CLAUDE.md "Direct message logging"): the `»` prefix, default `kind`/`source`, and
// how a failed send is written down are one decision, not three. NO REQUIRES IN THIS FILE, EVER — same
// dmKinds.js rule, reachable from a client component. DM_KIND strings are duplicated below rather than
// imported for that reason; db/test/dmPolicy.test.js asserts the two copies agree.
const KIND_CONVERSATION = "CONVERSATION";
const KIND_NOTICE = "NOTICE";
const KIND_QUIET = "QUIET";

// What a DM nobody classified is: the game talking, not a person.
const DEFAULT_KIND = KIND_NOTICE;

// What produced a row, when the caller did not say. Every transport agrees on this now.
const DEFAULT_SOURCE = "bot_auto";

// The `»` marking a line as the game restating something at you (CLAUDE.md, "Bot message style").
// Idempotent — tests for the chevron ALONE, not `"» "`, so `»hi` doesn't become `» »hi`.
// Subtext is left alone for the same reason bot/src/lib/respond.js leaves it alone: `-#` is the
// world talking quietly under the conversation, not the game quoting you back at yourself, and
// `» -# …` would be both voices at once.
function applyDmPrefix(content) {
  const text = String(content ?? "");
  return text.startsWith("»") || text.startsWith("-#") ? text : `» ${text}`;
}

// The exact `data` for a DirectMessage.create after a send. One place, so a new column is added to
// three transports by adding it here. `hasEmbeds` is the QUIET default's trigger (an inspect readout
// is plumbing); passed rather than read off `opts` because the gateway transport carries embeds on the payload.
function dmLogRow({ discordUserId, content, opts = {}, discordMessageId = null, hasEmbeds = false }) {
  return {
    discordUserId,
    direction: "OUTBOUND",
    content,
    authorDiscordUserId: opts.authorDiscordUserId ?? null,
    source: opts.source ?? DEFAULT_SOURCE,
    kind: opts.kind ?? (hasEmbeds ? KIND_QUIET : DEFAULT_KIND),
    discordMessageId: discordMessageId ?? null,
    // The composer's own id for this send. Null everywhere else (partial unique index allows it).
    clientNonce: opts.clientNonce ?? null,
    // ?? undefined: an explicit null is rejected by Prisma for a Json? column.
    meta: opts.meta ?? undefined,
  };
}

// The identity of one delivery attempt, stable across the push and a later resend, so a resend
// doesn't send a second copy. Built from ids, never a loop index (stable across RUNS too).
// `recipientKey` is what a caller passes when the Discord id isn't the real identity — a character
// with no linked Discord account has a null id, so keying on it alone could collapse a whole room of
// unlinked recipients into one row, or collide a PRIVATE recipient with a PUBLIC post's `…:none` tail.
// `discordUserId` stays the fallback for transports that genuinely key on a Discord account.
function dedupeKey({ scope, subjectId, discordUserId, recipientKey }) {
  return `${scope}:${subjectId}:${recipientKey ?? discordUserId ?? "none"}`;
}

// What a bounced send is written down as, so the push and the resend record the same failure the same way.
function describeFailure(err) {
  return {
    error: String(err?.message ?? err ?? "unknown error"),
    // 50007 is Discord's real closed-DMs code; kept beside the message so a GM can tell the two apart.
    status: err?.status ?? err?.code ?? null,
  };
}

module.exports = {
  applyDmPrefix,
  dmLogRow,
  dedupeKey,
  describeFailure,
  DEFAULT_KIND,
};
