# The game 3 redesign

This is the architecture for reworking the whole web UI for game 3. It sets
the direction and the decisions; Opus plans each phase from it and Sonnet
builds. It does not replace `DESIGN-SYSTEM.md` yet. That doc gets rewritten
in the last phase, once the rules below have been proved in the app.

Two mockups sit beside this doc and are the reference for how it should
look: `docs/design/mockups/chat/index.html` (the full treatment) and
`docs/design/mockups/character/index.html` (the CSS-only template every other
page follows). Open them in a browser. The screenshots next to them were
taken in a sandbox with no font access, so the blackletter is missing there.

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
| Tier names | Numerals everywhere. `Melee (Skilled)` becomes `Melee III` in `docs/tags.yaml`, so it is the tag's real name on both faces. Sidegrades keep their word: `Laborer (Farming)`. Section 7. |
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

The chat mockup's values, then the 10% correction.

**Ground and surfaces.** Warm black, not teal. Mockup: `#0d0b08` ground,
`#171310` surface, `#211b16` raised. Correction: lift each a step so the app
reads dark rather than black, around `#14110d` / `#1d1814` / `#27211b`, and
keep the 1.20 contrast per rung the surface ladder rule requires.

**Textures.** `web/public/assets/chrome/` holds the five files and their
attribution. `chatbg.png` tiles under every page. The mockups ran it at full
strength on chat and 0.35 on the sheet; correction: about 0.6 on the chat
log, 0.25 elsewhere, so it is a texture and not a subject. `chatshadow.png`
repeats along the top of the log. `bg.png` is a vertical rail, `bg2.png` the
header strip, `stats-LFWB.png` the frame around the chat "you" panel. Sprites
scale at integer multiples with `image-rendering: pixelated`.

**Accent.** Dried blood for fills (`#7a2a24`), a rusty salmon for text
(`#d8806a`). Correction: desaturate both a little and let the positive
green (`#7fa06a`) and the gold warning (`#c9a24a`) carry more of the
interface, so it is iron and lamplight rather than iron and blood. No teal.
No orange.

**Text.** Bone grey `#b3ada2` body, `#7d776c` muted, `#cfc9bb` emphasis.
Speech `#efb28a`. World subtext `#8a8478`. Combat and danger `#fd5b5b`.
Blackletter in `#9a5a5a` with `text-shadow: 0 2px 3px #000`; Lifeweb's own
`#744` fails contrast on this ground. Names get a small fixed palette of six
muted hues, assigned per character and stable across sessions.

**Fonts.** Body and chrome:
`system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif` at 13px,
12px in tables and chips, line-height 1.3. That is the "more modern"
correction: Verdana-2003 was a step too far. Headings are the same face,
bold, barely larger than body. `--font-mono` becomes
`"Courier New", Courier, ui-monospace, monospace` for numbers only.
`--font-display` stays UnifrakturMaguntia, the one Google Font left, used
for a zone heading, a decree, and the name on the sheet. `next/font` drops
Source Sans 3, Source Serif 4 and IBM Plex Mono.

**Shape.** Radius 0 everywhere; the radius ladder collapses to one token at
0. `.btn` is a 2px outset border on a flat fill, inset on `:active`. Inputs
are inset with a hard dark edge. Panel padding 8px, table cells 2px 6px with
1px rules. Chips are bordered labels with a 3px category rule, not pills.
`StatusPill` is bold coloured text with no background.

## 4. Themes and time

`themeForPhase` in `web/lib/turnFormat.js` picks dusk or dawn from the turn's
phase today. Game 3 syncs to real Central time instead:

- One palette, two named looks. `dawn` and `dusk` are both defined on the
  rust ground and differ in lamp warmth only: dawn a little cooler and
  lifted, dusk warmer and lower.
- **A slow gradient through the day, a hard switch at dusk.** Between dawn
  and dusk the warmth tokens interpolate with clock time; at the dusk moment
  the theme flips at once. The interpolation is a handful of tokens set on
  `<html>` from a small client hook, re-evaluated on a coarse timer, never
  per frame. Everything else is static CSS.
