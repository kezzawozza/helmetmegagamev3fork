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
role and faction as the meta line, their face as a 24px avatar beside the Back
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

Inside, `.sheet-body` is the band, then `.ledger-body`: three columns
(`18rem / 1fr / 22rem`). Under 1180px the rail folds under the working column;
under 820px the three columns become three tabs, **You / Do / Tags**, a
`.tab-bar` keyed on `data-tab` in CSS with no JS media query. Only the widths
change at those breakpoints — the scrolling is the same at every size.

## 2. The band (`LedgerBand.js`)

Who this is, where they stand, and:

- **The identity cluster** (`.ledger-identity`) — the face, then the name as an
  `h2`, the role and faction on one muted line (the faction a link to
  `/faction`), where they stand on the next, and the status strip under that.
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
  clicked chip opens the tag's `TagDetails` under it. The rail has no Status
  card for that reason.
- **Five tiles, one row** — free moves, ⬢ against the cap, carrying with its
  meter, the **Mood box** (`MOOD.md` §4) and the Gambit modifier
  (`db/lib/gambitModifier.js`, the same call the bot makes). `.ledger-tiles`'
  `max-width` fits exactly five: a sixth needs 856px, so anything else goes on
  the row below rather than into this row.
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
  does not. The Carrying breakdown had come off precisely because *one*
  pressable tile in a row of read-only ones read as a bug —
  `db/lib/carry.js#carryBreakdown` has said "for the hover breakdown on
  /character" the whole time — and that reason is gone.
- **The tile itself is `web/app/components/DetailTile.js`**, and the Combat
  one is `CombatReadout.js`. Both used to live inside `LedgerBand.js`; they
  came out when the GM desks started wearing the same readout, so the swap-in-
  place behaviour below is written once rather than approximated a second time
  on the desk (COMBAT.md §6). Nothing on this page changed when they moved.
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
  poll (`play/useMyMove.js`, which `YouPanel.js` shares). File the Move from
  here. A **Gambit** that has not locked yet carries a quiet **Change…** under
  its words, which reopens the same dialog on it to rewrite or **Cancel Gambit**;
  a Labor, or anything the game filed, has already happened and carries nothing
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
  crafts and builds that finish, the road's end, and dinner (the
  `hungerPass.js` rule: Hungerless owes nothing, a meal covers it, otherwise
  1 ⬢, 2 with Fast Metabolism, and short of that you go Hungry). Renders
  nothing on a quiet turn.
- **The verb strip** — `ActionGrid variant="strip"`: every action in
  `actionRegistry.js` as one wrapping row of small labelled buttons, sections
  split by a hairline. **Every button hovers**, the same tooltip the verb wears
  everywhere else: its name, the sentence saying what it does, and — when it is
  greyed — the pool's `gateReason`. A gated verb is dashed and does not press.
  The Trumpet joins the row when held.

## 3. The rail (`TagRail.js`)

One card per kind, one row per tag. `web/lib/sheetCards.js` is the pure half:
which card (the tag's category, Status excluded), the order inside it, the
sub-groups (the `TagGroup` a tag belongs to), and `rowValue()` — the one thing
on the row's right, picked in the order a player cares: turns left (in
`--danger` on the last turn), then pounds, then the armour word, then a carry
or labor bonus, then a stack count.

| Card | Order | Second line |
|---|---|---|
| Health | soonest to run out first | `→ Festering · cure 2 ⬢ · Medical (Basic)` from `expiresInto` and the requirement block |
| Skills | by family (TagGroup) | the next rung: the catalog tag whose `parentTagId` is this one, with its cost |
| Items, Assets | by kind, heaviest first; the header carries the total lb | an **item card** — see below |
| General, Meta, Demoness | alphabetical | — |

**A tag's two marks.** The 3px rule down the left is its **category**, from
one of seven `--tag-*` tokens in `globals.css` (`DESIGN-SYSTEM.md`); the glyph
before its name is its **group**, from `web/lib/tagIcons.js`. One signal each.
Until 2026-09-15 both jobs were done by one freeform hex per group in
`docs/taggroups.yaml`, and the result was forty-odd bright stripes with no key
— technically meaningful, practically confetti. Do not give a group a colour
again; give it an icon.

**Items and Assets are item cards** (`ItemCard.js`), not rows. `rowValue()` is
first-match-wins, which is right for one line and lossy by construction: a
stack of five 2 lb rations reads `10 lb` and never that there are five, and an
armoured coat never mentions its armour because it weighs something. An
inventory is the one place that trade is wrong, so those two cards use
`itemFacts()` instead and print all of it — weight each and total, `2 of 5
worn`, the armour word, the carry bonus, where it sits. Assets gets the same
treatment as Items now (sub-groups and a header total) rather than falling
through to the plain alphabetical branch, which it did while still being
granted Items' full verbs.

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
pointer device, always drawn on a touch one.

The header holds **Spend Tag Points** (the store modal) and the filter box:
name, description or group; a card with nothing left hides while a query is
set.

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
door locked to one is locked to the other. The header is the
combined armour as words (`armorValue.js#combineArmor` → `armorWord`).

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

## 5. What is not here

- **The Bio form is the form** (`BioForm.js`), unchanged, in the left column,
  with `LedgerWork.js` — Crafting & building, the clock on a half-finished
  project or build site — under it. That panel sat in the middle column beside
  the rig until the sheet read as a tall middle between two short sides; it is
  a readout and nothing on it presses, so it belongs with the Bio rather than
  with the verbs. Below 820px that also moves it from the **Do** tab to
  **You**.
- No collapsing cards, no Traits/Drawbacks split — both were put to Bascinet
  and skipped.

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
