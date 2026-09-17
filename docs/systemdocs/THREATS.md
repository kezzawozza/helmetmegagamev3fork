# Threats

The antagonist seats: what they are, how a GM hands one out, and what happens
when somebody accepts one. The catalog is `db/lib/threats.js`; the GM surface
is `/gm/dev?s=assignments` and `/gm/dev?s=antagonists`.

Companion to `CHARACTERS.md` (the creation wizard's Antagonists step, which
writes the consent this reads) and `DEV-PANEL.md` §11 (the panel these two
sections live in).

## 1. What a threat is

One entry in `db/lib/threats.js`. Three optional pieces decide what an entry
can do, and which ones it carries is the whole taxonomy:

| Piece | What it means |
|---|---|
| `optIn: true` or `{ name, whitelist }` | A checkbox in the lobby and on the wizard's Antagonists step. Consent data, nothing else. `name` is the PUBLIC name the box wears when it differs from the seat's — "Succubus" for the Demoness so the 18+ nature is said out loud, "Cultist" / "Cultist Leader" for the two Thanati seats so the word never appears; `whitelist: true` greys the box for anyone without the Whitelist Discord role (the same role that gates leader seats) and drops the slug server-side. `optInName()` / `optInWhitelisted()` read the shape; `antagonistNames()` returns public names, which is what every GM table shows. |
| `assign: {…}` | A real seat a GM can hand to an existing character. |
| `spawn: {…}` | The same seat, handed to somebody with no character at all. |
| `party: { key, name }` | The group a seat scores its **objectives** with and is named as in the reveal (§6a): the two Thanati seats share `thanati`, the two Tribunal seats `tribunal`. A seat without one is **solo** — `partyOf()` answers with the seat itself, and the reveal says "was a" rather than "were the". |
| `brief: [lines]` | Prose the seat DM carries — the **one exception** to "no prose in the catalog" below. Only for a seat with no Role of its own (`spawn.roleSlug` null), where there is no charter to duplicate and nowhere else for the words to live. Only the Thanati carry one. Bascinet's words verbatim, unsigned. Assign sends it in place of the generic opener. The Spawn **offer** never carries it — a decline must not have read the doctrine — so the bot DMs it once Accept lands (`bot/src/lib/threatSpawn.js`). |

`assignable: true` is the flag both buttons read; every assignable seat is also
spawnable, because anything worth giving to a character is worth giving to a
new one.

**Half the opt-ins are decoys**, and which ones are real is not written down here.
Ticking a checkbox tells a GM about consent without telling the player which
seats are real, and a doc in the repo that lists the real ones undoes that. The
roster lives in `SECRETS.md`, which is gitignored.

Three mechanisms are worth knowing about regardless of which seat uses them:

- **`spawn.locationSlug`** lets a seat name its own landing site, so a GM
  offering it need not remember where that seat arrives. `offerThreatSpawn`
  prefers a GM's explicit pick, then this, then the role's own start.
- **A Role no player may take.** A spawn needs a Role for its charter, kit and
  start, so a seat can own a `docs/roles.yaml` faction whose slugs sit in
  `SPAWN_ONLY_ROLE_SLUGS` (`db/lib/roleCapacity.js`, re-exported by
  `web/lib/characterCreation.js`). That withholds them from the creation
  picker outright, rather than greying them the way a whitelisted seat is
  greyed — and keeps them out of the lobby's roll and its hand-set dropdown
  (`LOBBY.md` §3).
- **`SHUTTLE_ARRIVAL_SLUGS`** makes spawning a seat tell the whole map a shuttle
  came down — every Location channel, via
  `db/lib/worldBroadcast.js#ambientEverywhere`. Adding a seat to that broadcast
  is one line in the set.

