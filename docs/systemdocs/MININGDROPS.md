# The mining drop die

What a day in the seam can turn up on top of its ⬢. Companion to
[`MINING.md`](MINING.md) (the payout this rides on), [`SYNC.md`](SYNC.md) (the
YAML-master mechanics this reuses), [`TAGS.md`](TAGS.md) (the catalog a TAG
drop grants from) and [`CAVING.md`](CAVING.md) (the other "roll a die on an
action, maybe grant a tag" system in the game — see §5 for where the two
diverge on purpose).

Read this before touching `db/lib/miningDrops.js`, `db/lib/syncMiningDrops.js`,
`docs/miningdrops.yaml`, or the `miningDrop` entry in `db/lib/moveEffects.js`.

## 1. The die

Every Mine payout rolls a flat, unweighted 1d6 once, on top of its ⬢. The
other two day-spending buttons never roll at all: **Refine** pays in Squeeze
(`FACTORY.md`) and **Farm** pays in crops (`SOILERY.md`), and neither is
mining.

It fires from exactly one place: the `miningDrop` entry in
`db/lib/moveEffects.js`'s `MOVE_EFFECTS`. The Mine button's own `Action` is
what carries it — `web/app/(app)/character/actions/mine.js` calls
`applyMoveEffects` inside the filing transaction, so the ⬢, the die and the
fatigue step all land at the press together (`MINING.md` §3).

The entry is gated on the Mine button's own marker (`AUTO_MINE_NOTE` in
`gmNotes`), not on "this `Action` has a roll expression". The old test meant
"this was a Labor", and once Labor stopped being a `MoveKind` it stopped
distinguishing anything.

