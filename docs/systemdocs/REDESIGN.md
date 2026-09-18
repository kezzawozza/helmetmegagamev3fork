# The game 3 redesign

This is the record of reworking the whole web UI for game 3: what it was
going for, the decisions Bascinet made, and which phase landed what.
**`DESIGN-SYSTEM.md` holds the rules now** — read that first for how the app
is actually styled. This doc stays as the history and the reasoning behind
those rules, not a second copy of them; §3–§9 below each point at the doc
that now owns their material instead of restating it.

Two mockups sit beside this doc and were the reference for how it should
look: `docs/design/mockups/chat/index.html` (the full treatment) and
`docs/design/mockups/character/index.html` (the CSS-only template every other
page followed). Open them in a browser if you want to see where the numbers in
§3 originally came from. The screenshots next to them were taken in a sandbox
with no font access, so the blackletter is missing there.

## 1. What we are going for

The inspiration is Lifeweb. Its interface is a rusted, riveted fixture with a
plain, slightly ugly, functional log inside it. Two registers, on purpose:

- **The fixture.** Dark textured ground, iron rails, hard 1px borders,
  bevelled buttons, square corners. Blackletter for the few things the world
  says in its own voice: a zone name, a decree, a character's name on their
  sheet.
- **The tool.** The log, the tables, the forms. A plain system font at a
  small size, grey on dark, bold coloured names, salmon speech, dim world
  lines. It should read like output, not like a brand.

The gap between those two is the aesthetic. If both are tasteful it turns
back into Caves of Qud, which is where the current app sits: teal ground,
ember-orange accent, a designed serif and sans pairing, rounded panels.

Bascinet's correction after seeing the mockups: **about 10% less grimdark
than the chat mockup.** Concretely, in section 3.

## 2. Decisions made

These were settled with Bascinet on 2026-09-17. Do not reopen them in a plan.

| Decision | Answer |
|---|---|
| Tier names | Numerals everywhere. `Melee (Skilled)` becomes `Melee III` in `docs/tags.yaml`, so it is the tag's real name on both faces. Sidegrades keep their word: `Brewing (Distilling)`. Section 7. |
| Unread model in `/chat` | Discord-style. A place with unread notable lines brightens its name. A red count appears only for a mention, Bascinet mail, or a DM. Section 6. |
| A bare name is a mention | Yes, on both faces. The bot and the web both treat a character's name said in a Location as a mention: a red count on the web, a real ping relayed on Discord. Concealment wins: a hooded name never triggers. |
| Themes | One rust palette. Dawn and dusk stay as the two phase looks but both are re-solved on it; they differ by lamp warmth only. Limestone is deleted. The theme follows real CST time: a slow gradient in warmth through the day and a hard switch at dusk. Section 4. |
| Panel chrome | The metal strip goes on every `.panel-header` app-wide, plus the faint ground texture. Everything else is flat CSS. |
| Intercom | A full-width bordered block in the feed, like the mockup's decree. Scrolls with the log. Discord keeps its `@here` message. |
| Responsiveness | Three named pains: your own line takes too long to appear, switching places is slow, and the composer is clumsy. Incoming latency was not named. |
| Phones | Desktop first. Under 720px the same look scales up: 14px text, the 44px tap floor, the bottom bar kept. |
| Discord | The web is primary; Discord is the mirror. Every line still lands there, but web-only presentation needs no Discord equivalent. Discord players get the plain text. |
| GM desks | Restyle and consolidate. They inherit the look through the shared classes, and duplicated desk components merge into the shared set while they are being touched. |
| Font | A plain system stack, no web font for the body. One download: the blackletter. |
| Overgrowth motif | No. Bascinet considered vines and flowers and decided against them. |
| Scrollbar sprites | Out. The chat mockup's sprite scrollbar looked bad; use a flat dark `scrollbar-color` everywhere. |

## 3. The look, in numbers

This section set the ground, surface, accent, text and shape values — the chat
mockup's numbers, then Bascinet's 10% correction toward less grimdark. All of
it landed in phase 1 and has since moved with the app: **`DESIGN-SYSTEM.md`
§2 (Colour) and §3b (Shape) are where the real values live now**, gated by
`npm run audit:contrast --workspace=web`, not this doc's snapshot of them.

## 4. Themes and time

This section specified moving off `themeForPhase` (turn-phase-based) onto the
real Chicago clock, with a slow warmth gradient through the day and a hard
switch at dusk. Landed in phase 2. **`DESIGN-SYSTEM.md` §3 (Themes)** is the
current description, alongside `web/lib/clockTheme.js` itself.

## 5. One component set

