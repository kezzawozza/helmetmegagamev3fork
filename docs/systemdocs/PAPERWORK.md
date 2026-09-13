# Paperwork

Paper as an object: a thing you buy, write on, seal with wax, hand over, send
by bird, nail to a wall, or tear back down. Reading it needs letters and
working eyes; everyone else sees the same six words.

## 1. Why paper is a tag

A written sheet is a `Tag` row minted at runtime — `custom: true`,
`ephemeral: true`, a `custom-` slug — exactly the shape `db/lib/corpseMint.js`
writes for a body and `db/lib/depotCrates.js` for a crate. That sounds heavier
than it is: being a tag buys carry weight, Transfer, room stashes, Loot and
theft for free, rather than needing a parallel inventory nothing else in the
game knows how to read.

Two things had to change before it could work, and both were owed anyway.

**Runtime tags used to outlive the game.** `wipeGameData` never touched the
`Tag` catalog and `db:prune-tags` skips every `custom` row on purpose, so
crates and headstones were permanent orphans accumulating across every game
ever run — only corpses escaped, through `Tag.corpseOfCharacterId`'s cascade.
`Tag.ephemeral` is the fix: set by every runtime minter, swept by the wipe,
and deliberately **not** `custom`, because a GM's homebrew from `/gm/dev/tags`
is custom too and must survive a restart.

**`Tag.description` is broadcast to every browser.** `getVisibleTags`
(`web/lib/referenceData.js`) ships the whole catalog into `TagsProvider` on
every page. A letter's text in that column would publish every letter in the
game to everyone playing it. So the text lives in `Tag.paperText`, which
`TAG_CHIP_FIELDS` never selects, and the description is composed per request,
per viewer.

`Tag.paperTitle` sits beside it and is the opposite kind of column: public, and
deliberately so. It holds what the writer chose to advertise on the outside, and
exists separately from `Tag.name` because `name` gets rebuilt each time the
sheet is sealed or opened (§4).

That loader now also withholds `ephemeral` rows the caller isn't holding.
Without it the catalog payload would grow with every paper ever written — a
problem crates already had, with no consequences until paper made the set
unbounded.

## 2. The five states

| `Tag.paperKind` | What it is |
|---|---|
| *null*, slug `paper` | **Blank stock.** One stackable catalog tag. Not stocked loose — the Depot sells `stack-of-paper`, a 3 ⬢ ream that consumes into twenty sheets. |
| `PAPER` | **A written sheet.** Carries `paperText`. |
| `SEALED` | **A closed letter.** Same row, renamed in place. Carries `sealMark`. |
| `BROKEN_SEAL` | **A spent envelope.** Evidence somebody opened it, and whose wax it was. |
| `BOOK` | **A bound book.** Carries `paperText` like a sheet, and is the one kind that can never be added to. §4a. |

Blank paper is deliberately *not* a runtime row. You hold "Paper ×15" as one
`CharacterTag`; a sheet only becomes its own `Tag` when somebody writes on it,
so the row count grows with actual writing rather than with stock.

## 3. Reading

`db/lib/reading.js#readBlock(tags, { phase, indoors })` is the one gate.
It composes `examineVision.js#examineBlock` — blind, blind drunk, nearsighted
with the spectacles in a sack, sun-sensitive outdoors at Dawn — and adds the
`literate` tag on top.

**One message for every cause: `You can't read this.`** A blind man and an
illiterate one get identical refusals. Naming which would leak a condition to
anyone reading over their shoulder, and it would differ between the tag chip,
the noticeboard and the server's own refusal — which is exactly the drift the
single predicate exists to prevent.

`db/lib/paper.js#paperDescription(tag, viewer)` composes what a given reader
sees. **A `SEALED` letter's text is never composed, literate viewer or not.**
That is what the seal is.