**The face is never shown to the player.** Nothing else on a Move's
"Applied:" line names its own die either — a Gambit's roll is the one
exception, and it's shown at a deliberate reveal moment nothing here needs
(`stagedPush.js`'s `formatGambitRollDm`). The *find* is named, in the line the
button answers with; the number that produced it is not. A `NOTHING` draw or an
unconfigured roll says nothing at all, which is what lets a table be padded
with silence rather than announcing every miss.

### 1a. What the scopes read

There used to be an `Action.laborTier` column here, stamped once at filing and
never recomputed, because six Laboring tiers each drew from their own pool.
Mining is the only kind of day left, so the column went with Laboring and the
question it answered no longer exists.

What is left is `Action.zoneId` and `Action.locationId`, stamped at the press
from where the character is standing. Since the payout resolves in the same
transaction that files the row, there is no window in which a character could
walk somewhere else before the die rolls — which is what the stamped tier was
protecting against.

## 2. Combining scopes

A drop table is never one row. `MiningDropOption` rows are pool *entries*, and
a "table" for one roll is every entry that answers to it across up to **three**
scopes at once, drawn from as one combined pool:

| Scope | Matches when |
|---|---|
| Global | always |
| Zone | the zone the day was worked in |
| Location | the Location the day was worked in |

**Zone and Location never combine into a fourth bucket** — there is no "Zone +
Location" row. A character digging in a zone with no location-specific table
still draws from Global and the zone's own pool at the same die face.
`db/lib/miningDrops.js#scopeFilters` is the one place this is expressed, and
`db/test/miningDrops.test.js` pins its exact output.

There were **six** of these once: a `laborType` dimension naming which of the
six Laboring tiers was working, plus a crossed `laborType + Zone` and
`laborType + Location`. Mining is the only kind of day left, so the pools that
were scoped to Prospecting were promoted into the three above and the rest went
with Laboring. Nothing about the draw itself changed.

**Only a place with a `mining:` coefficient can ever draw at all.** The
`LocationMining` row is the Mine button's gate (`MINING.md` §2), so a bucket
naming a zone or Location nobody can dig in is dead config — it parses, it
syncs, and no roll will ever reach it.

The combined pool is drawn from in **two stages**, the shape
`db/lib/cavingLoot.js` has always had: land on a **rarity band** by the die
face's column, then pick evenly among that band's members.
`db/lib/miningdropsRarity.js` owns the columns and the arithmetic.

Every find carries a rarity — `ultracommon`, `common`, `uncommon`, `rare`,
`extremely-rare`, `nearly-impossible`, the same six names caving uses, though
not the same numbers. Two structural bands sit outside the ladder: `nothing`
(the pool missed) and `resources` (a ⬢ delta, which is not an item and has no
business competing on a rarity scale).

**Rarity is absolute.** A `rare` entry is worth its band's share whatever else
happens to be authored beside it. The bands nobody authored hand their share
to the commonest *tier* present — never to `resources`, which would otherwise
become the likeliest outcome of half the table. That is what stops one bucket
diluting another: adding a local table no longer steals probability from the
global one.

This replaced **repeat-to-weight**, where an entry's odds came from how many
times it had been copy-pasted. That cost three things: nothing could be rarer
than 1/poolsize (a 0.1% find needed ~150 duplicate lines), every bucket had to
carry its own `nothing` pad or stacking raised the wound rate, and 87 of the
file's 180 lines were duplicates. A repeated entry is now simply a mistake and
the sync refuses it.

### 2a. The fourth gate: `requiredTag`

The three scopes above answer "where" — a **fourth**, fully orthogonal
dimension answers "held by whom". A `MiningDropOption` row may carry
`requiredTagId`: null (the overwhelming common case) means every character;
set, the row only joins the combined pool for a character who holds that tag
too. Eagle Eyes is the one user today, and nothing player-facing says so — the
skill is meant to be found, not shopped for.

It is deliberately **not** part of the SQL `WHERE` `scopeFilters` builds.
"Does the drawing character hold tag X" cannot be expressed against a query
keyed on their zone and location alone, so `db/lib/miningDrops.js` fetches
every row the three scopes already matched and **post-filters** in application
code — `passesRequiredTag(row, heldTagIds)`, pure and unit-tested
(`db/test/miningDrops.test.js`) precisely because it has no database dependency
to fake. `heldTagIds` defaults to an empty set, so a caller that doesn't pass
it — or genuinely holds nothing — sees every gated row excluded rather than
leaking in; there is no "unknown, so allow it" branch anywhere in this path.

`db/lib/moveEffects.js`'s `miningDrop.apply` loads the character's held tags
**fresh, at apply time**, and loads them *before* the roll, because Lucky bends
the die (`db/lib/advantage.js`): two dice, the better one kept.

Authored as a `requiresTag:` key nested under any roll-keyed node — a whole
bucket, or one place inside it — mapping skill slug to another roll-keyed node
of the same shape:

```yaml
zone:
  depths:
    requiresTag:
      eagle-eyes:
        6:
          - { slug: ore-nugget, rarity: extremely-rare }
```

The nesting is a plain recursive parse
(`db/lib/syncMiningDrops.js#rowsFromScopeNode`), so it isn't special-cased to
`zone` — `global.requiresTag.eagle-eyes` (which is where the live one sits) or
a double-gated `requiresTag.a.requiresTag.b` parse the same way with no extra
code. `npm run db:audit-mining-drops -- --holds <skill-slug>` (optionally with
`--zone`/`--location`) previews the enriched combined pool a holder actually
draws from; omit it and the Combined section shows the baseline every other
character gets, which is also exactly what the tool defaults to so a gated
entry can never be mistaken for already-active.

### 2b. Building a table that is actually worth something

Mining's base pay is thin on purpose — 2–8 before the coefficients
(`MINING.md` §3). **This table is what makes up the difference**, which is why
mining's pools use faces 2, 3, 4 and 5 as well as 6, rather than sitting on 1
and 6 the way the old Laboring tables did. A prospector finds something worth
having more often than a hunter found a body, even if any one find is smaller.

Read the number off `npm run db:audit-mining-drops`'s own `⬢ EV/day` line for
the table you're building (§6a), the same way every other table in this file
was tuned — not by hand arithmetic.

Four things are easy to get wrong, all of them consequences of the rarity-band
draw (§2, §7):

- **Removing a worthless entry is a pure gain.** A band's column share is
  fixed, so taking a 0-value junk entry out of a band concentrates that same
  share onto the members left behind. Mining's pools author no `nothing` pad
  outside face 1, so there is no hit-rate cost to pay for it.
- **Adding to a band that already has one strong member splits its share.**
  Check what a band's existing members are worth before adding to it, not just
  what the new item is worth on its own. An empty face is the safest place to
  put fresh content, since there is nothing there yet to dilute.
- **A `requiresTag` entry only helps if it beats the band it joins.** It does
  not sit on top of the pool; it joins whatever band its rarity lands in. An
  early item-only pass at this got it wrong and the skill measurably *hurt* at
  a few places.
- **Never put a gated entry at a rarity nothing else reaches on that face.**
  The leftover from every tier nobody authored flows to the commonest tier
  present, so a lone entry at an early rarity can inherit almost the whole
  face's probability instead of its own column share. One pass put a 51 ⬢ item
  at `common` on face 5 and the average shot to +5.6 ⬢/day from that one slot.
  **The rule that held: use a rarity strictly later, in `TIERS` order
  (`db/lib/miningdropsRarity.js`), than whatever the ungated pools always put
  on that face.** That earlier tier is always live, so it always wins the
  "commonest" tiebreak, and the grant's share is capped at its own column
  percentage.

Two shapes that came out of the same work and are worth keeping. **Many medium
prizes beat a few juggernauts** — six modest finds spread across all six faces
rather than three big ones on three faces gives the same floor and average with
a much thinner spread. And **a genuinely rare place should not scale its EV up
with its rarity.** Keep it in the same band as an ordinary Location; what makes
`depths-chasm` special is what it can find (a flawless gem, steel) at a modest
hit rate, not a bigger number on an ordinary item. A place is special because
of what turns up there, not because it pays better on average.

## 3. Pool entries

Authored in `docs/miningdrops.yaml`, one list per (bucket, roll face). Three
kinds, and the sync tells them apart by the entry's own shape:

```yaml
zone:
  caves:
    3:
      - { slug: cave-fungus, rarity: uncommon }  # a Tag slug -> grants the tag
      - "+2"      # a signed integer -> a ⬢ delta (usually positive; nothing
                  #   stops a bad-table entry going negative)
      - nothing   # the explicit no-result pad, case-insensitive
```

**A find is an object and its rarity is required** — `{ slug, rarity }`, never
a bare slug. That is what replaced repeat-to-weight (§2): an entry's odds come
from a stated word, not from how many times it was pasted. A bare slug gets its
own error message from the sync, because it is the commonest way this file gets
edited wrong. `nothing` and a `"+N"` delta are not items and take no rarity;
the sync refuses one on either.

A **TAG** draw grants through `db/lib/tagWrites.js#addToStack` — the same
primitive every other tag grant in the game uses. A repeat find of a
stackable tag adds to the stack; a repeat find of a non-stackable one is a
no-op grant rather than an error, so authoring the same rare tag into two
different scopes' pools can never throw at draw time. The catalog's own
`defaultDurationTurns` rides along onto the grant, which is what makes a found
wound clear on its own instead of being permanent. A **RESOURCES** draw
credits (or, for a negative entry, debits, floor-clamped) through the same
`addResources` primitive the Gambit ⬢ delta uses. A **NOTHING** draw, or a roll
that matches no configured entry at all, applies nothing and is recorded
nowhere — see §1's note on why the face itself is silent.

## 4. Undo comes for free

A mining drop is just another `MOVE_EFFECTS` entry (`db/lib/moveEffects.js`),
snapshotted onto `Action.appliedEffects` exactly like `resources` and
`exhausted`. That means a GM reverting a Mine Move from `/gm/turns` — the
ordinary Move-undo path, nothing built for this system specifically — already
takes the found tag back or debits the bonus ⬢, with no extra code. There is
no separate "undo this find" button the way `CAVING.md` §4 needed one: Caving
loot is granted outside the Move machinery entirely (a `CavingRoll`, not an
`Action`), so it had to build its own revert; a mining drop rides the revert
this codebase already had.

The flip side: there is **no GM lens** for this system yet, unlike Caving's
(`CAVING.md` §5). A find shows up in the line the button answers with and in
the Move's own `appliedEffects`, but nothing surfaces "everyone who found
something this turn" as its own view.

Printing it on the desk costs **two** edits, not one: `describeMoveEffects`
(`db/lib/moveEffects.js`) is mirrored by hand in `web/lib/moveRows.js#paidLabel`
so the web never imports `db/lib` just to print "+5 ⬢". The first version of
this system taught only the db half, and `/gm/turns` rendered
`miningDrop: [object Object]` for a week. Teach both.

## 5. Why this isn't the Caving Die twice

Two "roll a die on an action, maybe grant something" systems now exist in
this codebase, and they deliberately don't share code, because they answer
different design questions:

- **The Caving Die's table is code** (`db/lib/cavingLoot.js`) — a fixed
  weighted-tier draw nobody expects a GM to retune without a deploy, gated by
  `validateCavingLoot()` at startup. **The mining drop table is data**
  (`docs/miningdrops.yaml`) — the whole point of this system is a GM-editable
  pool with no code change required to reshape it.
- The Caving Die rolls **on arrival** at a Location, with a **1** meaning
  GM-adjudicated trouble that lands unresolved on its own desk lens. The
  mining drop die rolls **on the Mine button**, and every face is either
  silent, a tag, or a ⬢ delta — nothing here is ever left for a GM to narrate.
  A "bad" result is still just a pool entry like any other — a `bruised` on a
  1, never a queued adjudication.
- Caving loot is a **separate row** (`CavingRoll`) outside the Move
  machinery, because a cave arrival isn't a Move at all. A mining drop rides
  on the `Action` the Mine button already files, which is what buys it free
  Undo (§4) at the cost of no dedicated log.

## 6. What is seeded today

`docs/miningdrops.yaml` authors:

- **`global`** on faces 1 and 6, plus its own `requiresTag: eagle-eyes` pool
  covering all six faces (§2a).
- **`zone`** for `hills`, `depths` and `caves` — the three zones that carry
  minable Locations.
- **`location`** for the individual seams inside them, where a place has
  something the rest of its zone does not.

An unconfigured `(bucket, roll)` pair — or a `requiresTag` gate nobody in the
combined draw happens to hold — contributes nothing to any pool; neither is an
error, and both are indistinguishable at draw time from every entry in a
configured pool happening to be `nothing`.

`global.1` is what the Global bucket is *for*: three self-clearing minor
mishaps (`bruised`, `vomiting`, `aching` — a couple of turns, no mechanical
cost beyond the tag) plus one easy find, so one shared pool covers a bad day
anywhere without being copy-pasted into every zone. `global.6` carries `obol` —
the physical form of ⬢ itself (`DEPOT.md`), priced at exactly 1 ⬢ rather than
by a `sellablePrice` it doesn't carry (§6a).

To add to a table: edit `docs/miningdrops.yaml`, run
`npm run db:audit-mining-drops` to see what it's actually worth before
committing to it (§6a), then `npm run db:sync-mining-drops` (or
`npm run db:sync`, which includes it last) to apply it. The sync is
**destructive on every run** — the whole `MiningDropOption` table is deleted
and rebuilt from the YAML, the same posture as `db:sync-documents`
(`SYNC.md` §1) — which is safe here specifically because nothing in the game
ever points *at* one of these rows (no `CharacterTag`, no `Action` foreign
key), so there is no player state a partial upsert would need to protect.

### 6a. Pricing a table before you commit to it

`npm run db:audit-mining-drops` reads `docs/miningdrops.yaml` straight off
disk — no sync needed first — and prints, for every authored bucket and the
combined pool:

- each entry's ⬢ value (a `RESOURCES` entry's own delta; a `TAG` entry's
  `sellablePrice` where it has one, `obol` hardcoded to 1 ⬢ since it IS the
  currency rather than something priced in it; a `TAG` with no `sellablePrice`
  but a `consumesIntoResources` — Purse, Supply Kit — falls back to that
  instead, since that's the ⬢ a player actually realizes, just through the
  other door; a `TAG` with neither, but listed in
  `miningdropsAnnotate.js`'s `ASSUMED_VALUES`, falls back to that stand-in, so
  a table using it can be priced and balanced before the tag is actually made
  sellable in the live catalog. It's a planning number only, never written to
  the tag, and the label says "assumed" to say so);