This section named the duplication to end — three desk-rail families, five
page families each carrying their own buttons and headers, three copies of a
transcript line — and set the rule that a page may not own a control the
shared set already has. Landed in phase 3, across the shard commits below.
**`DESIGN-SYSTEM.md` §5 (Shared classes) and §6 (Page shell)** now own the
component list and the rule.

## 6. The chat rework

This section laid out the chat pains in order — the composer, an instant own
line, a cached place switch, unread vs. notified, a bare name as a mention,
the intercom block, the places column — and is now what phase 5 is building
on `phase5-chat`. **`CHAT.md` is the doc that owns this material**, and will
describe it as shipped once that branch lands; this section is not kept in
sync with it in the meantime.

## 7. Tier names

This section set the rename rule — a chain's rungs become numerals
(`Melee (Skilled)` → `Melee III`), a sidegrade keeps its word
(`Brewing (Distilling)`) — and is now what phase 6 is building on
`phase6-tiers`. **`TAGS.md` is the doc that owns tag naming**, and will
describe the numerals as shipped once that branch lands.

## 8. GM desks

This section asked for the desks to inherit the look through the shared
classes and fold their duplicated rail/tab/header components into it, with no
layout redesign. That work happened inside phase 3 rather than as a separate
pass — the shard commits below (`DeskRail`, the shared tab strip, the header
strip on desk column heads) are what this section asked for. **`DESIGN-SYSTEM.md`
§6 (Page shell, the desk exception)** is where it is documented now.

## 9. Constraints that do not move

This section held the lines that do not move regardless of phase: no
`backdrop-filter` and no per-frame or full-viewport animation, every colour a
token, the contrast audit gating every colour and both ends of the theme
gradient, mobile keeping its 720px shell and 44px floor, Discord still
getting every line, and the BY-SA texture attribution shipping with the
textures. All of these are now load-bearing rules in **`DESIGN-SYSTEM.md`**
(§2 Colour, §3a Chrome, §9 Mobile) rather than a list to check against once —
CHAT.md carries the Discord-parity constraint specifically, once phase 5
lands.

## 10. Phases

Each phase is one Opus plan and its own push (or its own branch, until it
lands) to `master` in v3. Order matters: every later phase is judged against
the look the earlier ones establish.

1. **Tokens and fonts — landed** (`43e83ffe`, "Phase 1 of the game 3 redesign:
   the rust palette, system fonts, square bevelled chrome"). The two rust
   looks in `globals.css`, the system font stack, radius to 0, bevels on
   `.btn` and `.field`, the header strip, the ground texture at 0.25,
   limestone deleted.
2. **Real-time theme — landed** (`56f6db70`, "Phase 2 of the game 3 redesign:
   the look follows the Chicago clock"). The Chicago clock, the gradient
   tokens, the hard switch.
3. **Shared set consolidation — landed**, across five shards: `aaa28209`
   ("one TranscriptLine for the feed, the inspector and DMs"), `e7f512ef`
   ("one DeskRail — the Dev Panel and audit rails fold into it"), `d182b0c2`
   ("Chat's and the Depot's tabs take the shared
   strip"), `34ada3a4` ("one recipe for the quiet label over a group of
   things"), `9f7c07b1` ("one header strip on the desk column heads"). Pure
   refactor, no visible change beyond the look phases 1–2 already landed.
4. **The sheet — landed** (`f0eab3b7`, "Phase 4 of the game 3 redesign: the
   character sheet, rebuilt"). The band with the blackletter name, the five
   tiles, the verb strip as hairline-split bevelled groups, the tag rail, the
   equip board, Mood as the nine-band strip. `SHEET.md` was updated with it.
5. **Chat — landed** (`Merge branch 'phase5-chat'`). The composer, instant own
   line, cached place switch, unread/notified, name mentions, the intercom
   block, the places column. See §6 above.
6. **Tier names — landed** (`Merge branch 'phase6-tiers'`). See §7 above.
7. **GM desks — absorbed into phase 3.** No separate pass was needed; the
   shard commits above did the consolidation this phase asked for.
8. **Docs — this commit.** `DESIGN-SYSTEM.md` rewritten to the rules as they
   exist in code, `CRT-TERMINAL.md` retired, and this file's §3–§9 turned
   into pointers so there is one design doc again. `CHAT.md` and `TAGS.md`
   are phase 5's and phase 6's to update when those branches land — not
   touched here.

## 11. Out of scope

Sprite icons for verbs and the organ strip (the Lifeweb HUD sheets), a
Discord-side equivalent of any web notification, changes to the outbox or
the mirror, and anything about game rules. Those are later conversations.
