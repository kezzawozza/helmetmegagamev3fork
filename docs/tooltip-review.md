# Tooltip review — candidates, not deletions

Nothing here has been removed. This is the list to decide from, written during
the copyedit pass over player-facing text.

Two of our own docs already argue both sides, and both are worth reading before
cutting anything:

- **`DEPOT.md` §"the strip"** — *"No paragraph of explanation, no tooltips: a
  control whose name does not say what it does is the bug, not the missing
  tooltip."*
- **`SHEET.md` §2, the verb strip** — *"**Every button hovers**, the same tooltip
  the verb wears everywhere else."* The verb-strip tooltip is **deliberate**, and
  documented. Removing the `ACTION_HELP` mechanism is a design change that has to
  edit `SHEET.md` too — not just a deletion in `actionRegistry.js`.

So the list below is deliberately narrow: it names the sentences that fail
DEPOT.md's test *on their own terms* — the ones that say the button's name back
to you and nothing else.

## 1. `ACTION_HELP` sentences that restate their own label

`web/app/components/actionRegistry.js`. 46 entries total. These eight tell a
player who has already read the button nothing they did not just read:

| Line | Button | Tooltip | Note |
|---|---|---|---|
| 67 | Look at | "Look at someone." | |
| 70 | Destroy | "Destroy an item." | |
| 77 | Butcher | "Butcher a body." | |
| 69 | Craft | "Smith, craft, brew, or cook." | Arguably earns its keep — it names the *four* skills behind one button |
| 74 | Loot | "Loot somebody that's bound or helpless." | The gate is the content; the verb is the label |
| 93 | Kiss | "Ask somebody for a kiss." | "Ask" is the one real fact — it is a consent handshake (`KISS.md`) |
| 125 | Seal letter | "Close a letter with your wax seal." | |
| 73 | Tax | "Automatically tax your subjects" | **Verbatim copy** — Bascinet's words. Also the only entry in the file missing its full stop |

Three more are short but say something the label does not, so they are listed
for completeness rather than as candidates:

- line 75, **Free** — "Cut somebody loose."
- line 71, **Transfer** — "Exchange resources or tags." (names *what* moves)
- line 138, **Check wanted** — "Read the warrant book." (names the object)

The long entries — Extract, Crucify, Arm nuke, Package, Use pointer, Disguise —
all carry real rules (costs, timings, what the roll needs) and are not
candidates.

## 2. `InfoIcon` — the `(?)` glyph

`web/app/components/InfoIcon.js`, described in its own header as being for
"extra explanation nobody asked to see." Player-facing sites only:

- `BioNameFields.js:66` — "Rendered in quotes between your first and last name."
  Strongest candidate: it describes the field's own formatting, visible the
  moment you type.
- `CreateCharacterWizard.js:521` — titles are earned.
- `CreateCharacterWizard.js:550` — the dynasty name updates itself.
- `CreateCharacterWizard.js:487` — (multi-line).
- `AvatarField.js:24`, `DesirePanel.js:86` — text passed in, not fixed copy.

**Not player-facing despite living in `components/`:** the five long blurbs in
`TagFieldset.js` (weight band, wound chain, cure chain, price reference,
adjudication note) reach players nowhere — `TagFieldset` is only mounted from
`CustomTagDialog` and `gm/dev/tags`. Leave them; they are GM reference.

`messageTokens.js:54`, `RichText.js:41` and `DocumentMarkdown.js:41` render an
`{info:…}` token from authored content. They are a mechanism, not copy.

## 3. Native `title=` hover hints

Real browser tooltips, as distinct from the `title` prop that every dialog uses
as a heading:

- `DiscordTime.js:21,39` — the exact timestamp under a relative one. **Keep**:
  it is the only way to get the absolute time.
- `NavRail.js:103` — `title={item.label}` on a rail item that already renders
  its label. Candidate.
- `NavRail.js:130,138` — mute/unmute, sign out. Icon-only buttons, so the title
  is the only name they have. **Keep**.
- `chat/PlaceCard.js:137` — `researchHint`.
- `map/MapBoard.js:831` — which tag opened a route; `:906` — "Exert yourself for
  another free travel."
- `archive/ArchiveTranscript.js:115,151` — "Only {zone}" / "Only {speaker}"
  filter hints on click targets. Candidate: the click already does the obvious
  thing.
- `StatusPill.js:8` — a passthrough, not copy.

## Recommendation

If only one thing is cut, cut the eight in §1. They are the ones DEPOT.md is
about, and the cut is cheap: both call sites already pass
`ACTION_HELP[mode] ?? null`, and `ActionButton.js:13` returns the bare label
when there is no help and no gate reason. So the button keeps its hover, it
just stops repeating itself — which is what `SHEET.md` promises anyway ("its
name, the sentence saying what it does"; with no sentence, the name). Purchase
Gear already ships this way, on purpose.