- the pool's ⬢ **expected value** — the plain average of every entry's ⬢
  value, `nothing` and an unpriced tag both counting as 0;
- the pool's **hit rate** — the share of the pool that isn't `nothing`,
  independent of whether the hit carries a ⬢ price (a granted debuff is a
  hit with 0 ⬢ EV, and the report says so rather than hiding it inside the
  average).

A tag's `pointCost` is printed next to an unpriced entry for reference, but
never summed into the ⬢ EV — it's a different scale (character-build points),
and mixing the two would make the number mean nothing. Pass `--zone <slug>`
and/or `--location <slug>` to preview what a combined pool would look like
at a place with its own scoped bucket, and `--holds <skill-slug>` (comma-
separated for more than one) to also fold in whatever a `requiresTag`-gated
bucket adds for a character who holds it (§2a). Every `requiresTag` entry
still prints in the Authored-pools section regardless of `--holds` — it's
only the Combined section, the "what a real payout draws from" view, that
the flag changes.

### 6b. `--write`: the file annotates itself

`npm run db:audit-mining-drops -- --write` is the one flag that touches the
file. It rewrites `docs/miningdrops.yaml`'s own comments in place — every
pool entry's ⬢ value, every roll's **own** EV (this bucket alone, CONDITIONAL
on landing on that face) *and* **combined** EV (what a real payout in that
exact scope actually pools together on that face, per §2's three buckets and
§2a's fourth gate) — and, on every category header (a place, a skill under
`requiresTag`), a rollup that is **not** those per-face numbers sitting next
to each other.