**No prose lives in the catalog, except a `brief`.** What a seated player
reads is the Role's own charter — `intro` and `description` from
`docs/roles.yaml` — sent by the seat DM. The catalog used to carry a `blurb`
per seat as well; Bascinet pulled it on 2026-09-06 because it was a second,
drafted copy of what the role already said. The Thanati are the exception
because they have no role to copy: a GM picks a cover role when spawning one,
so their own words have to ride on the entry. The hand-run briefs (Brigands,
Monsters, the Sympathizer) are not entries at all; they are in `SECRETS.md`.

### Why a code module and not a table

Same reasoning as `db/lib/roleIds.js`: fixed values that can never differ per
environment, so a row would only add a join and a way to drift.

### Renaming a slug needs no migration

`normalizeAntagonistSlugs` and `antagonistNames` both **drop unknown slugs
silently**, so a `Character.antagonistOptIns` still holding a retired slug
renders as nothing rather than leaking a stale name. Seats have been renamed
this way with no data work at all; the rename history is in `SECRETS.md`, since
an old name is still a name.

## 2. Who holds a seat is derived, not stored

There is no "current threat" column. A character **is** the Demoness because
they hold the `demoness` tag — `seatTagSlug` on the catalog entry is the link,
and `threatBySeatTag()` walks it back.

This is deliberate. A column would be a second copy of the truth, and it would
be wrong the moment a GM granted the tag by hand from
`/gm/dev/characters/[characterId]` — which is exactly how seats were handed out
before any of this existed. `CharacterTag.acquiredAt` supplies the "Since"
column for free.

## 3. Assign

`assignThreat({ characterId, threatSlug })` in
`web/app/(app)/gm/dev/threatActions.js`. GM-gated (`web/lib/devAccess.js`), not
superadmin — running the game is what seats and objectives are — and it
re-checks `assignable` itself — a server action is a public endpoint and the
dropdown is a hint, not a lock.

One transaction: the seat's tags, then the points, then the conflicts. Tags
are **upserted**, not created, because a GM may have granted the seat tag by
hand already and a duplicate would violate `CharacterTag`'s
`(characterId, tagId)` unique. Then one `threat_assigned` audit row.

