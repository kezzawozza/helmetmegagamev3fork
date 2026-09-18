# The Dev Character Panel

`/gm/dev/characters/[characterId]` — every value on one player, in one place,
plus the verbs a GM reaches for often enough to want a button. Companion to
`CHARACTERS.md` (the rules this deliberately bypasses) and `ADJUDICATION.md`
(the Move surface this hands off to).

Not to be confused with `/gm/dev`, the **game**-level Dev Panel: turn, game
config, Restart Game. That one is superadmin-gated. This one is not.

## 1. Who can open it

Gated on **GM membership** via `getGmSession()`, not `isSuperadmin`. Every
`CharacterLink` in the app points here, and an in-game GM is meant to use it.
Exactly one thing narrows further: **Delete character** requires superadmin,
checked inside the action rather than by hiding the button.

## 2. The two kinds of interaction

The panel does two different things, and keeping them apart is the whole
design:

| | Staged | Immediate |
|---|---|---|
| What | Values — every editable column | Verbs — kill, revive, restore/spend turn, message, teleport, transfer, delete — **and every tag change**, and every admin note |
| When | On **Apply** | The moment it's confirmed |
| Undo | **Cancel** discards the lot | Its own inverse, if it has one |
| Audit | One row for the whole Apply | One row each |
| DM | Only if something changed | Every verb but Delete |

**Every microaction but Delete tells the player.** A dev-panel edit
is still a thing that happened to their character — `notifyCharacter()` in
`actions.js` sends a plain DM (not a Request; nothing here rides the Request
lifecycle) from `after()`, post-commit, same posture as the Discord-sync steps.
It's a thin `source: "gm_dev"` wrapper around the shared
`web/lib/notifyCharacter.js`, the same notifier every player-to-player
Request uses (`REQUESTS.md`) — one DM helper, one posture, everywhere a
player's sheet changes because of someone else's action. A deleted character
has no row left to DM about. Apply summarises whatever actually changed (tags gained/lost,
resources, zone, name) rather than restating the whole diff. Kill is the one
exception: it doesn't call `notifyCharacter` at all, because
`killCharacter()` sends the death DM itself (`REQUESTS.md`) — a second one
here would double it up.

They are held to **disjoint fields**, so they can never race each other. The
field that would have straddled both is `status`: it is deliberately absent
from the form and lives only as the Kill and Revive buttons. That is why
`applyCharacterEdits` never has to reason about "did they also just kill this
character" — it reads status from the database, never from the payload.

**Tags used to be staged too, and are not any more.** That made the commonest
gesture on the panel the slowest: adjusting one stack cost a stage, a scroll
and an Apply, and Cancel then discarded every unrelated edit along with it. A
tag change now commits on the gesture, one call each.

The two halves still hold to **disjoint fields**, so they still cannot race —
and a tags-only write never bumps `Character.updatedAt`, because
`applyCharacterEdits` skips its `character.update` when the core diff is empty.
So it cannot invalidate a core edit staged beside it, and the Tags tab
deliberately sends no `expectedUpdatedAt`.

**Every button in the bar is now a verb.** **Heal all**, **Feed** and the
**Inflict wound** picker all push *tag* ops, so all three fire and say what
they did. The bar used to carry one exception — a **Refund points** button
that recomputed `tagPoints` from the creation budget and *staged* the result,
which needed a `stages` caption and an inline "Staged X — press Apply" line to
stop reading as a dead button. It is gone, and the caption and that line went
with it. Each is one gesture, one
call, one audit row, one DM however many ops it carries, since
`applyTagOpsInTx` takes a batch: healing a ward is still one thing that
happened to the player rather than a burst of them. Heal-all and Inflict both
read `isHealable` from `web/lib/healRequests.js` (a **Health** tag carrying a
cure cost) rather than re-deriving the predicate, so the picker and the server
can't disagree about what an affliction is.

## 3. Layout