- `limestone` is deleted, `THEMES` shrinks to two, `BASCINET_THEME` keeps
  working as the override.
- `npm run audit:contrast --workspace=web` gates both looks and both ends of
  the gradient. A monochrome-ish rust palette is where AA is easiest to lose,
  so this runs in every phase.

## 5. One component set

The app has 644 top-level CSS classes and 170 components, and the same idea
drawn several ways. The redesign is the excuse to end that. The rule: **a
page may not own a control that the shared set already has.**

Keep and restyle, since they already carry most of the app: `PageShell`,
`PageHeader`, `Panel`, `DataTable` and `Pager`, `Modal` and `useConfirm`,
`ActionButton`, `ActionDialog`, `CheckField`, `Switch`, `CheckPicker`,
`ChipPicker`, `StatusPill`, `EnumPill`, `EmptyState`, `SubmitButton`,
`FormError`, `useActionRunner`, `useNotice`.

Consolidate while touching them:

- **Desk chrome.** `.desk-*`, `.ops-*` and `.audit-*` are three nav-rail
  families for four desks. One `DeskRail` component and one `.desk-*`
  family; `DeskHeader` stays the one header.
- **Page families.** `.chat-` (147 rules), `.desk-` (79), `.depot-` (35),
  `.map-` (29), `.sheet-`, `.ledger-`, `.equip-` each carry their own
  buttons, headers and lists. Anything in them that is a button, a header, a
  chip, a list row or a tab moves to the shared class; only true layout
  stays page-scoped.
- **One log renderer.** `/chat`'s feed, `/archive`, the desk inspector's
  Archive tab and the DM thread all draw a line of transcript. One
  `TranscriptLine` component with one style, keyed on `channelKind`, used by
  all four.
- **One header strip.** `.panel-header` draws `bg2.png`; the chat column
  bars and the desk column heads use `.panel-header` rather than their own.

## 6. The chat rework

The feed is where the look lives and where the named pains are. In order:

**The composer.** One textarea, Enter sends and Shift+Enter breaks, the Say
kind is a small segmented control beside it rather than a dropdown, `@` opens
the mention directory inline, Up-arrow on an empty box edits your last line.
The typing line stays above it. Nothing in this touches the outbox.

**Your own line appears at once.** `feedStore` already has an optimistic
`pending` map keyed by `clientId`. The pain is that the composer waits on the
POST before it clears and the pending row is not drawn until the store
re-renders. Fix: clear the box and append the pending row on submit,
synchronously, and reconcile on the confirmed row. Failure marks the line,
never removes it silently.

**Switching places paints from cache.** `/chat` should hold every place's
last window of rows in the store and paint it on switch before fetching
history. The snapshot layer in `web/lib/snapshot/` is the seam; the store's
`resetHistory` should not wipe what was already shown.

**Unread and notification.** Two levels, like Discord:

- *Unread.* The newest notable seq in a place is past what this browser has
  seen there (`seenStore`). The place's name brightens. No number.
- *Notified.* A mention of you, a line in your Bascinet mail, or a DM. A red
  count, the chime, and a browser notification when the tab is hidden.
  Counts are per place and clear when the place is read.

`SYSTEM` scenery never counts for either, as today.

**A name is a mention.** `db/lib/mentions.js` (new) answers "does this text
name this character" for both faces: whole-word match on the presented name
and the bare first name, case-insensitive, never on a concealed character,
never on the speaker. The bot's `messageCreate` and the web's send path both
call it and write a mention relay through the existing `relayWebMentions`
shape, so Discord gets a real ping and the web gets a notified count. The
directory in `web/lib/mentionDirectory.js` stays the source of names.

**The intercom block.** `channelKind: "intercom"` rows draw as a bordered
full-width block: a small caps heading ("Intercom · Keep"), the words in the
body face at regular size, a top and bottom rule. It scrolls with the log.
The decree block from the mockup is the same component with a blackletter
heading, so GM notices and intercoms share one shape.

