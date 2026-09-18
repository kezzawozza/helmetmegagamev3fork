# The character sheet (`/character`)

The sheet is `/character`, and `web/app/components/CharacterSheet.js` is the
component that draws it. There used to be two — a page of chips and an icon
rack at `/character`, and a rebuilt workspace at `/ledger` being judged against
it. The rebuild won. The old sheet and its panels are deleted, and `/ledger` is
a one-line permanent redirect to `/character` so old links and bookmarks still
land (`web/app/(app)/ledger/page.js`).

Everything it draws is built once by
`web/app/(app)/character/page.js#FreshCharacter`, which resolves one of four
`kind`s — a closed door, the lobby, the creation wizard, or the sheet — and
`CharacterView.js` picks the component. The other three are ordinary
`PageShell` pages; only the sheet is the workspace below.

## 1. The frame

**It is an ordinary scrolling page.** One scrollbar, the document's: the band
scrolls away with everything else, the three columns grow to fit their cards,
and reaching the bottom of the tag rail is the same gesture as reaching the
bottom of any other page. It was built the other way first — a `100dvh`
`.sheet-shell` over three independently scrolling columns, the way Chat still
works — and that was wrong for a sheet: nothing on it arrives while you read,
so nothing had to be pinned. The shell class is gone entirely.

`web/app/(app)/character/layout.js` draws the shared `AppHeader`
(`web/app/components/AppHeader.js`) and nothing else around `{children}`. It is
an **ordinary page name**: the title is the word `Character`, there is no meta
line, and the one action is **← Back to the game · Esc**, a link to `/chat`.
The turn chip is `AppHeader`'s own `TurnMeta`, the same one every other page
gets.

It was a *person* until 2026-09-10 — the character's name as the title, their
role as the meta line, their face as a 24px avatar beside the Back
link. All four moved down into the band (§2), where they sit next to a face big
enough to be worth looking at; saying them again 40px above only made the page
name the person twice. The layout still asks `loadHeaderIdentity()`, because
whether there **is** a living character is what gates the Back link and the
Escape listener.

The Back link and the Escape listener are drawn **only when there is a living
`ALIVE` character** (`loadHeaderIdentity()`, the same question that decides
`kind === "sheet"`) and only when the Chat page is on
(`GameConfig.playPanelEnabled`), since `/chat` would just bounce back. That
gate matters: a player halfway through the creation wizard pressing Escape
means "close this", not "leave".

**Escape goes back to the game.** `character/EscapeToPlay.js` listens on
`window` in the *capture* phase and stands down when a dialog holds the
keyboard (`Modal.js#dialogHoldsKeyboard`), when a field has focus (it blurs
it instead), or when a floating thing is open — a pinned tag panel, a click
menu, a `Select` popup — whose own handler closes it on the same keypress.
Capture, because those handlers sit on `document` and React flushes their
close before a bubbling `window` listener runs; by then the menu was gone
and the page navigated out from under a player who meant to close a menu.
The `/chat` snapshot (`CHAT.md` §5c) paints in the first frame, which is what
makes it feel immediate.

Inside, `.sheet-body` is the band, then `.ledger-body`: **two columns**
(`1fr / 22rem`). The left is what you have — the tag rail, the Items and Assets
cards, the Bio, Crafting & building. The right is what you are wearing, how you
feel and what you want — the rig, Mood, Desires — then Who's here and what
stands here. Under 1180px the right column narrows to `18rem`; under 720px they
stack, and everything that presses takes a 44px floor. Only the widths change —
the scrolling is the same at every size.

It was three columns behind a **You / Do / Tags** tab bar until phase 4 of the
game 3 redesign (`REDESIGN.md` §10, `docs/design/mockups/character/index.html`
is the spec). The middle column existed mostly to give the Bio form somewhere to
be, and the tab bar hid two thirds of a sheet on a phone — reading your own wound
cost two taps. There are no tabs now, and `.sheet-tabs` is gone.

## 2. The band (`LedgerBand.js`)