**The rollup is `⬢ EV/day`: the true, unconditional expected value of one
day's mining in that scope.** The die is 1d6, uniform, so it is `(1/6) *`
the sum of every face's combined EV — and a face nobody configured is a real,
counted **zero** in that sum, not a face left out of it. A pool authored only
at rolls 1 and 6 does NOT average those two numbers together; four of the six
faces produce nothing, and they belong in the denominator. Hit rate in the
rollup is the same kind of number: the share of **all six faces**, not just the
configured ones, that produce something.

That rollup is what "cascading" means concretely: `eagle-eyes:`'s own line is
the real ⬢-per-day a holder nets from Global plus their own gated pool,
combined and properly weighted, without anyone hand-computing it — edit the
pool, run `--write`, read the new number. The terminal report (no `--write`)
prints the same total after the per-face lines, labeled
`-> mining: ⬢ EV/day …`.

It is **text surgery, not a YAML round-trip** (`db/lib/miningdropsAnnotate.js`)
— an indentation-stack walker over the raw lines that only ever replaces a
trailing `# …` on a line it recognizes (a roll key, a category key, a pool
entry). Every other line — every hand-written paragraph, every blank line,
the bucket structure itself — passes through untouched, because nothing
here re-serializes the YAML; it can't reorder a key or reformat a list. This
is a deliberate trade against a generic comment-preserving YAML library: the
file's shape is fully hand-authored and disciplined (2-space indents,
`key:` lines, numeric roll keys, `- entry` lines), so a bespoke walker
tailored to exactly that shape is simpler and safer than a general one.

