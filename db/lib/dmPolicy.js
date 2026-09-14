// One policy for the three sendDm transports.
//
// There are three of them and there always will be — bot/src/lib/dm.js talks
// over the gateway, web/lib/discordGuild.js over REST from the web app, and
// db/lib/dm.js over REST from the turn engine (CLAUDE.md, "Direct message
// logging"). What they should NOT each have is their own opinion about the `»`
// prefix, the default `kind`, the default `source`, or what a failed send looks
// like when it is written down. Those are one decision, and this is where it
// lives. Each transport keeps its own body; it swaps its inline copy of these
// four rules for a call.
//
// NO REQUIRES IN THIS FILE, EVER — the dmKinds.js rule, for the same reason:
// it is reachable from a client component through the web transport's module
// graph, and one require of @lifeweb/db here drags PrismaClient into the
// browser bundle and kills the route with a node:fs error carrying no digest.
// The DM_KIND strings are duplicated below rather than imported for exactly
// that reason; db/test/dmPolicy.test.js asserts the two copies agree.

// The strings, copied from db/lib/dmKinds.js. See the note above on why this
// is a copy and not a require.
const KIND_CONVERSATION = "CONVERSATION";
const KIND_NOTICE = "NOTICE";
const KIND_QUIET = "QUIET";

// What a DM nobody classified is: the game talking, not a person.
const DEFAULT_KIND = KIND_NOTICE;

// What produced a row, when the caller did not say. Every transport agrees on
// this now — web/lib/discordGuild.js used to write null here, which was not a
// third meaning, only an unset field. Nothing keys off `source IS NULL`
// (checked across all three packages before the change), and the readers that
// branch on a source name it explicitly (db/lib/dmKinds.js's four).
const DEFAULT_SOURCE = "bot_auto";

// The `»` that marks a line as the game restating something at you
// (CLAUDE.md, "Bot message style"). Idempotent: a caller that wrote its own
// chevron — the `/dm` handler does — gets one, not two.
//
// The test is the chevron ALONE, not `"» "`. A caller that wrote `»hi` with no
// space still wrote a chevron, and `» »hi` is two of them — which is the one
// shape a reader notices, because it reads as a quote of a quote.
function applyDmPrefix(content) {
  const text = String(content ?? "");
  return text.startsWith("»") ? text : `» ${text}`;
}

// The exact `data` for a DirectMessage.create after a send. One place, so a
// new column (clientNonce was the last one) is added to three transports by
// adding it here.
//
// `hasEmbeds` is the QUIET default's trigger: an inspect readout is plumbing,
// and plumbing is never drawn. It is passed rather than read off `opts`
// because the gateway transport carries its embeds on the payload instead.
function dmLogRow({ discordUserId, content, opts = {}, discordMessageId = null, hasEmbeds = false }) {
  return {
    discordUserId,
    direction: "OUTBOUND",
    content,
    authorDiscordUserId: opts.authorDiscordUserId ?? null,
    source: opts.source ?? DEFAULT_SOURCE,
    kind: opts.kind ?? (hasEmbeds ? KIND_QUIET : DEFAULT_KIND),
    discordMessageId: discordMessageId ?? null,
    // The composer's own id for this send, where there was a composer behind
    // it. Null everywhere else, which the partial unique index allows.
    clientNonce: opts.clientNonce ?? null,
    // ?? undefined: an explicit null would be rejected by Prisma for a Json?
    // column, and the transports' .catch() would eat the lost row.
    meta: opts.meta ?? undefined,
  };
}

// The identity of one delivery attempt, stable across the push and a later
// resend — which is the whole point: the push and the Resend button must agree
// on which row they are retrying, or a resend sends a second copy.
//
// Stable across RUNS too, so it is built from ids and never from a loop index.
// The push's step ladder used `delivery:<messageId>:<index>`; an index moves if
// a recipient is removed between a crash and its resume.
//
// `recipientKey` is what a caller passes when the Discord id is not the
// identity it means. A staged message's recipients are CHARACTERS, and a
// character who has never linked a Discord account has a null id — so keying on
// the Discord id gave every such recipient the same `…:none` tail, and a
// createMany with skipDuplicates silently collapsed a whole roomful of them
// into one row. Worse, that same tail is the one a PUBLIC post uses, so a
// PRIVATE recipient could collide with the zone's own post. Callers pass the
// thing that actually identifies the recipient; `discordUserId` stays as the
// fallback for the transports that genuinely key on a Discord account.
function dedupeKey({ scope, subjectId, discordUserId, recipientKey }) {
  return `${scope}:${subjectId}:${recipientKey ?? discordUserId ?? "none"}`;
}

// What a bounced send is written down as — in Delivery.lastError, in
// StagedMessage.deliveryFailures, and in the audit row — so the push and the
// resend record the same failure the same way.
function describeFailure(err) {
  return {
    error: String(err?.message ?? err ?? "unknown error"),
    // 50007 is Discord's real closed-DMs code. Kept beside the message because
    // "they have DMs closed" is a different thing for a GM to read than "the
    // send timed out", and the text alone does not distinguish them.
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