Who this is, where they stand, and:

- **The identity cluster** (`.ledger-identity`) — the face, then the name, the
  role on one muted line,
  **"Standing in Town — Tallow Row"** on the next, and the status strip under
  that.
- **The name is the blackletter.** `.ledger-name` takes `--font-display` in
  `--blackletter` with `text-shadow: 0 2px 3px #000`, at `--fs-3xl`. It is one of
  the handful of places the world speaks in its own voice (`REDESIGN.md` §1), and
  the size is a floor rather than a choice: the face is illegible smaller, and
  `--blackletter` only clears contrast as large text. That shadow is the one
  literal colour in `globals.css`'s sheet families, and it is black, which no
  theme changes.
  These are the page's only statement of who you are, now that the header is a
  page name again (§1).
- **The face has no size of its own.** The column beside it sets the height and
  the face matches it, square — a floor of `6rem` so it can never come out
  smaller than the 64px it replaced, a ceiling of `9rem` so a dozen status tags
  cannot turn somebody's portrait into a wall. `.ledger-identity` also *grows*
  (`flex: 1 1 22rem`) rather than shrink-wrapping: `.ledger-tiles` caps at
  `47rem`, and before this the leftover width simply became a gap in the middle
  of the band.

- **The status strip** — Chat's own `play/StatusStrip.js`, minus its two
  leading chips: every Status and Health tag, and no ⬢ or carry line. The
  sheet passes `numbers={false}`, because the tiles a few inches to the right
  say both with the caps and the load meter the chips could only half-say, and
  printing the same two numbers twice on one band read as a bug. Chat has no
  tiles, so it keeps them. On the sheet the strip takes `onPick`, and a
  clicked chip opens the tag's `TagDetails` under it. The rail has a Status run
  as well as of phase 4 (§3) — a chip and a row are not the same reading.
- **Five tiles, one row** — free moves, the ⬢ balance, carrying with its
  meter, the **Mood box** (`MOOD.md` §4) and the Gambit modifier
  (`db/lib/gambitModifier.js`, the same call the bot makes). `.ledger-tiles`'
  `max-width` fits exactly five: a sixth needs 856px, so anything else goes on
  the row below rather than into this row.
