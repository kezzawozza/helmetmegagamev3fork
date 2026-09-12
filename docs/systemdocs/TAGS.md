# Tag catalog

How the `Tag`/`TagGroup` catalog is structured, master-sourced, and synced.
Not to be confused with `CharacterTag` (an individual character's *holding*
of a tag). The old `Location.tags` free-text flavor strings went with
Locations themselves; nothing like them exists on a Zone.

## 1. Category -> Group -> Tag

Three levels:

- **Category** — a flat string (`Meta`, `General`, `Skills`, `Status`,
  `Items`, `Assets`, plus the one hidden one, `Demoness`).
  Not its own DB table; `docs/tags.yaml`'s top-level `categories:` list is
  validation-only — `syncTagsFromYaml` rejects any tag/group whose
  `category` isn't in that list. Because a category has no row of its own, a
  **hidden** category isn't a category-level field either: it's a group-level
  `requiredTag` on the one group that category contains (§3a). **Items are the portable
  half and Assets the standing half**: a revolver or a meal you carry and
  hand over, versus a Manor, a House, or a Follower you simply have. There is
  deliberately no third `Companions` category — the property-vs-companion
  split inside Assets is carried by the `assets-property` /
  `assets-companions` groups, which keeps `TRANSFERABLE_CATEGORIES` (Transfer
  Tag's filter, `web/lib/tagRequests.js`) a two-item list.
- **Group** (`TagGroup`) — optional, scoped to exactly one category, exists
  purely to color tags for display (e.g. Status's Health/Food/Buffs/Debuffs
  groups). A tag with no group renders uncolored. `TagGroup.color` is a
  freeform hex string (e.g. `"#6fa8ab"`), rendered directly by
  `web/app/components/ChipLabel.js` (used by `TagChip.js`)
  — not theme-aware, so pick a value that reads on both the dusk and dawn
  backgrounds. Three groups are deliberately **empty**:
  `status-health` (the Health category, §5c, took every tag that used to live
  in it) and `general-restrictions` / `general-interests` (merged into
  `general-personality`, `DESIRES.md` §5). Groups sync upsert-only and are
  never deleted by the sync — `db:prune-tags` will prune one once it's
  absent from `docs/taggroups.yaml` and no surviving tag sits in it, but
  these three stay listed there, so the rows survive; don't reuse those
  slugs and don't put anything back in them.
- **Tag** — the catalog entry itself.

## 2. Master sources: `docs/tags.yaml` and `docs/taggroups.yaml`

`docs/tags.yaml` holds categories and tags; `docs/taggroups.yaml` holds the
`TagGroup` catalog (split into its own file so group colors can be freeform
hex rather than a fixed token set). Same posture as `docs/zones.yaml`:
hand-edited, `slug` is the stable match key across syncs, and syncing is
**upsert-only** — removing an entry from either YAML never deletes its row
by itself, it just stops receiving updates. The separate, opt-in
`npm run db:prune-tags` (§3b) is what actually deletes: it prunes a tag
absent from `docs/tags.yaml`, and once no surviving tag sits in it, a group
absent from `docs/taggroups.yaml`. `db/lib/syncTags.js#syncTagsFromYaml(prisma)`
reads both files and does the sync, run by hand via `npm run db:sync-tags`
(`db/scripts/sync/sync-tags.js`) or automatically at the end of `wipeGameData`'s
"Restart Game" flow (`web/app/(app)/gm/dev/actions.js`), right after
`syncZonesFromYaml` and the special-channels sync.

The sync is five passes, since tags/groups can reference each other by slug
before every row necessarily exists yet: TagGroup scalars, then Tag scalars
+ `groupId`, then `parentTag`/`requiredTag` links, then `TagGroup.requiredTag`
links, then `requirement.skills`. (`consumesInto` is the exception — it is
validated up front against the YAML's own slug set, before any write, so a
typo fails cleanly instead of half-applying.) Each pass only writes a row when something actually changed (a
diff check, same style as the zone sync's hash gate).

### A slug is its name, slugified

`slug` is the name lowercased with punctuation dropped and spaces/colons
turned into hyphens: **Old Ways (Bacchus)** is `old-ways-bacchus`, **True Form:
Serpent** is `true-form-serpent`. `syncTags.js` throws when a tag breaks the
rule, so renaming a tag means renaming its slug in the same pass — and then
every reference to it, since the slug is what desires, taggroups and code
match on. (Names themselves are never referenced that way, with two
exceptions: `roles.yaml`'s `starting_tags` and `documents.yaml`'s `tags` both
resolve tags **by name**.)

The one carve-out is a hidden category (`demoness`), where a
generic power name would collide with a general tag: those may lead with the
category instead, as `demoness-heal` and `demoness-seductive` do.

## 3. Two relations that look similar but aren't


- **`parentTag` (tier chain)** — sequential, replacing. Melee (Basic) ->
  Melee (Trained) -> Melee (Skilled) -> ... Acquiring a tier is meant
  to replace the previous one on the character, not stack alongside it.
  `Laborer (Skilled)` chains off `Laborer (Basic)` the same way.
- **`requiredTag` (prerequisite)** — non-replacing. The character must
  already hold `requiredTag`, but acquiring this tag does **not** remove or
  replace it. Example in the catalog: `Ranged (Archer)` requires
  `Ranged (Basic)` but coexists with `Ranged (Skilled)` — a character can
  hold both at once. Also the right relation for an origin/membership gate the
  gated tag doesn't consume: `Manor` requires `Courtier`, `House`/`Shack`
  require `Ravenhearter`, and
  `Laborer (Farming)` requires `Laborer (Skilled)` — a sidegrade that coexists
  with the tier it builds on.

  One exception: on a **craftable** item, `requiredTag` is a combat/use
  gate, not a workshop gate, and the Add Tag menu's craft route does not
  check it — see §3b.
- **`TagGroup.requiredTag`** — the group-level version of the same
  prerequisite: every tag in that group stays gated behind one required tag,
  so a whole category-of-flavor can be hidden behind a single membership tag
  without repeating `requiredTag` on every tag in it. See §3a.
- **`Tag.exclusive`** — not a relation at all, but the third rule the same
  callers enforce: a character may hold at most **one** tag carrying this
  flag **per tag group**. Set on the nine Beliefs (`general-beliefs`), which
  are a single answer rather than a collection, on the five Addictions
  (`general-addictions`), and on the six courtier wax seals (`items-paper`,
  `PAPERWORK.md` §5) — so a character holds at most one belief, at most one
  Addiction and at most one personal seal, independently.

  The seals are the one case where the flag sits in a group that also holds
  tags **without** it — blank paper, the eight office stamps, and every note
  anybody writes. That is fine and is what "per tag group" means: the rule only
  ever compares two tags that BOTH carry the flag, so nothing else in
  `items-paper` is touched. **Nothing in `general-personality` carries it**:
  the 2026-09-01 merge dropped it from the nine ex-Restrictions on purpose, so
  Pacifist + Craven is now a legal character. That is what makes the merged
  group actually merged — leaving the flag on would have kept "one Restriction
  max" alive inside a group that no longer looks capped. Neither of the two above could express it — a `parentTag` chain
  is priced cumulatively and walks one direction, and `requiredTag` is a
  prerequisite rather than a conflict. The one exemption is a pair joined by
  `requiredTag`, checked in both directions: Fundamentalist declares
  `requiredTag: post-christian`, so the two are one belief taken to its
  extreme. `exclusiveConflict(tag, heldOrSelectedIds, byId)` in
  `web/lib/characterCreation.js` returns the conflicting tag or null, and
  every caller's `select` must include `exclusive`, `groupId` and
  `requiredTagId` or the rule silently stops applying (or, missing `groupId`,
  applies across groups). In `PointBuy` a conflict with another *pick*
  swaps (like a chain sibling); a conflict with something already held is
  dimmed and named. Conversion mid-game is a GM's to make: Destroy is for
  items now (`CRAFTING.md` §5), so a Belief cannot be dropped from the sheet
  and the store's error just names the pair.
- **`Tag.conflictsWith`** — a named pairwise conflict, distinct from
  `exclusive`'s at-most-one-per-group rule: it isn't scoped to a group and
  isn't carved out for a `requiredTag` pair, so it's the right tool for a
  conflict that crosses groups or crosses the belief/drawback line — every
  Addiction lists `conflictsWith: [depressed, prudish]`
  so, say, Alcoholic and Depressed can't stack. Authored one-directional in
  `docs/tags.yaml` and symmetrized by `db:sync-tags` (pass 6, §2), so a
  caller only ever has to check one side; a **custom** GM tag's edge is not
  guaranteed symmetric, which is why `db:prune-tags`'s blocker check reads
  both directions. `conflictingTag(tag, heldOrSelectedIds, byId)` in
  `web/lib/characterCreation.js` is the enforcement predicate, same
  shape/bypass posture as `exclusiveConflict` above — every caller's `select`
  must include `conflictsWith`/`conflictsWithIds`. The one-per-group rule the
  Addiction and Restriction groups themselves enforce (at most one of each)
  is plain `exclusive`, not this field.

  **It is not only for cross-group edges.** Depressed carries the catalog's
  largest conflict list, and almost all of it points *inside* its own
  `general-personality` group, on top of the five Addictions that already point
  at it from their side.

  **The rule is the Desire system, not the group.** Depressed locks the whole
  Desire catalog, so it conflicts with the other tags that *touch* Desires —
  the ones carrying their own `desires:` block (Nobility, Eunuch, Craven,
  Kleptomaniac, Pacifist, Prudish, Devoted Follower) and the ones a Desire
  gates on from `docs/desires.yaml` (Mad Doctor, Esoteric, Adventurer, Cruel,
  Charitable, Death Wish, Schemer, Superstitious, Desperate, Hypochondriac,
  Hot-Headed, Corrupt). A tag that never touches Desires has no quarrel with
  it: Lazy, Insomniac, Guilt Ridden, Torturer, the five phobias, Debtor, Poor
  Swimmer, Motion Sickness and Lightweight all sit beside Depressed quite
  happily. **Adding a Personality tag? It belongs on Depressed's list only if
  it locks or opens Desires** — that test, not a frozen enumeration.

  That list is `conflictsWith` and deliberately **not** `exclusive` on the
  group, even though it is close to a one-per-group rule. `exclusive` compares
  every flagged pair, so setting it would also re-forbid Pacifist + Craven —
  which the 2026-09-01 merge made legal on purpose (see the `Tag.exclusive`
  bullet above). Only a named list can say "this one tag crowds out the
  others" without capping the group.
- **`Tag.excludedRoleSlugs`** — the one gate that ignores what a character
  holds and looks at their **seat** instead. Authored in `docs/tags.yaml` as
  `excludedRoles: [migrant, mercenary, …]`, a list of role slugs from
  `docs/roles.yaml` (validated against that file by `db:sync-tags`, so a typo
  throws rather than quietly opening the gate). Devoted Follower is the first
  and only user: a Migrant, a Mercenary, a Bum, an Outsider or a Pusher has
  nobody to be devoted to. Plain slugs rather than a `Role` relation, because
  `db:sync-roles` rewrites Role rows and the slug is the stable key the rest
  of the codebase already matches seats on (`CURSED_ROLE_SLUGS`).
  `roleExcluded(tag, roleSlug)` is the predicate. Because it never depends on
  the rest of the build, `purchasableTags()` drops the row from the menu
  outright rather than dimming it — so `PointBuy` takes a `roleSlug` prop from
  both mount sites (the creation wizard's chosen role, and the store's
  `storeRoleSlug` threaded down from `/character`). `createCharacter` and the
  store's `buyTags` re-check it. A GM grant bypasses it, like every gate here.

`web/lib/characterCreation.js` is where the logic lives.
`holdsRequirement(requiredTagId, …)` answers "is this one id satisfied by
anything held or selected, at any tier of its chain"; `requirementSatisfied`
calls it for **both** `tag.requiredTagId` and `tag.group.requiredTagId`, and
is the only place the two are combined. `chainOf`/`cumulativeCost`/
`effectiveCost` price a `parentTag` chain as the sum of its hops, and
`chainSiblingsToRemove` collapses a selection down to one member per chain
(the tiers **below** a pick, since `chainOf` only walks upward), and
`heldHigherTiers` is its downward mirror — the held tiers **above** a tag,
i.e. "is this a downgrade". A chain replaces upward and never re-opens
downward: buying or adding a higher tier **deletes the held lower tier in
the same transaction** (the store's `buyTags` and `addTagRequest` both do
this), and every purchase path rejects a tier below one already held. The
removed tier is snapshotted onto the request's `effect.replaced`, so a GM
Undo restores exactly what came off — see `web/lib/tagEffects.js`.

Enforced in these places, all reading those same helpers: `PointBuy.js`
(creation and `/store`), `createActions.js#createCharacter` and
`store/actions.js#buyTags` (the server-side re-checks, since the menu is
advisory), and `web/lib/referenceData.js#getVisibleTags` (§3a). **A GM grant
still ignores both, deliberately** — a GM handing out a tag is the one path
that should never be second-guessed.

The Add Tag picker in `RequestActionsProvider.js` and its server re-check,
`requestActions.js#addTagRequest`, are the **exception** — see §3b, which
covers a different question (can you make this, not can you use it) with a
different predicate.

Every caller must select `group.requiredTagId` alongside `requiredTagId`.
Miss it and a hidden category silently opens for everyone, with nothing to
show that it has.

### `desires:` locks

A fourth field, `Tag.desireLocks` (YAML: `desires: { locks: [...] }`), is
**not** a relation onto another tag at all — it locks parts of the *Desire
catalog* shut for whoever holds it. Full writeup, including the clause
grammar and how several held tags' locks union together: `DESIRES.md` §3.

## 3b. The Craft menu asks a different question

`requirementSatisfied()` answers "can you **use** this" — the right question
for creation and `/store`, where the whole catalog is bought outright. The
Craft menu (Add Tag, renamed and reworked — `CRAFTING.md`) asks "can you
**make** this" instead, and now it actually checks: the recipe's
`requirement.skills` must be held, or a higher tier of one, the same walk Heal
uses (`db/lib/medicalVision.js#satisfiedSkillIds`). This replaced an earlier
honor-system door where the menu asked almost nothing and the pushed request's
GM review was the only enforcement — that version was a deliberate choice at
the time (a smith with no combat skill forging weapons to sell, a fighter
pulling gear from an armoury the fiction gives them, situations no skill check
could see), but it also meant nothing stopped a player who held no relevant
skill at all. The recipe check now runs server-side; the picker's "To make: …"
line still shows the recipe, but it's the gate, not just advice.

The Craft picker and `craftRequest` therefore don't call
`requirementSatisfied`. They call
`addRequirementSatisfied(tag, tagsById, heldTagIds)` in
`web/lib/tagRequests.js`, which is now **one route onto a tag**:

- **Make it** — `craftable`, plus the recipe's `requirement.skills`
  (`CRAFTING.md` §2). The picker's `knownRecipeIds` shows only recipes whose
  skills you hold; `craftRequest` re-derives the same check before writing
  anything. `resourceCost` is charged up front to a payer (yourself, a Room
  stash here, or a person here); `turnsCost` decides Dead Simple / Routine /
  multi-turn `CraftProject`.

There used to be a second route — **buy it**, `purchasable &&
purchasableAfterStart`, gated on the item's own `requiredTagId`. It is gone.
It offered 155 tags (46 Skills, 60 General, 23 Bacchus, 15 Demoness, 10
Assets, 1 Item), every one of them also priced in `/store`, and Add Tag costs
nothing but a written reason — so it was strictly cheaper than paying Tag
Points for the same tag, and the request log showed players taking it that
way. A menu whose own help text has to ask players not to abuse it is a menu
with the wrong contents. Buying is now `/store`'s job alone.

The **group gate still applies, unconditionally** — same as everywhere else,
it's the hidden-category mechanism and is never bypassed. A Demoness
craftable stays invisible outside the category.

`requirementSkills` is an **AND** list, and it is a real gate:
`requireRecipeSkills` (`web/app/(app)/character/requestActions.js`) refuses
the craft unless the maker holds every skill named, or a higher tier of it —
`buildSkillAncestry` means `smithing-skilled` satisfies a `smithing`
requirement.

**There is no OR gate anywhere in the catalog** (`requiredTag` is a single FK,
and this list is an AND), so never author a multi-skill recipe meaning
"either" — this paragraph claimed the reverse until 2026-09-05 and the Dead
Simple rung had been authored to match the wrong claim.

Lazy's `requiredTag: laboring-basic` is how "Laboring OR Commoner" gets
expressed without an OR gate that doesn't exist: `holdsRequirement` walks the
tier chain, and a Commoner starts with Laboring (Skilled), which already sits
above Basic — so the single FK is satisfied by either the bare skill or the
role that starts with a higher rung of it.

A multi-skill recipe is therefore a deliberate conjunction. `barbed-net` is
the one that exists: `[crafting, fundamentalist]`, i.e. only a zealot who can
also work a needle. Note the second entry is not a skill at all — the sync
resolves any tag slug here (`db/lib/syncTags.js`), which is what lets a recipe
require a *belief*.

`isDeadSimple()` (`web/lib/tagRequests.js`) reads the same slugs for the
4-per-turn cap, so callers still select `requirementSkills { name, slug }`.

## 3a. Hidden categories, and gated groups

**Two tags gate an action rather than an item: `bird` and `literate`.** Holding
both puts the Bird on the Actions grid; holding `literate` puts Write and Seal
there (`BIRD.md`, `PAPERWORK.md`). `literate` is also half of
`db/lib/reading.js#readBlock`, which is what any future literacy feature should
call rather than reinvent — the other half is the character's eyes, and a
written thing they cannot read must look the same everywhere in the game. There
used to be a cipher here (`db/lib/gribble.js`); paper replaced it.

One whole category is secret: **Demoness** (behind the `demoness` tag). It
contains exactly one `TagGroup` carrying the `requiredTag`, which is where
the whole mechanism lives — the tags inside deliberately do **not** repeat
`requiredTag`, so the gate is written once. (The Cult of Bacchus used to be
a second hidden category, gated the same way behind `cultist`; it's archived
in `docs/archive/bacchus.yaml`, and the mechanism below applies to any future
hidden category the same way it applied to that one.)

The same field also gates a group **inside a visible category**, which is how
body membership is modelled: `general-cerberon` ("Cerberon", behind `cerberon`)
and `general-brigand` ("Brigands", behind `brigand`) sit in `general`, so the
General tab stays because `general-traits` and `general-social` are ungated —
only the group vanishes. Same rule about not repeating the gate on the members.

Note where the two keys live: `cerberon` and `brigand` are in
`general-traits`, **outside** the groups they open. A gated group cannot hold
its own key — nobody would ever be able to see it. Both are
`purchasable: false` and arrive from `roles.yaml` `starting_tags`, which is
also why the Add Tag picker has to fold held tags into its `byId` map (below).

Three things make a category actually hidden rather than merely empty:

- **The tabs are derived after the filter, not before.** `unlockedTags()`
  runs first and `menuCategories()` reads its output, so a fully-gated
  category has *no tab*. It used to be the other way round, which left a tab
  reading "Nothing available in this category" — an advertisement.
  `unlockedTags` takes a `keepIds` list for the menu's current picks, since
  selecting a tag doesn't satisfy that tag's own requirement and it would
  otherwise vanish under the cursor.
- **The Add Tag picker folds the character's held tags into its `byId` map.**
  The catalog it gets is purchasable-or-craftable only, so the tags that
  *open* a gate (both are `purchasable: false`, GM-assigned) aren't in it —
  without the fold, the chain walk dead-ends and the category stays shut for
  the one person meant to see it.
- **`getVisibleTags` withholds them.** That loader
  (`web/lib/referenceData.js`, streamed through `TagsProvider` from
  `layout.js`) is the app-wide tag catalog `RichText`/`TagChip` read, and
  its `/api/tags` predecessor used to be unauthenticated and complete,
  so the whole Demoness catalog was one DevTools tab away. It resolves
  the caller's own character and drops any tag whose group is gated. Gating
  is on the **group** gate only, never a tag's own `requiredTag`: Ranged
  (Archer) isn't a secret, and hiding it would break `{tag:ranged-archer}`
  in public documents for everyone who hasn't bought it.

## 4. The point economy

`pointCost` is the price in the point-buy menu, and it is **signed**:
positive costs the player points, negative *grants* them (the drawbacks,
Old and Frail at `-5` each). Both directions fall out of one subtraction, so
`remaining >= 0` is one of the three rules for whether a build is legal — the
two drawback ceilings in §4a are the others.

**The display inverts it, and both axes agree.** `formatCost`/`costColor`
(`web/lib/characterCreation.js`) show the effect on the player's *point
pool*, never whether the tag is a good thing to have:

| tag | `pointCost` | shown as | colour |
|---|---|---|---|
| Frail | `-5` | `+5 pts` | `--positive` (pool grows) |
| Melee (Basic) | `7` | `-7 pts` | `--accent` (pool shrinks) |
| Shack | `0` | `0 pts` | `--muted` |

These two functions are the only place that flip lives — every caller
(`TagChip`, `PointBuy`, `RequestActionsProvider`, `CreateCharacterWizard`) passes
the raw signed `pointCost` and lets them decide, so nothing else should ever
negate it. The arithmetic is untouched: `PointBuy`'s affordability check and
`remaining = budget - sum(pointCost)` both still read the raw catalog value.

Before this, the sign was catalog-style while the colour was pool-style, so
Frail read as "`-3`, in green" — two conventions disagreeing on one line.

A character's budget is
`GameConfig.startingTagPoints` (default 12) `+ role.extra_starting_points`
`- 6 if the player is Cursed`, computed by
`web/lib/characterCreation.js#computeBudget`. Anything unspent is kept on
`Character.tagPoints`.

`purchasable` gates whether a tag can ever be bought — role-granted identity
tags (Courtier, Chaplain, Nobility) are `false`, so they arrive with the role
and never through the menu.

`mastery` is the third state those two flags could not express. `purchasable`
says "buyable at all" and `purchasableAfterStart` says "still buyable
mid-game"; neither says **"not yet"**. A mastery tag is refused by character
creation and offered only by `/store`, so it is bought with points earned in
play rather than out of a starting budget — a capstone you grow into instead
of an opening pick. The web draws a **★** beside the name of one, everywhere a
name is drawn (`web/app/components/ChipLabel.js` for the web,
`db/lib/tagDisplayName.js` for Examine and the bot's 🔍 embed).

Two pairings are refused by `db/lib/syncTags.js` outright, because both would
leave a tag quietly unbuyable rather than visibly broken: `mastery` with
`purchasableAfterStart: false` (the store is the only menu left, and it just
shut), and `mastery` with a negative `pointCost` (a drawback you can only take
mid-game is the point farm §4a exists to prevent). The gate itself is one line
in `purchasableTags()` mirroring the `afterStartOnly` line beside it, and
`createActions.js` re-checks it server-side with `mastery: false` in its own
`where` — a hidden option is a hint, not a lock.

The nine mastery tags today are Lucky (15), Manic (13), Metempsychosis (12),
Amor Fati (12), Imperturbable (12), Brewing (Distilling) (14), Laboring
(Scavenging) (12), Laboring (Tireless) (14) and Musician (Pythagorean) (14).
Second Wind reads like one and deliberately is not: it is an ordinary 6-point
tag, buyable at creation like anything else.

`purchasableAfterStart` splits the two menus that share
`web/app/components/PointBuy.js`: character creation offers every
`purchasable` tag, while the mid-game store offers only those still marked
`purchasableAfterStart`. That's what lets a pick like "Secretly an Android"
exist at launch and never afterward. **Every negative-cost tag is
`purchasableAfterStart: false`, and `db/lib/syncTags.js` now throws on one
that is not.** A drawback bought mid-game is a point farm: `REMOVE_TAG` and
`CONSUME_TAG` refund resources but never Tag Points, so buy → shed → buy runs
forever.

Shedding turned out to be only half of it. A drawback pays out the moment it
is bought, and points are the scarce thing — being stuck with Frail afterwards
is a price a player will happily pay for eight points to spend today. So the
store's guard in `web/app/(app)/store/actions.js` refuses **any** negative-cost
tag whatever its flags say, where it used to refuse only one carrying
`removable` or `consumable`. That is the backstop under a GM-authored custom
row, the one place the sync cannot see.

This was prose and nothing else until 2026-09-10, and it had drifted: `Corrupt`
sat at −2 with `purchasableAfterStart: true`, buyable by anyone who opened the
store.

That invariant has three enforcement points. `purchasableTags()` honours it
via `PointBuy`'s `afterStartOnly` prop, which **`/store`** mounts — the
mid-game store is routed (`web/app/(app)/store/`), spends
`Character.tagPoints`, and files each cart as one `BUY_TAGS` request
(`REQUESTS.md`). Its server action `buyTags` re-checks the flag per tag,
rejects a tier at or below one already held (`heldHigherTiers` /
`effectiveCost`), and replaces the held lower tier when a higher one is
bought (§3). It does **not** refuse a negative effective cost: it used to,
and that belt-and-braces line was what made the Addictions unbuyable despite
their flag. A negative cart total is credited rather than debited (the write
guards on `totalPoints !== 0`, not `> 0`). The drawback POINT cap (§4a) is a
creation rule only — `/store` passes no cap at all. `/store` is therefore the
**only** menu `purchasableAfterStart` still governs: the **Craft request**
(Add Tag, renamed), the other mid-game path, no longer reads the flag at all.
`addableTags()` test `craftable` and the recipe's `requirement.skills`
(`craftRequest` server-side re-checks both — §3b), which is why most
craftables being deliberately `purchasableAfterStart: false` (43 of 58 —
meals, tonics, explosives) costs them nothing. They are made rather than
bought, and their `requirement` block is the recipe Craft now enforces, not
just GM-review guidance (§3b). No drawback is craftable, so no drawback can
arrive through Craft.

The two mid-game paths deal in different currencies and coexist on purpose:
the store spends Tag Points against catalog prices with no GM in the loop
until review; Add Tag spends turns, skills and ⬢ against a `requirement`
block. They no longer overlap — a tag with a point price is bought, a tag with
a recipe is made, and nothing is both. Armor and weapons showing up under Add
Tag is the crafting economy, not a store leak.

**The Assets are creation-only.** Horse, Bird, Rat, Kitty Cat, Dog, Manor,
House and Shack are
`purchasableAfterStart: false`, so they leave `/store` as well as Add Tag —
mid-game a horse or a house comes from a GM grant, another player, or the
Depot, not a menu. To keep the "another player" half real, the property
tags (Manor, House, Shack) are `tradeable: true`; the companions and Cart
already were. The Plow joined them when it moved out of Items, so it stopped
weighing on a farmer's back (SMITHING.md §3); the Workshop asset was retired
outright in favour of the Workshop Equipment **item** you have to haul
(SMITHING.md §2a).

**Assets weigh nothing**, which is the mechanical point of the category:
a horse carries itself and a house does not move, so neither belongs in
`carryWeight` (CARRY.md §1). Note what that costs, because `tradeable` is
one flag covering both directions (§5): a house deed can now be lifted off a
corpse. That is the accepted price of being able to hand one over.

Full writeup of creation, roles, and the wizard: `CHARACTERS.md`.

## 4a. The price scale

**This is the canonical scale. Price a new or repriced tag against it, not
against whatever its neighbours in the file happen to cost.** The catalog
drifted for 260 tags precisely because the scale was unwritten, and the
inconsistencies that turned up on the first pass against it — a revolver at 4
points, Starting Wares at 4 while consuming into 7 points of goods — were the
kind that only look wrong once there is something to check them against.

The scale is **absolute across categories**. A 3-point item and a 3-point
skill are meant to matter about equally, so "expensive for an item" is not a
reason to price one at 5.

| `pointCost` | Band |
|---|---|
| 2 | Minor. A small edge, a small possession, a narrow competence. |
| 5 | Moderate. A real capability; one rung of a skill chain. |
| 7 | Significant. Reliably changes how a scene goes. |
| 9 | Good. Three-quarters of the default budget. |
| 11 | Very good. |
| 14 | Character defining. The revolver; Giant. |
| −2 | An inconvenience. |
| −5 | A real cost, situational. |
| −7 | A real cost, most of the time. |
| −9 | Severe. Permanent or near-permanent. |
| −11 | Removes a whole sense or capability, with no realistic cure. |

14 is the ceiling and −11 the floor; nothing should be priced outside them
without a deliberate decision recorded here.

**The mastery band is that decision, made once for a whole class rather than
per tag.** A `mastery` tag (§4) is bought mid-game with points a character
earned, never out of the 12 a build opens with, so the ceiling that keeps one
tag from eating a whole starting budget is not the constraint on it. They are
priced 12–15 and are meant to be (**Smithing (Gunpowder) is the one exception,
at 9** — made `mastery` on 2026-09-10 so no character starts a gunsmith, and
left at its old price because 10 pt of prerequisites already stand in front of
it, `SMITHING.md` §1): a capstone should cost about what a
character's whole first sheet did. Lucky at 15 is the highest price in the
catalog and the deliberate top of this band — it bends every die a character
rolls. Do not read the mastery prices as a new general scale; an ordinary tag
is still priced off the table above. **Pilgrim is the first deliberate
exception, priced at 1** — off the scale entirely, Gunboat's call.
**Instrument is the second, also at 1** — Bascinet's call: it buys no
advantage whatsoever, only the `/play` line, and the Minstrel gets it free
with the role, so pricing it at a full band would have made an object nobody
but a Minstrel would ever own. **Pack
Mule is the other, at 4** — between the 2 and 5 bands, Bascinet's call when
the carry caps landed (`CARRY.md`). **Teaching (Drill Instructor) is a third,
at 3** — between the 2 and 5 bands, Bascinet's own call, the same kind of
deliberate outlier as Pack Mule; don't read a pattern into it. **Fast
Metabolism is a fourth, at −6** — between the −5 and −7 bands, Bascinet's
call; it is the only tag that changes the *size* of the per-turn upkeep rather
than exempting somebody from it (`TURN-ENGINE.md` §2 step 8). **Leper is a
fifth, at −1** — below the −2 band, and the reason is arithmetic rather than
taste: it is the `requiredTag` on the Leper's Hood, which costs 0, so at −2 the
pair would have *paid* a player to take a free hood. **Depressed is a sixth,
at −8** — between the −7 and −9 bands, and the one price on this page set by a
rule rather than a feel: `DESIRES.md` §5 prices a Personality tag by how much
of the Desire catalog it closes against how much it opens, and Depressed
closes everything and opens nothing, so it is that band's floor. **Camouflage is a seventh, at 3** — lowered from 4, Bascinet's call, the same
between-bands spot as Teaching (Drill Instructor). It buys no code: nothing
reads the slug, and "nearly invisible when ambushing in a forested area" is
adjudicated the way Mindreading's Gambit is. Teaching (Lecturing) sits on-scale at 5, the ordinary Moderate band
(`LESSONS.md` §1); **Teaching itself dropped to 4 on 2026-09-10**, Bascinet's
call, the same between-bands spot. **Crafting dropped to 2 the same day** —
back onto the Minor band from Moderate, and on-scale there: it gates the Dead
Simple rung and miscellaneous production, not a rung of the smithing chain
(`SMITHING.md` §1).
**Torturing Equipment is 0** — unpurchasable, like the other kits' `purchasable:
false` rows; what it costs is its recipe (`TORTURE.md` §5), not a price.
**Appraisal is 1** — below the 2-point floor, Bascinet's call: it grants no
advantage in play, only a readout of a number the catalog already held
(`Tag.sellablePrice`), so it doesn't earn a full Minor band. Seven roles
(Merchant, Arbiter, Baron, Docker, Geschef, Banneret, Innkeeper) and two
Courtier kits (Manor Lord, Court Artist) get it free in `starting_tags`.

**The Personality batch of 2026-09-05 sits partly off-band too, again
Bascinet's call rather than a new scale.** Poor Swimmer is −1 (below the −2
band, alongside Leper). Claustrophobia and Guilt Ridden are each
−3 (between −2 and −5). Motion Sickness, Insomniac and Lazy are each −4
(also between −2 and −5). Pyrophobia and Teratophobia sit on-scale at the
ordinary −2 band. Hemophobia and Agoraphobia (2026-09-06) are −4 each,
Bascinet's call, the same off-band spot as Motion Sickness and Insomniac.

**The Tag Redo batch of 2026-09-05 moved a lot of the catalog off-band, and
that is Bascinet's call rather than a new scale.** Fourteen tags now sit
between bands: Adventurer 3, Dagger 3, Death Wish 3, Knuckle Duster 3,
Pickpocket 3, Skeleton Wedge 3 and Nine Lives 3 (between 2 and 5); Brave was 4 here too, but the fear-dial batch of
2026-09-06 moved it to 5 (repriced for its new ×0.5 on every mood harm,
MOOD.md) — it sits on the ordinary 5 band now, so drop it from this
off-band list. Escape Artist 4, Esoteric 4, Lockpicking 4, Pavise 4 and
Camouflage 4 (also between 2 and 5); Light Sleeper and Old Blood at 1 (below
the 2 band, alongside Pilgrim and Instrument). Don't read a pattern into any
of them.

**The combat and traits batch of 2026-09-06 adds seven more off-band calls,
again Bascinet's rather than a new scale.** Steady is 1 (below the 2 band,
alongside Pilgrim, Instrument, Light Sleeper and Old Blood). Ranged (Throwing
Weapons) is 4 and Ranged (Sniper) 7, against a nominal sidegrade price of 10 —
Sniper on the Melee (Flamboyant) precedent, since "at long range" is a real
condition of its own rather than a situational-but-free one. Reckless Attacker
and Monster Hunter are 5 each, both ungated for Guerrilla's reason. Drunken
Master is 5 and gated behind Alcoholic, so it is bought at a −4 discount
nothing else in the group pays. Dense is −3 (between −2 and −5, alongside
Tremor, which is the same magnitude of nuisance). Don't read a pattern into
any of them — and note that the sidegrade band now has four exceptions
(Flamboyant, Sniper, Throwing Weapons, Guerrilla), so "sidegrades cost 10" is
a starting point rather than a rule.

**Corrupt at −2 is the one that argues with this section**, and it is
deliberate. By the income rule below it should be positive: it opens five
Desires and closes nothing, which is the Interest shape. It is priced as a
drawback anyway, on the grounds that being on the take is a real liability to
play.

A `combine: or` on its five Desires was tried as a mitigation the same day and
**reverted**, because it was worse than what it fixed: OR lets a Cerberus or a
Sheriff qualify for all five *without* holding Corrupt, which empties the tag
for the only two seats it is written for and makes its own description false
to them. The AND stands. What the −2 does leave open is a character outside
those seats buying Corrupt once for two points and no unlocks; that is bounded
(once per character, and being a non-item means it can never be sold back)
and is accepted.

**At character creation a build faces TWO ceilings on drawbacks, and it stops
at whichever it reaches first:**

- **`GameConfig.maxDrawbackTags`** — how many drawback tags may be bought.
  **6** by default (widened from 5 on 2026-09-05, to make room for the new
  phobia and habit drawbacks).
- **`GameConfig.maxDrawbackPoints`** — how many points those drawbacks may
  claim back in total, stored as a **positive magnitude**. **13** by default
  (widened from 12 the same day) — one point *above* `startingTagPoints`,
  deliberately: a build carrying six real problems can now buy one point's
  worth more than the starting budget, rather than the old exact symmetry.

Both are live on `/gm/dev`, and `0` is a real setting on either: no drawbacks
at all.

**Neither ceiling works alone, which is the whole reason there are two.** A
count cap by itself spends the same slot on a −1 and on a −11, so five
drawbacks are worth −5 to one player and −43 to another — the cap reads as an
instruction to stack the heaviest tags in the catalog, and the player taking
five small human flaws is simply playing it wrong. A point cap by itself is
the mirror problem: one Appendicitis finishes you, while ten −1s are never
stopped by anything. The game shipped each in turn — `maxNegativeTags`
(points, retired 2026-08-31) then `maxDrawbackTags` (count) — before landing
on both. Together they say the thing that was meant all along: a character
may have a handful of problems, worth only so much trouble in total.

Only what was bought through the point-buy menu counts against either
(`CharacterTag.source === "POINT_BUY"`): a role's free drawback (the Meister's
Frail, the Headman's Old) arrives as `GM_GRANT`, and so does anything a GM or
a turn effect inflicts, so neither eats into a player's allowance. A GM grant
can still push someone past both, deliberately — the same bypass every other
gate has (§3).

**The ceilings belong to the wizard and stop existing once play starts.**
`/store` passes neither and shows no drawback readout at all: the one kind of
drawback it can sell (an Addiction) is meant to be sellable, and a limit the
shelf can neither enforce nor move is noise. That is a decision, not an
omission — a character can trade suffering for points mid-game. It is not a
farm, because a drawback the store pays for must be one that can never be
handed back (§4, and the guard in `buyTags`).

They have three surfaces. `PointBuy.js` tracks both live in the build pane
(`negativeCap` / `negativeHeld`, `negativePointCap` / `negativePointsHeld`):
the points half is drawn as a **second budget bar** under the points-remaining
figure, with the tag count as a line beneath it, each going red on its own so
a player can see *which* ceiling they hit rather than being told they hit one.
A drawback that would push the build past either is dimmed exactly as an
unaffordable tag is — the count half blocks once the count is reached, the
points half blocks per tag, since a −2 can still fit where a −7 no longer
does — and, like the budget, the click still goes through so the pane can say
why the build isn't legal. `CreateCharacterWizard` folds both into
`canAdvance` beside `remaining >= 0`. `createCharacter` re-checks both
server-side as separate refusals that each name their own limit, because a
server action is a public endpoint.

`negativeTagCount()` and `negativeTagPoints()` in
`web/lib/characterCreation.js` are the shared predicates. Both read the raw
`pointCost` rather than `effectiveCost`: a drawback never sits in a tier
chain, so there is nothing to discount, and running them through the discount
would only give a future negative-cost chain a quiet way past the ceiling.

**0 is a real price, not a missing one**, and it is the most common value in
the file (142 of 268). Everything unpurchasable — injuries, statuses, meals,
role grants — is 0, and every tag must carry the field explicitly. A tag with
no `pointCost` at all is a bug; `intercom` was the one instance, and that tag
has since been deleted outright along with the channel it opened.

### Rules that follow from the scale

- **Addictions and Personality (`general-addictions`,
  `general-personality`) run their own bands, off the same scale.**
  Addictions a flat −4, Personality −8…+5. The rationale is income-based, not
  severity-based: the price tracks how much of the Desire catalog a tag closes
  against how much it opens. Depressed closes everything and opens nothing, so
  it sits at the floor at −8; Eunuch closes exactly one family and sits at −1.
  Pacifist stays at −2 even though it now opens two Desires of its own, because
  what it opens is narrow and what it forbids is not. An Interest-shaped tag is
  positive because it is pure upside — it widens the catalog with no lock
  attached.

  Addictions are flat rather than a band as of 2026-09-02, when each one
  stopped closing a slice of the whole catalog and started closing exactly one
  thing: the **bottom Desire slot**, to everything outside its own family
  (`DESIRES.md` §3). The old −3…−6 spread priced how much of the catalog each
  shut, and that variable no longer exists — all five now do the same amount of
  damage, so they cost the same.

  **A Personality tag may be negative AND open Desires.** That is the whole
  point of the 2026-09-01 merge that replaced `general-restrictions` and
  `general-interests` with one group; before it, a Restriction was defined as
  a pure dead end. See `DESIRES.md` §5.
- **No drawback is purchasable after start.** Every negative-`pointCost` tag
  carries `purchasableAfterStart: false`, the sync throws on one that does
  not, `/store` refuses any negative-cost tag server-side whatever its flags,
  and fulfilling a Desire is therefore the only mid-game Tag Point faucet.
  This is what closes the buy-a-drawback → get-cured → keep-the-points loop
  at the door (`DESIRES.md` §7).
- **Skill chains are flat 5 per rung and charged cumulatively**
  (`cumulativeCost`, §3). Do not price a rung off-ladder to make a chain
  cheaper; shorten the chain.
- **Melee and Ranged are the one exception — 7 per rung, Legendary at 14.**
  The Combat Update split the old Fighting ladder into two trees,
  `melee-basic..melee-legendary` and `ranged-basic..ranged-legendary`, in the
  `Combat` group. Rungs are still cumulative, so Melee (Legendary) and Ranged
  (Legendary) are each 42 (7+7+7+7+14) — unreachable from a 12-point creation
  budget by design; you climb into it in play. Sidegrades cost 10 (~1.4x a
  rung) and use `requiredTag` on their tree's Basic, so they are *not*
  cumulative and stack with each other and with any rung: Melee (Shield Wall,
  Duelist, Polearms, Swords, Clubs) and Ranged (Archer, Firearms). Melee
  (Flamboyant) is priced at 7, not the usual 10 — the "without armor"
  condition is a real cost of its own, unlike the other sidegrades'
  situational-but-free conditions. Two sidegrades sit outside both
  trees: Grappler (5, standalone — bare hands are not a rung of either tree,
  so it gates on nothing), and Guerrilla (10, standalone and deliberately
  ungated, since a single `requiredTag` can't say "either tree").
- **Combat items ride a fixed six-tier ladder.** Weapons and armor are priced
  from the tier they sit in, not by feel. See
  [`SMITHING.md`](SMITHING.md) for the table.
- **Every negative tag is `purchasableAfterStart: false`.** Restated from §4
  because it is the one invariant the scale can be used to violate: a drawback
  bought mid-game pays out Tag Points, which is a faucet Desires are supposed
  to be alone in. The sync throws on a violation and the store refuses any
  negative-cost tag at the till, so this is enforced twice rather than asked
  for four times.
- **Items and Assets are `purchasableAfterStart: false` too**, without
  exception, and the sync throws on those as well. An object enters play by
  being crafted, found, traded or granted; its route in is `craftable` plus a
  `requirement` block, never points. 18 items violated this before the first
  pass against the scale, and 11 more rows — six wax seals, two hoods, the
  Cerberon Radio System, the Fishing Boat and the Cart — had drifted back open
  by the time the guard was written.
- **Nothing else is creation-only.** A trait, a skill, a belief or a personality
  is buyable in `/store` unless it is one of the two cases above. Eagle Eyes and
  Keen Hearing spent a whole game shut out of it by an authoring slip nobody
  could see, which is what the guards are for: a character who did not take
  sharp eyes at creation could never acquire them.
- **A consumable is worth what it consumes into.** If `consumesInto` grants
  7 points of tags, the container is not a 4-point tag.
- **Health-category `pointCost` is not a wound severity.** It answers "what is
  this worth at character creation" — 0 for almost all of them, since they are
  not purchasable. What the condition costs to *treat* is the `requirement`
  block, priced off the seven-rung cure ladder in §5c, which is a separate
  scale that must not be conflated with this one.
- **A skill's price is not adjusted for how much content gates on it.**
  `crafting` (5) gates 3 items where `smithing` (5) gates 23. Both stay at 5;
  the fix for that imbalance is content, not price. Noted here so the gap
  reads as known rather than accidental.

## 5. Other fields

- `catalog` (`Tag.catalogVisibility`) — who may see this tag in the
  `/documents` Tag Catalog tab. **Required on every tag**, like `pointCost`;
  `db:sync-tags` throws without it. `secret` is cave/antagonist content,
  hidden there from everyone — GMs included; `/gm/dev/tags` stays the
  unfiltered view. `gm` shows to GMs always, and to a player once their
  character relates to it: they hold it, their role's `starting_tags` grant
  it, they hold its group's `requiredTag` key, or — for Depot-priced wares —
  they hold the Merchant's License. `all` is fully public, character or not.
  Read only by `web/lib/tagCatalog.js`; unrelated to `visible` below, which
  is about the in-game 🔍 inspect. Rows the sync never touches (GM-authored
  tags, minted corpses/headstones) default to `GM`, so nothing lands fully
  public by omission.
- `visible` (`Tag.inspectVisibility`) — whether another player who 🔍-reacts
  to this character's proxied messages sees the tag
  (`bot/src/events/messageReactionAdd.js`). **Four states**, and the YAML
  says them in words:

  | `visible:` | Column | Means |
  |---|---|---|
  | `false` (default) | `HIDDEN` | Never seen. |
  | `true` | `ALWAYS` | Seen whether it is equipped or not. |
  | `worn` | `WORN` | Seen **only while `CharacterTag.equipped`**. |
  | `named` | `NAMED` | Seen **only while the subject is under their own name**. |

  **THE RULE, and it is catalog-wide.** `visible: true` means *a stranger
  looking you over would notice*: your body, your face, your gait; your
  clothes and anything large enough that you are visibly hauling it; and a
  reputation already attached to your name in public (Wanted, Knighted). **Never** your appetites, your beliefs, your opinions, your
  skills, or your secrets. Hot-Headed, Pacifist, Alcoholic, Eunuch, every
  Belief and every Skill in the catalog are `false`, and that is not an
  oversight — a temper is a thing you find out about someone, not a thing you
  see. The test that settles most arguments is a neighbour: if an
  identical-severity tag two rows away disagrees with you, one of the two is
  wrong. (Feverish was hidden while Infected and Festering were visible;
  Consumptive was hidden while Persistent Cough was visible; Mute was hidden
  while Silenced and Wired Jaw were visible. All three were the same mistake.)

  Health has its own second rule on top of this one — a medic sees what they
  could treat, whatever `visible` says. See §5c, "Visibility, and the
  doctor's eye": that is why an internal illness can safely be `false`
  without becoming undiagnosable.

  `worn` is the concealable middle: a dagger in a pocket is nobody's
  business, a drawn one is, and a badge left at home is a badge you are not
  displaying. It only means anything on an `equippable` tag, so
  `syncTagsFromYaml` **throws** if it is set without one — the same pairing
  discipline as `concealsIdentity`, and for the same reason. See the
  `equippable` section below for the item-by-item rule of thumb.

  `named` is the reputation case, and **Wanted is the tag it was written
  for**. A bounty is on a *name*, and the tag's own description says so — the
  Cerberon know your **face**. Under `true` it read the same either way, so a
  hooded stranger came back as "an unknown young man" whose kit included
  Wanted, and a man wearing a Disguise Kit's false name was read as Wanted
  under somebody else's name. Both are the hood failing at the one job it has.
  So a `named` tag is dropped from the read whenever the viewer is not seeing
  the real name: under concealment, and under a forced name (Apex Form, the
  Disguise Kit). It behaves exactly like `true` the rest of the time.

  The rule lives in `seenByBystander()` (`db/lib/medicalVision.js`) like the
  other three, and `db/lib/examine.js` is what works out whether the name is
  the subject's own — so **both** branches of the readout, the ordinary one and
  the concealed one, get it, and the camera's `wasConcealedAs` path inherits
  it. `db/test/wantedVisibility.test.js` holds it down. Two things it
  deliberately does **not** touch: torture (breaking a man gets you his real
  name, so the warrant comes with it — `TORTURE.md`), and the Cerberon's
  warrant book (`Check Wanted`, `REQUESTS.md`), which is a *record* and does
  not care who is hooded.

  Knighted is `true` and stays `true` for now — whether a hooded knight should
  still read as Knighted is Bascinet's call, and it is now a one-word change.

  Read it through `seenByBystander()` (`db/lib/medicalVision.js`), never by
  comparing the enum at a call site: both of the bot's embeds route through
  that one predicate so they can't drift on what "visible" means. The column
  was renamed off `visibleOnInspect` on purpose when the third state landed —
  a tri-state under the old name would have been *truthy* for `worn`, so every
  surviving `if (tag.visibleOnInspect)` would have leaked every stowed weapon
  the day the migration ran. Under a new name a missed read site gets
  `undefined` and the tag stays hidden. A vision gate should fail closed.

  Note it is a property of the tag being *seen*. The tag that widens what an
  inspect shows is read off the **inspector** instead: Seductive reveals the
  subject's active Desire, resolved by `db/lib/inspectVision.js`, which also
  accepts the discounted Demoness twin. Like the officer-gated Resources
  field (`FACTIONS.md`), an unseen field is absent rather than placeholdered — a placeholder
  advertises that there is something to go after.
- `exclusive` — at most one such tag per character *per group*. Set on the nine Beliefs;
  see §3 for the rule, the `requiredTag` exemption, and where it is enforced.
- `carryBonus` — **live**: what the tag adds to both carry caps while held, as
  a **signed distance from ×1** (Cart `4`, Pack Mule `0.5`, Giant `0.75`, Frail
  `-0.1`). They **add**, they do not multiply. `null` for the rest of the
  catalog, and `0` is rejected — the honest way to say "none" is to leave the
  key out. A description ending in `{carry:slug}` renders the exact figure from
  the live config, in either direction. `db:sync-tags` rebases every holder
  afterwards so an edited bonus never reads as "your Cart just left". See
  `CARRY.md`.
- `tradeable` — **live**: whether the tag can change hands at all. It is
  also what counts against the item carry cap — every unit of every
  tradeable tag (`CARRY.md` §1). One flag
  covers both directions — handing it to someone standing with you
  (`TRANSFER_TAG`) and lifting it off a corpse or a helpless body
  (`LOOT_CHARACTER`). `web/lib/tagRequests.js#isTradeable` is the single
  reader; the Hand Over menu, the Loot dialog's per-target tag list, and both
  server actions all go through it, so the menu and the gate can't drift.

  It used to be a category test — `["Items", "Assets"]` — from back when the
  field was set on almost nothing. That was wrong in both directions at once.
  It let a corpse be stripped of its **House**, its **Manor** and its
  **Drone**, none of which are things you carry away from a body; and it
  ignored the sixteen Items that already said `tradeable: false`, including the
  Quickened Nerve Braid, which is *grafted into the holder's neck*. The catalog
  had been carrying the right answer for months and nothing read it.

  Office regalia (the Bishop's Mitre, the Sheriff's Badge, the clan banners) is
  deliberately `true`. Prying a badge off the body of the man who held the
  office is exactly the kind of thing the game is for, and because this is one
  flag, that also leaves it giftable — which is how it has always behaved, so
  nothing regressed. Splitting give from take would be a second field and a
  migration; do that only if handing an office over by dropdown turns out to be
  a real problem in play.

  `syncTags.js` **throws** if a tag in `items` or `assets` omits the field.
  It reads as `?? false`, so silence would sync a new sword as unmovable and
  nobody would find out until a player couldn't hand over the thing they had
  just forged. Every other category still defaults to `false` — a skill or an
  injury is not a thing you carry. The same trap exists for GM-made tags on
  `/gm/dev/tags`, where the checkbox defaults off; its label spells out the
  consequence rather than relying on the GM knowing.

  One tag outside Items/Assets sets it: `detonation-charge`, a keg of dynamite
  filed under `general`. The old category test blocked it; it is transferable
  now, which is correct.
- `forcesName` (`Tag.forcedName`) — a name the holder is **forced to wear**.
  Apex Form sets it to `Beast`. While any held tag carries one, the character
  proxies under that name with the letter plaque for its initial, Who's here?
  and 🔍 name them that way, and `/conceal` is refused. See "`forcesName`"
  under `equippable` / `concealsIdentity` below, and `PROXYING.md` §5.
- `sellable` / `sellablePrice` — the seller's half of
  `purchasable`/`purchasableAfterStart`: whether the Merchant's Depot will
  buy this tag off him, and for how many ⬢. Added for the Caves Update
  (`CAVING.md` §6) and inert until the Merchant Update, which built the
  counter that reads it (`DEPOT.md` §4). `syncTags.js` requires the two to
  travel together: `sellable` without a positive `sellablePrice` is an error,
  and so is a price set without `sellable: true`.
- `depotPrice` — the buy side of that counter: what the Depot **charges** him
  for one (`DEPOT.md` §3). Null means the station does not stock the tag,
  which is the case for everything Ravenheart makes itself. It travels with
  nothing else — carrying a price is what puts a ware on the shelf — so
  `syncTags.js` only checks it is positive, and warns without throwing if it
  is at or under the same tag's `sellablePrice`, since buying and selling one
  thing in a loop would print ⬢.
- `stackable` — whether a character can hold more than one at a time. Live
  code reads this; see §5a.
- `defaultDurationTurns` (spelled `durationTurns` in the YAML) — catalog-level "how many turns does this last once
  granted," for tags that auto-expire (e.g. Drained is 3). The actual
  per-instance expiry lives on `CharacterTag.expiresTurn` (an absolute turn
  number, computed from this default at grant time), swept by
  `resolveNeeds()` in `db/index.js` once the closing turn's number reaches
  it. Live code reads this — Hunger (1) and every tonic effect compute their
  `expiresTurn` through `expiryFrom` — so it is no longer catalog-only.

  **N turns means N turns, counting the one it was granted in.** The expiry
  turn is itself a turn the tag is live for, because the sweep runs while that
  turn *closes* — so the arithmetic is `firstLiveTurn + duration - 1`, not
  `+ duration`. It used to be the latter, which quietly gave every timed tag
  an extra turn on the sheet and made a 2-turn tag count down "2 left, 1 left,
  last turn": three states for what the catalog called two turns.

  **Which turn is the first live one depends on when you grant.** Mid-turn
  (a request, a GM grant, a purchase) it is the open turn, which is what
  `expiryFor(tag, openTurn)` assumes. A pass that grants while *closing* a
  turn — Hunger, the wound progression, Exhausted, a stack rerolling its
  clock, the staged push — grants for the turn about to open, so it passes
  `turn.number + 1` to `expiryFrom`. Note the ordering it implies: `resolveNeeds()` sweeps *before*
  the Hunger pass grants, so a still-broke character's Hunger is cleared and
  re-granted rather than colliding with `@@unique([characterId, tagId])`. See
  `REQUESTS.md` §4.

  **Every grant path must stamp `expiresTurn`.** The sweep matches
  `expiresTurn <= turn.number`, and `null` never matches — so a timed tag
  granted without a stamp is *permanent*, no matter what `durationTurns` says
  in the YAML. `db/lib/turnFormat.js#expiryFrom(firstLiveTurn, duration)` —
  and its mid-turn wrapper `expiryFor(tag, openTurn)`, re-exported from
  `web/lib/turnFormat.js` — is the one place that arithmetic lives; use it
  rather than open-coding a turn number plus a duration again. This was a real bug: `grantTag`
  on `/gm/dev` and `addTagRequest` both left it null, so a GM-granted
  Paralyzed sat on the sheet forever while its tooltip advertised "Lasts 1
  turn".

### How a duration is displayed

`web/lib/turnFormat.js#tagDuration(left, defaultDurationTurns)` is the single
source for both the chip badge and the tooltip row, so the two can never
disagree. `left` is `turnsLeft()` for a held `CharacterTag`, and `null` for a
bare catalog reference (a `{tag:…}` in prose has no `CharacterTag` behind it).

| State | Tooltip row | Chip badge |
|---|---|---|
| Held, 2+ turns to run | `2 turns left` | `· 2t` |
| Held, final turn | `Expires this turn` | `· last` |
| Catalog reference | `Lasts 1 turn once granted` | `· 1t` |
| No duration at all | *(row omitted)* | *(none)* |

`turnsLeft()` counts **inclusively** — the open turn is one of the turns left —
so the final turn arrives here as `1` and takes the wording rather than a bare
`1t`. A 2-turn tag therefore shows exactly two states, one per turn: `2 turns
left`, then `Expires this turn`. There is no state that says "1 turn left" and
means "and one more after that".

Two details are deliberate. **"once granted"** is what separates a catalog fact
from a live countdown — without it the same tag read two different ways
depending on how it happened to be granted, which is exactly the confusion this
replaced. And the final turn reads **`last`, never `0t`**: the tag is still
active on that turn, so a zero contradicted the tooltip beside it.

`formatTagRequirement` spells its turns out (`1 turn`, not `1t`) for the same
reason — an unlabelled `1t` meaning *turns of work to cure* sat in the same
panel as a `1t` meaning *turns remaining*.

Both formatters are hand-duplicated as `db/lib/turnFormat.js` and
`db/lib/formatTagRequirement.js` for the bot's 🔍 inspect embed, the same
convention as `buildNickname`. Change both copies together; don't collapse them
(the web copies must stay dependency-free so client components can import
them).
- `removable` — whether a player can strip this tag off themselves mid-game
  without a GM. Live: it is the whole filter behind the Destroy menu (Remove
  Tag, renamed — `CRAFTING.md`) (`destroyableTags()`, `web/lib/tagRequests.js`)
  and is re-checked by `destroyTagRequest`. The one flag of the four the sync
  DERIVES rather than reads: Destroy is for things you own, so an Items or
  Assets tag has it and nothing else does. Never true on a Health tag — a
  wound is healed, not destroyed; see `healable` below.
- `craftable` — whether this tag represents something a player can
  craft/make, as opposed to one that only ever arrives via role, GM grant,
  or automatic game logic. Live: `addableTags()` offers Craftable tags in the
  Craft menu (Add Tag, renamed), and Craft now enforces the recipe's
  `requirement.skills` server-side rather than leaving them as GM-review
  guidance — see §3b and `CRAFTING.md` §2.
- `healable` — whether the Heal menu offers this tag. Replaced an older
  heuristic (any Health-category tag with a `requirement:` block); the flag
  is what `web/lib/healRequests.js#isHealable` reads now, and it's what's set
  `true` on every health tag with a cure, `false` everywhere else — see §5c.
- `teachable` — whether this tag is a skill Learn Skill / Teach Skill will
  offer. Set `true` on every entry in the `skills` category except the
  Teaching tree itself (Teaching, Lecturing, Drill Instructor are `false` —
  you can't be taught to teach) and Research (also `false` — it arrives only
  through the Scholastic's `starting_tags`, and studying it yourself in the
  Cathedral is the whole point, not something a lesson can hand you), not
  derived from the category; the one rule is
  `db/lib/lessons.js#teachableSkills` (`LESSONS.md` §2).
- `consumable` / `consumesInto` — whether a player can use this tag up, and
  what it becomes. Live; see §5b.
- `expiresInto` — what this tag becomes when its `durationTurns` runs out,
  instead of simply being swept away. Live; see §5c.
- `laborBonus` — what this tag adds to one kind of Laboring, e.g.
  `laborBonus: { kind: hunting, amount: 3 }`. `equipped` defaults **true**;
  `requiresTag` gates it on holding something else (the Plow needs a horse).
  Bonuses sum. The hands cap readied WEAPONS only; accessories are
  uncapped, and the fishing rod and the trapping gear are accessories.
  Normalised and validated in `db/lib/tagShapes.js`, which throws on an
  unknown `kind`, on a bonus that requires equipping a tag that is not
  `equippable`, and on a `requiresTag` naming a tag that does not exist — a
  typo'd `kind` would otherwise make a tool silently worthless. Full rules in
  `LABORING.md` §5.
- `requirementItems` (YAML: `requirement.items`) — the recipe's
  **ingredients**, and the only ones the game has. **Spent by default**:
  `quantity` units come off the crafter's sheet per craft, the same scaling ⬢
  has, and they go when the work *starts* rather than when it finishes. Three
  entry shapes — a tag slug (`items: [cave-fungus]`), a whole **group**
  (`items: [{ group: items-corpse }]`), or a player's pick
  (`items: [{ anyOf: [tea, sweets, honey] }]`). The group form is not a
  convenience but a necessity, since a corpse written at death is never in
  `docs/tags.yaml` for a slug to name — and it is always **kept**, never spent,
  because a group names no single stack to decrement (`keep: false` on one is
  refused). `keep: true` turns a slug entry back into a hold-check. Stored as
  Json rather than a relation, with a denormalized display `label` — and, on an
  `anyOf`, denormalized member `options` — that the sync rewrites every run.
  Validated in `db/lib/tagShapes.js`, which throws on an `items` block on a tag
  that is not `craftable` (the Craft path is the only enforcement point), on
  one paired with `placement:` (a build site has no one sheet to spend from),
  and on a second `anyOf` in one recipe (the dialog posts one choice). Enforced
  against the crafter's **own sheet only**, never a room stash. Full writeup in
  [`CORPSES.md`](CORPSES.md) §8.
- `requirementTurns` / `requirementResources` / `requirementGambit` /
  `requirementPerTurn` / `requirementSkills` (YAML: nested under
  `requirement:` as `turnsCost` / `resourceCost` / `gambit` / `perTurn` /
  `skills`) — what it costs a character to add
  or remove this tag in play (e.g. curing Arthritis needs Medical (Skilled)
  and some turns; forging the revolver tag costs turns, resources, and
  Smithing; the `cart` tag costs turns, resources, and `Builder (Skilled)` —
  there is no "Basic" rung of that family, it starts at Skilled).
  `requirementSkills` is a many-to-many self-relation onto `Tag`
  (multiple skill tags accepted), resolved in `syncTags.js`'s pass 5. This
  is mostly a GM adjudication reference, shown to players, with one
  exception: the Heal request (`HEAL_CHARACTER`, REQUESTS.md §5c) enforces
  the *removal* direction on `Status` tags — `requirementResources` is the ⬢
  it charges and `requirementSkills` is what the medic must hold (any
  equal-or-higher tier up the `parentTag` chain counts). In the *adding*
  direction the Add Tag menu shows the skills as its "To make: …" hint but
  does not enforce them (§3b). Turns, ⬢ and Gambit stay reference-only
  everywhere.
  One shared block covers whichever direction (add or remove) is
  narratively relevant to a given tag, rather than separate blocks per
  direction. Rendered everywhere a tag's description already renders, in a
  minified form, via `formatTagRequirement()` (`db/lib/formatTagRequirement.js`,
  exported from `@lifeweb/db`) — see `TagChip.js` and `PointBuy.js`.
  The one surface that does **not** render it wholesale is the 🔍-inspect
  embed (`bot/src/events/messageReactionAdd.js`), which shows it for
  **Health-category tags only**. The same block reads as a doctor's bill on an
  affliction and as a recipe on everything else, and a bystander glancing at a
  worn sword has no business learning what forging one costs. On the Health
  rows the ⬢ *is* shown; every other visible tag is a bare name plus its
  turns-left badge.

## 5a. Stacks

Meals, ammunition, anything a crafting Move makes in a batch — a character
needs to hold four Fine Meals and hand them out one at a time. `stackable:
true` in `docs/tags.yaml` sets `Tag.stackable`; the count lives on
`CharacterTag.quantity` (default `1`).

**A stack is one row carrying a count, never N rows.**
`@@unique([characterId, tagId])` stays exactly as it was, which is the whole
point: every presence check in the codebase — `specialChannels.js`,
`gambitModifier.js`, `laborAccess.js`, the Mortus nav gate — keeps
reading "holds it or doesn't" with no change, and `restoreCharacterTag`'s
upsert stays valid.

Three functions in `web/lib/tagEffects.js` are the only writers that know
about `quantity`; everything else goes through them:

| | |
|---|---|
| `addToStack(tx, characterId, tagId, n, opts)` | create-or-increment. Pins `n` to 1 unless `opts.stackable`, so a caller that forgot to check can't mint a phantom stack. `opts.stackable` is the catalog flag and nothing else — there is no override. |
| `dropCharacterTag(tx, characterId, tagId, n)` | decrement, deleting the row at 0. `n = null` (the default) drops the whole holding — what an ordinary tag always wants. |
| `restoreCharacterTag(tx, characterId, snapshot)` | undo's inverse. **Increments** on the update branch: `snapshot.quantity` is what the request took away, not what the character should end up holding. |

**Nothing stacks a non-stackable tag, a GM surface included.** A GM ignores
`requiredTag`, the `TagGroup` gate and the budget (§6 below), but not this:
`stackable` describes the shape of the row rather than who may hold what, and
a quantity on a holds-it-or-doesn't flag is just a corrupt row. So the
quantity stepper is rendered **only on a `stackable` tag** — in the Dev Panel
Tags tab and in the turn desk's effect composer alike (`DEV-PANEL.md` §5). On
the Dev Panel's Holds row that stepper sets the **resulting count** rather than
a delta, staged as a `patch quantity`, so taking a stack from seven to three is
one gesture; zero there means the whole holding, converted to a `remove` before
it is sent. Elsewhere the stepper still reads as "how many" —
`mergeTagOp` (`web/lib/tagOpAlgebra.js`) pins a non-stackable `add` back to 1
so repeated clicks can't accumulate either, and `validateTagOps`
(`db/lib/tagOps.js`) refuses `quantity > 1` outright. This used to be
overridable: an op could carry `force: true`, which was derived from whatever
number happened to be in the stepper rather than from any deliberate choice.
That flag is gone.

Stacks made under the old rule may still be sitting in the database; they were
deliberately left alone rather than flattened by a script. Two things to know
about one. A stack on a tag with `expiresInto` is progressed as **one row** by
the untreated-wound pass (`db/lib/tagExpiryPass.js`), since that pass only
reads `stackable: false` rows — the whole stack turns into one successor
together. And `sweepExpiredStacks()` only handles catalog-`stackable` tags, so
such a stack sheds nothing on its own: it sits there until a GM removes it
(Remove takes the whole holding) or its chain fires.

Add Tag, Remove Tag and Transfer Tag all carry a quantity, clamped
server-side to what the sender actually holds, and record it on
`Request.effect` so Undo stays an exact inverse (`REQUESTS.md` §2). A GM's
Revoke button takes one unit off a stack rather than the whole larder.

**Point-buy never stacks.** `PointBuy.js` is a toggle-set with no quantity
anywhere, so a bought tag lands on `quantity`'s default of 1 and a stackable
tag cannot be point-farmed at creation. Stacks are built in play only.

**`stackable` combines safely with `durationTurns`.** It didn't used to —
the sweep deleted whole rows, stack and all — but `sweepExpiredStacks()`
(`db/index.js`) now sheds a single unit per expiry and rerolls the
remainder's timer, deleting the row only when the last unit goes. So three
of a two-turn tag lose one every two turns.

## 5b. Consuming

`consumable` marks a tag a player can **use up** from their own character
sheet, and `consumesInto` (a list of tag *slugs*) is what it turns into. A
meal is `consumable` with `consumesInto: [ate-meal]`; `ate-meal` carries
`durationTurns: 1` and the Hunger pass consumes it — so the whole chain falls
out of machinery that already existed. Nothing here is meal-specific: the one
rule that *is* about meals (a Fine Meal cheers everyone but a noble) is
expressed as catalog data in `docs/tags.yaml`, not as code.

Five rules carry it:

- **Always exactly one unit.** Consuming from a stack of three meals takes
  one, so there is deliberately no quantity field in this path at all.
- **Slugs, not a relation, specifically so a slug may repeat.** Listing one
  twice is the only way to ask for two of something — and that only
  multiplies for a `stackable` target; a non-stackable repeat collapses to
  one, exactly like §5a's rules elsewhere.
- **A granted tag starts its own clock.** `expiresTurn` is computed as
  `turn.number + defaultDurationTurns` at the moment of the grant — the same
  absolute-turn expression every other writer uses — which is what makes
  chains work (meal -> Ate Meal that the sweep then clears).
- **An already-held non-stackable grant is left completely alone**, expiry
  included: the character's existing one is the live truth, and clobbering it
  would silently extend or cut short something they already had. One
  consequence worth knowing: drinking a second Alcohol while already Tipsy
  does *not* extend Tipsy. Undo depends on `added: 0` meaning "this
  request didn't grant it", so a refresh here would need its own snapshot.
- **A grant may be conditional.** A `consumesInto` entry can be an object
  rather than a bare slug, and is then granted only to a character holding
  *none* of its `unlessTags`:

  ```yaml
  consumesInto:
    - ate-meal
    - slug: night-vision
      unlessTags: [blind]
  ```

  `Tag.consumesInto` still stores every target slug in order; the conditions
  live beside it in `Tag.consumesIntoUnless` (`Json`, null for the many tags
  that have none), and `syncTags.js` validates both halves against this file.
  `resolveConsumeGrants()` in `web/lib/consumeGrants.js` applies them. It is
  server-side only: consuming a tag prints nothing about what it grants, so
  there is no preview left to keep honest. **No tag uses this today.** Fine Meal was the only
  one, granting `happy` unless `nobility`, and its condition went with the Mood
  system; the mechanism is kept because it is general.
- **A grant may override the target's expiry.** The same object form takes an
  optional `durationTurns`, which replaces the granted tag's own
  `defaultDurationTurns` for that grant only:

  ```yaml
  consumesInto:
    - euphoric
    - slug: high
      durationTurns: 3
  ```

  This exists because one status can mean different things depending on what
  produced it. Raw Cave Fungus leaves you High for 2 turns; Bliss, which
  is Cave Fungus properly worked, leaves you High for 3. The alternative —
  `high-2` and `high-3` as separate tags — pushes an implementation detail
  into the player-facing catalog and multiplies with every future drink.

  It is stored in a second sidecar, `Tag.consumesIntoDurations` (`Json`,
  `{ "<slug>": N }`, null for almost every tag), resolved by the same
  `resolveConsumeGrants()` and applied by `grantTagSlugs()`, which prefers the
  override and falls back to the tag's own duration. An override on a target
  that has no duration of its own is legal and simply gives it one — but never
  point one at `ate-meal`, which is deliberately never swept because the
  Hunger pass consumes it explicitly.

Consuming applies and writes one `AuditLog` row in the same transaction —
there is no approval step, no reason, and **no Undo** any more (`REQUESTS.md`
§1). What replaced Undo is the Dev Panel: a GM repairs a sheet by hand off
the audit row's own `restore` snapshot, which is why the row records what was
*actually* granted per slug (`added: 0` for a grant that was skipped as
already-held) — a GM can only put back what the row tells them was really
there.

`grantTagSlugs()` (`db/lib/tagWrites.js`, re-exported by
`web/lib/tagEffects.js`) is the single writer, a fourth sibling to the three
stack primitives in §5a.

**This replaced the old `grantsOnExpiry` field**, which did the same
conversion on a timer instead of on demand: letting a player choose *when* to
unpack a crate is strictly better than making them wait a turn.

`expiresInto` (§5c) is **not** that field coming back, and the distinction is
worth holding onto, because "two near-identical tag-becomes-other-tags
mechanisms" was the exact objection that killed the old one. The difference is
who decides. `consumesInto` is an action a player takes and is filed as an
undoable Request; `expiresInto` is what happens *to* them on the clock,
whether or not anyone wanted it, and is the whole reason an untreated wound is
frightening. A crate you open is not a wound that opens you. Both exist
because those are genuinely different things — but a new field that could be
written either way belongs in `consumesInto`, which is the one a player can
see coming and a GM can take back.

**Two more sidecars, added for the Caves Update** (see `CAVING.md` §7 for the
Purse/Supply Kit/Skinned Cave Rat tags that use them):

- **`consumesIntoResources`** (`Int?`) — the Resources half of a grant.
  `Purse` consumes into nothing but 3 ⬢ (`consumesInto: []`); `Supply Kit`
  combines both, 8 ⬢ plus one Alcohol. Applied by `consumeTagRequest` through
  the ordinary `creditResources` primitive, recorded in the audit row's
  `details` for a GM to read back.
- **`consumesIntoOneOf`** (`Json?`) — a parallel array to `consumesInto`,
  same length and order, for an even random pick between alternatives —
  `{ oneOf: [...] }` in `docs/tags.yaml`, the same shape `expiresInto` (§5c)
  already uses. `Skinned Cave Rat` is the first user: 50/50 `ate-meal` or
  `vomiting`. `resolveConsumeGrants()` rolls the real pick in the server
  action, and nothing rolls anywhere else — the player is told neither the
  alternatives nor which one they got.

## 5c. Health, the cure ladder, and `expiresInto`

Health is its own **category**, split out of Status. Status is the
needs/intoxication layer — Hungry, Drained, Tipsy, High, all of it granted and
cleared by machinery — while Health is a system with its own pricing, its own
progression, and its own visibility rule. Seven groups carry it:
`health-wounds`, `health-infection`, `health-illness`, `health-maiming`,
`health-mind`, `health-minor`, `health-recovery`. They split by what **kind**
of medicine an affliction wants, never by how bad it is; severity is carried
by the requirement block instead.

### The cure ladder

Every Health tag is priced off one of eight rungs. **Pick a rung and copy its
block. Do not invent numbers.** The whole point of a ladder is that a player
learns it once and can then read any affliction they meet.

**The `turns` column is a Move fraction now (the medical pass, M2), not a
literal turn count.** `craftMoveCost` (`web/lib/craftBudget.js`, `CRAFTING.md`
§2a) is what actually bills it — a rung's `turnsCost: 0` never touches a
Move at all (it draws on the shared free pool below instead), `1/3`/`1/2`
spend that fraction of the medic's one Routine, and `1` spends the whole
thing. See "The Move economy" below for how that bills and what it replaced.

| Tier | Reads as | ⬢ | turns (Move) | skill | Gambit |
|---|---|---|---|---|---|
| 0 | Untreatable | — | — | — | — |
| 1 | Dead Simple | 1 | 0 | Basic | no |
| 2 | Simple | 2 | 1/4 | Basic | no |
| 3 | Moderate | 2 | 1/3 | Skilled | no |
| 4 | Severe | 4 | 1/3 | Skilled | no |
| 5 | Very minor surgery | 7 | 1/2 | Skilled | no |
| 6 | Severe surgery | 14 | 1 | Expert | no |
| 7 | Complex surgery | 14 | 1 | Expert | yes |

Tiers 5–7 were repriced by the medical pass (M2 — 6→7, 8→9, 8→14) precisely
because a whole Move stopped being what any of them actually cost once the
lower rungs moved onto fractions; the ⬢ went up with the tier's now-relative
weight rather than staying pinned to the old flat 6/8/8. Tier 6 has since
been repriced again, 9→14 and 1/2→1 Move, so it now costs exactly what tier
7 does — see below. Tiers 1 and 3–4 kept their ⬢ and their Move billing
exactly; tier 2 kept its ⬢ but lost its free ride — it now bills a flat 1/4
Move like tiers 3–4's fractions, never touching the pool below.

The ladder now runs in both directions. `HARM_CHARACTER` (`REQUESTS.md` §5b)
puts a Health tag **on** somebody — offered from `isInflictable()`'s curated
list of `health-wounds` / `health-maiming` plus four of `health-mind` — so
every rung you price there is also an injury a player can inflict on someone
already helpless. Treatable is a separate question now: a Health tag is
offered to Heal when `Tag.healable` is `true`, not by category or by the
presence of a `requirement:` block (§5, `isHealable`). A rung priced
carelessly can still be wrong twice, on both surfaces — just remember they're
two different flags now, not one inference.

The ladder is read a third time by the mood dial: a new wound's rung decides
how much it costs the character who takes it, `db/lib/mood.js` reading the
same rungs as the table above (MOOD.md). Pricing a rung carelessly is now
wrong three ways, not two.

**Remove/Destroy no longer cures anything.** Before `healable` existed, the
old Remove Tag door doubled as a rough cure for some conditions — stripping a
tag off yourself with no medic involved. Health is not an Items category, so
nothing in it can be `removable` at all now: something a doctor treats is
`healable`, and healing is the only door.

Four things about it are deliberate.

**The top three rungs are the surgical ones, and they carry the whole
balance.** A Serpent closes an arterial bleed and cuts away dead flesh without
rolling — that is tier 5, and it is all the surgery they get. Anything that
means opening a chest or a belly is Esculap's work at tier 6; a Serpent may
still attempt it, but they roll. Tier 7 is the rung even Esculap rolls for,
which is why it shares tier 6's price: what separates the two is the Gambit,
not the bill. Only twelve tags sit above tier 5, and that scarcity is the point —
Esculap's time should be a thing players negotiate over.

**Realism sets the rung, not severity.** Severity and duration matter, but the
question that decides a tier is *what would it actually take a person to fix
this*. A dislocated shoulder is agonising and completely disabling, and it is
tier 1, because someone who has done it before puts it back in a moment. That
is why the table's left column is written as a description of the *work*
rather than of the injury.

**Tier 0 is a rung, not an omission.** Something realistically untreatable,
quick, and harmless — Vomiting, a Migraine, a Concussion, being Hungover —
gets **no `requirement:` block at all**, and `healable` stays `false`.
`isHealable()` (`web/lib/healRequests.js`) keys off the flag, so a tier-0 tag
never appears in the Heal picker and the action refuses it. This is a design
rule before it is a mechanic: charging a player 2 ⬢ and a doctor's afternoon
to shorten a bout of vomiting is silly, and pretending medicine can do it is
worse.

**Above your tier is still possible, and the Heal request now implements it.**
The requirement names what a character does **as routine**, which is why the
three Medical descriptions are phrased that way. A Serpent (Medical (Skilled))
can attempt the tier-6 surgery a punctured lung needs; they just roll for it,
while Esculap (Medical (Expert)) does not.

Reaching above your tier — or treating a tag whose own `requirementGambit` is
set, which is the whole of what separates tier 7 from tier 6, since they share
a price — files a **GAMBIT Move** instead of curing anything
(`isGambitHeal()`, `web/lib/healRequests.js`). It spends the medic's Move, the
die is rolled at file time, and the **affliction is left on the patient** until
a GM reads the roll on `/gm/turns`: an attempt that has not been resolved
cannot have cured anything, and a failed one is supposed to be able to leave
them worse. The shape is copied from a learner's Lesson Gambit
(`db/lib/lessons.js`), and `Action @@unique([characterId, turnId])` is what
makes it one gambit heal a turn without a second check.

### The Move economy (M2)

A routine cure spends the same Move a craft does — `MEDICAL.md` §3 owns the
full mechanism (the shared `craft` family arithmetic, the ledger, the
`billedSeen` re-check); this is the tag-side summary.

**A 0-turn cure is free, up to a shared daily pool.** Only tier 1 and the
two 0-⬢ named exceptions below (`dislocated-shoulder`, `minor-bleeding`)
still price at `turnsCost: 0` — tier 2 no longer does (below) — and that
rung draws on `MEDICAL_SIMPLE_PER_TURN = 4` (`web/lib/requests.js`) — 4
first-aids a day for a medic of ANY tier, counted per medic (not per
patient) off that turn's `request_heal_character` audit rows. This
replaced the old per-tier daily ration (2 a turn on Basic, 3 on Skilled, 4
on Expert, `MEDICAL_TIER_CAPS` — deleted); the Expert's edge is now what
they can afford on the turns-costing rungs, not a bigger free allowance.
Past the 4th, each additional 0-turn cure spills into the medical family's
Move at **1/4** rather than refusing outright, the same "allowance free,
past it costs the Move" rule Dead Simple crafting uses.

**Everything at tier 2+ bills the Move directly and never touches that
pool** — tier 2 (and its named-exception siblings `frostbite`, `choking`,
`hypothermia`) is a flat 1/4 now rather than drawing on the pool at all, a
1/3 or 1/2 rung spends that fraction of the medic's Routine, and tier 6 or
7 (a full Move, tier 7 always a Gambit) spends the whole thing. The family is hardcoded
`"medical"` on every caller that bills one of these, never derived from
`craftFamily(tag)`'s guess — a skill-less cure like Choking would otherwise
fall into the generic `craft` family and share a Routine with actual
crafting.

**Reaching above your tier — or a cure whose own `requirementGambit` is set,
which is the whole of what separates tier 7 from tier 6 since they share a
price — files a GAMBIT Move** instead of curing anything (`isGambitHeal()`,
`web/lib/healRequests.js`). It spends the medic's Move, the die is rolled at
file time, and the **affliction is left on the patient** until a GM reads
the roll on `/gm/turns`: an attempt that has not been resolved cannot have
cured anything, and a failed one is supposed to be able to leave them worse.
The shape is copied from a learner's Lesson Gambit (`db/lib/lessons.js`), and
`Action @@unique([characterId, turnId])` is what makes it one gambit heal a
turn without a second check.

**Tier 6 and 7 need a surgical site** (M3, the medical mirror of Smithing's
forge rule; reworked M6b): `needsSurgicalSite()` refuses one outright without
a site — Surgical Equipment in reach (held, or already laid out in the room,
`db/lib/equipmentReach.js`), a Surgical Theater structure, or a Portable
Surgical Pack. There is a Theater in the Sanctuary's operating theatre,
seeded from `docs/zones.yaml`; the old "procedures in the Sanctuary
automatically qualify" line was prose that no code ever read, and it is gone.
None of the three is consumed. The pack is the lesser site of the three: a
Gambit takes a **−1** exactly when the pack is the only thing enabling the
site (no Surgical Equipment, no Theater, also in reach) — Surgical Equipment
or a Theater in reach cancels the penalty outright, and neither ever grants a
bonus.

So `requirementResources`, `requirementSkills` and `requirementGambit` are all
enforced now. `requirementTurns` remains reference for the *length* of a
course of treatment, but its zero/non-zero split does real work: it decides
whether a cure draws on the free pool at all, or bills a Move fraction
outright.

### Curing by item, not by medic (M1)

A health tag can also be cured with no medic and no Move involved: an item
carrying `Tag.cures` (a list of health-tag slugs) cures every one of those
its target holds, through Consume rather than Heal — `MEDICAL.md` §1 owns
the mechanism. `Tag.administerable` is the one-item exception (Mercy): it
always succeeds regardless of `cures`, because it stabilizes rather than
naming a fixed list. `Tag.curesInto` is a per-item override
(`{ curedSlug: aftermathSlug }`) for when the item's own aftermath should
differ from the cured tag's ordinary `removesInto` — the four visible
prosthetics use it (Wooden Leg's cure leaves `peg-leg`, not whatever Missing
Leg's own `removesInto` would have said). None of these three fields is
validated against `healable` — a cure item reaching a tag `healable: false`
(Forgiveness → Shell Shocked, which no medic can treat) is deliberate, not a
gap.

`Tag.administerSkill` is a different gate, and it sits on the CURING ITEM,
not the cured tag: the skill required to apply that item to **anyone,
including the actor's own self** (a prosthetic fitting is surgery even on
your own leg). It is the one exception to §5f's "self-consume is never
ACT-gated" — see §5f. `MEDICAL.md` §2 has the full mechanism, including the
flat 1/2 Move fee it bills through the same medical family as above.

### Named exceptions

A handful of Health tags sit off the standard rungs on purpose — priced by
Kata's 8/28 review rather than a copy-pasted block, with `hypothermia`
joining them at M6. They are exceptions to "pick a rung," not new reusable
rungs; don't copy their numbers onto anything else.

- **`minor-bleeding`, `dislocated-shoulder`** — 0 ⬢, 0 turns, Medical
  (Basic). Below tier 1: a bandage or a shoulder pop is real medical
  knowledge, but it costs the doctor nothing to do.
- **`severe-bleeding`, `arterial-bleed`, `parasites`** — 3 ⬢, 1/3 Move,
  Medical (Skilled). Sits between tiers 3 and 4: stopping blood loss is
  urgent but simpler than the rest of what "Severe" covers.
- **`choking`, `hypothermia`** — 2 ⬢, 1/4 Move, no skill. A Heimlich (or
  warming somebody back up) needs no training at all — the ⬢ buys the
  doctor's time, not their expertise. Choking was repriced onto this shape
  by M2 (it used to cost a whole turn); Hypothermia was untreatable at all
  until M6 gave it the identical shape; both now bill the same flat 1/4 Move
  every other rung-2 tag does, never the free pool.
- **`frostbite`** — 2 ⬢, 1/4 Move, Medical (Skilled). Also gained
  `expiresInto: [necrosis]` — it now progresses like an untreated wound
  instead of sitting inert.

### `expiresInto`

An ordinary timed tag is swept away when its `expiresTurn` comes due. One
carrying `expiresInto` turns **into** something else on the way out. This is
the untreated-wound chain, and it is the thing that makes a doctor worth
finding:

```
Infected ──1t──▶ Festering ──1t──▶ Feverish ──1t──▶ Sepsis ──1t──▶ Dying ──1t──▶ dead
                     └────1t────▶ Necrosis ──2t──▶ Missing Leg *or* Missing Arm

Stuffed ──3t──▶ Exploded Chest ──1t──▶ Dying ──1t──▶ dead

Arterial Bleed ──1t──▶ dead        Phrygian Toxin ──1t──▶ dead
Crucified ──1t──▶ dead             Choking ──1t──▶ Dying ──1t──▶ dead
```

Dying is the one *tag* that isn't an `expiresInto` target — nothing follows it
in the catalog. Its `durationTurns: 1` is a countdown that
`db/lib/dyingDeathPass.js` reads at the close (`TURN-ENGINE.md` §2 4b). The
three arrows that point straight at "dead" are the reserved token, below.

Four turns from Infected to Dying, five to dead, and three to a lost limb. It
used to be nine, then six, and one turn is now one real day of somebody's life
— long enough that a doctor in the next zone is a plan, short enough that
ignoring a wound overnight is a decision rather than a rounding error. Note
what the cut does to the two branches: the limb arrives first now, and the
death branch two turns behind it.

**Five wounds feed the chain, and three of them are a coin flip.** `deep-wound`,
`severe-burns` and `grievous-wound` go septic for certain; `burned` splits
`oneOf: [infected, scarred]` and `minor-wound` splits
`oneOf: [infected, recovering]`, so an untreated lesser wound is a gamble rather
than a sentence. `scarred` and `recovering` are ordinary catalog tags doing duty
as the lucky outcome — nothing special marks them as "the good branch."

Closed injuries deliberately have **no** `expiresInto`: a bruise, a sprain, a
dislocated shoulder, cracked ribs, a broken bone or jaw. Note what that means
for their `durationTurns` — with no successor, the duration is how long you
*suffer*, so shortening one makes medicine **easier**, not harder. The two
fields pull in opposite directions and it is worth stopping to check which
kind of tag you are holding before you touch a number.

The second chain is the larva: `stuffed` is tier 5 (very minor surgery — cut
it out while it is small), `exploded-chest` is tier 7 (the rung even Esculap
rolls for) and runs on into Dying the same way Sepsis does. Both sit in
`health-illness`.

The YAML takes a bare slug, several slugs granted together, or an even random
pick:

```yaml
expiresInto: [festering]                    # one
expiresInto: [feverish, necrosis]           # both, at once
expiresInto:
  - oneOf: [missing-leg, missing-arm]       # a coin flip
expiresInto: [dead]                         # this one kills at its own close
```

### `dead`, the reserved token

`dead` is the one entry in a chain that is **not a slug**. There is no such tag
— death is a `Character.status`, not something you hold — and it means *this
wound kills at its own close, with no Dying turn in between*. Three carry it:
**Arterial Bleed**, **Phrygian Toxin** and **Crucified**. Blood spurting three
feet out took two real days to finish somebody while they routed through Dying,
which was one day too many for what the description promises.

**Nothing new kills anyone**, and that is the point of how it is built.
`tagExpiryPass.js` keeps its "only ever grants" invariant: on the token it
grants **Dying stamped for the current turn** (`expiresTurn: turn.number`)
rather than the next one. `dyingDeathPass.js` runs after it in `TURN_PASSES`
and matches `expiresTurn <= turn.number`, so it does the killing in that same
close, and the corpse, the role deletion and the side-effect thunk all come
from the one place they always did.

Four rules, enforced in `db/lib/tagShapes.js`:

- **`expiresInto` only.** `removesInto` rejects it as an unknown tag, because
  curing a wound must never be able to kill.
- **It may be the whole chain, or one side of a `oneOf` coin flip**, but it may
  not ride alongside another entry — entries all land at once, and there is
  nobody left to hold the other one.
- **The grant overwrites an existing Dying clock.** The pass writes these rows
  one at a time instead of through `createMany({ skipDuplicates: true })`: a
  character already on death's door with a later clock would otherwise have the
  fatal row silently dropped and survive the close.
- **Increased Recovery cannot stall it.** `chainReachesDying()` counts the
  token, so Mercy slows the march but never cancels the arrival — the same rule
  a chain into `dying` has always had.

It is deliberately **YAML-only**: the GM tag form's `expiresInto` picker lists
real slugs and does not offer it. A field that kills with no Dying turn in
between should not be one click away in a modal.

Choking keeps its `[dying]` on purpose. It is the one of the four where
somebody hammering your back is a plausible save.

`normalizeExpiresInto` normalises every entry to `{ oneOf: [...] }` — a bare
slug is a pick of one — so the stored `Tag.expiresInto` Json, the pass, and
`TagChip`'s "Becomes" row all handle a single shape. It validates three things
**before writing anything**:

- every slug exists in `docs/tags.yaml`;
- the tag has `durationTurns` ≥ 1, or nothing would ever fire it;
- **a tag may not list itself.** The grant happens one statement before the
  sweep that deletes the expired row, so a self-loop would be re-granted and
  immediately deleted, doing nothing. A recurring condition is written as a
  **two-tag loop** instead: Migraine expires into No Migraine, which expires
  back into Migraine, forever. That cycle is deliberate and there is no
  cycle detection beyond the self check.

Those rules live in `db/lib/tagShapes.js`, not in `syncTags.js`, because the
YAML is no longer the only door: a GM can author an expiry chain from the tag
form too (`DEV-PANEL.md` §8a). Both surfaces call the same
`normalizeExpiresInto` / `validateExpiresInto` pair, so a chain the form
accepts is one the next `db:sync-tags` would accept as well.

`db/lib/tagExpiryPass.js` applies it, inside `resolveNeeds()` and **before**
the sweep — the sweep is a blind `deleteMany`, so afterwards there is nothing
left to read (`TURN-ENGINE.md` §2). The pass grants and never deletes. Four
rules match the ones §5b lists for consuming, for the same reasons:

- **A successor a character already holds is left completely alone**, its own
  clock included (`skipDuplicates`). Re-granting would silently reset a
  condition they were most of the way through. The `dead` token is the one
  exception, and is written outside that batch for exactly this reason.
- **A successor starts its own clock**, `turn.number + defaultDurationTurns`,
  the same absolute-turn expression every other writer uses. A successor with
  no catalog duration is granted permanent — which is what Missing Leg and
  Scarred want. Dying used to be in that list; it now carries
  `durationTurns: 1`, which is a countdown to death rather than to recovery.
- **Nothing can fire twice in one pass.** Every duration is at least 1 and the
  sweep matches `expiresTurn <= turn.number`, so a tag granted while closing
  turn N cannot also expire on turn N. The `dead` token grants Dying *at* turn
  N deliberately, and it is safe for the same reason stated a different way:
  Dying has no `expiresInto`, so there is nothing for it to fire into.
- **A dead character's sheet stops moving.** Their rows still get swept; they
  just don't progress into anything.

**Nothing in the pass kills anyone** — not even a `dead` chain, which only
moves a Dying clock forward by one turn. Every terminal chain still lands on
`dying`, and `dying` carries `durationTurns: 1`: one turn on death's door,
then `db/lib/dyingDeathPass.js` ends it at the next close, automatically
(`TURN-ENGINE.md` §2 4b). What the token changes is only *which* close that
is.

That turn is the whole design, and three wounds are exempt from it on purpose
(the `dead` token above) because their descriptions promise otherwise.
`dying` is visible and carries a tier-7 cure,
so a heroic save is still on the table — a medic with Medical (Expert), a
Gambit, 14 ⬢ and one turn can pull someone back. What went away is the version
where a character sat on death's door indefinitely because no GM had got to
the Kill button. The pass is also careful in one direction: a `dying` row with
a **null** `expiresTurn` is stamped for the next close and its holder warned
rather than killed, so nothing granted before the clock existed dies to a
clock it was never shown. A GM can still end it early by hand
(`web/app/(app)/gm/turns/actions.js`), and can still cancel it entirely by
removing the tag.

### `removesInto`

`expiresInto` is what ignoring a wound costs; `removesInto` is what **curing
one still costs**. A tag carrying it turns into its treated form when it
leaves the sheet through a removal — a Broken Bone treated is a Splinted limb
for four turns, not a clean slate. It fires on five paths, inside each one's
own transaction. Two are player-driven:

- the **Remove Tag** request (`REQUESTS.md`) — self-removal from `/character`;
- the **Heal** request (`HEAL_CHARACTER`) — the aftermath lands on the
  *patient*, and the "treatment didn't take" GM edit takes it back off along
  with restoring the affliction.

Three are a GM taking a tag off a sheet, all through
`applyTagOpsInTx` (`db/lib/tagOps.js`) except the last:

- a **staged `remove`** on `/gm/turns`, applied at the turn close
  (`ADJUDICATION.md`);
- a **Dev Panel** `remove` op, applied on Apply (`DEV-PANEL.md`);
- a **bulk revoke** from `/gm/players` (`bulkTagCharacters`), which rolls the
  chain per character rather than once for the batch, so a `oneOf` doesn't
  hand a hundred people the same coin flip.

A GM removal used to be godmode and skip the chain. It doesn't, because most
GM removals *are* treatments — a staged effect resolving a wound, a revoke
after a scene — and a cure that costs nothing makes medicine pointless. The
one holdout is the bot's `/heal` slash command, which stays godmode: it is the
"put this sheet right" tool, not a treatment.

Expiry doesn't fire it either — that is `expiresInto`'s job, and the two
chains on one tag answer different questions (Deep Wound ignored goes
`infected`; Deep Wound treated goes `stitched-up`).

Same YAML shape as `expiresInto` — a bare slug, several at once, or an
`oneOf:` coin flip — normalised and validated by the same
`db/lib/tagShapes.js` pair on both authoring doors (the sync and the GM tag
form). Two differences: no `durationTurns` requirement, because the removal
fires it rather than any clock, and the self-reference error is its own
("removing it would grant it right back"). How long the aftermath lingers is
the granted tag's **own** `durationTurns` — Splinted's 4, Drained's 3 — or
forever for a permanent one (Scarred, Limp).

The grants go through `grantTagSlugs` (`db/lib/tagWrites.js`, re-exported by
`web/lib/tagEffects.js` — it moved down when the GM paths needed it, since
`db/` cannot import `web/`), so the rules match consuming and the expiry pass:
a successor the character already holds is left completely alone (`added: 0`
in the snapshot), and Undo takes back only what the request really added, off
the `effect.granted` snapshot rather than today's catalog. The `oneOf` picks
are rolled once, up front (`rollTagChain`), so the snapshot records exactly
what happened.

On the GM paths the same `granted` snapshot rides along on the `remove` entry
`applyTagOpsInTx` returns, so it lands in the Dev Panel's audit row and the
staged effect's snapshot. A removal that removed nothing — the character
wasn't holding the tag — grants nothing, so a stale staged op can't mint an
aftermath out of thin air. Those paths have no Undo, which is unchanged.

The `health-recovery` group is where the aftermaths live — its header comment
has said "what good treatment leaves behind" since before anything granted
them mechanically. Which afflictions carry `removesInto` (34 as of the
introduction) is authored in `docs/tags.yaml`; the deliberate *non*-carriers
are the trivial cures (a bruise, a popped shoulder, a Heimlich), where an
aftermath would make cheap medicine pointless. TagChip and the Tag Catalog's
detail sheet both show the chain as a **Treated** row beside **Becomes**.

### Visibility, and the doctor's eye

`visible` on a Health tag is a question about **realism, not severity**: could
a bystander tell? That is the catalog-wide rule in §5, applied here — the
addition is the doctor's eye below. A gaping wound, a missing arm, Paralyzed and Severe Burns
are obvious. Appendicitis, cracked ribs, parasites, chronic pain and Shell
Shocked are not, and are `visible: false`. Only `true` or `false` here —
nobody wears appendicitis, so no Health tag is `equippable` and `worn` never
applies to the category.

That would make the internal cases invisible to the one person who should
notice them, so there is a second rule: **if you could treat it as routine,
you can see it.** `db/lib/medicalVision.js#medicallyVisibleTags` unions the
subject's visible tags with the Health tags the *inspector* is
qualified for, and the 🔍 embed marks the second kind `· your diagnosis` —
because the patient isn't showing it to the room, and a medic who repeats it
as common knowledge has said something nobody else could know.

Routine is doing real work in that sentence. A tag whose cure needs a Gambit
stays hidden **even from an Expert**, since guessing isn't diagnosing; and a
tier-0 tag has no `requirementSkills` at all, so it is nobody's professional
business. The skill-tier walk (`buildSkillAncestry`/`satisfiedSkillIds`) lives
in `db/lib/medicalVision.js` rather than `web/lib/healRequests.js` precisely
so the bot's inspect and the web's Heal request cannot drift on the question
of who is qualified; `healRequests.js` re-exports it.

### Adding a health tag

1. Pick the group by what kind of medicine it wants.
2. Pick a ladder rung by what the work would really take, and copy its block
   verbatim. Tier 0 means no `requirement:` at all, and `healable: false`.
   Any rung above 0 gets `healable: true`. Nothing in Health needs a
   `removable` line — a Health tag never gets one; it is cured, not
   destroyed.
3. Set `visible` by whether a bystander could tell.
4. If it worsens, give it `durationTurns` and `expiresInto` — **and say so in
   the description**, naming what it becomes. The tooltip's "Becomes" row is
   reinforcement; the sentence is what makes someone act in time.
5. Negative `pointCost` (a drawback bought at creation) requires
   `purchasableAfterStart: false`, per §4 — as does anything in `items` or
   `assets`. The sync throws on either, so a slip fails the run rather than
   reaching a player.
6. Set `catalog:` — `secret` if it is cave- or antagonist-related (hidden
   from everyone on the /documents Tag Catalog, GMs included), `all` if it
   is public knowledge, `gm` otherwise. The field is required on every tag;
   the sync throws without it.
7. If some ITEM should cure this tag (rather than, or alongside, a medic's
   Heal), that goes on the ITEM's own entry, not this one: add this tag's
   slug to the item's `cures:` list, give it `curesInto:` only if the
   aftermath should differ from this tag's own `removesInto`, and set
   `administerSkill:` on the item if applying it — self included — should
   need a skill. None of the three is validated against this tag's own
   `healable` value; see "Curing by item, not by medic" above and
   `MEDICAL.md` §1–2 for the mechanism.
8. `npm run db:sync-tags`.

## 5d. GM-authored tags

A tag can also be written in the UI, at `/gm/dev/tags`, instead of in
`docs/tags.yaml`. Such a row carries `Tag.custom = true` and lives only in the
database.

The two halves of the catalog behave differently on purpose:

|  | From `docs/tags.yaml` | GM-authored |
|---|---|---|
| Editable in the UI | No — the next `db:sync-tags` would revert it | Yes |
| Touched by `db:sync-tags` | Upserted every run | Never (the sync is keyed by slug and has no entry for it) |
| Touched by `db:prune-tags` | Deleted if unreferenced and no longer in the YAML | Never — skipped explicitly |
| Deletable in the UI | No | Superadmin only, and only if nothing references it |

**Slugs are generated, never typed**: `custom-${slugify(name)}`. A GM naming a
tag "Arthritis" would otherwise collide with the YAML slug, and the next sync
would upsert straight over their row — silently converting their homebrew into
a YAML tag and clobbering every field. The prefix also guarantees a custom slug
can never appear in the prune script's YAML slug set by accident.

**There is a third author, and it is neither of these: the game itself.**
`db/lib/corpseMint.js` writes one Tag row per death ("Ada's Corpse") and
`db/lib/headstone.js` writes one per Engrave. Both set `custom: true` so the
syncs leave them alone, exactly as a GM's homebrew is protected — what tells
them apart is `Tag.corpseKind` and `Tag.corpseOfCharacterId`. That distinction
earns its keep three times: it is the join that walks a dead sheet after its
corpse, it is how the Butcher yield table tells a person from a Nekker, and its
`onDelete: Cascade` is the only thing stopping these rows outliving a Restart
Game. Full writeup in [`CORPSES.md`](CORPSES.md) §9.

A system-authored row is also the one exception to the rule below: a corpse
carries a decay chain, which no GM may hand-author. It does not go through
`expiresInto` to get one — it renames itself in place (`CORPSES.md` §3).

What a GM can set is the tag's own behaviour — cost, category, group,
description, the `stackable`/`equippable`/`consumable`/`removable`/
`purchasable` flags, the three-state "seen by others on 🔍", plus a duration. What they cannot set is
catalog *structure*: `parentTag`, `requiredTag`, `requirementSkills` and
`consumesInto` all wire tags to each other, and that belongs in the YAML where
it can be reviewed alongside the tags it connects.

## 5e. `ephemeral`: which rows are game state

There are three authors of a `Tag` row — `docs/tags.yaml`, a GM at
`/gm/dev/tags`, and the game itself (§5d). `custom` separates the first from the
other two. **`ephemeral` separates the third from the second**, and it has to
be its own field because the two want opposite things from a Restart Game: a
GM's homebrew must survive one, and a crate must not.

Set by every runtime minter — `db/lib/depotCrates.js`, the Factory's Package
button, `db/lib/headstone.js`, and both paper minters in
`db/lib/paperMint.js`. `wipeGameData` deletes exactly these rows and leaves the
catalog and the homebrew alone.

Corpses are the exception that needs nothing: `Tag.corpseOfCharacterId`'s
`onDelete: Cascade` already took them out with the characters, and still does.
They were also, until this landed, **the only runtime rows a wipe ever
removed** — crates and headstones simply accumulated.

One more reader: `web/lib/referenceData.js#getVisibleTags` withholds an
`ephemeral` row from anyone not holding it. That loader ships the whole catalog
to every browser on every page, and the runtime set has no ceiling — every
letter anybody writes is a row. Paper is what made that urgent; crates had the
same problem quietly.

## 6. Things that used to be tags and aren't anymore

`Leader` and `Treasurer` were retired as tags in the same rework that
introduced this system (and were finally removed from `docs/roles.yaml`'s
`starting_tags` too, in favor of per-role `leader:`/`treasurer:` booleans) — both are now plain booleans on `Character`
(`isLeader`, `isTreasurer`), assigned dynamically by a GM (Leader) or by a
GM/the faction's own Leader (Treasurer) from `/faction`
(`web/app/(app)/faction/actions.js`), exactly as before — only the storage
mechanism changed, not who can assign what. `Courtier` survived too, and still gates `Manor` via that tag's `requiredTag` (§3). `Mortus` survived the
"Role" category's retirement as an ordinary General tag since it drives real
logic elsewhere — it gates `/lifeweb` nav visibility. `Hunter` survived
alongside it for the same reason, but has since been retired: hunting is now
just a flavor of laboring (`LABORING.md`), and no `hunter` entry remains in
`docs/tags.yaml`.

## 7. Where the code lives

`db/lib/syncTags.js` (the sync itself), `db/scripts/sync/sync-tags.js` (terminal
entry point, `npm run db:sync-tags`), `docs/tags.yaml` /
`docs/taggroups.yaml` (content), `web/lib/referenceData.js#getVisibleTags`
(the catalog backing `{tag:slug}`/`{tag:id}` references, and the gate from
§3a),
`web/app/components/RichText.js`/`TagsProvider.js`, `TagChip.js` (the
hover-tooltip chip that renders group color, and the "Becomes" row from §5c),
`db/lib/inspectVision.js` (Seductive, §5),
`db/lib/medicalVision.js` (the cure-skill walk and the doctor's eye, §5c),
`db/lib/tagExpiryPass.js` (the `expiresInto` progression, §5c), and
`web/lib/healRequests.js` (what a medic may treat, `REQUESTS.md` §5c). Curing
by item, poisoning, resistance and the prosthetics have their own doc,
[`MEDICAL.md`](MEDICAL.md) — this section keeps the tag-side rules (the
ladder, `expiresInto`/`removesInto`, `cures`/`curesInto`/`administerSkill`
as catalog fields) and MEDICAL.md owns the mechanism each of those fields
drives.

**Tag descriptions carry `{tag:…}`/`{resource:…}` tokens
too**, not just documents — that's how a True Form names the {tag} it inflicts. The three
places a description renders all forbid an *interactive* chip, though: a
`TagChip` nested in a hover tooltip could never be hovered to reach its own
tooltip, and the point-buy / Add Tag rows are `<button>` elements. So they
render through `ChipText.js`, which resolves the same tokens to a plain
`ChipLabel`. `RichText.js` stays the full-fat renderer for prose the reader
can point at (documents, a character's appearance). Both share the parser in
`richTokens.js` — which exists in its own file precisely because `RichText`
renders `TagChip` and `TagChip` renders `ChipText`, so importing one from
the other would close an import cycle.

There are three token kinds. `{tag:slug|id}` and `{resource:field:tier}` are
described above; `{document:key}` names another paper by its `Document.key`
(`DOCUMENTS.md`), rendering as a chip that links to it. The
parser in `richTokens.js` is kind-agnostic — `{(\w+):([^}]+)}` — so a new kind
never touches it or `remarkTokens.js`. What a new kind *does* touch is the
three renderers, which is the whole edit surface: `RichText.js`'s
`BUBBLE_KINDS` map (the only real dispatch table), and the hardcoded if-chains
in `ChipText.js` and `DocumentMarkdown.js`'s `RichTokenRenderer`. Miss
`ChipText` and the token renders literally in a tag tooltip and in the
`/documents` card preview; miss `DocumentMarkdown` and it renders literally in
an open document. Every kind falls through to the raw `{…}` text when it can't
resolve, so a bad reference is visible rather than silently dropped.

A kind whose data the browser doesn't already hold also needs a read API and a
provider mounted in `layout.js`, the way `{tag:…}` has `getVisibleTags` +
`TagsProvider`. `{document:…}` is the case to copy if the data is
access-controlled: `/api/documents` ships every document's *name* but a body
only to a reader who may open it, so a chip for a paper you have not been
handed renders inert rather than either vanishing or leaking.

`hungry`, `hungerless` and `ate-meal` are the first tags granted and consumed
by automatic game logic rather than by a player, a GM, or a starting package —
`db/lib/hungerPass.js` is their only writer, and `db/lib/gambitModifier.js`
their only reader. `db/lib/constants.js` holds the slugs so neither file
hardcodes a string. `catatonic-afk` is a third: `db/lib/catatonicPass.js` (after
`GameConfig.catatonicTurns` idle turns) and
`db/lib/playerDeparture.js` (a guild leave, ungated — departure is a fact,
not a dial) are its two writers, it now carries a consequence — held for
`GameConfig.catatonicDeathTurns` turns straight, the character dies at close
(`TURN-ENGINE.md` §2 7b, the engine's one auto-kill) — and it
is also the only tag in the game that a pass both grants **and** clears
itself — it carries no `durationTurns`, deliberately, because there is no
sweep to hand the clear to; see `TURN-ENGINE.md` §2 for why that's the
correct exception to "every grant must stamp `expiresTurn`" rather than a
repeat of the Paralyzed bug. Because its whole purpose is broadcasting
"this player is AFK", it surfaces further than any other tag: a chip on the
`/faction` member roster (visible to ordinary members — the deliberate
exception to that roster's no-fate rule), a Catatonic column on
`/gm/players`, a muted dot on `CharacterAvatar` across the GM desks, a
Condition row on the player's own `/character` sheet, and the character's
personal Discord role renamed to `<name> • Catatonic` in flat grey. The
role's name/colour are composed only by
`db/lib/characterRoleAppearance.js` — shared by `ensureCharacterRole` and
the pass's returned `roleUpdates` — so a profile save can't strip the
suffix, and the doctor/pruner skip claimed roles before their signature
test ever sees the grey. The Health chain (§5c) is another such system,
and it
deliberately holds **no** slugs in `constants.js`: the whole chain is catalog
data, so `tagExpiryPass.js` never names a tag and a new chain needs no code
at all.

The Personality batch of 2026-09-05 added a second wave of scripted
drawbacks, each with its own writer:

- **Claustrophobia, Hemophobia, Agoraphobia, Pyrophobia and Teratophobia**
  each multiply one kind of mood harm rather than sustaining a state of their
  own — `db/lib/mood.js` (the multiplier table) and `db/lib/moodPass.js` (the
  nightly turn pass). See `MOOD.md`.
- **Guilt Ridden and Insomniac** each carry a nightly chance of a bad night's
  sleep, stepped through the same Tired -> Exhausted ladder a day's Labor uses
  (`LABORING.md` §4) — `db/lib/dawnAfflictionPass.js`, run right after the
  hunger pass.
- **Lazy** takes a quarter off a labor roll's yield, after the roll —
  `lazyYield()` in `db/lib/laborAccess.js`, called from both
  `db/lib/autoLaborPass.js` and `bot/src/lib/moveConfirm.js`.
- **Guilt Ridden** also blocks Confession outright —
  `db/lib/confession.js#confessableTags`/`validateConfession` (`CONFESSION.md`).
- **Lightweight and Iron Liver** reshape the drinking ladder —
  `web/lib/consumeGrants.js` (`BREWING.md` §5a).
- **Motion Sickness** refuses mounting a horse, motorcycle or fishing
  boat (`web/app/(app)/character/equipActions.js`), and grants Vomiting to a
  Motion Sick passenger dragged along a mounted or boated zone crossing
  (`db/lib/locationTravel.js#vomitOnTheRide`).
- **Debtor** is scripted at creation only: `db/lib/wantedPoster.js` grants 20
  starting obols and posts the DEBTOR notices (`DEPOT.md`).

## Phobias

A phobia is no longer its own system. It's a multiplier on one kind of harm to
the mood dial — see `MOOD.md` for the dial, the nine bands it produces, and the
full multiplier table.

## `equippable` / `concealsIdentity`

`equippable: true` marks a tag as something a character can wear or carry
readied, and so occupies its `equipSlot` (next section). Each UNIT spends its
own slot or hand: a stack of 5 swords, all equipped, is four hands full and
one still in the pack, not one hand for "a stack of swords" — a stackable tag
with no `equipSlot` at all still takes no more room than any other equippable
tag, since the slot (or the lack of one) is the only limit, never a flat count.

The state lives on two `CharacterTag` columns rather than a join table.
`equippedQuantity` is how many of `quantity` are currently out — 0 for an
unheld or fully-stowed stack, up to `quantity` itself for one equipped down to
the last unit — and `equipped` is kept in sync as `equippedQuantity > 0`, so
every "holds it or doesn't" check elsewhere in the codebase (fear, armour,
mounts, concealment, labor bonuses...) reads that one boolean and needs to
know nothing about counts. `@@unique([characterId, tagId])` stays: a stack is
still one row, it just carries two numbers instead of one flag.

Shrinking a stack below what is equipped — `dropCharacterTag`, a GM's quantity
patch — clamps `equippedQuantity` down to match and frees whatever slots or
hands that frees. Nothing is ever left with `equippedQuantity` pointing past
the end of a shorter stack.

`CharacterTag.equipped` is **cleared on death** — `killCharacter` runs an
`updateMany` over the corpse's held tags. A corpse doesn't wield things, and
a Revive later shouldn't walk back in with gear locked to slots that may
have moved. It also keeps the loot panel (`CHARACTERS.md` §5) from rendering
an item as if it's still worn.

`concealsIdentity: true` marks gear that hides who the wearer is — a mask, a
hood, a closed helm. It is **the gate on `/conceal`**: without one of these
equipped, a character cannot go unnamed at all (`PROXYING.md` §5). It is only
meaningful alongside `equippable`, and `syncTagsFromYaml` **throws** if it is
set without it rather than syncing a tag that could never do anything — the
kind of quiet failure that is miserable to debug from inside the game.

`forcesConceal: true` is the stricter form: concealed with no say in it, and
both `/conceal` toggles refuse in either direction. It requires
`concealsIdentity` — forcing a concealment the catalog does not grant is a
contradiction, not a stricter setting — and sync throws otherwise.

`concealSprite:` names the plated 256px avatar the room sees instead of the
wearer's face, a basename under `web/public/assets/helms/`. It is **required**
alongside `concealsIdentity`, and sync checks the file really exists: a hood
nobody can see is not concealment, it is a missing image. Build the files with
`npm run assets:helms --workspace=web` after adding a source sprite to
`web/assets/helms/`.

### `equipSlot` / `equipLayer` / `twoHanded`

There used to be a flat count, `GameConfig.equipSlots` — six things, then ten,
whatever they were — and for a long time it was the only limit, so a character
with free slots could ready eight swords, and later three helmets. **It is
retired** (2026-09-13): the column stays in the schema, unread and listed under
`INTERNAL_KEYS` in `db/lib/gameConfigFields.js`, and the slot is the whole
rule. Every `equippable` tag names one; sync throws on one that doesn't.

`equipSlot:` is the other half — `HEAD`, `BODY`, `SHIELD`, `WEAPON`,
`ACCESSORY` and `MOUNT`, the table below. `HEAD`, `BODY` and `MOUNT` are
layered (next paragraph), `SHIELD` holds exactly one, `WEAPON` is counted in
hands rather than a slot, and `ACCESSORY` has no limit at all. **Two equipped
tags may not share a slot (or, on a layered slot, a layer)** — including two
UNITS of the very same stackable slotted tag (`hat`, `death-mask`, `gas-mask`,
`graga-hide-cloak` are four that are both today): equipping a second one
clashes with the first, same as it would against any other tag in that slot,
because a slot holds one physical thing however large the stack behind it is.

> **Shipping this needs a tag sync.** The migration only adds the enum values
> and `Tag.twoHanded`. Every slot, every layer and every `twoHanded` flag
> lives in `docs/tags.yaml` and reaches the database through `npm run
> db:sync-tags` — and **no deploy step runs that for you**. Push without it
> and every weapon, accessory and mount is slotless: the rig draws empty rows,
> and the limit that stops eight swords is not there. The sync is upsert-only,
> so running it against the live database is safe (`SYNC.md` §2).

| `equipSlot` | limit | holds |
|---|---|---|
| `HEAD` | layers 1–3, one thing per layer | 1 liner (coif, cap, mask), 2 helm, 3 outer (hat, hood, bag) |
| `BODY` | layers 1–3, one thing per layer | 1 clothes (padded armor, robes, garb), 2 mail (mail shirt, brigandine), 3 outer (breastplate, plate, cloak, longcoat) |
| `WEAPON` | **four hands**, fewer if maimed (below); a `twoHanded: true` weapon takes two | everything you hold — every weapon, the shields, the banners, the flamethrower, the chainsaw |
| `ACCESSORY` | **four** | badges, pins, jewelry, spectacles, lenses, gloves, hand tools |
| `MOUNT` | layers 1–2 | 1 ridden (horse, motorcycle, boat), 2 towed (cart) |

### A maiming takes hands away

`Tag.handsLost` is how many of the four hand slots a tag costs: **a whole arm
is 2, a hand that no longer grips is 1** (Missing Arm, Mangled Hand, Missing
Fingers). `db/lib/equipSlots.js#handsFor` is the only place that answers "how
many hands does this character have", and every surface that shows or enforces
the cap reads it — the equip board draws that many cells rather than four with
some permanently dashed.

Three rules hold it together:

- **Counted while HELD, never equipped.** Nobody wears a missing arm. That is
  the opposite of `carryBonus` and armour, and the reason this is its own
  column rather than a negative carry bonus.
- **Nobody falls below two** (`HANDS_FLOOR`), however much is missing. A
  character who can hold nothing at all is a dead end rather than a drawback —
  they cannot carry a torch, take a letter, or pick up the thing a scene is
  about.
- **Ambidextrous does not give one back.** It cancels the fighting penalty a
  maiming carries (`COMBAT.md`), because *"losing a hand would only be a minor
  inconvenience to you"* is about coping, and coping is not the same as having
  the hand.

**An involuntary loss SHEDS; a player's own toggle REFUSES.** Granting Missing
Arm to somebody holding four weapons unequips the excess — fullest hands first,
so one poleaxe goes before two knives — rather than failing, because refusing
to cut a man's arm off on the grounds that his hands are full is the tail
wagging the dog. `db/lib/tagOps.js` does the shedding, deliberately outside the
equip-op block (a maiming carries no equip op, so anything inside it would
never run). Reaching for a fifth weapon yourself is still a refusal that names
what to put down, in `character/equipActions.js`.

`equipLayer:` 1 is against the skin and 3 outermost, and **two equipped tags
may not share a layer**. So a mail coif (`HEAD` 1) goes under a knight's helm
(`HEAD` 2), but two helms do not go together; a cart (`MOUNT` 2) is towed
behind a horse (`MOUNT` 1), but a horse and a boat are one ride too many.
`WEAPON` and `ACCESSORY` carry no layer, and sync throws if one is set on
them. Sync also throws on a layer outside **that slot's own range** —
1–3 on `HEAD` and `BODY`, 1–2 on `MOUNT`, since the rig has no third mount
cell to draw one in — a layer with no slot, a layered slot with no layer, a
slot on a tag that is not `equippable`, and `twoHanded` on anything but a
`WEAPON`.

**Hands** are the one limit that is a number: `WEAPON_HANDS = 4` in
`db/lib/equipSlots.js`, a constant rather than a knob. A bastard sword on the
back, a shield and a pistol in the holster is exactly four. The two-handers
are the polearms, the great swords, the bows and the long guns, and the
refusal names which of them is eating two. The rig calls the row **Held**, and
prints `n/4` on it the way the accessories row does.

There used to be a **`SHIELD`** slot beside this one, holding exactly one
thing under the title "Off hand". It was a second rule for the same place on
the body, so it was folded in here (2026-09-14) and the hands went from three
to four — which is precisely what the two slots already allowed together, so
no living character was left wearing a set the rules refuse. Two consequences
worth knowing: a shield now costs a hand like anything else, and **two shields
at once are legal**, because hands are the only limit on what you hold. The
enum value is **retired, not deleted** — Postgres cannot drop one, so it stays
in `schema.prisma` while `EQUIP_SLOTS` in `db/lib/equipSlots.js` leaves it
out, which makes sync throw on any YAML still naming it.

**Accessories** are the second, and the same shape: `MAX_ACCESSORIES = 4`,
beside it in the same file. The slot started uncapped, which made it the
pocket that everything fitting nowhere else went into — a character could wear
a dozen badges and every one of them counted. Four is a hard number rather
than a `GameConfig` knob for the reason the flat count was retired: a limit a
GM can set is a limit that can disagree with the slots. The refusal names only
the excess, the way the hands one does, and the rig prints `n/4` on the row.

A GM-authored custom tag (`/gm/dev/tags`) that is `equippable` but names no
slot is limited by nothing at all — the form has no slot picker yet — which is
the same as it was before, minus the count.

The layer also decides **which face shows**: the outermost equipped concealing
piece is the one whose `concealSprite` the room sees.

The rule lives in `db/lib/equipSlots.js` because **two** independent paths flip
`CharacterTag.equipped` — the player's toggle (`equipActions.js`) and the
GM/staged batch (`db/lib/tagOps.js`) — and a rule in only one of them is a rule
a GM can walk straight through. Both write first and then ask "is the resulting
set wearable?", which is the only form that lets a batch stage "unequip A,
equip B" without rejecting B for a conflict with an A that is already gone.

**Bound blocks equipping in both directions**, along with Craft and Destroy
(the ACT capability, `db/lib/incapacitation.js` — see §5f). A hostage who could
take the sack off their own head would not be much of a hostage.

`equippable` **does** interact with `visible`, through its third state. A tag
authored `visible: worn` is shown to a bystander's 🔍 only while
`CharacterTag.equipped` is true — see §5 for the table and the throw. What
gets it is a question about size, not secrecy: anything small enough to keep
out of sight when you aren't using it.

- **`worn`** — the sidearms and short blades (Dagger, Silver Knife, Work
  Knife, Knuckle Duster, Sling, Sword Cane, Bomb, and every pistol including
  the Sawn-Off), armor that goes under clothes (Padded Armor, Brigandine), and
  the small worn signals: Sheriff's Badge, Hand's Pin, Incarn's
  Key, Bishop's Mitre, Headman's Cap, Esculap's Vest, Jewelry, Spectacles,
  Radio Bracelet, Dark-Eye Lenses. The badges are the interesting half — an
  officer can now go about unmarked, and displaying the thing is a choice,
  which is what the Sheriff's Badge's own description always claimed.
- **`true`** — everything you cannot hide by not holding it: swords,
  polearms, bows, shields, plate, banners, the Baron's Scepter, the Power
  Fist, the Flamethrower, and all the garb and robes. Carrying one reads the
  same as wearing one.

A concealed character's 🔍 embed applies the same gate through the same
predicate, so a hidden cuirass stays hidden even while worn, and a stowed
dagger stays hidden even from someone standing next to it. What conceal takes
away is the *identity* — name, appearance, Desire, Resources — not the
inventory.

## `melee` / `ballistic`: what a piece of gear turns aside

Every piece of armour, headgear and shield carries two numbers, authored in
`docs/tags.yaml` as `melee:` and `ballistic:` and stored as `Tag.meleeArmor` /
`Tag.ballisticArmor`. Both run **0.0 to 1.0**, the fraction of a blow the piece
turns aside, and both count **only while equipped** — a vest in your cart stops
nothing, and letting it would make a turret survivable by shopping.

Two numbers because the two things that hit you in Ravenheart are nothing alike.
A breastplate is excellent against a sword and paper against a rifle, and the
catalog's own line about Light Infantry Armour — *"nothing forged in Ravenheart
stops a bullet"* — only means something once those can differ. Nothing forged in
the city sits above **0.3 ballistic**; the four things that do are all imported
or GM-granted.

**`ballistic` is live. `melee` is not, yet.** The turrets are the only thing in
the game that rolls damage (`docs/systemdocs/DEPOT.md` §0f), and they are
ballistic. Melee is still GM-adjudicated or a Gambit outcome, so `melee` is
authored and displayed but read by nothing. It is there so the catalog is
complete and consistent on the day a melee resolver lands, rather than becoming
a 35-tag authoring job at that point.

### Words, never numbers

A player is never shown the decimal. `db/lib/armorValue.js#armorWord` turns it
into one of six words, the same posture Laboring yields take
(`db/lib/laborYield.js#qualityWord`):

| value | word |
|---|---|
| absent or 0 | None |
| < 0.20 | Meager |
| < 0.40 | Sufficient |
| < 0.60 | Good |
| < 0.80 | Strong |
| ≥ 0.80 | Overkill |

`db/lib/formatTagArmor.js` renders the pair as `Melee: Good | Ballistic: Meager`
wherever a tag's description already shows — the chip, the detail sheet, the
point-buy shelf, Examine, and the 🔍 inspect embed. **Both halves always print
once either exists**, `None` included: a breastplate reading `Melee: Strong |
Ballistic: Meager` is the whole point of there being two numbers, and dropping
the weak half would hide exactly the fact somebody needs before walking into a
yard with a gun in it.

Working out that Strong beats Good is the player's job. A decimal on a chip
would turn kit choice into arithmetic.

### How pieces combine

Multiplicatively on what gets **through**, not additively on what is stopped
(`db/lib/armorValue.js#combineArmor`):

```
protection = min(0.95, 1 - Π(1 - value))
```

A helmet at 0.4 and a breastplate at 0.25 leave `0.6 × 0.75 = 45%` coming
through, so together they are 0.55. A full kit is meaningfully better than one
piece, and the second and third pieces are each worth less than the first —
which is both how armour actually works and what stops somebody in six
overlapping layers from being untouchable. The 0.95 cap is the same idea said
absolutely: nothing is ever bulletproof.

The result is rounded to four places before it leaves `combineArmor` — a
single piece authored at exactly a band edge (`0.2`, `0.4`, `0.6`, `0.8`)
combines to `0.19999999999999996` in IEEE 754, which `armorWord`'s strict `<`
reads as one word weaker than the tag says. Invisible for a long time because
the only caller was `db/lib/depotTurret.js`'s roll math, where the error is
irrelevant; visible the moment something displays the word — a character's
combined Melee/Ballistic now shows as an `Armor` line on the GM's Sheet tab
(`web/app/components/InspectorColumn.js`, shared by `/gm/turns` and
`/gm/players`), computed across every equipped piece the same way
`combineArmor` always has.

### Authoring one

`db/lib/syncTags.js` rejects a value outside 0..1, and rejects either key on a
tag that is not `equippable` — armour nobody can wear is dead config, and
`combineArmor` skips unequipped rows, so it would silently protect nobody rather
than fail the sync. A GM can set both from the tag form on `/gm/dev/tags`, which
takes the raw number: tuning a piece against the word "Sufficient" would be
guesswork.

Anything without a value turns nothing aside, which is most of the catalog —
skills, statuses, beliefs, and every cloth hood and mask. Those last are faces,
not armour.

## `forcesName`

`forcesName: Beast` is the opposite of a hood: a tag that **fixes** how its
holder presents instead of hiding it. It exists for transformations — Apex Form
turns a Demoness into a monster, and a monster does not get to keep posting as
`Lady Ysolde "the Fair" Marrow` with her portrait.

What it does, all resolved at **read time** by `db/lib/presentedIdentity.js`
(`PROXYING.md` §5), with the precedence **forced > concealed > own name**:

- Every proxied message — typed, the Speak modal, and the REST twin that posts
  staged public posts — goes out under the forced name, with the letter
  plaque for its initial (`/assets/letters/B.webp` for Beast). Never the
  character's own face, uploaded or built.
- **Who's here?** lists them under the forced name, with no Role, and never on
  the concealed line even if `Character.concealed` is still true on the row.
- The player-facing 🔍 embed titles itself with the forced name and shows the
  plaque. The GM's ⚜️ dossier keeps the real name and face and adds a
  `Presents as` line — a GM needs to know who it is.
- ⭐ files the note under the forced name, and the archive freezes it into
  `ArchiveEntry.concealedAlias`, so `/archive` reads `Beast (Ysolde Marrow)`
  exactly as it reads a hood.
- `/conceal` and the switch on `/character` both refuse. The portrait maker,
  the upload and Reset to Default are hidden on the sheet, and the server
  actions behind them re-check the tag, since a hidden button is a hint and
  not a lock.

What it deliberately does **not** touch: the `Character` row (no rename, so two
Beasts never collide on `Character.name`, and every GM table still says who it
is), the personal @-mention role, and the server nickname — both keep the real
bare name, by decision. The `/add` picker naming the character is intended, not
a leak.

One consequence of the precedence worth knowing: a character who had their hood
**up** when the tag landed stops being concealed. Their 🔍 embed goes back to
the full one — tags, Desire, Resources under whatever gates apply — titled with
the forced name. A Beast is not hiding, and the row's stale `concealed` flag
does not get a vote.

Because nothing is written when the tag lands, there is no grant hook and no
catch-up pass: the first message after any door grants it — the store, the dev
panel, a Desire — already posts as the forced name, and removing the tag
reverts every surface on the next message.

`syncTagsFromYaml` **throws** on an empty `forcesName`, on one longer than the
first-name budget (`NAME_LIMITS.firstName`, 24), and on a tag that sets it
beside `concealsIdentity` — a tag cannot hide who you are and dictate it. The
GM's custom-tag form has no editor for it, the same posture as `desireLocks`;
`/gm/dev/tags` shows it as a `Forces name: …` chip.

### The equipment board

`EquipBoard.js` on `/character` (`SHEET.md` §4) is **click-to-toggle**, not
drag-and-drop — drag would need a touch fallback that is exactly this anyway —
and is its own surface rather than an affordance on `TagChip`, whose tooltip
already carries the Consume button.

Equipping is **instant and writes neither a `Request` nor an `AuditLog` row**,
unlike everything in `REQUESTS.md`. It costs nothing, the player undoes it in
one tap, and at 100+ players a row per toggle would drown `/gm/audit`.

`equipOne` and `unequipOne` (`web/app/(app)/character/equipActions.js`) replaced
a single `toggleEquip` the day a slot stopped being a whole-holding flag —
`equipOne` pulls one more unit out of a stack, `unequipOne` puts one back, and
`EquipmentPanel.js` renders one box per `CharacterTag.equippedQuantity`, all of
them acting on the same row (units of a stack are fungible, so it never matters
which visual box unequips). The "Carrying" row underneath shows only the
REMAINDER — `quantity - equippedQuantity` — not the stack's full count.

Both resolve the character from the session rather than trusting a posted id,
re-check `tag.equippable`, and `equipOne` counts the slots inside a
transaction — **but the count alone is not sufficient.** Prisma runs at READ
COMMITTED, so two tabs both read the same free slot and both write. The
transaction opens with

```sql
SELECT id FROM "Character" ... FOR UPDATE
```

which serializes equips per character. Without it, a burst of 8 concurrent
equips all land against a cap of 6 (verified).

## Depot tags: obols, crates and sealed shipping

Three things the Depot rework added to the catalog.

**`obol`** — the Merchant's currency. Stackable, tradeable, `weight: 0`,
`visible: false`. One obol is worth exactly one ⬢ — it is that same value made
physical, rather than a compression of it — and it is money only at the Depot;
everywhere else it is a coin nobody has to take. It has no `pointCost` and
is not purchasable — the only door it enters the world through is the Depot's
ATM.

**`sealedShipping: true`** — a ware that arrives in a crate printing no
manifest, openable only with a `depot-keycard`. Authored rather than guessed
from the category, because "dangerous" is a judgement about the fiction. The
sync refuses it on a tag with no `depotPrice`: the station cannot ship what it
does not stock.

**Crates** are not in `docs/tags.yaml` at all. They are `Tag` rows minted at
runtime by `db/lib/depotCrates.js` with `custom: true` **and `ephemeral: true`**,
one per crate, carrying their contents in `Tag.crateContents` and their manifest
in `description`. `db:prune-tags` skips custom rows, so they survive a prune.

This doc used to claim the row was "deleted once nothing references it any
more". **That was never true** — nothing deleted it, and every crate ever landed
was a permanent orphan sitting in the catalog across every game. `ephemeral` is
the fix; see §5e.

See `docs/systemdocs/DEPOT.md` §0e.

## 5f. What a status tag takes away

`db/lib/incapacitation.js` used to be a single flat Set, and that set was the
only answer the game had to "can this character do this?". It covered the
physical half and had nothing to say about the other one, so a Paralyzed
character could shout across a Location and a Mute one could talk all day —
`mute` cost −7 points and appeared in no line of code anywhere.

It is now a table. Each slug names the capabilities it removes:

| Tag | ACT | SPEAK | SHOUT | |
|---|---|---|---|---|
| `unconscious` | ✗ | ✗ | ✗ | the top of the drinking ladder (`BREWING.md` §5a) |
| `paralyzed` | ✗ | ✗ | ✗ | its description has promised this since the day it was written |
| `seizure` | ✗ | ✗ | ✗ | you are on the floor (`FACTORY.md`) |
| `bound` | ✗ | **✓** | **✓** | **a hostage can yell for help** |
| `dying` | ✗ | ✓ | ✓ | last words are the tradition |
| `crucified` | ✗ | ✓ | ✓ | the Crucify button's tag (`REQUESTS.md`); becomes Dying after a turn, and a public death with no last words would be half a spectacle |
| `catatonic-afk` | ✗ | ✓ | ✓ | see the trap below |
| `mute` | ✓ | **✓** | ✗ | a mute smith is still a smith — and now still a talker |

**ACT** is the physical half — equip, craft, destroy, labor, butcher, package,
transfer, extract, travel, teach, confess, the Depot, writing on paper.
**SPEAK** is the voice — the proxy (ordinary chat, whispers, the Speak modal),
and the Council Room intercom. **SHOUT** is `/shout` and nothing else.

**SPEAK implies SHOUT**, written once in `expandCaps()` rather than by listing
both beside every entry, because the second half of such a pair is exactly what
somebody forgets. So no row above sets SPEAK ✗ and SHOUT ✓, and only `mute`
sets them the other way round.

**Why `mute` moved.** It used to take SPEAK, which meant a player who bought it
— or lost a tongue to Mutilate — could not say a word on either face for the
rest of the game. That removed the *player* from the game rather than the
character from a conversation, which is not a −7 drawback, it is a quit button.
It now takes SHOUT alone: the voice is there, it just will not carry. It is
also **no longer purchasable** (`docs/tags.yaml`); the tongue rung of the
Mutilate ladder (`TORTURE.md`) is the only thing that puts it on somebody now.

`INCAPACITATING_SLUGS` still exists and still means what it always did —
"helpless, therefore lootable, draggable and bindable" — but it is now
**derived from the ACT column** rather than written out a second time. `mute`
is the proof that is the right derivation: it is the one entry that keeps its
hands, and it correctly does not appear in the set. Two hand-maintained lists
would have disagreed the first time somebody added a tag to one of them.

**The catatonic trap.** `db/lib/catatonicPass.js` DMs the player *"it lifts the
moment you act or speak in character again"* and clears the tag off their
activity clock. Gate catatonic speech and the tag becomes self-sealing: the
player can never do the one thing that lifts it, and
`db/lib/catatonicDeathPass.js` then kills them for it. **Catatonic must never
block SPEAK.** For the same reason, a refused message still writes the
speaker's activity (`bot/src/lib/proxy.js`) — being silenced must not march
somebody toward an auto-kill for trying to talk.

**Composing with Stupid.** `stupid` is not in the table — it garbles speech
(`db/lib/babble.js`) rather than removing it. The gate runs first: a Stupid
Paralytic is silent, not babbling.

**The seam.** `blockerFor(characterTags, capability)` returns the offending
`{ slug, name }` rather than a boolean, so every refusal can name the tag —
"you're Bound" beats "you can't do that", and a player refused without a reason
files a GM ticket about it. On the web, `requireCharacter({ needs: ACT })` in
`web/app/(app)/character/requestActions.js` carries it for nearly every
request in one place, because that function already loads every held tag.

**What is deliberately not gated:** faction bureaucracy, claiming a Desire,
reading, examining, the point-buy store, and consuming. Faction paperwork has
no in-world moment — a bound player unable to accept a membership application
filed three days ago is a paperwork outage, not a hostage situation. And
somebody can always pour a drink into you.

**One exception to consuming's own exemption: `Tag.administerSkill`.** An
item gated this way (a prosthetic fitting, `MEDICAL.md` §2) DOES need ACT to
consume, even on your own sheet — not because administering is gated (it
isn't, any more than an ordinary consume is), but because a gated consume
files a Move, and a Bound or Paralyzed character cannot file a Move for
themselves either. The gate sits on the Move, not on the medicine.