**On the web, a paper is drawn as a sheet, and its words are markdown.**
`paperView(tag, viewer)` beside `paperDescription` makes the same decision as
a shape, `{ kind, text, plain }`, and `web/app/components/PaperSheet.js` is
the one renderer: a serif block on its own ground (`.paper-sheet`), the
writer's bold, italics, lists and quotes rendered through `ChatMarkdown` like
any other thing a person wrote. `plain` means the text is *about* the paper —
the refusal, a seal, a closed book — and is drawn flat and italic, never as
markdown, so a refusal cannot be dressed up as a letter and blind still looks
like illiterate. Every surface that opens a paper goes through it: the tag
chip's hover panel and the tag detail sheet (`tag.paper`, attached by
`getVisibleTags` and the sheet's `sheetCharacter`), a notice read off a board
(`readNotice` returns `paper`), and the "already on it" text in the Write
dialog (`readMyPaper`). `description` stays the flat sentence for lists. On
Discord the bot posts the text as it is and Discord renders the markdown
itself.

Three surfaces strip `paperText` before anything crosses to the browser:
`getVisibleTags`, the sheet's own `sheetCharacter` in
`web/app/(app)/character/page.js`, and the Write dialog, which fetches the
text on demand through `readMyPaper` rather than shipping it with the page.
**Holding a letter is not the same as being able to read it** — that is the
entire point of an illiterate courier, and a raw string in the page source
would end it.

## 4. Writing

The **Write** button on the Actions grid. Pick a sheet, type, submit.

- On a blank sheet: one unit off the stack, one new `PAPER` row.
- On a written one: **append**. The existing text is shown read-only above the
  box. Nothing in the game shortens `paperText`.

`web/app/(app)/character/paperActions.js`. **It files no `Request`**, the same
call `equipActions.js` makes: writing costs nothing, spends no Move, is the
most frequent thing a scribe does, and there is nothing for a GM to
adjudicate. What a GM needs is to *read* the letters, and they can — the text
is on the tag, and every GM surface that renders a tag renders it.

### 4a. Books

A book is ten sheets bound together and written in one pass, and then it is
finished — **Write refuses a `BOOK`**. That single rule is the whole difference
between a book and a sheet, and it is what makes a book worth stealing rather
than editing.

**Two steps now, and neither is a button of its own.** `blank-book` is an
ordinary craft recipe (`docs/tags.yaml`): ten Paper, no skill, no ⬢,
`perTurn: 4`. Then **Write** takes a blank book like it takes a blank sheet —
the option appears in "What are you writing on?", and choosing it grows a Title
field and raises the box from `WRITE_MAX` to `BOOK_MAX`.
`db/lib/paperMint.js#bindBook` still mints the row; it now spends **one blank
book** rather than ten sheets, because the sheets were spent at the craft.

- **Bind a Book and Tear Up a Book are gone.** Binding is the recipe plus
  Write; tearing up has no replacement, so a book is permanent and the ten
  sheets are not coming back.
- The reason binding could not be a recipe was that `items:` had no way to say
  "ten". It does now — `count:` on a spent ingredient
  (`db/lib/tagShapes.js#normalizeRequirementItems`, `CRAFTING.md` §2), which
  any recipe can use.
- **Binding needs no letters any more.** Craft has no notion of literacy, and
  that turned out to be right: sewing pages together is not writing. The gate
  is where the writing is — `writePaperImpl`'s `readBlock` check.
- **A book wears its title**, and must be given one — a shelf of books all
  called `A Note` would be useless. A letter may be given one and need not be
  (below). The contents of either still sit behind the literacy gate. Same reason its `inspectVisibility` is `ALWAYS`
  where a note's is `HIDDEN`: carrying a book is visible, reading it is not.
- **Authored books** — the Keep's Library, the Meister's Office — are declared
  in `docs/tags.yaml` with `bookText:`, the same shape `sealMark:` has:
  `db/lib/syncTags.js` files it on `paperKind: BOOK` + `paperText`, and
  authoring a `description:` beside one is an error rather than an override.
  They must sit in `items-paper`.
- Those are **catalog** rows, not `ephemeral` ones, so unlike a letter they are
  not withheld by `getVisibleTags`'s held-only filter — every browser gets the
  row. So `paperDescription` composes a book's text only for a reader actually
  **holding** it (`viewer.holdsIt`, passed by `web/lib/referenceData.js`);
  everyone else reads `CLOSED_BOOK_LINE` and has to go and find it. Without
  that, one literate character would publish the whole Library.

