# The labor drop die

What a Labor payout can find, on top of its ⬢. Companion to `LABORING.md`
(the payout this rides on), `SYNC.md` (the YAML-master mechanics this reuses),
`TAGS.md` (the catalog a TAG drop grants from) and `CAVING.md` (the other
"roll a die on an action, maybe grant a tag" system in the game — see §5 for
where the two diverge on purpose).

Read this before touching `db/lib/miningDrops.js`, `db/lib/syncMiningDrops.js`,
`docs/miningdrops.yaml`, or the `miningDrop` entry in `db/lib/moveEffects.js`.

## 1. The die

Every Labor payout that actually resolves to a real tier — `basic`,
`skilled`, `hunting`, `farming` or `fishing` — rolls a flat, unweighted 1d6
once, on top of its ⬢. **A refining Labor (the Godard Factory floor) never
rolls at all**; it pays in Squeeze, not the die (`FACTORY.md`).

It fires from exactly one place: the `miningDrop` entry in
`db/lib/moveEffects.js`'s `MOVE_EFFECTS`, which every Labor payout already
runs through — the auto-labor pass (`db/lib/autoLaborPass.js`) and a
hand-filed Labor's turn-close payout (`db/lib/stagedPush.js`) both call
`applyMoveEffects` on the same `Action` row, so there is exactly one code path
and neither payout route can forget to roll.

