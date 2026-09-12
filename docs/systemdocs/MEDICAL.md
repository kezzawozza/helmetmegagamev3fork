# Medical treatment: items, administering, poisoning, prosthetics

The medical pass's other half. `TAGS.md` §5c owns the cure ladder itself —
the eight rungs, which group wants which kind of medicine, `expiresInto` and
`removesInto` — and keeps that ownership here too; this doc is what sits on
top of it: `Tag.cures`/`curesInto`/`administerable`/`administerSkill` (a
non-medic curing something with an item instead of a medic's Heal request),
the Move economy a routine cure spends (shared with `CRAFTING.md` §2a),
poisoning and its resistance trait, and the four prosthetics. Code:
`web/lib/consumeGrants.js`, the administer/poison paths in
`web/app/(app)/character/requestActions.js` (`consumeTagRequestImpl`,
`poisonItemRequestImpl`, `poisonCharacterRequestImpl`), `db/lib/tagWrites.js`,
`db/lib/poison.js`, `db/lib/hiddenCures.js`, `web/lib/craftBudget.js`,
`web/lib/healRequests.js`, `db/lib/medicalVision.js`. Related: `REQUESTS.md`
(the ration/audit rules an item cure has to obey too), `CARRY.md` (room
stashes, which carry poison state the same as a character's).

## 1. Two doors onto a cure: a medic, or an item

`TAGS.md` §5c's Heal request is one door onto the cure ladder. The other is
Consume: an item carrying `Tag.cures` (a list of health-tag slugs) can cure
those tags on whoever eats or is given it, no `medical-basic` required and no
Move economy touched at all — Consume was already a request every player
could file on their own sheet, and administering it to someone else is the
same request with a target.

**`cures` is an intersection test, not a requirement.** `consumeTagRequestImpl`
reads the target's held tags and cures whichever ones the item's `cures` list
names — White Honey (`cures: [poisoned, envenomated, phrygian-toxin]`) cures
every one of those three a patient happens to be holding at once, not just the
first. An item with a non-empty `cures` list that intersects nothing the
target holds is refused (`"X isn't holding anything Y treats."`) — **unless**
the item also carries `administerable: true` (Mercy), which is the one item
that stabilizes without curing a named list: it always succeeds regardless of
what the target holds.

**Administering to someone else is gated where self-consume is not.**
Consuming from your own sheet has never needed ACT (TAGS.md §5f) — the whole
point of first aid is that you can patch yourself up with no doctor and no
Move. Administering to someone ELSE is an act done *to* them, and it costs
what any other act-on-another does: the actor needs ACT, the target must be
ALIVE, co-located (`isHere`), and not concealed. The item itself never leaves
the actor's own inventory conceptually — `dropCharacterTag` still takes it off
the actor's sheet — but every grant the consume makes (the cure, the
aftermath, the fear relief) lands on the target.

**Cure application, per held cured tag:** `dropCharacterTag` takes the
affliction off, then the aftermath is `curesInto[slug]` if the item names an
override for that specific slug, else the cured tag's own `removesInto`
(`rollTagChain`, same coin-flip machinery `TAGS.md` §5c's Heal path uses).
Half the wound's fear cost eases the same way a Heal's does
(`woundFearFor(curedTag) / 2`, kind `HEALED`) — which is why the cured tag has
to be re-read *with its group* inside the transaction: the target's own load
omits it, the same trap `healCharacterRequestImpl` already dodges.

**The audit stays `request_consume_tag`, never `request_heal_character`.**
An item cure is not a Heal — it never touches `routineHealsThisTurn`'s pool
(§3) and it never rolls a Gambit, because an item's `cures` list is a flat
yes/no with no tier to reach above. `details.cured` carries one entry per
cured tag, each with its own `restore` snapshot (`{ tagId, source,
expiresTurn, quantity }`) so a GM can hand it back exactly, the same
`REQUESTS.md` §2 rule every destructive action follows.

**Patient-side race.** Two people administering the same cure to the same
target in the same instant both pass the outside intersection check; the
target's row is locked (sorted-id order with the actor's, to avoid a
deadlock) and the intersection is re-verified under that lock before anything
is cured. The loser gets `"X was already treated for that."` instead of a
phantom success — but only when the item's own gate *depended* on the
intersection: an `administerable` item like Mercy has nothing to lose either
way, so it never refuses here.

## 2. `administerSkill`: the one exception to "self-consume is never ACT-gated"

A handful of items (the four prosthetics, and any future item like them) set
`Tag.administerSkill`, and it gates **every** consume of that item — self
included. Fitting a peg leg onto your own stump is still surgery, and the
game does not let an untrained character do surgery on themselves for free
just because self-consume is normally exempt from every other gate. Two
separate questions, checked separately:

- **Is the actor qualified?** `satisfiedSkillIds` (the same tier-ancestry walk
  Heal uses) must include the named skill or a higher tier of it, whether the
  actor is treating themselves or someone else. Missing it refuses outright
  ("You need Medical (Expert) to use Wooden Leg.").
- **Does filing the Move need ACT?** A gated consume **files a Move** (below),
  and a Bound or Paralyzed character cannot file one even for themselves — so
  a self-administer through an `administerSkill` item DOES need ACT, unlike
  an ordinary self-consume. An administered-to-someone-else consume already
  needed ACT for its own reason (§1); this is the one case where the SELF
  branch needs it too, and only because of the Move it's about to spend.

**The fee is always 1/2 Move from the `medical` family**, flat, regardless of
what the item's own craft `requirementTurns` cost to make — fitting is a
separate job from crafting, and the Expert's scarce Move is the fee that
replaces any per-item fitting charge. Priced through a synthetic tag
(`{ requirementTurns: 1, requirementPerTurn: 2 }`, family `"medical"`) rather
than the item's own requirement block, so a craft recipe repricing the ITEM
never accidentally reprices the FITTING. Spent inside the transaction under
the same row lock and re-checked against the Move window (`moveWindow`),
exactly like every other budget-consuming action in the game.

## 3. The Move economy a routine cure spends

`CRAFTING.md` §2a owns the Move-budget arithmetic itself (fractions,
`craftMoveCost`, the ledger). This is the medical-specific wiring on top of
it — everything here is `healCharacterRequestImpl`'s own reading of that
shared machine, never a second copy of it.

**The family is hardcoded `"medical"`, never derived.** `craftFamily(tag)`
guesses a family from a recipe's `requirementSkills` prefix, which works for
an ordinary craft but would drop a skill-less cure like Choking into the
generic `craft` family — so both `craftMoveCost` and `spendCraftMove`/the
ledger copy take an explicit `family: "medical"` override from every caller
that bills a heal or an administer fee. This is also why a Routine already
committed to `medical` work refuses a Choking cure and a Broadsword in the
same turn, same as any two families would.

**The free pool.** Every cure priced at `turnsCost: 0` on the cure ladder —
first aid, bandaging, setting a simple break — is a free action, shared
across a medic's whole day regardless of which health tag it treats, up to
`MEDICAL_SIMPLE_PER_TURN = 4` (`web/lib/requests.js`). This replaced the old
per-tier daily ration (2/3/4 by Basic/Skilled/Expert) — the pool is now flat
and shared by tier, because the Expert's edge is what they can afford on the
turn-costing rungs (below), not a bigger free allowance. Counted by
`routineHealsThisTurn`: `request_heal_character` audit rows this turn, for
this medic (`actorDiscordUserId`, **not** the patient — a medic treating four
different people is rationed once, not per patient), filtered to
`!gambit && requirement.turns === 0`. Past the 4th, each additional 0-turn
cure spills into the medical family's Move at **1/4** — the same "allowance
free, past it costs the Move" rule Dead Simple crafting uses. **The predicate
is counted in three places that all have to change together** if this pool's
shape ever does: `routineHealsThisTurn` here, `peoplePools.js` (whose own
comment demands an exact match — it's what tells auto-labor a character
still has a free Move today), and `countsAgainstHealCap`/`healCapFor`
(`web/lib/healRequests.js`, which also feeds the Heal dialog's own quoted
cost).

**Everything past 0 turns bills the Move directly and never touches the
pool** — a `turnsCost: 1/3` or `1/2` cure is a fraction of the Move
(`craftMoveCost`'s `share` case), and a `turnsCost: 1` cure is the whole
thing. A whole Move is NOT the same as a Gambit: since M2b the top of the
ladder holds both, at the same 14 ⬢ — tier 6 (`appendicitis`, `disfigured`,
`envenomated`, `gut-wound`, `punctured-lung`) spends the whole Move as
routine work, and tier 7 carries `requirementGambit` on top of it, which is
the only thing separating the two rungs now that they share a price. A
Gambit heal never reaches the pool question at all: it files a
`MOVE`/`GAMBIT` Action, and
`Action @@unique([characterId, turnId])` is what rations it to one a turn,
the same shape a learner's Lesson Gambit uses.

**Surgery needs a site** (reworked M6b). A tier-6 or tier-7 cure
(`needsSurgicalSite`, read off the cure's *own* required skill —
`medical-expert` — not the treating medic's, so a Skilled medic reaching
above their tier for one still needs it) refuses outright without a site:
Surgical Equipment in reach (held, or already stood up in the room), a
Surgical Theater, or a **Portable Surgical Pack**. All three are ordinary
standing gear now — nothing is consumed. The pack is a worse site, though:
when it is the ONLY thing enabling the site (no Surgical Equipment and no
Theater also in reach), the Gambit's die takes a **−1**. Reaching for the
fixed kit or a Theater always wins outright and cancels the penalty, pack or
no pack — neither ever adds a bonus of its own. Non-site-gated Gambits
(reaching above your tier on an ordinary cure) never touch either kit at
all.

**Re-priced everywhere it's billed.** Every Move cost here is priced twice:
once outside the transaction for a fast refusal, and again inside it under a
row lock, because two simultaneous heals (or one heal racing the pool filling
up) would otherwise both read the same count and both pass. The player is
never billed more than the dialog showed them (`billedSeen`/`acknowledgeBill`)
— a stale free-allowance reading gets "reload to see the new cost" instead of
a silent surprise charge.

## 4. Poisoning

Three doors open off a held poison item (`Tag.poison: true`), one dialog:
**lace a held meal or drink**, **dose a helpless person here**, or **drink it
yourself**. The third is the ordinary Consume path — poisons are
`consumable` with their own wired `consumesInto`, so the dialog option posts
nothing new. The first two are their own request each.

**Lacing (`poisonItemRequestImpl`).** ACT-gated. The target must be a held
food or drink (`items-food`/`items-drink` group, itself not a poison) —
never gear, never a status. On success the food's `CharacterTag` row gets
`poisonedCount += 1` and `poisonPayload` set to the poison's tag id; the vial
is consumed. **Poisons don't mix**: dosing a stack that already carries a
*different* payload doesn't refuse and doesn't merge doses — it's silently
wasted, because a refusal here would tell the poisoner (and, if they talked,
the eventual eater) that the stack was already tainted. The refusal messages
that DO exist ("that's already tainted with something else", "it can't hold
any more poison than that") are gated on `canDetectPoison` — held only for a
poisoner who could have noticed the stack anyway (§5); anyone else's
wasted dose is silently lost in the mix, teaching them nothing. Audited as
`request_poison_item`, **with `turnId`** — the ordinary Consume audit's own
missing `turnId` is a known, separate gap this one doesn't repeat.

**Dosing a person (`poisonCharacterRequestImpl`).** Poison's own deliberate
door, and it is NOT a loosening of §1's cures-locked administer gate — a
conscious victim is never dosable this way; poisoned food is what that's for.
The target must be co-located and already helpless
(`INCAPACITATING_SLUGS` — bound, dying, paralyzed, unconscious, crucified,
catatonic, the same class Harm and Loot use); the actor needs ACT. The
poison's own `consumesInto` grants land on the target through the same
`resolveConsumeGrants` the Consume path uses, `resists` filter included — a
forced dose is countered by Iron Constitution exactly like a swallowed one,
because the trait is about the constitution, never the consent. Audited as
`request_poison_character`, with `turnId`; the target is DM'd anonymously
("someone forced something down your throat"), the same posture Harm's own
notification uses.

**The draw.** A stack's `poisonedCount`/`quantity` is a ratio, not a per-unit
flag — nobody, poisoner included, knows which physical units are the tainted
ones. `drawPoisonedUnits` (`db/lib/poison.js`) is one hypergeometric draw used
by every path that moves units off a poisoned stack: a Consume draw (`take:
1`, the odds are exactly `poisonedCount / quantity`), a Transfer or Loot move
of several units at once (`take: quantity`, which runs the same single-unit
draw that many times without replacement so the expected split matches the
stack's own ratio without ever landing on a fixed rounding). A poisoned
Consume draw applies the poison's `consumesInto` **on top of** the food's own
grant, through the same `resolveConsumeGrants` call — resisted exactly the
same way (§5). Both `addToStack`/`dropCharacterTag` (characters) and
`addToRoomStack`/`dropRoomTag` (room stashes, `db/lib/tagWrites.js`) carry the
`poisonedCount`/`poisonPayload` pair, so dropping a poisoned meal in a stash
and someone else picking it up carries the taint across — merging into a row
that already holds a *different* payload dilutes the incoming units clean,
the same silent-loss rule lacing uses, never a recipient-side refusal (which
would leak the poisoning to the victim). A GM's crate Package/unpack and the
carry-overflow spill both thread the same state through rather than
laundering it (the M4 fix round closed those three paths specifically).

**Detection.** Two ways to tell a stack is tainted, either enough on its own:
holding `poison-sense` (a trait) or `poison-snooper` (a multi-use item — just
holding it is the check, it's never consumed). `canDetectPoison`
(`db/lib/poison.js`) is the one predicate both the lacing refusals (above)
and the sheet/inspect markers read. Everyone else sees the plain stack row —
it *is* the plain row, not a hidden field withheld from them. **Secrecy is
structural, not a filter forgotten somewhere**: `db/lib/poison.js` never
returns a raw `poisonedCount`/`poisonPayload` to a caller — only a drawn
count or a yes/no on detection — so what a client is allowed to see is
decided at the serialization boundary (`character/page.js`, `db/lib/
examine.js`), not by this module leaking the wrong field.

## 5. Resistance (`Tag.resists`)

A held tag's `resists` list (Iron Constitution's sidecar) names slugs its
holder shrugs off — `resistSlugsOf` unions every held tag's list into one
set, and `resolveConsumeGrants` is the **only** place it's read: never inside
`grantTagSlugs`, which the bot's GM `/heal` and every other writer share, and
which must never quietly filter a deliberate GM grant. Two effects, both in
`web/lib/consumeGrants.js`: a `oneOf` position (a food's random split, like
Skinned Cave Rat's vomiting/ate-meal) **prefers** a non-resisted alternative
when one exists, rather than landing on the resisted branch and re-rolling
away from it; and whatever the position finally lands on — `oneOf`-picked or
plain — is dropped from the grant if it's still in the resist set, reported
back as `resisted` rather than silently vanishing. Both the ordinary
food-grant path and the poison paths (a poisoned Consume draw, a forced dose)
call through the identical function, so the trait counters a poison exactly
the same way whether it was swallowed or forced.

## 6. Prosthetics and the hidden cures

The four prosthetics are ordinary `Tag.cures` items with one extra field —
`administerSkill: medical-expert` (§2) — and a `curesInto` override, since
none of the four maimings they treat carries its own `removesInto`: Wooden
Leg cures `missing-leg` into the cosmetic `peg-leg`, Iron Hook cures
`missing-arm` into `hook-hand`, and so on. The two secret cybernetics
(`cybernetic-arm`/`cybernetic-leg`) cure the same two maimings outright with
**no** aftermath at all — the graft leaves no mark, unlike the visible
prosthetics. Both are gated on an ingredient (`cybernetic-core`) nothing
drops yet, same as `last-breath`'s `aberrant-heart` — buildable the day the
loot-table pass wires one in, inert until then.

**`last-breath` is the one item door onto a tier-7 cure that isn't a
Gambit.** Dying is always a roll through Heal — even an Esculap rolls for it
— but an item's `cures` list is a flat yes/no with no tier to reach above, so
a held bottle cures Dying outright, no die involved, the same way White Honey
bypasses Envenomated's own tier. Its recipe (and the two cybernetics') is
hidden by conjunction rather than by the ordinary "hidden until you hold the
ingredient" rule most secret recipes use (`CRAFTING.md`'s Recipes-tab
filter): the Craft menu shows it only to a character who is BOTH
`brewing-expert` AND already holding the named ingredient
(`web/lib/tagRequests.js#computeKnownRecipeIds`) — an expert holding the rare
part realizes what it could brew; neither half alone is enough to see it.

**Hidden cures are a different mechanism, and deliberately never
advertised.** `db/lib/hiddenCures.js` is a small, hardcoded table (currently
just `bliss → [depressed]`) of a consumable quietly curing something no
description, systemdoc or tooltip ever names — a player finds out by eating
one and noticing. This is NOT the same door as `Tag.cures`: a tag that
advertised its own hidden cure would stop being a discovery. It runs after
the ordinary grants (so Bliss still leaves you Euphoric and High on top of
whatever it quietly cures) and writes nothing to the request's own audit
`details` — an Undo of the consume does not restore the hidden cure, because
the cure is something that happened to the character, not a line item in a
receipt.

## 7. Where the code lives

`web/lib/consumeGrants.js` (`resolveConsumeGrants`, the resist filter, the
ladder climb every consume shares with drinking), `db/lib/poison.js` (the
detector predicate, the hypergeometric draw), `db/lib/hiddenCures.js` (§6),
`db/lib/tagWrites.js` (`addToStack`/`dropCharacterTag`/`addToRoomStack`/
`dropRoomTag`, all four poison-aware), `web/lib/craftBudget.js`
(`craftMoveCost`, the family override, the ledger arithmetic — shared with
`CRAFTING.md` §2a), `web/lib/healRequests.js` (`isHealable`, `isGambitHeal`,
`needsSurgicalSite`, `countsAgainstHealCap`, `healCapFor` — the client/server
shared predicates), `db/lib/medicalVision.js` (the skill-tier ancestry walk
and the doctor's-eye visibility rule, shared with the bot's 🔍 inspect —
`TAGS.md` §5c), and the administer/poison/heal request implementations
themselves in `web/app/(app)/character/requestActions.js`
(`consumeTagRequestImpl`, `poisonItemRequestImpl`,
`poisonCharacterRequestImpl`, `healCharacterRequestImpl`).