**A note's name is anonymous unless the writer names it.** The Write dialog
offers a title on a **blank** sheet — optional, and left empty the sheet is
called `A Note`, which is what every sheet in the game was called before this
existed. `paperName(title)` in `db/lib/paper.js` is the whole rule.

Know what a title costs, because it is not nothing. `Tag.name` travels
everywhere a tag does (Transfer, Loot, a room's Storage readout, the bot's
inspect embed, a noticeboard listing) and **none of those surfaces knows
anything about literacy** — so a title is read by every hand the sheet passes
through, illiterate ones included, while the text stays gated. That is the same
bargain a book has always made: a title is what the writer chose to advertise
on the outside, and it is a different act from what they wrote inside. A writer
who wants to advertise nothing leaves it blank. The writer's own name is still
kept on `Tag.paperAuthor` for the GM and nothing else, and is never composed
into the title.

**Set once, on the first write.** Writing on a sheet that already has words
appends and shows no title field, so a second hand cannot rename what a first
hand called it. Sheets written before this existed therefore stay `A Note`
permanently — there is no retitle path, deliberately.

**A title goes through the wax and comes back.** A `SEALED` row is named
`<title> — Sealed Letter (<wax>)`, and breaking the seal puts the bare title
back on the sheet. An untitled letter is unchanged: `Sealed Letter (<wax>)`,
exactly as every letter read before this. A `BROKEN_SEAL` row is still
`Broken Seal (<wax>)` and wears no title at all — envelopes stack, and every
one bearing the same wax has to read alike.

This is a reversal, and worth knowing why. Sealing used to *delete* the title:
`name` was overwritten in place, nothing kept a copy, and breaking the seal
wrote `A Note`. The argument was that the outside of an envelope says whose wax
it carries and nothing else. What that missed is a courier holding two sealed
letters, who could tell them apart only by opening one — and opening one is
permanent. The secrecy is still there, and it is the same secrecy a written
sheet has always had: a title is optional, so a writer who wants to advertise
nothing leaves it blank, and the *contents* stay behind the literacy gate
either way.

`Tag.paperTitle` is where the title lives now, apart from `name`, because
`name` is composed and recomposed as the sheet is sealed and opened.
`paperName(title)` and `sealedName(label, title)` in `db/lib/paper.js` are the
only two places either string is built.

**The sealer may name an untitled sheet.** The Seal dialog grows the same
optional title field the Write dialog has, but **only when the sheet arrived
with no title** — that keeps the set-once rule, so a second hand cannot rename
what a first hand called it. `sealWithMark` enforces it server-side rather than
trusting the hidden field, and the posted title goes through `cleanCustomText`
for the same reason a written one does. Letters sealed before this existed have
no stored title and stay as they read today; those names are gone.

**A title is scrubbed, not just trimmed.** It goes through
`cleanCustomText` (`web/lib/customCraft.js`), the custom-craft mint's own
scrubber, which takes out `@`, `{` and `}` — a paper's name is interpolated
straight into bot messages (`You put ${name} up.` on a noticeboard, the Bird's
`The bird is away with ${name}.`), so an unscrubbed `@everyone` would be a real
mention. The book title never ran through it and now does.

The name used to read `A Note (TG-4596)` — a waybill code in the Depot's house
style — and that was never a design choice, only a constraint showing through:
`Tag.name` was `@unique`, so every new sheet needed a title no other tag had.
Naming an object after its own database key is what `slug` is for, and
`Tag.slug` (`custom-paper-<who>-<stamp>-<rand>`) was already doing it. The
`@unique` on `name` was **dropped** (`20260913010000_paper_name_not_unique`)
and the code went with it.

Two consequences worth knowing. Nothing in the game may look a `Tag` up by
name any more — `Role.startingTagSlugs` was the last reader that did, and
`db:sync-roles` now resolves the display names `docs/roles.yaml` authors into
slugs as it validates them (`db/lib/startingTags.js`), so the column is finally
honest about what it holds. And where two rows of one kind genuinely *should*
be told apart on sight — a corpse, a disguise, a photograph — the `(2)` suffix
their minters add is now a readability choice rather than a constraint, and is
kept on purpose. Two notes both reading `A Note` is the point; two bodies both
reading `Ada's Corpse` is not.