**A `PostToolUse` hook runs it automatically.**
`.claude/hooks/miningdrops-value-hint.py`, registered in the project's
`.claude/settings.json`, fires on every Edit/Write to this file and runs
`--write` right away — the mechanical numbers are never stale for more than
one edit. What the hook cannot do is judge *why* an entry belongs in a pool,
so it hands that back as a reminder instead:

**Convention for a pool entry's comment: blurb first, then ` — `, then the
mechanical value.**

```yaml
- { slug: sprained-ankle, rarity: common }  # the ground here doesn't forgive a bad step — not sellable
```

Write the blurb yourself when you add an entry — `db/lib/miningdropsAnnotate.js`
never invents one. On every later `--write`, `splitBlurb()` preserves
whatever sits before ` — ` and only regenerates what comes after; a bare
comment that already equals today's mechanical value (no blurb ever
written, or the tool's own prior output) is left alone rather than wrapped
into a fake blurb, which is what stops a plain refresh from ever duplicating
itself into `sells 4 ⬢ — sells 4 ⬢`.

## 7. Missing on face 1

**The pads are gone.** Every roll-1 bucket used to carry its own `nothing`
entries, deepening as buckets stacked — `global` 30%, a labor type 40%, every
zone and cross bucket 50% — because the draw was uniform over the concatenation
and the pooled no-wound rate was the size-weighted average of whatever happened
to be stacked. That made "add a wound and you must add pad with it" a real
rule, and forgetting it quietly raised the wound rate everywhere the bucket
applied. 53 of the file's 180 entries were pad.