**The face is never shown to the player.** Nothing else on a Move's
"Applied:" line names its own die either — a Gambit's roll is the one
exception, and it's shown at a deliberate reveal moment nothing here needs
(`stagedPush.js`'s `formatGambitRollDm`). A find or a bonus speaks for itself
in the DM; a `NOTHING` draw or an unconfigured roll says nothing at all,
which is what lets a table be padded with silence rather than announcing
every miss.

### 1a. Which tier the roll answers to

`Action.laborTier` — stamped once, either at filing (`db/lib/moves.js`, a
hand-filed Labor) or at auto-labor creation (`db/lib/autoLaborPass.js`) — is
the source, **never recomputed** at turn close. A free zone move can carry a
character somewhere else before a hand-filed Labor's payout runs
(`Action.locationId`'s own comment in `schema.prisma` is the same hazard,
predating this system); re-deriving the tier from wherever the character
happens to be standing when the die finally rolls would answer a different
question than the one that was actually priced. A row filed before this
column existed reads `null` and simply rolls no drop — same as any Labor
whose face lands on an unconfigured pool.

## 2. Combining scopes

A drop table is never one row. `MiningDropOption` rows are pool *entries*, and
a "table" for one roll is every entry that answers to it across up to **six**
scopes at once, drawn from as one combined pool:

| Scope | Matches when |
|---|---|
| Global | always |
| Labor type | the winning tier |
| Zone | the zone the Labor was filed in |
| Labor type + Zone | both at once |
| Location | the Location the Labor was filed in |
| Labor type + Location | both at once |

**Zone and Location never combine with each other** — there is no seventh
"Labor type + Zone + Location" bucket, and no plain "Zone + Location" one.
Farming in a zone with no location-specific table still draws from Global,
`laborType: farming`, and the zone's own pool, all at the same die face —
`db/lib/miningDrops.js#scopeFilters` is the one place this is expressed, and
`db/test/miningDrops.test.js` pins its exact output.

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
global one, which is why the obol is now a real chance for a cave fisher
instead of a 1-in-23.

This replaced **repeat-to-weight**, where an entry's odds came from how many
times it had been copy-pasted. That cost three things: nothing could be rarer
than 1/poolsize (a 0.1% find needed ~150 duplicate lines), every bucket had to
carry its own `nothing` pad or stacking raised the wound rate, and 87 of the
file's 180 lines were duplicates. A repeated entry is now simply a mistake and
the sync refuses it.

### 2a. The seventh gate: `requiredTag`

The six scopes above answer "where, and doing what" — a **seventh**, fully
orthogonal dimension answers "held by whom". A `MiningDropOption` row may
carry `requiredTagId`: null (the overwhelming common case) means every
character; set, the row only joins the combined pool for a character who
holds that tag too. Forester-in-the-Forest is the first user: a `forester`
skill whose own catalog line — "gaining an advantage in finding food, water,
or shelter" — did nothing at all before this, now backs a bonus pool nested
under `zone.forest`.

It is deliberately **not** part of the SQL `WHERE` `scopeFilters` builds.
"Does the drawing character hold tag X" cannot be expressed against a query
keyed on their zone/location/laborType alone, so `db/lib/miningDrops.js`
fetches every row the six scopes already matched and **post-filters** in
application code — `passesRequiredTag(row, heldTagIds)`, pure and
unit-tested (`db/test/miningDrops.test.js`) precisely because it has no
database dependency to fake. `heldTagIds` defaults to an empty set, so a
caller that doesn't pass it — or genuinely holds nothing — sees every gated
row excluded rather than leaking in; there is no "unknown, so allow it"
branch anywhere in this path.

`db/lib/moveEffects.js`'s `miningDrop.apply` loads the character's held tags
**fresh, at apply time** — the same live-state reasoning §1a gives for
`Action.laborTier`: a skill learned between filing and turn close should
count, the same way the tier itself is never re-derived from a stale
snapshot. It is one extra `characterTag.findMany`, run once per Labor
payout, alongside the query the drop itself already needs.

Authored as a `requiresTag:` key nested under any roll-keyed node — a whole
bucket, or one place/labor-type inside it — mapping skill slug to another
roll-keyed node of the same shape:

```yaml
zone:
  forest:
    requiresTag:
      forester:
        6:
          - rope
          - trail-ration
          - "+1"
```

The nesting is a plain recursive parse (`db/lib/syncMiningDrops.js#rowsFromScopeNode`),
so it isn't special-cased to `zone` — `laborType.hunting.requiresTag.forester`
or even a double-gated `requiresTag.forester.requiresTag.butcher` parse the
same way with no extra code, though nothing seeds those yet. `npm run
db:audit-mining-drops -- --holds <skill-slug>` (optionally with `--zone`/
`--location`) previews the enriched combined pool a holder actually draws
from; omit it and the Combined section shows the baseline every other
character gets, which is also exactly what the tool defaults to so a gated
entry can never be mistaken for already-active.

### 2b. Prospecting's tables lean different

Hunting, Farming and Fishing pay their ⬢ mostly through `laborAccess.js`'s
own range and treat this die as a bonus on top — most of their pools live on
face 1 (a wound, padded) and face 6 (a modest find), with 2-5 usually empty.
Prospecting pays less ⬢ than any of them on purpose
(`db/lib/production.js` — 2-8, the thinnest range in the game): the plan is
for THIS table to make up the difference, so a Prospecting pool needs to be
worth noticeably more than the others', and it should **use faces 3, 4 and 5
too**, not just 6 — a prospector finds something worth having more often
than a hunter finds a body, even if any one find is smaller.

**Target total EV/labor, by the location's own yield coefficient**
(Bascinet, 2026-09-09; raised ~50% on 2026-09-20) — a rule of thumb, not a
formula to hit exactly:

| coefficient | target EV/labor |
|---|---|
| 0.4 | ~6 ⬢ |
| 0.6-0.7 | ~9-10.5 ⬢ |
| 0.8-1.0 | ~12-15 ⬢ |

Read this off `npm run db:audit-mining-drops`'s own combined EV/labor line
for the table you're building (§6a), the same way every other table in this
file was tuned — not by hand arithmetic. Since a Prospecting-specific
`zone:`/`laborType:` bucket doesn't exist yet at most locations, a
`laborTypeLocation` table is currently carrying its whole target alone; once
a zone-wide or labor-type-wide Prospecting pool exists, a location's own
table only needs to make up the remainder.

**The 2026-09-20 pass raised every Prospecting table's own EV/labor by about
50%, entirely through item drops — base pay (`db/lib/production.js`) didn't
move.** The lever that did most of the work, under the rarity-band draw
(§2, §7): a band's column share is FIXED, so removing a 0-value junk entry
(Rock, Bear Trap, a "not sellable" filler sitting next to something real)
concentrates that same share onto the members left behind, which is a pure
gain with no downside — Prospecting's pools never authored a `nothing` pad,
so there's no hit-rate cost to worry about. The trap on the other side: adding
a new entry to a band that already has ONE strong member (Hills/Forest
face 4's Buried Lockbox, alone) SPLITS that member's share and can lower the
band's average — check what a band's existing members are worth before
adding to it, not just what the new item is worth on its own. An empty face
in a bucket (Forest's regional table had no face 6 at all) is the safest
place to add fresh content, since there's nothing there yet to dilute.

**The Prospecting advantage pool (the `requiresTag` pool nested under
`laborType.prospecting`, MININGDROPS.md §2a — it hangs off Eagle Eyes, and
nothing player-facing says so) learned the same lesson the hard way, across
four redesigns.** Its first pass used tag grants only, verified "never hurts"
against the OLD uniform draw — but that property doesn't carry over to the
rarity system: a `requiresTag` entry still just JOINS whatever band its
rarity lands in, so it only helps if it's worth more than that band's
existing members, and at a couple of Forest locations it was worth less and
the pool came out net NEGATIVE. A flat `"+N"` (a RESOURCES entry) fixed the
guarantee — its own untouched `resources` band, immune to dilution — but
traded items for coin, which wasn't the skill's flavor (Bascinet: "use item
drops"). Rebuilding the guarantee with items needs a sharper rule than "pick
an unused rarity": it has to be one that can never become the band the
LEFTOVER (every tier nobody authored) flows to, or one big value in that
slot detonates — an early pass put a 51 ⬢ item at a rarity most locations
had nothing earlier than live, so that rarity inherited almost the FACE's
entire probability instead of its own column share, and the average shot
past +5 ⬢/labor from one slot.

**The rule that held: only use a rarity STRICTLY LATER, in TIERS order
(`db/lib/miningdropsRarity.js`), than whatever the base table's own ungated
entries ALWAYS put on that face.** That earlier tier is always live, so it
always wins the "commonest" tiebreak instead, and the grant's share is
capped at its own column percentage, full stop. `laborType.prospecting`
guarantees a floor at faces 2/4/5/6; the shared `global.1` mishap pool plays
the same role at face 1 (ultracommon, always live everywhere). Face 3 needed
a fix first — nothing reached it globally, so Hills' and Forest's regional
tables (`laborTypeZone.prospecting`) each picked up a small face-3 entry
specifically to give every location a floor there too, closing the last gap
(a location with NOTHING on a face is the "sole occupant" trap: an add-on
there wins the WHOLE face instead of its column's share).

**Bascinet's last ask ("less spiky... use every number 1-6, many medium
prizes instead of juggernauts") is also the shape that held up best.** Six
modest items (14-33 ⬢ each) spread across all six faces, rather than three
big ones (51-60 ⬢) on three — same total floor and average, thinner spread.
One exception worth flagging: face 5's next-safe rarity (`extremely-rare`)
is already crowded with 4-42 ⬢ gear at several locations (a Basement
Lockbox worth 61 ⬢ ASSUMED among them), so that slot is kept smaller than
the other five on purpose rather than sized to match — it can't win the
tiebreak, but a big item there would still dilute the high rollers it joins.

**A genuinely rare spot — the Ore Vein, eventually — should NOT scale EV up
with its rarity.** Keep the EV in the same band as an ordinary location's
target above; what makes it rare is a pool entry (or a few) that exist
NOWHERE else in the catalog — an ore type, a gem, whatever the fiction calls
for — at a modest hit rate, not a bigger number on an ordinary item. A
location is special because of what it can find, not because it pays better
on average.

`laborTypeLocation.prospecting.hills-west` is the first table built this
way: the Forgotten Gallows is a real grave (`docs/zones.yaml`), so its pool
draws on faces 3-6 with two tags minted for it alone (`gallows-charm`,
`burial-ring`) rather than reusing the room's own one-time stash items.

## 3. Pool entries

Authored in `docs/miningdrops.yaml`, one list per (bucket, roll face). Three
kinds, and the sync tells them apart by the string's own shape:

```yaml
laborType:
  hunting:
    6:
      - nightshade-herb   # a Tag slug -> grants the tag
      - "+2"              # a signed integer -> a ⬢ delta (usually positive;
                           #   nothing stops a bad-table entry going negative)
      - nothing            # the explicit no-result pad, case-insensitive
```

A **TAG** draw grants through `db/lib/tagWrites.js#addToStack` — the same
primitive every other tag grant in the game uses. A repeat find of a
stackable tag adds to the stack; a repeat find of a non-stackable one is a
no-op grant rather than an error, so authoring the same rare tag into two
different scopes' pools can never throw at draw time. A **RESOURCES** draw
credits (or, for a negative entry, debits, floor-clamped) through the same
`addResources` primitive `resources` and the Gambit ⬢ delta use. A
**NOTHING** draw, or a roll that matches no configured entry at all, applies
nothing and is recorded nowhere — see §1's note on why the face itself is
silent.

## 4. Undo comes for free

A labor drop is just another `MOVE_EFFECTS` entry (`db/lib/moveEffects.js`),
snapshotted onto `Action.appliedEffects` exactly like `resources` and
`exhausted`. That means a GM reverting a Labor Move from `/gm/turns` — the
ordinary Move-undo path, nothing built for this system specifically — already
takes the found tag back or debits the bonus ⬢, with no extra code. There is
no separate "undo this find" button the way `CAVING.md` §4 needed one: Caving
loot is granted outside the Move machinery entirely (a `CavingRoll`, not an
`Action`), so it had to build its own revert; a labor drop rides the revert
this codebase already had.

The flip side: there is **no GM lens** for this system yet, unlike Caving's
(`CAVING.md` §5). A find shows up in the player's DM and in the Move's own
`appliedEffects`, but nothing surfaces "everyone who found something this
turn" as its own view.

Printing it on the desk costs **two** edits, not one: `describeMoveEffects`
(`db/lib/moveEffects.js`) is mirrored by hand in `web/lib/moveRows.js#paidLabel`
so the web never imports `db/lib` just to print "+5 ⬢". The first version of
this system taught only the db half, and `/gm/turns` rendered
`miningDrop: [object Object]` for a week. Teach both. Worth
building once the table is real and Bascinet wants to watch it; not built
now because there is nothing yet worth watching.

## 5. Why this isn't the Caving Die twice

Two "roll a die on an action, maybe grant something" systems now exist in
this codebase, and they deliberately don't share code, because they answer
different design questions:

- **The Caving Die's table is code** (`db/lib/cavingLoot.js`) — a fixed
  weighted-tier draw nobody expects a GM to retune without a deploy, gated by
  `validateCavingLoot()` at startup. **The labor drop table is data**
  (`docs/miningdrops.yaml`) — Bascinet's own session notes call it out
  explicitly as unfinished and iterative ("we don't have the full loot table
  figured out yet"), and the whole point of this system is a GM-editable
  pool with no code change required to reshape it.
- The Caving Die rolls **on arrival** at a Location, with a **1** meaning
  GM-adjudicated trouble that lands unresolved on its own desk lens. The
  labor drop die rolls **on a Labor payout resolving**, and every face is
  either silent, a tag, or a ⬢ delta — nothing here is ever left for a GM to
  narrate. A "bad" result is still just a pool entry like any other — a
  `bruised` on a 1, never a queued adjudication.
- Caving loot is a **separate row** (`CavingRoll`) outside the Move
  machinery, because a cave arrival isn't a Move at all. A labor drop rides
  on the `Action` a Labor already is, which is what buys it free Undo (§4)
  at the cost of no dedicated log.

## 6. Seeding a table for the first time

`docs/miningdrops.yaml` seeds `laborType.hunting.6`, `laborType.farming.6`,
`laborType.fishing.6`, `global.1`/`global.6`, and one skill-gated bucket,
`zone.forest.requiresTag.forester.6` (§2a). `location`, `laborTypeZone`,
`laborTypeLocation` and both `basic`/`skilled` on their own are still `{}`,
which is a legal, deliberate "not configured yet". An unconfigured
`(bucket, roll)` pair — or a `requiresTag` gate nobody in the combined draw
happens to hold — contributes nothing to any pool; neither is an error, and
both are indistinguishable at draw time from every entry in a configured
pool happening to be `nothing`.

`global.1` is the first real use of the Global bucket, and it's a
demonstration of what Global is *for*: three self-clearing minor mishaps
(`bruised`, `vomiting`, `aching` — 1-2 turns, no mechanical cost beyond the
tag) with no hunting/farming/fishing-specific equivalent in the catalog, so
one shared pool covers a bad roll for every labor type at once — Basic and
Skilled included, which is why `db:audit-mining-drops`'s combined view reports
100% hit rate on their roll-1 even though neither has an authored bucket of
its own. `global.6` is one entry, `obol` — the physical form of ⬢ itself
(`DEPOT.md`), so it is priced at exactly 1 ⬢ rather than by a `sellablePrice`
it doesn't carry (§6a).

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
disk — no sync needed first — and prints, for every authored bucket and
every combined labor-type pool:

- each entry's ⬢ value (a `RESOURCES` entry's own delta; a `TAG` entry's
  `sellablePrice` where it has one, `obol` hardcoded to 1 ⬢ since it IS the
  currency rather than something priced in it; a `TAG` with no `sellablePrice`
  but a `consumesIntoResources` — Purse, Supply Kit — falls back to that
  instead, since that's the ⬢ a player actually realizes, just through the
  other door (2026-09-09); a `TAG` with neither, but listed in
  `miningdropsAnnotate.js`'s `ASSUMED_VALUES` — godflesh at 8 ⬢, and the three
  monster corpses (Skinless/Graga/Nekker) at what Butchering turns them into
  (25/8/5 ⬢) since Butchering is free (CORPSES.md §6: no ⬢, no turn) and
  consumes the body for exactly one of that yield, so the corpse and its
  yield are worth the same thing — falls back to that stand-in instead, so a
  table using it can be priced and balanced before the tag is actually made
  sellable in the live catalog. It's a planning number only, never written
  to the tag, and the label says
  "assumed" to say so (2026-09-10));
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
exact scope actually pools together on that face, per §2's six buckets and
§2a's seventh gate) — and, on every category header (a labor type, a place,
a skill under `requiresTag`), a rollup that is **not** those per-face numbers
sitting next to each other.

**The rollup is `⬢ EV/labor`: the true, unconditional expected value of one
Labor action in that scope.** The die is 1d6, uniform, so it is `(1/6) *`
the sum of every face's combined EV — and a face nobody configured (almost
always 2-5) is a real, counted **zero** in that sum, not a face left out of
it. A pool authored only at rolls 1 and 6 does NOT average those two
numbers together; four of the six faces produce nothing, and they belong in
the denominator. `hills-waterway`'s fishing table is the worked example:
roll 6 alone pools to `EV 2.31 ⬢`, but the actual value of fishing there is
`2.31 / 6 ≈ 0.38 ⬢` per Labor, because five of every six attempts land on a
face (1-5) that gives nothing or (on this table) only the Global roll-1
mishaps. Hit rate in the rollup is the same kind of number: the share of
**all six faces**, not just the configured ones, that produce something.

That rollup is what "cascading" means concretely: `forester:`'s own line is
the real ⬢-per-Labor a Forester nets from Global + Zone + their own gated
pool, combined and properly weighted, without anyone hand-computing it —
edit the pool, run `--write`, read the new number. The terminal report
(no `--write`) prints the same per-tier total after each tier's per-face
lines, labeled `-> <tier>: ⬢ EV/labor ...`.

It is **text surgery, not a YAML round-trip** (`db/lib/miningdropsAnnotate.js`)
— an indentation-stack walker over the raw lines that only ever replaces a
trailing `# ...` on a line it recognizes (a roll key, a category key, a pool
entry). Every other line — every hand-written paragraph, every blank line,
the six-bucket structure itself — passes through untouched, because nothing
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
- minor-bleeding  # a boar's tusk catches you — not sellable
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
entries, deepening as buckets stacked — `global` 30%, `laborType.hunting` 40%,
every zone and cross bucket 50% — because the draw was uniform over the
concatenation and the pooled no-wound rate was the size-weighted average of
whatever happened to be stacked. That made "add a wound and you must add pad
with it" a real rule, and forgetting it quietly raised the wound rate
everywhere the bucket applied. 53 of the file's 180 entries were pad.

How often a roll misses is now **one number in the face's column**
(`db/lib/miningdropsRarity.js`): 45% on a 1, 15% on a 6, never on a 5. A pool
says `nothing` once to opt in, or leaves it out to say a roll here always
lands. The sync refuses a second one.

The trade, made deliberately: **a zone can no longer be more dangerous than
another by missing less often.** The Marshes and the Forest miss equally; what
distinguishes them is *which* wound they deal — the Marshes reach for
`deep-wound` and `grievous-wound`, the Forest for a sprained ankle. Severity
carries the danger now, not frequency.

Where it currently lands, per Labor:

| Situation | No wound on a 1 | Wound | Severe | Grievous |
|---|---|---|---|---|
| Basic/Skilled, quiet zone | 45% | 9.2% | — | — |
| Hunting, Forest | 45% | 9.2% | — | — |
| Hunting, Forest Cliffs | 45% | 7.6% | 1.6% | — |
| Hunting, Marshes / Depths | 45% | 7.4% | 1.6% | 0.2% |
| Hunting, Black Hills | 45% | 7.6% | 1.6% | — |
| Basic labor, Marshes / Depths | 45% | 7.6% | 1.6% | — |

The clean column is **45% everywhere now**, where it used to run 30-42% and
rise with how many buckets you stacked. That is the pads going: the miss rate
is the face's, not an emergent average of whatever was authored. Standing
somewhere dangerous no longer changes how *often* a 1 bites, only how hard.

Every wound carries the catalog's `durationTurns` (2-4) onto the grant, so
these all clear on their own — see `miningDrop.apply`'s own comment for why
that has to be stamped at grant time rather than read back from the catalog.

## 8. The Depths corpse table

`laborTypeZone.hunting.depths` configures faces **5 and 6** with one pool:
three `common` corpses — `skinless-corpse`, `nekker-corpse`, `graga-corpse` —
and an `extremely-rare` `aberrant-heart`. It used to say the same thing by
writing each corpse three times and the heart once; the rarity says it in a
word, and the heart is properly rare now rather than one line in ten.

Zone-scoped rather than repeated across six Locations because
`laborAccess.js#resolveLaborRate` refuses a tier whose location coefficient is
missing or zero, and `depths-crystal-chambers` is the only Depths Location with
no `yield:` block. Hunting is already impossible there, so "zone-wide" and
"every Depths Location with a yield" name the same set.

Face 5 is otherwise unconfigured everywhere, so a 5 draws from this pool alone
— 90% a corpse, 10% the heart. A 6 pools with the global obol and the hunting
table (18 entries), halving it. That asymmetry is deliberate: a 5 in the Depths
is always a body, a 6 is a body or an ordinary find. Per Depths-hunting Labor:
**23.3% a corpse, 2.59% an Aberrant Heart.**

Two things to know about the corpses. They are `sellable: false`, so
`db:audit-mining-drops` scores them at 0 ⬢ and the bucket's EV is really the
heart alone — their worth is butchering (`skinless-brain`, `graga-sac`,
`nekker-pheromones`). And a Graga Corpse is 75 lb against a 71 lb base cap, so
a hunter who draws one walks out Overburdened; the carry pass settles it at
turn close (`TURN-ENGINE.md` §8b), shedding to a Depths room only past the
106 lb hard cap.

## 9. Where the code lives

| Concern | File |
|---|---|
| The config table, and its two enums | `db/prisma/schema.prisma` (`MiningDropOption`, `LaborDropLaborType`, `MiningDropKind`) |
| Reading a combined pool and drawing from it | `db/lib/miningDrops.js` |
| The die roll, the grant/credit, and Undo | `db/lib/moveEffects.js`'s `miningDrop` entry |
| Which tier a roll answers to | `Action.laborTier`, stamped by `db/lib/moves.js` and `db/lib/autoLaborPass.js` |
| The YAML master | `docs/miningdrops.yaml` |
| The sync | `db/lib/syncMiningDrops.js`, `db/scripts/sync/sync-mining-drops.js` |
| Pricing a table, and `--write`ing its own comments | `db/scripts/ops/audit-mining-drops.js`, `db/lib/miningdropsAnnotate.js` |
| The auto-refresh hook | `.claude/hooks/miningdrops-value-hint.py` |
| Combine-scope tests | `db/test/miningDrops.test.js` |
| Cascading-EV / annotator tests | `db/test/miningdropsAnnotate.test.js` |


## 8. Laboring (Scavenging) redraws an empty face

Laboring (Scavenging) (a mastery, `TAGS.md` §4a) redraws on the **6's pool**
when a rolled 4 or 5 finds **an empty one** — `pickMiningDropOption` in
`db/lib/miningDrops.js`, where the pool is already in hand.

The empty-pool test is the rule, not a detail. This shipped first as a blanket
`4/5 → 6` remap, which was written when faces **1 and 6 were the only ones
configured anywhere**. Prospecting (2026-09-19) filled in 2, 4 and 5, and the
blanket remap immediately became a **downgrade**:

| labor type | configured faces | what a blanket remap cost |
|---|---|---|
| hunting | 1, 6 | nothing |
| farming | 6 | nothing |
| fishing | **4** (EV 10 ⬢), 6 (EV 1.56) | traded 10 ⬢ for 1.56 |
| prospecting | **2, 4, 5**, 6 | traded face 5's 8 ⬢ for 6.75 |

Falling back only from a face that would otherwise pay **nothing** gives the
same answer as the old rule everywhere the old rule was right, can never take a
configured payout away, and stays true on its own as the rest of the table gets
built out — no per-face bookkeeping to keep in step.

**A 1 is still left alone.** The tag says a *good* day is never an injury, not
that a bad one stops happening.

Lucky stacks on top and is applied first (`db/lib/advantage.js`): two dice,
better one kept, and only then the fallback.