Telling your own two notes apart is the excerpt every picker already shows
(`character/page.js`), which is literacy-gated — so the one person who can tell
them apart is the one who can read them.

## 5. Wax

A wax stamp is declared by `sealMark:` in `docs/tags.yaml` — the line the wax
carries, "Three cups, stacked." `db:sync-tags` composes the whole description
around it, so the boilerplate is written once; authoring a `description:`
beside a `sealMark:` is an error rather than an override.

- **Six courtier seals**, `pointCost: 1`, gated on `courtier`, and
  **`exclusive`** — a courtier has *one* seal. It is a signature, not a
  collection, and a courtier who owned all six could sign as anybody.

  Note what that does and does not cover. `exclusive` is enforced on the
  purchase paths only — the creation wizard, `/store`, and their server-side
  re-checks — the same posture the Beliefs have. It does **not** stop a second
  seal arriving by Transfer, by Loot or from a GM, and that is deliberate: a
  seal is a physical object, so taking one off somebody is exactly the kind of
  thing the game is for. What you cannot do is *buy* a second.

  All six share `requiredTag: courtier`, which does not defeat the flag —
  `exclusiveConflict`'s exemption (`web/lib/characterCreation.js`) is for a
  direct parent/child pair, and neither seal requires the other.
- **Eight office stamps**, `purchasable: false`, each starting in the room its
  seat works out of (`docs/zones.yaml` `stash:`). All `tradeable: true` like
  every other piece of office regalia — prying the Bishop's stamp off the
  Bishop is the kind of thing the game is for (`TAGS.md` §5).

  **Not `exclusive`.** A stamp belongs to a seat rather than to a person, so
  holding two means you took one of them off somebody, which is a situation
  worth having. It would also be inert: nothing here is purchasable, and the
  purchase paths are the only place the flag is enforced.

**The Merchant's is the one stamp with no mark in the file.** His bears his own
initials, written once at character creation beside the line that teaches the
Depot turret his face (`db/lib/merchantSeal.js`). `db:sync-tags` leaves both
`sealMark` and `description` alone for any stamp that names an office but
carries no authored mark, so a re-sync cannot rub it back off.

**One seal comes off no stamp at all.** `paperMint.js#sealWithMark` takes the
label and mark as plain text, and `sealPaper` is now a wrapper that reads them
off a stamp `Tag`. Its only caller is the GM letter (`BIRD.md` §9), where there
is no object to press — everything downstream, `paperDescription` and the break
included, cannot tell the two apart.

**Sealing renames the row in place**, the same move a corpse makes when it rots
— a letter somebody is carrying seals in their hands with no second row to
reconcile. The name it takes leads with the writer's title, if there is one,
and trails the wax — §4 for why, and for the one moment a sealer may supply
that title themselves. The stamp is **not** consumed.

**Breaking a seal is Consume**, and takes its own road out of
`consumeTagRequest`: the ordinary path reads `consumesInto`, which names
catalog *slugs*, and the letter inside a sealed one is a runtime row no slug
in `docs/tags.yaml` could ever name. It is a `BREAK_SEAL` request, and it is
the one Request in the game that undoes **exactly** — nothing was destroyed,
so re-waxing the row and taking the envelope back is the whole of it. What it
cannot undo is that they read it.

## 6. The Bird

The Bird carries an object now. It used to hold text of its own, ciphered into
runes for a recipient who could not read; `db/lib/gribble.js`, the Read button
and `ReadDialog.js` are all deleted. Paper does that job better, because an
illiterate recipient holds a real thing and can walk it to somebody who reads.

Everything else survives untouched: the once-a-day claim keyed on the in-game
**day**, the reachable-zone rule at both ends, the guessed zone, the instant
`delivered` computation, and `birdPass.js`'s delayed failure notice.