How often a roll misses is now **one number in the face's column**
(`db/lib/miningdropsRarity.js`): 45% on a 1, 15% on a 6, never on 2 through 5.
A pool says `nothing` once to opt in, or leaves it out to say a roll here
always lands. The sync refuses a second one.

The trade, made deliberately: **a zone can no longer be more dangerous than
another by missing less often.** What distinguishes them is *which* wound they
deal — the Depths reach for a deep wound, the Hills for a sprained ankle.
Severity carries the danger now, not frequency. Standing somewhere dangerous no
longer changes how *often* a 1 bites, only how hard.

Every wound carries the catalog's `durationTurns` onto the grant, so these all
clear on their own — see `miningDrop.apply`'s own comment for why that has to
be stamped at grant time rather than read back from the catalog.

## 8. Where the code lives

| Concern | File |
|---|---|
| The config table, and its two enums | `db/prisma/schema.prisma` (`MiningDropOption`, `MiningDropKind`, `MiningDropRarity`) |
| The rarity columns, one per die face | `db/lib/miningdropsRarity.js` |
| Reading a combined pool and drawing from it | `db/lib/miningDrops.js` |
| The die roll, the grant/credit, and Undo | `db/lib/moveEffects.js`'s `miningDrop` entry |
| The Move the die rides on | `web/app/(app)/character/actions/mine.js` |
| The YAML master | `docs/miningdrops.yaml` |
| The sync | `db/lib/syncMiningDrops.js`, `db/scripts/sync/sync-mining-drops.js` |
| Pricing a table, and `--write`ing its own comments | `db/scripts/ops/audit-mining-drops.js`, `db/lib/miningdropsAnnotate.js`, `db/lib/miningdropsEv.js` |
| The auto-refresh hook | `.claude/hooks/miningdrops-value-hint.py` |
| Combine-scope tests | `db/test/miningDrops.test.js` |
| Cascading-EV / annotator tests | `db/test/miningdropsAnnotate.test.js` |