- **The band** (`DevBand.js`) — who this is, then the derived facts a GM wants
  before touching anything. It is built out of **`DetailTile`**, the same box
  the player's own sheet uses. That component came out of `LedgerBand.js`
  when the GM desks started wearing the sheet's Combat readout
  (`SHEET.md` §2, `COMBAT.md` §6); this band is its third caller.

  The band used to be fifteen bare label/value pairs in four labeled
  clusters, and after that a rulebook — every tile carried a sentence
  explaining the rule behind it. A GM running this panel already knows the
  rules, so the tiles are plain read-only boxes with nothing to hover, except
  where noted.

  **Four primary tiles, kept on one line: Resources, Tag points, Mood** (the
  band word), and **Gambit die** (opens to name which modifiers, from
  `gambitParts`). **Combat** (`CombatReadout.js`, the same tile the player's
  sheet and `/gm/turns` show, with `showArmorPieces` on — GM-only, names the
  worn pieces behind each armour word) sits on its own full-width row below
  them, not in the tile grid — its two-tree readout needs a third of the
  band's width to lay out without wrapping into a neighbour, the same reason
  `LedgerBand.js` gives.

  **A second row of tiles below Combat is the informational glance** — free
  to wrap over more than one line, unlike the primary four. **Equipped**,
  **Drawbacks**, and the bare **This turn** answered questions nobody was
  asking and are gone; in their place:

  - **Concealed** — a resolved answer that can disagree with what the player
    set: `Character.concealed` is only a wish and takes effect solely while
    something concealing is equipped, so it says **On, but nothing worn** for
    the state that reads to a player as "my hood does not work". The
    resolution happens in `web/lib/devPanelData.js`, through
    `presentedIdentity` — the same function every send path asks — rather
    than being restated on the client.
  - **This turn** — now the Move's own kind (`moveKindLabel`,
    `web/lib/moves.js`) when they've filed one, opening to its description —
    a fact about this character, never a rule.
  - **Staged for push** — the adjudication workspace's queued changes against
    this sheet, promoted from a footer line into a tile.
  - **Carrying** — `carryStatus()` (`db/lib/carry.js`), the same function
    `LedgerBand.js`'s own "Carrying" tile calls, fed the nested
    `characterTags` shape (below) rather than the flattened `held`.
  - **Expiring soon** — held tags due to run out this turn or next.
  - **Afflictions** — held tags the `isHealable` predicate calls an
    affliction, the same one the wound picker and Heal-all button use.
  - **Hunger** — whether the Hungry tag (`feed.dropSlug`) is currently held.
  - **Goals** — active Desires over the configured slot count, opening to say
    how many slots are unlocked and empty (`goalsSummary`,
    `web/lib/devPanelData.js`).
  - **Last activity** — the character's most recent `AuditLog` row,
    prettified (`web/lib/auditNarrative.js#prettifyActionType`).

  The identity line above the tiles also carries a **Cursed** badge
  (`curse.cursed`, not `Character.status` — that enum has no cursed value of
  its own), **Leader**/**Treasurer** chips, and a **turn ping** mark, none of
  which draw when they'd say nothing.

  There is no Discord-mirror control here any more — a GM who needs to flip
  a player's own "Play on Discord too" switch does it from `/character`
  material, not this panel; this surface doesn't carry an opinion about it.
- **Held tags** (`HeldTagsBody.js`) — always visible in the panel's main
  body, between the action bar and the tabs, not gated behind the Tags tab.
  Reuses the sheet's own grouping and rows — `buildCards`/`TagRow`/`ItemCard`
  from `web/lib/sheetCards.js` — the same reuse `InspectorColumn.js`'s
  `SheetView` already established for the adjudication desk, so a GM reads
  the same cards everywhere a tag list shows up. `includeStatus: true`
  because this panel has no `StatusStrip` of its own. Unlike `SheetView`'s ✕
  (which only *stages* a removal), every verb here — the quantity stepper,
  Equip/Unequip, Make permanent, Remove — fires immediately through the same
  `applyCharacterEdits` call the Tags tab's Grant flow uses: this is the GM's
  live edit surface, not the adjudication desk. Removing a tag whose
  `removesInto` chain would leave an aftermath behind (`TAGS.md` §5c) still
  asks first, naming what it will leave — the one gesture here that
  repeating its inverse does **not** undo.

  The nested shape it needs (`{ tag, quantity, equipped, … }`, with `tag`
  composed via `chipSelect()`/`composeChipTag()` — `web/lib/tagChipRows.js`
  — rather than a raw Tag row) is `characterTags` on the DTO, built once in
  `web/lib/devPanelData.js` and reused for the Combat tile's `held`
  projection, `carryStatus()`, `gambitModifiers`, and the Desire gates —
  one composition, not five queries.
- **Action bar** — `IconButton`s over `.icon-btn`, in named clusters: Life ·
  Turn · Reach · Body · Admin. A destructive verb never sits flush against a
  harmless one, and **Admin draws only for a superadmin** — Delete is all that
  is left in it, so a plain GM would otherwise get an empty labelled group.

  **Uncurse** lives in the Life cluster, beside Kill/Revive, and only draws
  when the character is actually cursed (`curse.cursed`). It is a single
  lift-only action — `setCurseOverride({ override: false })` — not a
  curse-setting control: this panel offers no way to curse someone from here,
  only to take it off. It writes `Character.cursedOverride` and never
  `buriedAt`, since stamping that would also take the body out of the world.

  **Two buttons were removed earlier.** The eye linked to `/character`, the
  signed-in GM's own sheet rather than this character's. **Re-push Discord**
  re-sent the role and the channel overwrites a character
  should already have, which is what `db:mirror` and the channel doctor do on
  every bot start anyway — so it could only ever confirm that nothing was
  wrong.
- **Tabs** — Identity · Tags · Turn · Goals · Record · Notes, on the existing
  `.tab-bar` / `.tab-item` classes. The Notes tab's own label reads
  **"Notes (N)"** once N is above zero — `adminNotesCount`, a plain
  `prisma.adminNote.count()` in `web/lib/devPanelData.js`, so a GM sees there
  is something to read without opening the tab first. **Notes** is the shared
  `AdminNotes` component, the same one the player desk's inspector mounts
  (`PLAYER-DESK.md` §7). It is keyed on the PLAYER, not the character, so it is
  the same list under every character that player has ever had — two characters
  on one account see one pile, which is the point. It takes no part in the
  staged-edit form: nothing of it is in `EDITABLE_FIELDS`, so a note never joins
  the Apply bar's diff and **Cancel cannot discard one** — notes commit the
  moment they are added, like a microaction. It needs none of the deferred
  `loadRecord` machinery either, because it fetches on mount and the mount is
  the fetch. One consequence worth knowing rather than discovering: a half-typed
  note is **not** dirty-guarded, so closing the modal with text still in the box
  loses it, the same way the Tags tab behaves. Identity's place field is a **Zone**
  select, listing presence zones only (the Caves group is a container, not a
  place); Apply swaps the zone's Discord role, and the empty option is a real
  choice meaning "nowhere, and no zone channel access". The band's identity
  line shows the zone for the same reason — there is no Location to show.
- **Apply bar** — `.dev-apply-bar`, sticky at the bottom, and rendered **only
  when something is pending**, so the panel reads as a viewer until it isn't
  one. Sticky rather than fixed so it stays in the page column and can't cover
  the nav rail on a narrow screen.

A staged edit's own affordance is `.field-dirty` from `DESIGN-SYSTEM.md` §5,
which outlines a single control with an unsaved edit. The Tags tab no longer
uses `.staged-row`: nothing there is pending long enough to need marking.

## 4. `applyCharacterEdits`

One payload, one transaction, one audit row. In order:

1. **Validate everything before opening the transaction**, so a rejected
   payload leaves nothing half-written. Names through `NAME_LIMITS` /
   `normalizeHonorific`, age through `AGE_MIN`/`AGE_MAX`, every foreign key
   checked to exist. A GM form is a public endpoint too.
2. **Allowlist.** `EDITABLE_FIELDS` in `web/lib/characterWrite.js` is the
   whole surface; anything else posted is ignored outright, which is what
   stops a hand-rolled request reassigning `discordUserId`.
3. **The dynasty lock**, keyed on the role *being saved* — so moving someone
   into a family seat renames them in the same write.
4. **`Character.name` recomposed** with `formatCharacterName`. This is the
   GM writer of that column; there is a fixed set and they all go through the
   formatter.
5. **In the transaction**: `SELECT … FOR UPDATE` on the Character row (the
   same lock `equipActions.js#equipOne` takes, so an Apply and a player's
   equip tap serialise), an `expectedUpdatedAt` check, the update, the tag
   ops, the audit row.
6. **Discord afterwards**, in `after()`, never inside the transaction — a
   REST call there holds a Postgres connection open across the network. The
   steps are computed as a **plan** rather than a run of independent `if`s,
   specifically so a dead character can't fall through into a branch that
   re-grants channel access.

### Optimistic concurrency

`expectedUpdatedAt` comes from page load and is re-checked inside the
transaction. Two GMs on one sheet is rare enough not to warrant the
cooperative lock Moves use, but silently clobbering the other one's save
isn't acceptable either — the loser is told to reload.

## 5. Tag ops

Keyed by **`tagId`, never `characterTagId`**. A `characterTagId` can vanish
between page load and Apply: the expiry sweep in `resolveNeeds()` deletes rows
at every turn close. `@@unique([characterId, tagId])` makes `tagId` a stable
address, and it is what every `tagEffects.js` helper already takes.

```
{ tagId, op: "add",    quantity?, source?, expiry?, equipped? }
{ tagId, op: "remove", quantity? }      // null quantity = the whole holding
{ tagId, op: "patch",  quantity?, equipped?, expiry? }
```

A quantity stepper (`web/app/components/QuantityField.js`) is rendered **only
when the tag is `stackable`**. Everything else is a holds-it-or-doesn't flag:
no box, and the button just reads "Grant". The `force: true` escape hatch that
used to let a GM stack anything is gone (`TAGS.md` §5a).

**The two steppers mean different things, and that is the point.** On a
`TagEditor.js` *catalog* row — a tag not yet held — it is "how many to
grant", so it feeds an `add`. On a `HeldTagsBody.js` row for an existing
holding it is **the resulting count**, so it feeds a `patch quantity`, which
`applyTagOpsInTx` writes straight onto the row. Setting a stack of seven to
three is one gesture; it used to be four clicks of "Take one", because the
Remove button was pinned to `quantity: 1` and ignored the number box sitting
beside it.

Two consequences of an absolute count worth knowing:

- **Zero means the whole holding goes**, and the client converts it to a
  `remove` before sending. `validateTagOps` refuses a `patch` below 1 outright
  rather than degrading to a removal, so the conversion cannot be left to the
  server.
- **Rapid steps coalesce.** An absolute quantity is idempotent, so
  `HeldTagsBody.js`'s stepper debounces and sends only the number it settles
  on. A stream of deltas could not be collapsed that way — this is the
  concrete reason the control sets a count rather than nudging one.

Applied **removes → adds → patches → equipped**. Removes lead so swapping one
tier of a chain for another can't trip the equip cap halfway through; the
equip count is checked **once** at the end, so "unequip A, equip B" isn't
rejected on B.

A `remove` fires the tag's **treated-wound aftermath** (`Tag.removesInto`,
`TAGS.md` §5c): removing a Broken Bone leaves Splinted behind for four turns.
This used to be godmode and skip the chain; it doesn't, because most GM
removals are treatments. The aftermath is rolled per op, granted **after** the
adds — so an explicit add of the same tag, with its own source and expiry,
wins — and recorded as `granted` on the `remove` entry in the audit row.
Removing a tag the character isn't holding grants nothing.

Every add stamps its expiry through `expiryFor(tag, openTurn)`. This is not
optional: the sweep matches on `expiresTurn`, so a timed tag granted with a
null there never expires at all.

## 6. The Tags tab is add-only

`PointBuy` is the *player's* rules-respecting store and stays that way. The GM
editor shares its pure helpers and deliberately drops every gate:

- **Every category**, hidden ones (Demoness) and `meta` included.
  `TAGS.md` is explicit that a GM grant ignores `requiredTag` and the
  `TagGroup` gate; this is the surface that does it.
- **No budget.** Cost is information, never a limit — `tagPoints` is a field
  on the Identity tab.

Both menus share `filterTagsByQuery` from `characterCreation.js`, so search
behaves identically. In `PointBuy` the search runs **after** `unlockedTags`,
never instead of it — otherwise a lucky search string would reveal a gated tag.

**`TagEditor.js` used to split into two permanent sections — Holds and the
catalog. Holds is gone from this tab.** What a character actually has moved
to the panel's main body (`HeldTagsBody.js`, §3) — always visible, not
gated behind a click — because "what does this character have" and "what am
I adding" are different questions, and conflating them is why a Grant button
here once quietly meant something different from the stepper sitting above
it. The tab is exactly what's left: search, grant, create custom.

- **Catalog** — the browser, tabbed by category. Within a tab, tags are
  bucketed under a small header per `TagGroup` (name plus the group's own
  colour as a swatch — the one inline colour in the app, since it's freeform
  data out of the database, not a theme token), chain order inside the
  group, ungrouped tags last under no header. Each row is one line — checkbox
  (mass-grant), name, cost, badges (custom / held) — with the
  description behind a native `<details>` disclosure so the tab isn't a mile
  of always-open panels. A held tag still shows up (that's how a GM finds the
  next tier of a chain), but carries no action here — just a "held ×N" line;
  editing an existing holding happens in the main body now, not this tab.

  The catalog half — search, tabs, grouping, the row shell, multi-select — is
  the shared `web/app/components/TagCatalogBrowser.js`, extracted so
  `EffectComposer.js` (`/gm/turns`' stage-an-effect modal) gets the same
  power-user tag surface instead of a flat name/slug search box. Row actions
  are the one thing each caller supplies (`renderActions`): `TagEditor.js`
  grants live, `EffectComposer.js` stages an add/remove op instead. Held-tag
  context differs too — `EffectComposer.js` shows the *target's* held tags
  read-only next to its own staged-ops list, since a staged effect only ever
  adds a fresh op.

A non-empty search box searches the **whole catalog**, ignoring the active
category tab, with a chip on each hit naming its category. Clear the box to
go back to per-category browsing.

**Minted is the last tab, and it is not a category.** Every runtime-minted row —
the notes players wrote, corpses, crates, photographs — buckets there instead of
swelling Items, which can otherwise be a hundred letters deep before the first
longsword. It is derived from `Tag.ephemeral`, the column that already means
exactly this (`/gm/dev`'s quest picker filters on it for the same reason), so it
cannot drift from what the minters write. The tab only appears when there is
something in it, and a search still crosses it: somebody typing a letter's title
wants that letter, tab or no tab.

This used to happen by accident. The minters wrote a lowercase `items` that
`SELECT DISTINCT category` sorted into its own tab beside the real `Items` — the
right shape for the wrong reason, and the same slip made those rows invisible in
the `/chat` Things drawer (`TAGS.md` §1). The rows were backfilled on
2026-09-26; this tab is that separation done deliberately.

## 7. Turn economy

There is **no `turnsRemaining` column**. "Has this character acted" is
entirely "does an `Action` row exist for (characterId, the open Turn)".
Everything follows from that:

- **Restore turn** deletes the row, after `revertMoveEffects` claws back
  anything already applied. Since the staged-arbitration rework nothing pays
  before the turn-end push, so pre-push there is nothing to claw back —
  `appliedEffects` is null and the revert is a no-op — but the call stays,
  because it is what keeps this correct for any row that *has* been pushed.
  Shared with the workspace's Unlock as `deleteActionRestoringTurn` in
  `web/lib/moveEconomy.js` — two copies would drift the first time
  `appliedEffects` grew a key. It refuses while another GM holds a live lock
  on the Move, and DMs the player, since a freed turn they don't know about
  is a wasted day.
- **Spend turn** files a stub: a `PASSED` Routine worth nothing, marked
  `gmNotes: "auto:gm_spent_turn"` in the same family as
  `autoLaborPass.js`'s `auto:labor`. It DMs the player too. Kill, Restore
  turn and Spend turn are each a one-line `useConfirm` — they used to open a
  `RequestDialog` for a typed reason first, and nobody ever wrote one that
  said anything the DM did not. The server actions still take an optional
  `reason`, which becomes the DM's second line (and the stub's
  `description` for Spend turn) when a caller passes one.

Editing a Move is **not** duplicated here. `/gm/turns` owns that, with the
cooperative lock, the dirty guard, Solve/Reject and the dice invariant on a
Kind switch; the Turn tab links across.

## 7a. Resource transfers

The Identity tab's Resources field only mints or burns ⬢ — it has no
counterparty, because a staged edit is one character's diff. "The Cerberi
paid Sera 8 ⬢" needs a party on both ends, which is what the **Transfer ⬢**
button (`ActionBar.js`, `ResourcesIcon`) is for: two Selects, "From" and
"To", each over the roster of ALIVE characters — with a small ⇄ button to
swap them, plus an amount. This panel just preselects "To" as this
character, with "From" left on "— Select… —".

It is **immediate, not staged**, unlike the panel's column edits. The
counterparty usually isn't this panel's own subject, so having half of it
wait on *this* character's Apply/Cancel would be incoherent — the same
reasoning that keeps Kill, Revive, Restore turn and Spend turn off the staged
diff. It goes through `web/lib/gmTransfer.js`, the same primitive the
adjudication desk's staged transfers use
(`db/lib/resourceTransfer.js#applyTransfer`), open to any GM — not just a
superadmin — and writes an `AuditLog` row rather than a `Request`, so there
is no one-click Undo; the reverse transfer is the reversal.

`gmTransferResources({ fromKey, toKey, amount, reason })` (the reason is
optional now, and the Dev Panel no longer asks for one) is the same generic
primitive the adjudication desk's `TransferComposer` stages a transfer
through, so the Dev Panel's server action (`transferResourcesImpl`) just
passes `fromKey`/`toKey` straight through. It still preselects this
character on one end for convenience, still writes an `AuditLog` row instead
of a `Request`, and is still **immediate, not staged** — same reasoning as
above.

## 8. Custom tags

`/gm/dev?s=tags` lists the whole catalog and lets a GM author their own. A
GM-authored tag carries `Tag.custom = true` and lives only in the database.

- **Slugs are server-generated as `custom-${slugify(name)}`, never typed.**
  A GM naming a tag "Arthritis" would otherwise collide with the YAML slug and
  the next `db:sync-tags` would upsert straight over their row.
- **YAML-sourced rows are read-only here.** `docs/tags.yaml` is their source
  of truth and the next sync would revert a UI edit, so allowing it would be a
  lie.
- **Deleting** is superadmin-only, and refused for a tag anyone holds or
  anything references.

`db:sync-tags` is unchanged and still upsert-only. `db:prune-tags` is its new
destructive counterpart — see `SYNC.md`.

### 8a. The shared custom-tag dialog

Authoring a one-off tag isn't only a `?s=tags` action — a GM chasing a
Move or editing a sheet often wants to invent a tag on the spot and hand it to
someone right there. `web/app/components/CustomTagDialog.js` is the one
dialog for that, reached from several doors: the standalone catalog page's
"New tag" button, the Dev Panel's Tags tab (`TagEditor.js`), and the
adjudication desk's stage-an-effect modal (`EffectComposer.js`). Every door
mounts it through `TagCatalogBrowser`'s optional `onCreateCustom` prop, which
renders a "+ Custom tag" button in the browser's toolbar carrying the same
tooltip everywhere: *"Use this for things that would affect adjudications —
not just little bracelets or something."*

**The tag's own fields are `web/app/components/TagFieldset.js`**, shared with
the catalog page's *edit* dialog. The two used to be different forms — this
quick door sent five fields while the edit form sent sixteen — so a tag
invented mid-adjudication couldn't expire, stack or be worn until someone
walked to `?s=tags` and edited it. One component means they can't drift
again.

It opens on **Basics** — Name, Category, Group, Description, Seen by others on
🔍 — with everything else folded into a collapsed `Advanced` disclosure in four
blocks: **Behaviour** (`stackable`, `equippable`, `concealsIdentity`,
`consumable`, `removable`, `tradeable`, `healable`, `teachable`, the two
armour fractions and `weightLbs`), **Lifespan** (`defaultDurationTurns`,
`expiresInto`, `removesInto`), **Economy** (`pointCost`, `purchasable`,
`purchasableAfterStart`, `sellable`, `sellablePrice`) and **Requirement**
(`requirementTurns`, `requirementResources`, `requirementGambit`,
`requirementSkills`). `removable` is editable here like the rest, but on a
CATALOG tag the next `db:sync-tags` derives it back from the category
(`CRAFTING.md` §5) — the checkbox is for custom rows, which no sync sees.

The edit dialog opens that disclosure, since a GM there
came to change a field; the quick door leaves it shut.

Group is still offered only when the caller's tag rows carry a group id —
several DTOs trim `TagGroup` to name/color for display and can't resolve a
picker back to one. The **two chains** — expiry (`expiresInto`) and removal
(`removesInto`, the treated-wound aftermath, `TAGS.md` §5c) — take the same
posture for the same reason: they address tags by `slug`, so a door whose
rows carry none hides them rather than offering a picker whose selections
would never match. They share one row editor; only the expiry chain is gated
on a duration, since the removal chain is fired by the removal itself.

**Weight** is the one Behaviour field nothing disables — a sack of grain is
cargo without being equippable — and it is always optional here. Blank means
the tag is not cargo at all (every skill, status, injury and Asset), which is
a different claim from `0`, a real rung for a key or a letter (`CARRY.md` §1,
and the band table in the header of `docs/tags.yaml`). `db:sync-tags` refuses
a tradeable `items` tag with no weight; this door deliberately does not, since
a GM patching one situation mid-turn shouldn't be stopped to price a weight.
It still refuses a negative one.

Three pairings are mirrored as disabled controls and re-checked on the server:
`concealsIdentity` and `WORN` visibility need `equippable`, `sellablePrice`
needs `sellable`, and an `expiresInto` chain needs a duration.

`concealsIdentity` is then **refused outright** on a GM-authored tag, pairing
notwithstanding. Concealing gear also needs a `Tag.concealSprite`, and that has
to be a real file under `web/public/assets/helms/` built by
`npm run assets:helms` — nothing a GM can add from here. Left half-set the flag
would do nothing at all, so the form says so rather than silently producing a
mask that conceals nobody. Headgear is authored in `docs/tags.yaml`
(`TAGS.md`, `PROXYING.md` §5). The read-only chips on the detail sheet still
show `Conceals by force`, `Conceal sprite:` and the `Worn: head · layer 3`
pair for catalog tags. The chain itself
is a list of outcome rows, each a multi-pick — one tag means "becomes this",
two or more an even coin-flip, the `{ oneOf: [...] }` shape
`db/lib/tagExpiryPass.js` reads.

The **structural** fields stay out on purpose — `parentTagId`,
`requiredTagId`, `exclusive`, `depotPrice` and the `consumesInto` family wire
tags to each other, which is catalog structure for `docs/tags.yaml` to hold
under review. The two chains are the deliberate exception: an untreated wound
getting worse — and a treated one leaving its aftermath — is most of the
point of a homebrew injury, and both point at existing tags rather than
restructuring them. Their rules (`normalizeExpiresInto` /
`validateExpiresInto` and the `removesInto` pair) live in
`db/lib/tagShapes.js` so this form and `db:sync-tags` enforce one rule set —
otherwise the form would accept chains the next sync rejects.

The door's own fields, around that fieldset: Clone from… (prefills **every**
field from an existing catalog tag, its duration and expiry chain included,
then edits normally) and Assign to (a searchable multi-pick over whatever
character list the door supplies — hidden entirely when the door has none to
offer). New tags default to `purchasable: false`,
`purchasableAfterStart: false`, `removable: true`, and visible on 🔍 — a
homebrew tag for solving one situation, not a catalog entry meant to reach the
store.

Doors that pass a character list also get an Apply now / Stage for turn end
toggle (`allowStage`). "Apply now" grants live, in the same transaction as the
tag's creation (`applyTagOpsInTx`, same engine §5 documents). "Stage for turn
end" writes a `StagedEffect` per target instead — one shared `batchId` across
a multi-target assignment, built the same shape `createStagedEffects` uses —
so a GM chasing a Move can invent the tag and queue it against that Move's
target in one gesture. Either way it's **one transaction, one audit row**
(`gm_custom_tag_created`, mirroring `bulkTagCharacters`' details shape) for
the tag's creation and its assignment together. The server half is
`createCustomTagAndAssign` in `web/app/(app)/gm/dev/tags/actions.js`.

The Dev Panel's own door (`TagEditor.js`) commits a custom-tag assignment
through the dialog's own transaction, in the same gesture that creates the tag
— the same posture Bulk tagging (§9) takes. This used to be an exception to
§2's split, back when the Tags tab staged; now that tag changes fire anyway it
is simply the same rule, reached by a different transaction. `DevPanel.js` passes the current
character's id and name into `TagEditor.js` so "Assign to" comes preselected.
The same door also sits in the shared inspector's Tags tab on both desks
(`web/app/components/InspectorColumn.js`, `customTag` prop) — staging by
default on `/gm/turns`, applying on `/gm/players`. A multi-target grant runs
one transaction per character (never one across the batch, for the reasons §9
gives), refuses dead targets, caps at 200, and reports partial failure.

## 9. Bulk tagging

The player desk's roster grows a "Tag selected" bar beside the message composer,
reusing the row selection already there. `bulkTagCharacters` runs **one
transaction per character, never one across the batch**: a hundred-character
transaction would hold a row lock against each of those players' own equip
toggles for its whole duration, and one bad character would roll back
ninety-nine good ones. Partial success is reported; one audit row covers the
batch.

## 10. As a modal over `/gm/turns`

The whole panel — all five tabs and every microaction — also mounts as a
modal directly over the adjudication desk, so a GM chasing a Move or Request
can jump into a character's full sheet without leaving the desk or losing
its state (selected queue row, inspector, pins, staged effects). `DevPanel`
takes `frame="modal"` and owns the `Modal` itself, because the dirty (staged
edit) state lives inside it — closing has to go through the same
`useDirtyGuard` that already guards Apply/Cancel, so an unsaved edit prompts
before the modal closes.

The modal is **modeless** (`DESIGN-SYSTEM.md` §8) — no backdrop, the desk
underneath stays clickable, and the header drags the panel aside. So are its
own dialogs: Message, Teleport, Inflict a wound, and the reason prompts for
Kill, Revive, Restore turn, Spend turn and Transfer ⬢. Two things stay
blocking, because both are asking a question that needs an answer: every
`useConfirm()`, and the typed-name **Delete character** dialog. The
`useDirtyGuard` close path is untouched — an unsaved staged edit still prompts
before the modal closes, whichever way it is dismissed.

The data assembly is shared, not duplicated: `web/lib/devPanelData.js`
exports `loadDevPanelProps(characterId, actingDiscordUserId)`, the DTO bundle
`<DevPanel/>` needs to **open**, and both the standalone page and the desk
call it. The desk reaches it through its own server action,
`getDevPanelData` in `web/app/components/devPanelActions.js` — a
separate file from the desk's `actions.js` because that file is itself
`"use server"` and can't export a plain loader function, and because its
`requireGm` isn't importable from another `"use server"` module.

**The Record tab is not in that bundle.** Its four history lists (100 Moves,
100 Requests, 100 audit rows, 50 DMs) were the largest thing the panel loaded
and the least likely thing it used — most visits are "grant a tag, close it".
They live in a second export, `loadDevPanelRecord(characterId,
discordUserId)`, behind the `getDevPanelRecord` server action, and `DevPanel`
fetches them from the tab button's own **click handler** on the first switch
to Record — not from an effect, since `react-hooks/set-state-in-effect` is an
error in this repo. `RecordTab` renders a "Loading…" line until they land,
and the result is cached for the life of the mount. `openTurnAction` used to
be found inside that 100-row Moves list; it is now its own small `findFirst`
in the main batch.

`DevCharacterButton` (`web/app/components/DevCharacterButton.js`) is the
shared jump button everywhere a `CharacterLink` might want one. Given an
`onOpen` callback it opens the modal instead of navigating to the standalone
page — the desk's `Workspace.js` owns the open/closed state and passes
`onOpenDev` down through `MoveDesk`, `CavingDesk`, and `InspectorColumn`.
Without `onOpen` it falls back to the plain `Link`, used everywhere else.

In the `onOpen` branch it also **prefetches at click time**: `onPointerDown`
calls `prefetchDevPanel(characterId)`, exported from `DevPanelModal.js`,
which starts `getDevPanelData` and parks the promise in a module-level map.
The modal's mount effect consumes an entry younger than 20s instead of firing
its own fetch, so the round trip overlaps the mount rather than following it.
`reload()` (the `onMutated` path) drops the map entry first — a microaction
just changed the sheet, so any parked promise is stale by definition.

A microaction's refresh (Kill, Revive, Teleport, a tag gesture…) flows
through an `onMutated` prop rather than a bare `router.refresh()`: in the
modal it re-fetches `getDevPanelData` (so the open panel repaints) and also
calls `router.refresh()` (so the desk's own queue rows and staged hints
repaint too). The standalone page still just calls `router.refresh()`.
Delete follows the same shape through `onDeleted` — the modal closes itself
and refreshes the desk, instead of the page's own navigation away.

## 11. The other Dev Panel: `/gm/dev`

A different page from this doc's character panel — the game-level one. It is
the fourth page in the `(desk)` family (`DESIGN-SYSTEM.md` §6): a two-column
settings workspace, `OpsNav.js` picking one section down the left over a
validated `?s=` param, one settings surface on the right. Each section fetches
only its own data — `listGuildMembers()` and the role/seat maths only load for
the two Threats sections, instead of on every visit regardless of which section
a GM actually opens.

The split across two route groups is deliberate. `page.js` and `OpsNav.js`
live in `(desk)/gm/dev/`, because the `(app)` layout's fixed `TurnChip` would
float over a desk shell (same reason no desk carries one — `DESIGN-SYSTEM.md`
§6). The server actions, the client tables and the nested editors stay in
`(app)/gm/dev/`, since only the top page needed to move.

**One navigation now, not two.** Characters, Factions, Tags and Zones used to
be four PageShell pages of their own, listed in an "Elsewhere ↗" group on the
rail and again in a `DevSubNav.js` row in their own headers, both reading one
shared `DEV_PAGES` list. Their index pages are **sections of this panel**
now — `?s=characters`, `?s=factions`, `?s=tags`, `?s=zones` — so there is one
rail and no shared list to keep: `DevSubNav.js` and `web/lib/devNav.js` are
both gone. The old paths redirect to their sections.

What stays a route is anything *below* an index: `/gm/dev/characters/[characterId]`
(this doc's own panel, which mounts as a modeless modal over `/gm/turns` — §10)
and the place editor's `zones/[zoneId]`, `zones/locations/[locationId]`,
`zones/rooms/[roomId]` and `zones/links`. Each of those carries one named way
back (`← Characters`, `← Zones`) rather than a five-item nav.

**`/gm/dev/threats` is a redirect, not a page.** The threat surfaces are two
*sections* of this panel (`?s=assignments`, `?s=antagonists` — `THREATS.md`
§1); the `threats/` folder holds only their tables, which the panel imports.
It had no `page.js`, so every link written to the obvious-looking
`/gm/dev/threats` 404'd. It now redirects to `/gm/dev?s=assignments`.

### 11a. Two tiers, one table

The panel is **not** superadmin-only. It has two tiers, and the line between
them is *host access* against *running the game*:

- **`super`** — the superadmin (`web/lib/superadmin.js`). Wipe the game, retune
  the economy, force a turn, open and close the lobby: things whose blast
  radius is the whole installation.
- **`gm`** — anyone holding either GM role (`gmRoleIds()`, `GAMEMASTERS.md`).
  The daily work: move a group of characters, send a letter, say a line into a
  zone, set an antagonist's objectives.

`web/lib/devAccess.js` is the whole difference. `SECTION_TIER` names a tier per
section, `allows(tier, need)` answers, and `getDevTier()` resolves the viewer
to `"super" | "gm" | "none"` off `getGmSession()` (already `cache()`d, so the
guild lookup is paid once). Three things read that one table, and nothing else
decides access:

1. `page.js` — redirects `"none"`, then picks the section through
   `resolveSection(tier, s)`. A section this tier cannot open falls back to
   their home section (`game` for a master, `bulk` for a GM) rather than
   bouncing them off the panel.
2. `OpsNav.js` — filters its items and drops a group that empties, so a GM
   never sees a door the gate will not open.
3. `requireDev(need)` — the one guard every server action in
   `actions.js`, `threatActions.js` and `objectiveActions.js` calls. It
   replaced three identical copies of `requireSuperadmin`, which survives as a
   one-line alias so the callers that still cost `super` read unchanged.

The gate lives in `page.js` rather than the layout because `(desk)/layout.js`
only checks GM membership — `/gm/players` and `/gm/turns` share that layout.

**Four controls narrow inside a section a GM can otherwise open.** Each is
checked against the tier at the call site *and* in its action, because a server
action is a public endpoint and a hidden button is a hint:

| Where | Superadmin only |
|---|---|
| `?s=reports` | **Repair**. `runDoctorAction` reads the posted `mode` **before** the guard and asks for `super` only when it is `repair` — the dry run is GM work |
| `/gm/dev/factions` | Delete a faction (`FactionsTable`'s `canDelete` prop) |
| `?s=tags` | Delete a custom tag |
| `/gm/dev/characters/[id]` | Delete a character |

Characters and Factions are GM-open. The per-character panel this doc is about
was always GM-gated, so its own index being superadmin was an inconsistency,
not a policy.

### 11b. The sections

Fifteen: **Game**, **History**, **Turn**, **Configuration**, **Depot** and
**Oracle** under "Game"; **Bulk actions**, **System reports** and
**Gamemasters** under "Operations"; **Quests**, **Characters**, **Factions**,
**Tags** and **Zones** under "Content"; **Assignments** and **Antagonists**
under "Threats"; **Archive & restart** on its own under "Danger". Everything
under "Game" and "Danger" is `super`; everything else is `gm`.

Two label notes. **History** is still `?s=games` — renaming the key would
break every bookmark to buy nothing, and "Game" sitting beside "Games" was the
actual problem. **Depot** and **Oracle** dropped their definite articles;
nothing else on the rail carried one.
The Game section — phase, lobby roster, the assignment preview, Start and End
— is `LOBBY.md`. The two Threats sections replaced the old Antagonist Roster
popup and have their own doc — `THREATS.md`; the Antagonists section also
carries the **Objectives** cards, one per antagonist party (`THREATS.md` §6a),
and the pending spawn offers.

**Assignments opens with Seats out** (`SeatsOut.js`): every `LobbyEntry` that
is `ASSIGNED` with no character yet — a seat handed out and not taken up —
with the handle, the role, how long is left on the window, and whether the
six-hours-left reminder has gone. Read-only: the seat expires on its own
(`db/lib/lobbySweep.js`) and re-offering is a Start-Game concern.

It is here rather than beside the lobby roster because **`assignments` is `gm`
and `game` is `super`**. The roster shows the same rows, but it sits next to
Start, End and Restart Game, so an ordinary GM could not reach it — which
meant the loudest thing the game says to anybody ("You're in. You are the
Baroness.") went out with nobody but the master able to see who had been told.
That gap only became visible when notices stopped counting as conversation on
the player desk (`PLAYER-DESK.md` §5); before that the assignment DM sat in
the inbox and the answer was an accident.
`LAUNCH.md` covers Restart Game itself, and the Depot section is this doc's
appendix.

**Configuration is rendered from a registry.** Every `GameConfig` knob is
declared once in `db/lib/gameConfigFields.js` — key, type, group, label, help,
clamp, default — and `ConfigForm.js` renders that list while
`updateGameConfig` parses it (`parseConfigForm`). A column without an entry is
unreachable from the panel, so `npm run db:check-config` (run by `push.sh`)
diffs the registry against the schema. None of it is reset by a wipe any more;
per-game state lives on `GameState` and is edited on the Game section (the
Lifeweb blood override) or the Turn section (next-turn overrides).

**Knobs documented nowhere else:**

| Knob | Does |
|---|---|
| `desireSlots` | How many Desires a character may hold ACTIVE at once, one per slot (default 2). Each slot sets/cancels/fulfils independently (`DESIRES.md` §1) |
| `maxDrawbackTags` | Character-creation cap on the COUNT of drawback tags a player may point-buy (default 6) — not their combined point value. A GM grant bypasses it, same as every other creation gate (`TAGS.md` §4a) |
| `maxDrawbackPoints` | The other half of the same ceiling: how many points those drawbacks may claim back in total, as a positive magnitude (default 13). A build stops at whichever cap it reaches first (`TAGS.md` §4a) |

**System Reports** shows the latest run of each operational pass — `WIPE`,
`DOCTOR`, `DAWN_WIPE`, `BULK_MOVE` — with its summary and its failures. A
report with no finish time means the container died mid-pass; that is the
signal, and the reason the row is written *before* the work starts rather than
after. Two buttons sit above it: **Run channel doctor (dry)** and **Repair**,
both full scope, both fired into `after()` so the button returns immediately
and the outcome shows up where every other pass reports (`CHANNELS.md` §6).
Repair is superadmin — see §11a.

**Discord mirror** is the panel under them, superadmin only. **Preview mirror**
reads the database, reads the guild once and lists every place the two
disagree, writing nothing — safe to press on a live game. **Reconcile now** is
the same comparison with the writes turned on: it creates what is missing,
adopts a same-named object before it would cut a second, reparents, renames,
rewrites a room starter that has drifted from its row, and then reconciles who
can see what. It runs in `after()` and reports as a `MIRROR` row in the list
below. The line under the buttons is the queue: how many places are waiting for
Discord, how many are retrying after a failed pass, and whether the circuit
breaker has suspended calls altogether. Waiting is normal and clears in
seconds; retrying is not (`CHANNELS.md` §6a).

**Who has gone quiet** sits above it: the same three buckets
`npm run db:report-inactive-characters` prints — left the guild, never
registered any activity, idle since day one — with a checkbox per row and a DM
box. Both surfaces read `db/lib/inactivity.js`, which is why the query was
lifted out of the ops script: the list a GM nudges from the web and the list
the CLI prints cannot be allowed to disagree about who counts as inactive.
`nudgeInactivePlayers` re-derives the eligible set from that module rather than
trusting the posted ids, and sends through `web/lib/discordGuild.js#sendDm` so
the nudge lands in the player's conversation on `/gm/players` instead of only
in somebody's client.

**Bulk actions** is one section for the whole "pick an audience, then say or
do one thing to all of them" family. Six verbs, two audiences:

| Verb | Picks | Calls |
|---|---|---|
| Move | characters | `applyBulkAction` |
| Resources | characters | `applyBulkAction` |
| Tag | characters | `applyBulkAction` |
| Message | characters | `sendGmBroadcast` |
| Letter | characters | `sendGmLetters` |
| Say | zones / Locations / Rooms | `sendAmbientLine` |

It used to be four sections — Bulk actions, Send a letter, Say something, and
a Broadcast tab on the Quests panel — with four pickers, four previews and four
send buttons between them, and three of the four could only reach one target at
a time. `?s=letters` and `?s=ambient` still resolve; `resolveSection` maps them
here rather than bouncing their owner to a home section.

The two audiences hold **separate live selections**, so switching Move → Say →
Move does not lose the roster you just picked. The character list is not
zone-scoped; the place lists are, to the GM's own `GmZoneView` zones, and
`sendAmbientLine` re-checks that scope per call.

**The first three verbs are raw edits** like `updateCharacterRaw`'s: no Move
cost, no `Action` filed, no adjacency check, no point spend, and no Undo.
`AuditLog` is the only record (`REQUESTS.md` §1a), so each writes its own row —
`gm_bulk_move`, `gm_bulk_resources`, `gm_bulk_tag` — and every run opens a
`BULK_MOVE` `SystemReport` finished inside `after()`, because the Discord half
runs past the response and a failure has nowhere else to be seen.

Two things about those verbs are load-bearing:

- **Tag goes through `grantTagSlugs` / `dropCharacterTag`** (`db/lib/tagWrites.js`),
  deliberately **not** the staged `applyTagOpsInTx` path the character panel
  uses — that one carries per-sheet validation and an optimistic-concurrency
  token this form has neither of. The stacking rules and the Blessed ward still
  apply, because they live in `grantTagSlugs`. It ends in
  `afterInventoryChange`, the same sweep every other tag writer runs, since a
  tag can change carry or a room key.
- **Resources clamps at zero.** A negative balance is not a state the rest of
  the game knows how to read.

**Say** posts a line of scenery through `db/lib/ambientLine.js` and
`postMessage`. The formatting is the whole reason the preview exists: `-#`
subtext is **per line**, so a two-line scene typed by hand in Discord comes out
half subtext, and `ambientLine` no longer signs anything itself — the panel
renders exactly what will be posted. Many targets at once means one call per
target, **sequentially, never `Promise.all`**: a fan-out across a zone list is
the shape that earns a Discord rate-limit ban. A partial failure is reported
per target. The intercom is the deliberate exception to all of this and is
**not** reachable from here — a PA is a loudspeaker, not scenery
(`db/lib/intercom.js`).

**Letter** puts a bird at somebody's window carrying a letter from whoever the
GM says it is from — the God-King, a dead man, nobody at all. It is the Bird
system with three branches, and `BIRD.md` §9 is its doc: the paper is minted
rather than taken off a sender's sheet, the seal's mark is typed rather than
pressed from a stamp, and the reply comes back as a row on that player's
conversation at `/gm/players`. `sendGmLetters` takes many recipients — one
sender, one seal, one body, N sheets, which is a proclamation nailed to N
windows. It validates everything that can refuse the whole batch **before**
minting anything, then runs **one transaction per recipient**, sequentially: a
hundred-character transaction would hold a row lock against each of those
players' own equip taps for as long as it ran (§9). A dead recipient is skipped
**by name** rather than taking the batch down. Capped at 200.

**Message** is the one verb that does not loop here at all: `sendGmBroadcast`
already fans out sequentially on the server inside `after()`. It is the same
action `/gm/players`' bulk composer calls — the shared internal is the action,
not a loop.

**The picker is shared.** `web/app/components/CheckPicker.js` (with
`usePickList.js` for callers that have no selection state of their own) is one
component across this section's two pickers, the quest gates, and
`/gm/players`' `BulkComposer`. It was `quests/GatePicker.js`, whose header said
to promote it on the fourth call site outside that folder; this was the fourth.
What made it shareable without a `filterDef`/`renderRow`/`selectAllMode` prop
soup: matching is a `search` **function** the caller passes, a row's second line
is the existing `note` field, Select all always unions, and anything else beside
the filter box goes in one `toolbar` slot.

### 11c. The History section

`/gm/dev?s=games` — the key is still `games`; the rail says History.
Superadmin. Every `Game` row there has ever been, newest
first: what it is called (its label, or the dates it ran — `gameTitle`), its
short id, how it ended (Running / Ended / Nuked or Ascended with the turn /
Never finished), whether its transcript has been exported to a packet or has
left the database entirely, and the days, turns, characters and deaths off its
stored epilogue. The archive count is the exception — it is counted live,
because `epilogue.facts.archived` is a snapshot from the moment a game ended
and the game being played has no epilogue at all — and it is the link into
`/archive?game=<id>` for that game. A game that has been archived away links
too: the page renders its stub.

This section exists because a game stopped having a number (`ARCHIVE.md`
§"Identity"). The ordinal was the only thing that made the pile of `Game` rows
legible; the list is what makes them legible now. It reads, it does not edit —
Archive this game and Restart Game's keep-or-discard are on the Game and Danger
sections, and taking the whole history down at once is `npm run
db:collapse-games`, off a command line and behind a dry run.

## 12. Where the code lives

| Concern | File |
|---|---|
| Page shell | `web/app/(app)/gm/dev/characters/[characterId]/page.js` |
| Shared DTO assembly (page + desk modal) — `loadDevPanelProps` to open, `loadDevPanelRecord` for the deferred Record tab | `web/lib/devPanelData.js` |
| Staged state, tabs, Apply bar, the "modal" frame | `DevPanel.js` |
| Microaction row and its dialogs | `ActionBar.js` |
| Tabs | `IdentityTab.js`, `TagEditor.js`, `TurnTab.js`, `GoalsTab.js`, `RecordTab.js`, and the shared `web/app/components/AdminNotes.js` + `adminNoteActions.js` |
| Server actions | `actions.js` (same directory) |
| Validation, diff, tag ops, effect plan | `web/lib/characterWrite.js` |
| Turn economy, the Move lock predicate | `web/lib/moveEconomy.js` |
| FK-ordered character purge | `db/lib/deleteCharacter.js` |
| Custom tag catalog | `web/app/(app)/gm/dev/tags/` (the table; the page is `?s=tags`) |
| Bulk tagging | `web/app/(app)/gm/actions.js#bulkTagCharacters` |
| Shared tag search | `web/lib/characterCreation.js#filterTagsByQuery` |
| The one quantity control, shared with every player-facing dialog | `web/app/components/QuantityField.js` |
| The shared tag form body (both custom-tag doors) | `web/app/components/TagFieldset.js` |
| `expiresInto`'s shape + rules, shared with `db:sync-tags` | `db/lib/tagShapes.js` |
| Shared catalog browser (categories, search, grouping, multi-select) | `web/app/components/TagCatalogBrowser.js` |
| Panel styling | `.dev-state-strip`, `.dev-state-group`, `.dev-bar-sep`, `.dev-apply-bar`, `.dev-tag-row`, `.dev-tag-group-head`, `.dev-modal-panel`, and `.qty` / `.qty-btn` / `.qty-input` in `globals.css` |
| Desk modal mount (shared by turns/players desks) + `prefetchDevPanel`, and its server actions (`getDevPanelData`, `getDevPanelRecord`) | `web/app/components/DevPanelModal.js`, `devPanelActions.js` |
| The game-level panel (§11) — page shell + section rail | `web/app/(desk)/gm/dev/page.js`, `web/app/(desk)/gm/dev/OpsNav.js` |
| History (§11c) — every game there has ever been, and the way into each transcript | `web/app/(desk)/gm/dev/PastGames.js`, and `web/lib/gameLabel.js` for what a game is called |
| Bulk actions (§11b) — the six verbs and the shell that draws them | `web/app/(desk)/gm/dev/BulkActions.js`, `web/app/(desk)/gm/dev/bulkVerbs.js` |
| The shared picker every "tick a set" surface wears | `web/app/components/CheckPicker.js`, `web/app/components/usePickList.js` |
| Bulk letters (§11b) — the action behind the Letter verb | `web/app/(app)/gm/dev/actions.js#sendGmLetters` |
| The tag catalog as a section, with its snapshot wiring | `web/app/(desk)/gm/dev/DevTagsSection.js` |
| The game-level panel's server actions | `web/app/(app)/gm/dev/actions.js` |
| The game-level panel's toggle help text, read through `InfoIcon` | `web/app/(app)/gm/dev/devHelp.js` |
| The game-level panel's styling | `.desk-body--ops`, `.desk-main--ops`, `.ops-section`, `.ops-section-head`, `.ops-lede`, `.ops-grid`, `.ops-toggles`, `.ops-toggle`, `.ops-toggle-note`, `.ops-actions`, `.ops-report`, `.ops-report-head`, `.ops-report-detail` in `globals.css`. The nav rail itself is the shared `DeskRail` (`.desk-rail[data-variant="sections"]`, `.desk-rail-group`, `.desk-rail-item`, `.group-label`) |
| The channel doctor it runs | `db/lib/channelDoctor.js` |

## The Depot section

`/gm/dev?s=depot`. The station is a public market now (`DEPOT.md`), so there
is far less here than there used to be: no account, no fuel, no shuttle
clock — the generator and the shuttle are both gone entirely, and there is
no station float to hold a balance on. `updateDepot` writes four fields:
`Depot.debtObols` (the Company's drawn-down credit line), its cap
`Depot.creditCapObols` (75), `Depot.sellTaxRate` (a percentage, clamped
rather than refused) and `Depot.turretArmed`. There is no ⬢-per-obol field
either: an obol is one ⬢ and the rate never existed as a knob.

The last two duplicate a player-facing surface rather than being the only
door: the sell tax rate is really the Meister's own dial, set day to day
from `/treasury`, which gates on standing in the Keep with a key to his office
(`DEPOT.md` §0h), and
the turret's switch is really a red button on the Merchant's Office starter
post, typed word, re-checked at submit, the same pattern as the Censor's
(`DEPOT.md` §0i) — this checkbox is a superadmin's way to flip it without
walking there.

**The turret's severity table is not edited here, and never really was.**
`db/lib/depotTurret.js#turretTable()` returns the shipped
`DEFAULT_TURRET_TABLE` and ignores its argument, so both guns have always
rolled the same odds. There was a JSON editor on this page for it and a code
comment calling `Depot.turretTable` an orphan column; there is no such column,
and the editor wrote nothing anything read. Retuning means editing that
constant. See `docs/systemdocs/DEPOT.md` §0i for the shipped table.

## Zones

`/gm/dev?s=zones` — the place editor. Its nested editors (`zones/[zoneId]`,
`zones/locations/[locationId]`, `zones/rooms/[roomId]`, `zones/links`) are
still routes of their own. Any GM can edit a Zone, Location or Room;
retiring, hard-deleting and seeding a stash are superadmin-only, checked with
`requireDev("super")`. See `docs/systemdocs/SYNC.md`'s new top note for why
this exists instead of another pass of `docs/zones.yaml`.

Pages:

| Page | What's on it |
|---|---|
| `zones/page.js` | Every Zone, its mirror status ("mirrored" once `discordCategoryId` is set, else "pending"), reorder arrows, and a Create form |
| `zones/[zoneId]/page.js` | The Zone's own fields (name, kind, sort order, description, map polygon) and its Locations |
| `zones/locations/[locationId]/page.js` | The Location's fields, its `LocationYield` bases (the live `current` coefficient is read-only — it drifts on its own every turn close), its Rooms, and its travel links |
| `zones/links/page.js` | Every `LocationLink` in the game. `isOpen` is shown read-only — it's play state, only `authoredOpen` is edited here |
| `zones/rooms/[roomId]/page.js` | The Room's fields and its stash: existing `RoomTag` rows (read-only quantities — those move by play, not by this form) plus a **Seed these items now** box that writes new rows and appends to `seededStashSlugs` |

Rules the editor enforces, all server-side in `zones/actions.js`:

- **Slug is set at creation and never editable again.** It's `placeKey`,
  archive keys, and every YAML reference. Slugs are one namespace across
  Zone, Location and Room (`db/lib/placeValidation.js`).
- **Rename goes through a confirm dialog** — it also renames the live
  Discord object on the next mirror pass, which is a bigger deal than most
  edits here.
- **Every save posts back the row's `updatedAt`.** A stale write (someone
  else changed it since the page loaded) is refused with "Someone else
  changed this; reload and try again" rather than silently overwritten.
- **Delete is soft by default.** Retire stamps `retiredAt`, which drops the
  place out of every picker, the travel graph, the map and the mirror's
  desired state — the mirror never deletes anything on its own, so a
  retired place's Discord footprint (if it had one) just sits there for a
  human to clean up. It's refused outright if a living character is
  standing there.
- **Hard delete is the other button**, superadmin-only, and refused with the
  exact list of what's still pointing at the place (`db/lib/placeDeletable.js`'s
  `hardDeleteBlockers`) — never a cascade.
- **Every write enqueues the touched place for the mirror**
  (`enqueueMirror`, `db/lib/discordMirror/queue.js`) and writes one
  `AuditLog` row. Discord catches up on the next drain; the page doesn't
  wait for it.
- **A Location's `attributes` map is one control per registry entry** —
  `db/lib/locationAttributes.js#ATTRIBUTES`, read by both the form and
  `updateLocation`. Each entry's `type` (default `"boolean"`) picks the
  control: `"boolean"` a checkbox, `"number"` a number input, `"enum"` a
  `<select>` over its `options`, anything else free text. A new attribute
  only needs a `type` in the registry to get a control here — the form
  never hardcodes a key.

Not yet built: a visual map-polygon editor (the textarea takes raw
`[[x,y],…]` JSON, 0-100).