**The letter only leaves your hands if it arrives.** A wrong guess means the
bird comes back with it still tied on. Burning a player's letter as the price
of a bad guess would be a second punishment nobody was warned about — and the
guess already costs them the day's send. The sender's receipt says nothing
about whether it landed, for the same reason the failure notice is delayed.

The Reply button opens a **string select of the replier's held letters**, not a
modal: you write with the Write button, which has a real text box and no
three-second clock on it, and post it here. A reply can therefore go out
sealed, which a modal could never have expressed.

`BirdMessage.body` survives as the GM's snapshot of what went — null on a
sealed letter, because the bird did not open it either.

### 6a. Paper minted straight into someone's hands

Not every written sheet comes off the Write button. `paperMint.js#mintLetterFor`
mints a `PAPER` row already carrying its text and puts it directly into a
character's hands, with no blank sheet spent and no player at the keyboard.
Two callers do this:

- **The GM letter** (`BIRD.md` §9) — a God-King has no sheet to take a page
  off, so the letter is minted rather than moved, authored in whatever name
  the GM typed.
- **The Research pass** (`db/lib/researchPass.js`, `TURN-ENGINE.md` §2) —
  a Scholastic's Gambit that rolls a 6 or better against a secret recipe
  (`CRAFTING.md` §2b) mints them a page of notes on it at turn close,
  authored in the researcher's own presented name. Same primitive as the GM
  letter, opposite direction: there the author is invented, here it's the
  reader who earned the page.

Either way the row is the same `PAPER_SHAPE` as a written sheet — it has
weight, can be handed on, pinned up, stolen, and is swept by a Restart Game —
so nothing downstream needs to know how it arrived.

## 7. Noticeboards

`noticeboard: true` in a Location's `attributes:` map
(`docs/zones.yaml`, registered in `db/lib/locationAttributes.js`, which refuses
an unregistered key). Set on the Square, the Gatehouse, the Garrison, the
Factory and the Depot.

The button is the **fifth** on the Location anchor, which is exactly Discord's
per-row cap — anything after this needs a second row. `locationAnchorRow` takes
the whole Location rather than a bare id so it can read the attribute.

The panel is **ephemeral, and three selects rather than buttons per notice**:
five action rows would overflow the board at three papers.

- **Read** — `readBlock` against live tags, the open turn's phase and the
  Location's `indoors`. Either the refusal or the full text in a code block,
  which also stops anything written on it rendering as markup or pinging
  somebody. Nobody is told it was read.
- **Tear down** — open to anyone standing there, including on somebody else's
  paper. A board you cannot strip is not a board. The delete *is* the claim, so
  two people tearing at one paper cannot both walk away with it.
- **Pin** — written or sealed, and never gated on literacy. `NoticePost.tagId`
  is `@unique`: a paper is on a board or in somebody's hands, never both.

A pin and a tear each raise an ambient `-#` line naming the **paper and never
the person**. Anonymous notice-pinning is the point of a public board.

### A GM works the same board

A GM presses the same Noticeboard button and gets the same panel, with the one
control that needs a body swapped out. **One rule decides which panel you get,
and it is the same rule on both faces:**

```
an alive character standing here  ->  you act as that character
otherwise, and you are a GM       ->  you act as a GM
otherwise                         ->  "You're not here."
```

So a GM who is playing somebody works the board through that body when they are
standing at it, and as a GM everywhere else — which is also why a GM never meets
"You're not here." on a board any more. On Discord the board is the one whose
channel the anchor sits in; on the web it is the Location the GM has open in
`/chat`, and the button lives in the zone rail's column because GM mode has no
right column of its own (it is built from a character, and GM mode is the
absence of one).

Three differences, each a consequence of having no body:

- **Post a notice**, where a player gets Pin. A GM carries no paper, so the
  notice is written on the spot — Title and Body — and minted through
  `mintUnownedPaper`, the one minter that needs no character. `postedById` is
  null, the shape a Wanted poster already lands in.
- **Read** skips `readBlock` entirely, wax seals included. A GM holds no tags,
  so the ordinary gate would call them illiterate and refuse every notice on
  every board.
- **Tear down** destroys the paper with the post (`destroyNotice`), because
  there are no hands to take it into. Exactly what the expiry sweep does.