**A seat's incompatible tags are `conflictsWith` edges on the seat tag** in
`docs/tags.yaml` (Judge and Demoness against Pacifist, Charitable and Saint;
the `thanati` Belief against those and Pilgrim, plus every other Belief by
the group's `exclusive` rule). That is what makes the store and Add Tag refuse
them for a holder without knowing what a threat is. What the character
*already* holds is settled by `db/lib/seatConflicts.js#resolveSeatConflicts`,
in the same transaction, in **two sweeps**.

**Sweep 1 — what the seat clears out of its own way.** Nothing here consults
`conflictsWith` at all, and nothing here is grandfathered:

- **every Addiction goes**, on every seat. The group is `general-addictions`,
  and the reason is the bottom Desire slot: an Addiction's `desireLocks`
  clause is `slot: bottom`, so a cultist's last slot is spoken for by the next
  drink rather than by the Dark Lord.
- **a Personality tag goes only where it actually locks one of the seat's own
  Desires.** "The seat's own Desires" is every non-retired `DesireTemplate`
  whose `requiresAnyTags` names a seat tag; whether a held tag locks one is
  asked of `db/lib/desireGates.js#lockedReasonForTemplate` — the same
  evaluator the catalog itself draws with, rather than a per-seat list
  somebody has to keep. So for the Thanati, **Pacifist** (`violence`),
  **Devoted Follower** (`scheming`), **Depressed** (`all`) and **Nobility**
  (by tier) go, while **Kleptomaniac** stays: it locks `wealth`, and no
  Thanati Desire is in that family. A seat that opens no Desires of its own
  therefore strips Addictions and nothing else.

Both take their points **back with them**. `pointCost` on a drawback is
negative, so the same `increment` that refunds a purchase charges for a flaw:
the player banked 4 for Alcoholic, and the seat has just deleted Alcoholic.
`Character.tagPoints` **may go negative** — deliberately, since the store's
check is `cost > tagPoints`, so a character in debt simply buys nothing until
they have worked it off. A floor at zero would quietly forgive the difference.

**Sweep 2 — the older pairwise and exclusive rules**, unchanged:

- a pairwise conflict that **cost points** is removed and its `pointCost`
  goes back to `Character.tagPoints` — refunded;
- a pairwise conflict with a zero or negative cost is **kept** — a refunded
  drawback would be a farmed one;
- a second **Belief** always goes, refunding `max(cost, 0)`.

**Sweep 1 runs first, and the order is load-bearing.** Pacifist is both a
`conflictsWith` edge on the `thanati` tag *and* a `violence` lock. Taken by
sweep 2 first it would land in the "kept, drawbacks and all" list, in the same
DM that says it was stripped.

The DM leads with the sweep-1 sentence, because it is the one that costs the
player points — "Your role conflicted with Alcoholic and Pacifist, so 4 tag
points have been taken back with them." — then lists what was refunded,
dropped and kept. The audit row carries all four lists plus `clawedBack`.

**The conversion rite is an Assign by another road.** `db/lib/riteEffects.js`'s
`conversion` handler grants the `thanati` tag and calls the same function, so a
convert loses their Addictions exactly like an assigned cultist — and is sent
the same sentence, since otherwise they would find four tag points missing with
nothing anywhere saying why.

The DM goes out **post-commit**, in `after()`, so a Discord outage can never
cost the grant:

```
You are now the {name}!
Check your tags and documents.
```

**Bascinet signed off on this wording**, so the Assign and Spawn tails, the
arrival line and the seat-conflict note all end on their own punctuation.

No charter here: an assigned character already has a role, and the seat is
its tags. The spawn offer (§4) is the one that carries a charter.

`sendDm` applies the `»` prefix, splits past 2000 characters and logs to
`DirectMessage`, so the whole thing shows up on `/gm/messages` too.

**Any threat, opted in or not.** Consent is a GM's judgement call; the opt-in
column exists to inform it, not to gate it.

Assign needs a living character. For anybody else the row offers Spawn instead.

## 4. Spawn

Two phases, because the offer crosses from web to Discord and back.

**Phase 1 — the GM offers.** `offerThreatSpawn` writes a `ThreatSpawn` row and
DMs the target the Role's charter plus Accept / Decline:

```
You have been offered a seat: the {name}.
{role.intro}
{role.description, one line each}
Accept and you arrive immediately. Decline and nothing happens.

The buttons work on **either face**: the same pair is drawn in the Bascinet
pane on `/chat`, which is the only place somebody with no character and no
Discord can answer at all (`CHAT.md` §2b).
```

A `{tag:…}` token in a description line is flattened to the tag's name for the
DM, looked up rather than title-cased. The buttons are raw component
JSON built by `spawnOfferComponents()` in `db/lib/threatSpawn.js` — the web
sends them and only the bot has discord.js, so the shape lives where both can
reach it, same as the Bird's Reply button.

If the DM fails (closed DMs, a departed member) the row is **rolled back to
`CANCELLED`**. A live offer with no buttons behind it is worse than no offer.

`ThreatSpawn_pending_unique` is a **partial** unique index
(`WHERE status = 'PENDING'`), so one player can never hold two live offers.
Prisma's schema language cannot express a partial unique, so it exists only in
the migration SQL — `prisma migrate diff` will propose dropping it and the
answer is no, exactly as with `FactionApplication_pending_unique`.

**Phase 2 — the player accepts.** The click lands in the **bot**: a DM has no
guild, and the clicker has no character yet, which is the whole point.
`bot/src/lib/threatSpawn.js` only routes; the work is
`acceptThreatSpawn()` in `db/lib/threatSpawn.js`.

The acknowledgement is `interaction.update()` — the buttons come off the message
and the outcome is written under it, so a dead button cannot be clicked twice
and the DM reads as a record afterwards. Same posture as `bot/src/lib/offers.js`.

Its transaction mirrors `createCharacter`'s, which until this landed was the
only code that had ever written a `Character` row:

- `SELECT id FROM "Role" … FOR UPDATE`, then re-count seats against
  `roleCapacity()` with `seatHolderStatuses()`. Prisma runs READ COMMITTED, so
  the row lock is what actually stops two people taking one seat.
- The `ThreatSpawn` row is **re-read under that lock**. Two fast clicks on the
  same button race here, and the status check before the transaction is only an
  early out.
- `character.create` with the rolled name, the seat's gender, the chosen
  location **and its `zoneId` in the same statement** — the denormalization
  contract.
- Tags: the seat's grant, its spawn kit, and whatever the role grants anyone,
  resolved in one pass so a missing slug is a clean refusal rather than a
  half-granted character.

Everything Discord-side runs **after** the answer is written, best-effort, via
`applySpawnSideEffects()`: the personal role (a mentionable name token held by
nobody — access rides the zone role and the Location overwrite), placement
through `applyLocationMoveSideEffects`, and the Ghost role dropped. Nothing
here writes a Discord nickname — nothing in the game does (`PROXYING.md` §8).

### The spawn kit

`spawn` names a gender, a `roleSlug` (null means the GM picks), `resources`,
`tagPoints` and `tagSlugs`. Tag entries are **slugs** with an optional count —
`"obol x4"` — parsed by `parseStartingTag`. A role's own `startingTagSlugs` are
display **names** despite the column's name, so the two are looked up
separately and merged.

Names are rolled from a per-gender list in `db/lib/threats.js`. They are
plain: a name is written to `Character.name` and the personal role title,
worn as identity rather than read as prose.

A spawned character opens with no `BankAccount` at all — `bank_account:` in
`docs/roles.yaml` only fires at ordinary creation. Whoever plays the seat
opens one at the Depot's counter with its **Create an account** button, the
same as any other body handed a threat mid-game (`CHARACTERS.md`,
`DEPOT.md` §0g).

## 5. The two GM sections

Both live on `/gm/dev` under the **Threats** nav group. Unlike most of
`/gm/dev`, which is superadmin-only, these two sections (`assignments` and
`antagonists`) are GM-tier — `web/lib/devAccess.js` — because running the game
is what seats and objectives are (`GAMEMASTERS.md` §5). Each fetches only its
own data.

### `?s=assignments`

Every **approved player in the guild**, in the game or not —
`listGuildMembers()` filtered on `PLAYER_ROLE_ID`, left-joined to characters by
`discordUserId`. A player with no character is a real row, not a gap: they are
exactly who a spawn is aimed at.

Opt-ins render as chips with their own dropdown. That one filter sits **outside**
`useTableState`, because a `filterDefs` entry compares by string equality and a
player holding three opt-ins would stringify to `"Archon,Judge,Warlock"` and
match none of them. It pre-filters the rows instead and rides in `FilterBar`'s
children.

### `?s=antagonists`

Three blocks under one glance strip — seats held, parties, objectives complete,
rites in flight, all four derived from props the page already builds rather
than from a query of their own.

1. **Seats.** Who holds one now, derived per §2, plus the offers nobody has
   answered yet with a Cancel button. An unanswered offer's only other trace is
   a DM in somebody else's client.
2. **Objectives**, §6a — one card per party, in a grid that fills the width.
   Each card's Add row is folded behind a `+ Add objective` toggle: three
   always-open forms was most of the section's height, and a GM reads the
   objectives already there far more often than they write a new one.
3. **Rites**, read-only (`THANATI.md`) — the Words of the Circle and every
   attempt, side by side once there is room.

The section wears `.ops-section--wide` for the eight-column seat table. That
used to fight `.desk-card`'s own `max-width: 52rem; margin: 0 auto`, which is
right on the reading desks and left every card here floating centred under a
table that stretched; `.ops-main .desk-card` now drops both.

## 6a. Objectives

An antagonist party's win conditions: what a GM writes down at game start, what
the game scores as it runs, and what the reveal prints when it ends. The catalog
of kinds is `db/lib/objectiveKinds.js`, the scoring is `db/lib/objectives.js`,
the rows are the `Objective` table, and the GM surface is the bottom of
`?s=antagonists`.

**A party, not a seat.** Objectives hang off the `party` key in §1 — the Thanati
share one list, the Tribunal another, and a solo seat (Demoness, Judge) is its
own party under its own slug. `PARTIES` is the deduped list in catalog order and
is what both the cards and the reveal iterate.

**A kind**'s fields are glossed at the top of `db/lib/objectiveKinds.js`; the
two worth knowing here are `target` — what the Add row asks for: a character, a
*leader* (a character whose Role has `requiresWhitelist`), the Inquisitor or
the Baron (not the Baroness — Bascinet's ruling), a Location, a number, free
text — and `script`. The kinds and their words are Bascinet's, from the
objectives spec. Solo parties only get `custom`.

**Three scripted kinds; the rest are the GM's word.** `script` names a checker
in `evaluateObjectives`, all read on demand — nothing runs at turn close:

| Kind | Checker | Reads |
|---|---|---|
| Kill [Character] | `characterDead` | the target's `status === "DEAD"`, exactly — `CURSED` is a dead enum value, not a state; a GM Revive un-scores this |
| Cause [N] deaths in a single day | `deathsInOneDay` | the game's DEATH `ArchiveEntry` rows grouped by `turnDay()` (two turns to a day); done if any day reached N. Whoever caused them — the cult need not have. The one exception is the bomb's turn (`nukeDetonatedTurn`), which is left out entirely: the blast is the Tribunal's objective, not a bloodbath |
| Detonate the nuclear device | `nukeDetonated` | `GameState.nukeDetonatedTurn` |

Everything else — Deface, Blow up, the conversion and sacrifice rites, Celebrate,
`custom` — is **manual**: the GM says whether it happened. The rite kinds are
`placeholder: true` until the rites exist, and the card says "waits on a rite"
beside them.

**The pin.** `Objective.pinned` is the GM's answer. A scripted kind starts at
null — *Game decides* — and a GM can pin Success or Failed over the checker (a
Revive, a ruling that the Thanati had no hand in a death). A manual kind is
never null; the pin is its only answer, and it starts at `startsDone` — false
for all but Celebrate, which the spec has start at Success. `pinObjective`
refuses a null pin on a manual kind.

**Blow up [Location]** lists surface Locations that are not wilderness
(`locationEligible`: `zone.kind === "SURFACE"` and no `wilderness` attribute);
the action refuses by the same rule.

**The reveal.** `buildEpilogue` hands `buildAntagonistReveal` the character and
death rows it already loaded plus the state, and stores `antagonists` on the
epilogue: every party with at least one seat holder of any status, its members
(the Thanati Leader first; a seat name in parentheses where it differs from the
party's), its objectives scored. A party with objectives and nobody seated is
left out — it never existed in play. Every manual objective prints as Success
or Failed by the GM's pin, the placeholder rite kinds included: an
unadjudicated one reads **Failed!**, which is the spec's binary. `/archive`
hides the whole reveal from players while a resumed game is running, since it
names live kill targets. `formatAntagonistLines` is Bascinet's
format, one line per party, printed under **The antagonists** between the
facts line and **Who was who**, and on `/archive`:

```
Ash was a Judge.
Maeris was a Demoness. Their objectives were: Seduce the Baron. **Success!** / Escape the Fortress. **Failed!**
Ash (Thanati Leader), Wren, Lark were the Thanati. Their objectives were: Kill Corvin. **Success!**
```

Because the bomb ends the game inside the same advance that stamps the
detonation and writes the blast deaths (`db/index.js`), the fireball epilogue
scores the Tribunal's Detonate as Success and any Thanati kill target the blast
took as dead. The blast never scores the cult's bloodbath: its turn is the one
`deathsInOneDay` leaves out.

**The card.** One per party in `PARTIES`, seated or not, under the roster
(`ObjectivesPanel.js`). Two things on it are decisions rather than layout: the
"N of M complete" count is the number the leader's final rite will pay 100 ⬢
per, once that exists; and a card whose party has nobody seated says so, since
`buildAntagonistReveal` will print nothing for it. The page and the card use
the same `membersByParty` the reveal does, so they cannot disagree about who
sits where. Actions are `web/app/(app)/gm/dev/objectiveActions.js`, GM-gated
(§5), each re-validating kind, party, target shape and
eligibility; every one writes an audit row (`objective_added` /
`objective_pinned` / `objective_removed`). After End Game the card warns that
the reveal is already frozen — only a second End Game rebuilds it.

**For the rite to come.** `listObjectives(prisma, { partyKey })` returns a
party's rows described and scored; nothing player-facing reads it yet, on
purpose — Bascinet's plan is a rite that reveals a cult's objectives in play.

**Restart Game** deletes the table (`wipeGameData`, inside the transaction and
after the epilogue snapshot, which must still see the rows). Nothing else needs
to survive: the reveal is on `Game.epilogue`.

## 6. Where the code lives

| File | What |
|---|---|
| `db/lib/threats.js` | The catalog, the parties, the Thanati brief, the name rolls, the button customId prefixes |
| `db/lib/threatSpawn.js` | Accept/decline, tag resolution, the Discord side effects |
| `db/lib/objectiveKinds.js` | The objective kinds, pure — `describeObjective`, `kindsForParty`, `PARTY_DEFAULTS` |
| `db/lib/objectives.js` | Scoring, `listObjectives`, the reveal (`buildAntagonistReveal`, `formatAntagonistLines`), `locationEligible` |
| `db/test/objectives.test.js` | The pure half under `node --test` |
| `web/lib/threats.js` | Client-safe re-export shim (the wizard is a client component) |
| `web/app/(app)/gm/dev/threatActions.js` | `assignThreat`, `offerThreatSpawn`, `cancelThreatSpawn` |
| `web/app/(app)/gm/dev/objectiveActions.js` | `addObjective`, `addStandardObjectives`, `pinObjective`, `removeObjective` |
| `web/app/(app)/gm/dev/threats/ThreatAssignmentsTable.js` | The players table |
| `web/app/(app)/gm/dev/threats/ThreatRosterTable.js` | The seats table + pending offers |
| `web/app/(app)/gm/dev/threats/ObjectivesPanel.js` | The Objectives cards |
| `web/app/(desk)/gm/dev/page.js` | Both sections' data loading and render |
| `bot/src/lib/threatSpawn.js` | The Accept / Decline click |

## 7. Adding a threat

1. Add the entry to `db/lib/threats.js`, alphabetized by `name`.
2. If it is a real seat, add its `seatTagSlug` tag to `docs/tags.yaml` (0-cost,
   `purchasable: false`, like `demoness` and `judge`) and run
   `npm run db:sync-tags`.
3. That is all. Both tables, both buttons and the wizard read the catalog.

The words a seated player reads are the Role's, from `docs/roles.yaml`. Do not
add prose to a catalog entry; write it on the role.

The Thanati are the one party with gameplay of their own beyond the seat — the
THANATI buttons, the hideout, the rites. That is `THANATI.md`, not this file.

**The design doc is `SECRETS.md`** — gitignored, superadmin-only. Rationale, the
real-vs-decoy roster and the round scripts live there. This file stays in the
repo and stays mechanical: it should name no antagonist it does not have to.