- **Every tile carries a quiet second line** (`DetailTile`'s `sub`), always
  drawn, never pressed for: free moves says whether the Gambit is filed, ⬢ says
  the coin in your pocket in `¢`, Mood says its own figure and `press for why`,
  the Gambit die names the heaviest single modifier and counts the rest. Two
  things the mockup asks for do not exist in the data and are not invented here:
  there is **no ⬢ cap** (the old `GameConfig.carryResourceCap` went when a ⬢
  started weighing a pound and counting against the carry cap, `CARRY.md` §1), so
  that line says the coin instead; and nothing records **why** a mood is where it
  is, so `press for why` opens Bascinet's paragraph on what moves one.
- **The row below is This turn · Combat · Turn Effects** — three boxes of the
  same build, reading as what you are doing, what you can do (`COMBAT.md`) and
  what the turn will do to you. It is `auto-fit`, so Turn Effects simply
  narrows from half the band to a third when Combat is there, and Combat takes
  half again on a quiet turn when the forecast renders nothing.
- **A box with something to say SWAPS ITS OWN FACE for it.** Hover, focus or
  click and the value is replaced by the breakdown, inside the same box. The
  detail is absolutely positioned inside it, so the box is sized by its resting
  face alone and **opening one cannot move anything** — which is the whole
  point. It used to append a block under the row and shove the rest of the
  sheet down; floating it instead would have put a panel over the thing you
  were reading. Swapping in place is the third answer.
- **Nearly all of them press**, and that is what fixed the one that did not.
  Free moves (why it is 0), Carrying (what holds the cap up), Combat, Mood and
  the Gambit die (which modifiers, by name) all have something to say; only ⬢
  does not — its sub-line says the coin, which is all there is to say — it is a plain number with no cap of its own to explain, since ⬢
  became a one-pound item and started counting against the carry cap beside
  the gear (`CARRY.md`). There used to be a second cap, and the tile still did
  not press then either. The Carrying breakdown had come off precisely because *one*
  pressable tile in a row of read-only ones read as a bug —
  `db/lib/carry.js#carryBreakdown` has said "for the hover breakdown on
  /character" the whole time — and that reason is gone.
- **The tile itself is `web/app/components/DetailTile.js`**, and the Combat
  one is `CombatReadout.js`. Both used to live inside `LedgerBand.js`; they
  came out when the GM desks started wearing the same readout, so the swap-in-
  place behaviour below is written once rather than approximated a second time
  on the desk (COMBAT.md §6). The Dev Character Panel's band is the third
  caller (`DEV-PANEL.md` §3). Nothing on this page changed when they moved.
- **Three ways in, and all three are needed.** A mouse opens on
  `pointerenter` and closes on leave. A **tap** is the click path: touch fires
  a synthesised `mouseenter` before its click, so the pointer handlers ignore
  anything that is not a mouse, or the enter would open the tile and the click
  would shut it again in the same gesture. A **keyboard** opens on
  `:focus-visible`, not plain focus, so a tap does not trigger it too.
- Anything that still overrun its box scrolls inside it, with the last few
  pixels masked out so a cut line reads as "there is more" rather than as a
  fault. In practice that is the Mood box, whose paragraph is Bascinet's own
  words and long enough that no tile could hold it whole.
- **This turn** — Chat's `TurnCard` + `MoveDialog`, wrapped in
  `SheetTurn.js`, over the same `play/actions.js#myMove` and the same minute
  poll (`play/useMyMove.js`, which `ChatAside.js` shares). File the Move from
  here. A **Gambit** that has not locked yet carries a quiet **Change…** under
  its words, which reopens the same dialog on it to rewrite or **Cancel Gambit**;
  anything the game filed has already happened and carries nothing
  (TURN-ENGINE.md §6a-i). A pending lesson or binding reads under that. The turn chip and the **Move…**
  button sit on ONE line: `.sheet-turn .chat-move` is a wrapping flex row, and
  the button keeps its natural width instead of stretching into a bar that
  doubled the box's height. A Move already filed adds its **kind to the same
  chip row** and puts its own words on the line under it, behind a `»` and
  clamped to two lines until clicked. It used to open a second chips row and a
  column of its own, which roughly tripled the box the moment somebody filed.
  The rules are scoped to `.sheet-turn`: `/chat`'s YOU column draws the same
  `TurnCard` and keeps its own three-line clamp.
- **Turn Effects** (`TurnForecast.js`) — the turn passes read forward
  one step, as ONE wrapping line separated by `·` rather than a list, and with
  no full stops: four short clauses down a column made the box taller than the
  turn card beside it. Past three items the rest fold behind a `+N more`,
  decided by counting them and never by measuring the box (`ExpandableText.js`
  explains why). It reads: tags on their last turn and what they become (`expiresInto`),
  crafts and builds that finish, the road's end, a hunger warning, and the
  animals' feed. Renders nothing on a quiet turn.

  **The hunger warning is one clause with no number in it** —
  "You'll go hungry" / "You'll start starving" on the turn the meter's decay
  would first cross that threshold (`db/lib/hunger.js`), computed server-side
  in `character/page.js` so the raw `hungerValue` never reaches the client;
  never said again once a band is already held.

  **The animals' feed is the half that still costs ⬢**, and it is a separate
  pass (`horseUpkeepPass.js`, `TURN-ENGINE.md` §5b). The line counts how many
  of `UPKEEP_SLUGS` the character holds — read off the same list the real pass
  walks, so an animal added later shows up here with no second edit — and says
  either what they will consume or that you cannot feed them.
- **The verb strip** — `ActionGrid variant="strip"`: every action in
  `actionRegistry.js` as one wrapping row of bevelled buttons, the sections split
  by a hairline. Each one **is a `.btn-secondary`** (`.action-strip-item` only
  adds the icon gap and the strip's spacing), so the bevel, the press and the
  dashed gated state all come from the shared class and a verb here looks like
  every other button in the app (`REDESIGN.md` §5). **Every button hovers**, the
  same tooltip the verb wears everywhere else: its name, the sentence saying what
  it does, and — when it is greyed — the pool's `gateReason`. A gated verb is
  dashed and does not press. The **Trumpet** joins the end of the row when held,
  in its own hairline group, as the one filled red `.btn` among the greys — it
  commits on the spot rather than opening a dialog, and it asks first.
- **On a touch screen that tooltip IS the button** (`ActionButton.js`). It could
  not be read at all before: every variant passed `pinnable={false}`, which is
  what switches off the one tap path `HoverCard` has, so a tap fell straight
  through to the verb. For the instant verbs that ask nothing first
  (`components/actions/index.js`) that tap *was* the action — and Break
  restraints justifies skipping its confirm on the grounds that "the tooltip
  already says what pressing it does", which on a phone had never once been
  true. Now the first tap pins the panel and the panel carries a real button at
  its foot. A greyed verb takes `aria-disabled` rather than `disabled` there,
  because a disabled button dispatches no click and the reason it is greyed is
  the thing a touch player most needs to reach. Two verbs carry no help sentence
  and both open a dialog rather than committing, so they keep the plain path;
  so does `variant="menu"`, which is already the inside of a menu.

**A handful of classes now carry the mockup's own name as well as their old
one** — `.tile` beside `.ledger-tile`, `.band-box` beside `.ledger-turn`,
`.meter` beside `.sheet-meter`, `.carry-line` beside `.sheet-carry-line`, on
the same elements. This is deliberate, not incomplete: `DetailTile.js`,
`CombatReadout.js` and the band's identity markup are shared with the GM's
Dev Character Panel and inspector (`DevBand.js`, `InspectorColumn.js`), which
still style off the old names, so those stay; the mockup's names are added
alongside rather than replacing them, and `sheet.css`'s rules key off whichever
name is present. Classes that are genuinely sheet-only — the rail rows, the
rig's cells, the action strip, Mood's ladder, `ItemsTable.js`, `DesirePanel.js`
— carry the mockup's names outright, with no old name left behind.

## 3. The rail (`TagRail.js`)

Two shapes. The plain rails — **Skills, Health, Status, General, Meta** — are
labelled runs of rows inside **one Tags card**, with the filter and the tag
points over the lot of them. **Items and Assets are ONE `.data-table`**
(`ItemsTable.js`), under one Items heading — the mockup's own grammar
(`docs/design/mockups/character/index.html`): Thing · Where · Each · Total,
heaviest first, one row per held tag. This is the shard that dropped the
two-card shape phase 4 shipped: a character's whole property reading as two
separate panels was the one place the sheet still didn't look like the
artifact. Before phase 4 it was one panel per kind plus a separate header
strip, which read as six unrelated boxes; before this pass it was two cards
that at least agreed with each other, which was still two panels for one
inventory.

`web/lib/itemWhere.js` is the new small helper the **Where** column reads: a
tag actually worn or readied gets its equip slot's own words (`head`,
`body, Over`, `held`, `ride`, `accessories`, off `equipSlots.js`'s own
`SLOT_TITLES`/`LAYER_NAMES` rather than a second list), everything else reads
`pack`.

**This is a sheet-only reshaping of the same rows.** `web/lib/sheetCards.js`'s
`buildCards()` still returns Items and Assets as two separate cards — the GM's
Sheet tab and the Dev Character Panel (`InspectorColumn.js`, `HeldTagsBody.js`)
still mount `ItemCard.js` and want that split, because a GM skimming a whole
inventory wants every fact a card can carry (armour, `2 of 5 worn`, a carry
bonus) rather than one table row's worth. `TagRail.js` flattens both cards'
rows into one list for its own `ItemsTable.js`; nothing else about
`buildCards()` or `ItemCard.js` changed.

**Status is in the rail now** (`buildCards(…, { includeStatus: true })`), as well
as a chip in the band. The two are not the same reading — a chip says "you are
Concealed", a row says what it turns into and when it ends — and the mockup draws
both.

`web/lib/sheetCards.js` is the pure half:
which card (the tag's category), the order inside it, the
sub-groups (the `TagGroup` a tag belongs to), and `rowValue()` — the one thing
on the row's right, picked in the order a player cares: turns left (in
`--danger` on the last turn), then pounds, then the armour word, then a carry
or mining bonus, then a stack count.

| Card | Order | Second line |
|---|---|---|
| Health | soonest to run out first | `→ Festering · cure 2 ⬢ · Medical I` from `expiresInto` and the requirement block |
| Skills | by family (TagGroup) | the next rung: the catalog tag whose `parentTagId` is this one, with its cost in **tag points** — the mockup writes `8 ⬢` there, but the store spends `Character.tagPoints`, so the row says `pts` |
| General, Meta, Demoness | alphabetical | — |

Items and Assets are not in this table any more — they never reach `TagRail.js`'s
plain-row path, `ItemsTable.js` draws them (above).

**A tag's two marks.** The 3px rule down the left is its **category**, from
one of seven `--tag-*` tokens in `globals.css` (`DESIGN-SYSTEM.md`); the glyph
before its name is its **group**, from `web/lib/tagIcons.js`. One signal each.
Until 2026-09-15 both jobs were done by one freeform hex per group in
`docs/taggroups.yaml`, and the result was forty-odd bright stripes with no key
— technically meaningful, practically confetti. Do not give a group a colour
again; give it an icon.

**On the sheet, Items and Assets are one `.data-table`** (`ItemsTable.js`), not
item cards. `rowValue()` is first-match-wins, which is right for one rail row
and lossy by construction: a stack of five 2 lb rations reads `10 lb` and never
that there are five. The table sidesteps that differently than the card did —
it has an Each and a Total column instead of one collapsed value, so the
weight math is never lossy even without `itemFacts()`'s full sentence. What the
table does NOT carry over from the item card: `2 of 5 worn`, the fit note, and
the carry/mining bonus text all lived in `itemFacts()`'s reading-order sentence,
which the mockup's four columns have no slot for. That is still available —
click the row to open `TagDetails.js`, the same block every other row on the
sheet opens.

**Off the sheet, Items and Assets are still item cards** (`ItemCard.js`) — the
GM's Sheet tab and the Dev Character Panel keep the full `itemFacts()` sentence
and the per-kind card split, because a GM skimming a whole inventory is asking
a different question than a player is.

**The state marks are one vocabulary** (`TagMarks.js`): worn, smells wrong,
locked, drawn the same way on a chip, a row and a card — glyphs where it is
tight, words where there is room. They are marks on the face, never tones:
`DESIGN-SYSTEM.md`'s rule holds that a chip is a label and a `StatusPill` is a
state, so `danger` stays the only tone a chip may wear.

`TagRow.js` is the row: click it and `TagDetails.js` opens inline beneath —
the same block `TagChip.js` shows on hover everywhere else, lifted out of it
so the two cannot drift. The rows, the tiles and the rig still put their words
**on the page** rather than in a floating box, because a panel that opens where
you are reading beats one that opens over it. The strip is the exception: it is
a row of small buttons with no room to say anything, so it hovers like the same
buttons do everywhere else in the app.

`RowVerbs.js` are the small buttons beside an Items, Assets or Health row —
Use, Equip/Unequip, Give, Destroy, Heal. The predicates are Chat's
(`play/thingRows.js#thingVerbs`, the same sets the Things drawer reads), the
handlers are the sheet's own dialogs through `RequestActionsProvider.open`
with the tag preselected, or `equipActions.js#toggleEquip`. Heal opens the
Heal dialog on yourself and that wound. Hidden until hover or focus on a
pointer device.

**On a touch screen they are not beside the row at all — they are at the foot
of the details it opens.** They used to be drawn permanently there, because the
hide-until-hover rule is inside an `@media (hover: hover)` block and a phone
simply falls through it. That put Use and Destroy a thumb's width from the face
you tap to read the row, and Use is the one verb on this surface with no dialog
behind it: `TagRail.js#consume` goes straight to the server. A player reported
exactly what that shape predicts — reaching to read something and eating it
instead. `TagRow.js` and `ItemCard.js` read `useIsCoarsePointer()` and render
`{verbs}` in one place or the other, never both: two copies hidden by CSS would
put every verb in the accessibility tree twice.

So on a phone **tapping a row means "what is this?" and nothing else.** Acting
is a second tap, from inside what the first one opened — the rule
[`DESIGN-SYSTEM.md`](DESIGN-SYSTEM.md) §9 now states for the whole app.

The Tags card's header holds **Spend Tag Points** (the store modal) and, under
it, the filter box: name, description or group. A run with nothing left hides
while a query is set, and so does an Items or Assets card.

## 4. The rig (`EquipBoard.js`)

The equipment rules are `TAGS.md`'s ("equipSlot / equipLayer /
twoHanded"): **one thing on a head**, one per layer of Body (Mail, then Over)
and Ride, four
hands — fewer if maimed, and the board draws only the cells you actually have
(`TAGS.md`, "A maiming takes hands away") — accessories uncapped. The board draws
exactly that — a row per slot, a
cell per place, a two-hander spanning two hand cells, `Ride` only when
something to ride is held. A filled cell says the one fact worth a glance
(the armour words, "conceals you", a carry bonus, pounds) and carries ✕. An
empty cell is dashed and named; clicking it is a `ClickMenu` of what you
carry that fits there **and what a Room stash here is holding that fits there**,
and nothing fitting says where it looked ("Nothing you carry or in the
Waystation fits here.").

The stash half arrived 2026-09-10, from a player: *"If I'm in a room with stuff
stored in it, I should be able to click on this and see what I can take from
that room that would fit in this slot."* A stash row names its room and sits
under a hairline below the carried ones; picking it runs
`equipActions.js#takeAndEquip`, which is the ordinary `transferRequest` — the
audit row and the room's own "a young man takes a Padded Cap" line both still
fire (`CARRY.md` §7) — and then equips what it took. **A refusal on the wearing
half leaves the take standing**, says so, and the thing is in your pack. The
rooms are the ones `loadStashRooms` already offers the Transfer dialog, so a
door locked to one is locked to the other.

The panel is headed **Equipment**, with the combined armour beside it as two
shield marks and two words (`armorValue.js#combineArmor` → `armorWord`). Each
slot row names itself on the left and says how it fills on the right — "Mail,
then Over", "3/4 hands", "one thing" — off `equipSlots.js#LAYER_NAMES` rather
than written out again, so a slot that gains a layer says so. At the **foot of
the board is the Carrying line and its meter**, the same two numbers and the same
`carry` object the band's Carrying tile reads: the board above is what changes
them, and taking a coat off to get under the cap should not mean scrolling back
up to check.

The rows are only as good as the catalog: slots and layers reach the database
through `npm run db:sync-tags`, which no deploy step runs, so a push without
it leaves every weapon, accessory and mount slotless and the board empty
(`TAGS.md`, "equipSlot / equipLayer / twoHanded").

**A slot always draws everything actually in it**, even past its own limit.
A layered row appends a cell for any stray layer the catalog no longer has,
and an unlayered one (Head) draws every piece worn there rather than the first
— because a character can be over the limit through no act of their own, from
the 2026-09-15 collapse or from a deploy running ahead of its
`db:sync-tags`. Drawing one would leave the rest on their head with no ✕ to
take them off, and a pre-existing clash refuses every later equip
(`TAGS.md`). The board may be the bearer of bad news; it may not lie about
what you are wearing.

Every click is `toggleEquip`, so a refusal — a second helm, a fourth hand — is
the server's sentence in `FormError` under the board. The `Ride` row goes
further and drops what `equipActions.js` would refuse anyway — a cart indoors,
a boat against a horse, anything at all with Motion Sickness — with a line in
the menu saying why. `ClickMenu.js` is the
portaled click menu that used to live inside `play/ThingsDrawer.js`.

## 4a. Mood, as the ladder (`MoodPanel.js`)

The band's Mood tile says the one word and the figure. The panel in the right
column says **where that word sits among the others**: one cell per band from
Panicking to Ecstatic tinted by the band's tone, the one you are in lit, every
band's word underneath with yours picked out, then the sentence on what moves a
mood. "Uncomfortable" means nothing until you can see there are four worse states
below it and five better ones above.

Both the cells and the words come from `MOOD_BANDS` in `db/lib/mood.js`, never
from a count written here — that table is the only thing that says how many bands
there are, and it says **ten**, where `MOOD.md` and the mockup both say nine.
Drawing it from the table means the table keeps winning. The strip itself is
`aria-hidden`; the run of words carries the same information in text.

Self sheet only, the same posture the Combat tile takes: somebody else's figure
is not yours to read.

**No narrative paragraph** (Bascinet, 2026-09-18: "Mood narrative: cut").
`MoodPanel.js` used to print `MOOD_DETAIL` — Bascinet's own generic sentence on
what moves a mood, the same words the band's Mood tile opens — as a paragraph
under the ladder every time. Printing it there read as though it were this
character's own reason, which nothing in the data actually records. That
paragraph still exists and is still true; it lives one press away, on the
band's Mood tile ("press for why", §2), which is a request rather than a
default.

## 4b. Desires (`DesirePanel.js`)

One `.desire` block per slot — the mockup's own grammar
(`docs/design/mockups/character/index.html`): a `.head` line (the slot number
and a `.status-pill`), then plain prose underneath. This is the current
retroactive-claim system (`DESIRES.md`) drawn under that grammar, not the
pre-2026-09-02 shape the mockup was drawn against — a Desire is never
"occupied" with a reward pending, only **open** (the pill reads `Open`, a
`Claim a Desire` button underneath) or **cooling down** from its last claim
(the pill reads `lockedSlotLabel(slot)`, e.g. "locked until turn 16"). A
slot's last claim, when there is one, prints above the button as `Last: … — N
Tag Points`. The bottom slot still draws its bordered box when an Addiction
binds it (`data-bound="true"` on `.desire`). The panel header's `N open` note
counts slots with no active lock.

## 5. What is not here

- **The Bio form is the form** (`BioForm.js`), unchanged, at the foot of the
  left column under the tag rail, with `LedgerWork.js` — Crafting & building,
  the clock on a half-finished project or build site — under it. Both are
  readouts and nothing on either presses, so they sit at the bottom of the
  reading column rather than beside the rig, which is all controls.
- No collapsing cards, no Traits/Drawbacks split — both were put to Bascinet
  and skipped.

## 5a. One global change came with this pass

`--font-serif` on `:root` is a real serif again —
`"Times New Roman", Times, "Liberation Serif", serif` — where phase 1 had left it
an alias of `--font-sans`. That one line is what puts `h1`/`h2`/`h3`,
`.panel-header` and `.section-title` into the bold serif the mockup draws them
in, **app-wide**, with no call site touched. Body text is still `--font-sans`.

## 6. The `ledger` names are kept on purpose

`LedgerBand.js`, `LedgerWork.js` and every `.ledger-*` class are named after
the route this sheet was built on. The route is gone; the names stay. Renaming
them is a few hundred lines of mechanical churn across the components and
`globals.css` for no change in behaviour, and every rename of that size is a
chance to break one selector nobody notices until a player opens the page.
Same reasoning CLAUDE.md gives for keeping the Lifeweb names: **a
`grep -i ledger` hit in this area is not a bug.** `SheetTurn.js`,
`TagRail.js`, `EquipBoard.js` and the `.sheet-*` classes are the ones that
were always named for the sheet, and they keep those names too.