**The ambient line is deliberately identical.** A GM's pin and a GM's tear raise
the same anonymous `-#` line a player's does, naming the paper and never the
person, so nobody in the room can tell one from the other. The only record of
who posted a notice is the `AuditLog` row (`gm_post_notice` / `gm_tear_notice`)
— `paperAuthor` carries the GM's Discord id and nothing renders it anywhere.

A GM notice takes the same `noticeExpiryTurns` clock as everyone else's; there
is no field for it.

`GameConfig.noticeExpiryTurns` (default 10, live on `/gm/dev`) is how long one
stays up, counting the turn it went up in. **An expired notice is destroyed,
paper and all** — it blew away, which is what makes tearing one down worth
doing. The `noticeboard` pass in `db/index.js` deletes the `NoticePost` and the
`ephemeral` Tag row with it.

Wanted and Debtor notices ride this same machinery rather than a bespoke one —
`db/lib/wantedPoster.js` mints them through `paperMint.js` and pins one copy
on a board (the Square for Wanted, the Depot's board for Debtor) with
two more loose sheets scattered in nearby rooms, on a 30-turn clock.

That machinery is a **character-creation** thing only. The Censor's and the
Sheriff's Arrest Warrant button (`REQUESTS.md` §5g) grants the Wanted tag and
puts up **no paper at all** — the man is read as wanted off his own face
(`TAGS.md`, `visible: named`) and nothing announces it. Do not "fix" that by
wiring `postWantedPosters` into the warrant: a warrant nobody can see coming is
the point of it.

## 8. Where the code lives

`db/lib/reading.js` (the gate), `db/lib/paper.js` (names, descriptions, the
per-viewer composition), `db/lib/paperMint.js` (the four writes),
`db/lib/noticeboard.js` (board copy, the attribute, and `destroyNotice`),
`db/lib/merchantSeal.js` (his initials),
`web/app/(app)/character/paperActions.js` (Write and Seal),
`bot/src/lib/noticeboardPanel.js` (the board, players' and GMs' alike),
`web/app/(app)/chat/GmNoticeboardDialog.js` (the GM's board on the web),
`bot/src/lib/birdReply.js` (the answer),
`db/lib/customText.js` (what an authored title may contain),
`docs/tags.yaml` + `docs/zones.yaml` (the catalog and where the stamps start).

## 9. What this does not do

- **Forgery is HALF implemented.** The `forger` tag (Brigands only,
  `general-brigand`) is a real recipe skill, and it now reaches **every stamp
  in the game** — the six courtier wax seals *and* all eight office stamps,
  the Baron's included — each `craftable` at 1 turn and 2 ⬢. So a brigand can
  make a Fleur-de-Lis, or the Bishop's own mark, and seal a letter with it.

  The two sets throttle differently, on purpose. The six courtier seals are
  `exclusive: true`, so a forger holds one at a time and has to hand each off
  before making the next. The eight office stamps are not, because a stamp is
  an object attached to a seat rather than a signature you chose — holding the
  Bishop's and the Censor's at once is a situation the game wants. Note that
  `exclusive` now bites on the craft route where it used to be inert on these:
  `craftRequest` calls `exclusiveConflict`, and before they were craftable
  there was no path it could apply to.

  Nothing was opened up besides crafting: the office stamps stay
  `purchasable: false`, so the only two routes to the Baron's stamp are taking
  it off the Baron and forging one. The recipe stays hidden from everyone but
  a forger, because `forger` is a `catalog: gm` skill and
  `web/app/(app)/character/page.js` strips a recipe gated on a hidden trade —
  a "Recipe: Forger · 1 turn · 2 ⬢" line on the Baron's stamp would tell the
  whole game that stamps get forged, which is the one thing a forger pays for.

  What is still NOT implemented is forging the **handwriting**: a letter's
  `paperAuthor` is always the writer's presented name, and nothing lets a
  forger set it to somebody else's. That is the remaining hook, and §5's
  presented-name rule is where it would go.
- **No copying.** There is no way to duplicate a letter. Transcribing one is
  Write plus retyping, which seems right.