**Places column.** Compressed, sectioned, as the mockup draws it: Mail,
then the zone name as a divider, Summary, Here, Locations, Rooms, Elsewhere.
Unread brightens, notified counts. The mobile drawer is the same list.

**Removed from the mockup:** the sprite scrollbar.

## 7. Tier names

The chains in `docs/tags.yaml`: Melee and Ranged (Basic, Trained, Skilled,
Expert, Legendary), Laboring, Pickpocketing, Smithing, Builder, Medical,
Brewing, Cooking (various subsets). Rename each rung to a numeral by its
position in its own chain, so `Melee (Basic)` is `Melee I` and
`Melee (Legendary)` is `Melee V`, while `Builder (Skilled)`, the first rung
of a chain that starts there, is `Builder I`. The word stays wherever it is
a sidegrade rather than a rung (`Laborer (Farming)`, the Laboring
masteries). `parentTag` and `requiredTag` keys do not change; only `name`.

Names are referenced in prose across the system docs, the handbook and a
handful of `db/lib` strings (four hits). The rename is a sync, not a
migration: `db:sync-tags` upserts by key, so no character loses a tag. This
is a game 3 change and never runs against the game 2 database.

## 8. GM desks

They inherit the look through the shared classes and get the consolidation
in section 5. No layout redesign. The rule for a desk page in this pass:
if it looks broken after the restyle, fix it; if it looks dense, leave it.
The inspector column, the modeless dialogs and the keyboard guards in
`ADJUDICATION.md` and `PLAYER-DESK.md` are not touched.

## 9. Constraints that do not move

- **No `backdrop-filter`, no per-frame animation, no full-viewport animated
  layer.** `/gm/turns` scrolling smoothly is the benchmark. The theme
  gradient is a coarse timer setting tokens, not an animation.
- **The contrast audit gates every colour**, both looks, both ends of the
  gradient, the zone and tag codes at 3.0.
- **Every colour is a token.** Zero hardcoded hex in a component stays
  zero. The name palette in section 3 is six tokens.
- **Discord still gets every line.** The outbox, the proxy pipeline and the
  mirror are not part of this work. A web-only feature is presentation, or a
  notification, never a message Discord does not receive.
- **Mobile keeps the 720px shell, the 44px floor and the bottom bar.** The
  chat page keeps its full-screen phone view.
- **The BY-SA attribution ships with the first texture commit**
  (`web/public/assets/chrome/ATTRIBUTION.md`, already there) and a line in
  the handbook credits.

## 10. Phases

Each phase is one Opus plan and lands on `master` in v3 on its own. Order
matters: every later phase is judged against the look the earlier ones
establish.

1. **Tokens and fonts.** The two rust looks in `globals.css`, the system
   font stack, radius to 0, bevels on `.btn` and `.field`, the header strip,
   the ground texture at 0.25, limestone deleted. Audit green. Every page
   changes at once and nothing else does. This is the sheet mockup made real.
2. **Real-time theme.** The CST clock, the gradient tokens, the hard switch.
3. **Shared set consolidation.** Section 5: the desk rails, the log
   renderer, the page families' private buttons and headers. Pure refactor,
   no visible change beyond the look already landed.
4. **Chat.** Section 6, in its listed order: composer, instant own line,
   cached place switch, unread and notified, name mentions (bot and web), the
   intercom block, the places column, the rails and the you-panel frame.
5. **Tier names.** Section 7, with the doc and handbook sweep.
6. **GM desks.** Section 8.
7. **Docs.** Rewrite `DESIGN-SYSTEM.md` to the new rules, retire
   `CRT-TERMINAL.md`, update `CHAT.md` and `SHEET.md`, and delete this file's
   sections 3 to 6 in favour of pointers, so there is one design doc again.

## 11. Out of scope

Sprite icons for verbs and the organ strip (the Lifeweb HUD sheets), a
Discord-side equivalent of any web notification, changes to the outbox or
the mirror, and anything about game rules. Those are later conversations.
