# Web design system

How the web app is styled, and the rules for adding to it. Source of truth for
exact *values* is `web/app/globals.css` and the font setup in
`web/app/layout.js` — this doc is a map of what's there and how to use it, not
a copy of the values. Keep it that way; a duplicate goes stale.

Product bar: **functionality, usability, cleanliness, responsiveness, browser
performance.** The explicit reference point to avoid is the typical slow,
laggy Discord bot dashboard.

**The look is two registers, on purpose.** The fixture is the rusted, riveted
frame around everything: dark textured ground, iron rails, hard 1px borders,
bevelled buttons, square corners, blackletter for the handful of things the
world says in its own voice. The tool is what sits inside that frame: the log,
the tables, the forms — a plain system font at a small size, grey on dark,
bold coloured names, dim world lines, reading like output rather than like a
brand. The gap between the two is the whole aesthetic. Make both registers
equally polished and it turns back into a designed teal-and-ember app with
rounded panels, which is the look this replaced.

## 1. Fonts

One face loaded via `next/font/google` in `layout.js`, exposed as a CSS
variable on `<html>`:

| Variable | Face | Use |
|---|---|---|
| `--font-display` | UnifrakturMaguntia | Blackletter, reserved for the few things the world says in its own voice: the login wordmark, and a character's own name on their sheet (`.ledger-name`, in `--blackletter` with `text-shadow: 0 2px 3px #000` — see §2). Chat's zone heading and its decree block are landing on the same face as part of the chat rework; that piece has not shipped yet, so it's not documented here until it does. |

`--font-sans`, `--font-serif` and `--font-mono` are plain system stacks
declared on `:root` in `globals.css`, not downloaded fonts:

- `--font-sans` — `system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`,
  13px body, 12px in tables and chips. This is the tool register described
  above: it should read like output, not like a brand.
- `--font-serif` — `"Times New Roman", Times, "Liberation Serif", serif`.
  `h1`/`h2`/`h3`, `.panel-header` and `.section-title` pick this up from one
  rule in `globals.css` and nothing else changes — every heading in the app is
  a bold serif, automatically, and no call site hand-applies a font class.
- `--font-mono` — `"Courier New", Courier, ui-monospace, monospace`, opt-in via
  `.mono`, for data only: numbers, IDs, timestamps, dice. It was the body face
  once, which made it wallpaper — dense GM tables got wider and harder to
  read, and the mono signalled nothing because everything was mono.

Two rules that are easy to get wrong:

- **Never hand-apply a font class to a heading.** Just use the tag; the global
  rule handles the serif, the weight and the size.
- **Never use `--font-display` for bulk headings, loading-state text, or
  player-authored content.** It's illegible at small sizes and reads as a
  mismatch everywhere but the few places it's deliberate. `--fs-3xl` (28px) is
  the floor it's readable at, and the only size the blackletter tokens below
  are gated for contrast against.

## 2. Colour

Entirely CSS custom properties, redefined per-theme in `globals.css`. **Never
hardcode a hex or rgb value in a component** — always `var(--x)`, so it tracks
the active theme. There are currently zero hardcoded colours app-wide; keep it
that way.

Three things about the token set are load-bearing and easy to undo by accident:

- **The surface ladder is `--bg` → `--surface` → `--surface-raised`**, each
  step keeping ~1.20 contrast. `.panel` sits on `--surface`; modals, tooltips,
  sticky table headers and the turn chip sit on `--surface-raised`.
  `--field-bg` is *recessed below* the surface, so inputs read as cut into a
  panel rather than as another panel stacked on it. At 1.08 the whole app read
  as one flat sheet, which is what this spacing fixes. `--panel-bg` survives
  only as a legacy alias for `--surface`.
- **`--accent` and `--accent-text` are different colours on purpose.**
  `--accent` is a fill or rule; `--accent-text` is for text and outlines. One
  ember token cannot be both legible and rich — collapsing them makes every
  button in the app fail AA. Similarly `--accent-solid` + `--on-accent` are the
  primary button pair, and **`--danger`, not `--accent`, is for destructive
  actions**.
- **Contrast is gated, not vibes.** `npm run audit:contrast --workspace=web`
  parses the theme blocks straight out of `globals.css` and fails on any AA
  regression. Run it after touching a colour. It also **scans `web/app` and
  `web/lib`** for `var(--accent)` used as anything but a fill or a rule — an
  allowlist, not a denylist, because the worst offender was `costColor()`
  handing the token to six callers to spend as text, which no denylist could
  attribute. `--accent` as text measures **2.96** on dusk's `--surface`: under
  not just AA's 4.5 but the 3.0 large-text floor.
- **The zone code is fills only.** `--zone-fortress` / `--zone-town` /
  `--zone-forest` / `--zone-hills` / `--zone-marshes` / `--zone-caves` /
  `--zone-depths` are colour-picked from the map and
  declared **inside each `[data-theme]` block**, not on `:root`, so the audit
  script sees them. They are the rule down the side of a `.zone-chip` and
  **never a text colour** — gated at **3.0** against `--surface`, the
  large-graphic floor, because none of them would clear AA's 4.5 and gating
  them there would only force them off the map's palette. Three of the twelve
  values deviate from the map for contrast and say so in a comment; do not
  restore them. See [`GAMEMASTERS.md`](GAMEMASTERS.md) §3.
- **The tag code is fills only, and says CATEGORY.** `--tag-general` /
  `--tag-skills` / `--tag-status` / `--tag-health` / `--tag-items` /
  `--tag-assets` / `--tag-demoness`, one per `Tag.category`, declared per
  theme and gated at **3.0** exactly like the zone code above. They are the
  rule down the left of a `.chip`, a sheet row or an item card, keyed off a
  `data-tag-category` attribute, and never a text colour.
  **They are deliberately desaturated** — around 20–35% where the values they
  replaced ran 45–57%. Mute by spending CHROMA, never luminance: the 3.0 floor
  is a luminance rule, so desaturating leaves it intact while taking the glare
  off. A sheet is forty tags at once, and forty bright stripes read as
  confetti.
  The finer distinction — which `TagGroup` — is carried by an **icon**
  (`web/lib/tagIcons.js`, rendered through `TagIcon.js`), not by a second
  colour. That split replaced a freeform per-group hex out of the database on
  2026-09-15; `ChipLabel.js` painting that hex inline used to be the one
  documented exception to "colour rides on a token", and there is no exception
  now. Do not give a group a colour.
- **The name palette is six tokens, and they owe full AA.** `--name-1`
  through `--name-6` are muted hues, one assigned per character, stable across
  sessions, used as **bold text** on a log line to tell speakers apart at a
  glance. Unlike the zone and tag codes above, a name is read as text, not as
  a fill — so `audit:contrast` gates these at **4.5**, not 3.0. Both looks
  share one set; worst case measures 6.16.
- **`--blackletter` is body text's opposite number** — the one token that
  exists to be *illegible at small sizes on purpose*, because it is only ever
  used at `--fs-3xl` (28px) and up, always with `text-shadow: 0 2px 3px #000`
  at the call site. It is gated at the **3.0** large-text floor, not full AA:
  Lifeweb's own `#744` and an earlier `#9a5a5a` both measured under 3.0 on
  this ground, so both looks' values are lifted off the "authentic" pick to
  clear it. Never set it on body text — see §1 for where it's actually used.
- **Each theme names its own `color-scheme`.** A handful of controls are drawn
  by the browser, not by `globals.css` — the unchecked checkbox, the date
  picker's calendar glyph and popup, the search field's clear button, the
  `<select>` option list, the scrollbars. They read that property and nothing
  else, so without it a native `<select>` popup opens white in dusk.

## 3. Themes

One rust palette, two named looks, both *underground darks* — Ravenheart is a
cave civilisation, so they differ by lamplight temperature and lift, not by
daylight. The look follows real Chicago wall-clock time via
`web/lib/clockTheme.js`: dawn 06:00–18:00 with a slow warmth ramp on six
tokens driven by `--lamp`, dusk 18:00–06:00 flat, hard switch at 18:00.
`BASCINET_THEME` pins either look with no ramp (`resolveLook` in
`clockTheme.js`; anything it doesn't recognise, including the deleted
`limestone`, falls through to the clock). `audit:contrast` gates the ramp at
five points, not just the two ends.

A CRT/terminal look was considered twice and dropped both times — too slow and
too much flavour once it had the full treatment (an animated warp filter,
scanline flicker), invisible once it was toned down to fit the performance
budget. Nobody has since found a middle version worth shipping. If a new look
comes up, it is not a special case: add a `[data-theme="…"]` block to
`globals.css` with the same token set as dawn and dusk, add its name to
`THEMES` in `web/lib/clockTheme.js`, and let `audit:contrast` gate it before it
ships — same as any other theme.

## 3a. Chrome

The fixture register (see the top of this doc) is drawn with two textured
layers and one sprite strip, all from `web/public/assets/chrome/` — five
images lifted from the open-licensed Lifeweb/Farweb archive, credited in that
folder's `ATTRIBUTION.md` (CC BY-SA 3.0) and again in the handbook's credits.
Anything derived from them (a recolour, a crop) carries the same license; CSS
that only references them does not.

- **`.grain`** tiles `chatbg.png` under every page at `opacity: 0.25` — texture,
  not a subject. It sits at `z-index: -1` (not 0) so it paints behind in-flow
  content rather than as a film over it, and it never animates.
- **`.vignette`** is a radial gradient toward `--shadow-color` at the same
  `z-index`, both layers fixed and `pointer-events: none` so neither costs a
  paint on scroll. Neither layer, nor anything else in the app, gets a
  `backdrop-filter` or a per-frame or full-viewport animation — `/gm/turns`
  scrolling smoothly with these composited is the benchmark.
- **The header strip is retired (2026-09-18).** `.panel-header` and the desk
  bars (`.desk-inspector-head`, `.desk-convo-head`, `.ops-section-head`) no
  longer carry `bg2.png` along their foot — the character-sheet mockup's own
  build won instead: a flex row (title on the left, a quiet `.note` on the
  right) over a single 1px `border-bottom`. It read as a row of beads and cost
  20px of padding on every panel in the app for it, and Bascinet's own words on
  seeing the mockup beside the app were "look how neat, compressed, clean the
  artifact looked". `bg2.png` is not gone from the app — `.bar` in
  `web/app/chat.css` (the chat mockup's own build, a different mockup) still
  wears it, unchanged.

Every sprite here scales at integer multiples with `image-rendering:
pixelated`. A non-integer size blurs a pixel-art image instead of scaling it
cleanly, which is the one way to make this chrome look like a mistake rather
than a texture.

## 3b. Shape

Radius is `0` everywhere. The four old radius tokens (`--r-sm`/`--r-md`/
`--r-lg`/`--r-full`) survive as aliases of `--r` so the ~110 call sites that
still name one don't need touching — never reintroduce a non-zero value under
any of them.

- **`.btn` and `.btn-secondary` are a 2px bevel on a flat fill**, drawn as
  explicit per-side borders (`--border-hi` top/left, `--border-lo`
  bottom/right) rather than the `outset` keyword, which computes its own light
  and dark from `border-color` and lands differently per browser. `:active`
  swaps the two pairs, so the button looks pressed in. A gated verb
  (`aria-disabled`/`:disabled`) goes dashed instead of pressing.
- **`.field` and `.control` are inset**, the opposite bevel: a hard dark edge
  top and left (`--border-lo`), the ordinary hairline bottom and right, so an
  input reads as cut into the panel rather than sitting on top of it.
- **Chips are bordered labels, not pills.** `.chip` is a 1px border with a 3px
  category rule down the left — `--tag-rule` set by `data-tag-category` for a
  tag chip, `--zone-*` set directly by `data-zone` for a `.zone-chip` — over a
  flat `--surface-raised` fill, square corners: a name for a thing that simply
  *is*. `danger` is the one tone a chip carries, for the short list of
  always-bad states (Overburdened, Dying, Catatonic).
- **`StatusPill` is bold coloured text, no background, no border.** A tone
  (`good`/`warn`/`bad`/`muted`/`subdued`/`accent`) says what a state *means*
  and the stylesheet supplies the colour — see §5a's "chip is a LABEL,
  StatusPill is a STATE" rule for why the two never trade places.
- **Tables are tight.** `.data-table` cells run `2px 6px` padding with 1px
  rules on every side, `--fs-xs` throughout, headers uppercase and muted. It
  reads dense on purpose — a GM desk is a log, not a brochure.

## 4. Tailwind bridge

Tailwind is bridged to the tokens via the `@theme inline` block in
`globals.css`. That's what makes `text-sm`/`text-lg` resolve to the design
scale rather than Tailwind's stock sizes, and what makes `text-muted`/
`bg-surface` real utilities.

Prefer those utilities over an inline `style={{ color: "var(--muted)" }}` in new
code — the app still carries ~80 such objects and they're retired as pages are
touched. What is left is mostly *computed*: a group colour, `costColor()`, a
map coordinate. A utility class cannot express those, so they stay.

**When overriding a size token in `@theme`, always pair it with its
`--text-<size>--line-height`**, or the utility falls back to a ratio computed
against the size you just replaced.

## 5. Shared classes

Use these instead of rolling one-off markup.

| Class | For |
|---|---|
| `.panel` | Any card/section container. A card **with** a heading is `Panel` — it carries the padding `.panel` deliberately does not, and writes the `.panel-header` for you. |
| `.panel-header` | Its heading — serif `--fs-lg`, a flex row over a 1px `border-bottom`, with `.note` for a quiet right-aligned aside. See §3a — the metal strip it used to carry is retired. |
| `.section-title` | A heading that is a **flex child beside something else**. |
| `.btn` | Solid primary button. |
| `.btn-secondary` | Outline. |
| `.btn-danger` | Destructive — Reject, Kill, Restart Game. |
| `.btn-quiet` | Text-only. |
| `.field` | Wraps a `.field-label` + input/textarea/select. |
| `.chip` | Small tag/pill labels. |
| `.zone-chip` | A `.chip` carrying the zone code on `data-zone`. `data-zone="none"` is the dashed neutral for no faction. |
| `.data-table` | Tabular data. |
| `.menu-item` | Link-like row actions. |
| `.control` | The `.field` control surface, without the label column — a `<select>` in a table cell, an input inline in a toolbar. |
| `.icon-btn` | The one framed icon button — via `IconButton`, whose `size` is `sm` (26, default) or `lg` (44), the desktop size; a coarse pointer inside `/chat` floors every one of these at 44 regardless. |
| `.chat-buttons` | Chat's only action row. A `.btn-quiet` inside one gets the padded, aligned treatment `.modal-actions` gives one, so a Cancel lines up with the button beside it. |
| `.chat-section-fold` | The one folding section header in Chat — Places' own sections, Things, Desires — a `<button>`. A header that doesn't fold is a `<p className="group-label chat-section-title">` instead. `.group-label` is the shared recipe — quiet, uppercase, --fs-2xs — and `.chat-section-title` is only Chat's own inset and spacing on top of it. |
| `.group-label` | The quiet uppercase label over a group of things, on its own — Chat's section headers, the audit inspector's field labels, a `DeskRailGroup` title, every sheet rail group. One recipe (`--ls-wide`, `--fs-2xs`, `--muted`) rather than a hand-typed letter-spacing at each call site. |
| `.tline` | One line of transcript, via `TranscriptLine.js` — the Chat feed, the DM thread, the inspector's Archive tab and the archive-context popup all draw through it. `data-density` (`feed` / `thread` / `thread-compact`) is geometry only, a staging post for the three old page families' numbers rather than a real fork; `data-kind` carries the row's `channelKind` and is the only thing allowed to change how a system line looks. `/archive`'s own four-column grid row is the one exception — no gutter/body shape reproduces it without breaking the grid. |
| `DeskRail` / `.desk-rail` | The left rail on every `(desk)` page — one component and one class family for what used to be three: the adjudication desk's and player desk's queue, `/gm/audit`'s filters, and `/gm/dev`'s and `/gm/economy`'s section nav. `variant="queue"` is a scrolling list of selectable rows; `variant="sections"` is a padded stack of titled groups (`DeskRailGroup`, which is `.group-label` over its children — this replaced `.ops-nav-group`/`.audit-group` written twice). Never give this component or its children `position`/`z-index`/`transform`/`filter`/`contain`/`will-change` — see §6. |
| `.tab-item` / `.tab-bar` | A tab strip navigating between panels. Keyed on `data-active`. One shared strip now: Chat's aside, the Depot console and the faction console all wear it instead of three near-copies, and it scrolls sideways under a narrow viewport rather than wrapping. |
| `.segmented` | A group of mutually exclusive options as one joined pill. Keyed on `aria-pressed`. |
| `.chip-row` | A wrapping row of chips. The house form for a **multi**-select: each chip is a `<button className="chip">` keyed on `data-active` (plus `aria-pressed`), and `.chip[data-active]` gives it the accent border and label. |
| `.select-card` | A `.panel` you pick. Selection is `aria-pressed`. Its left rule may carry a group colour set inline per row — a tag group in Point Buy, a desire family in the Desire picker — because those are freeform hexes out of data, not tokens. |
| `.check-row` / `.switch-row` | A boolean and its label — via `CheckField` / `Switch`. |
| `.check-picker` | A scrolling box of check rows with a filter over it — via `CheckPicker`, with `usePickList` when the caller has no selection state of its own. The house form for ticking a set out of a **long** list: a hundred-character roster, the whole tag catalog, every Location. It beats `.chip-row` exactly when the list is long enough to need a search box or a row needs a second line (a place, a role); `.chip-row` stays right for a short set of labels. Never a `<select multiple>`, which offers neither. |
| `.status-pill` | A state, coloured by `data-tone`. |
| `.empty-state` | "Nothing here" text. |
| `.form-error` | Something went wrong. Always `--danger`. |
| `.modal-overlay` / `.modal-panel` | Modals — **always** via `Modal`, usually via `useConfirm()`. Under 640px every one is a bottom sheet: full width, up from the foot, `.modal-actions` pinned. |
| `.notice-stack` / `.notice-card` | The result notice — via `useNotice()` (`NoticeProvider.js`), never by hand. One line saying what a button just did; `data-tone="bad"` for a refusal. Not a `.modal-overlay`, on purpose. |
| `.action-tile` / `.menu-item` / `.icon-btn` for a verb | A player action — via `ActionButton` (`variant="tile" | "icon" | "menu"`), which carries the label, the explaining sentence and, when greyed, the reason in one tooltip. |
| `.stack-row` / `.stack-list` | A stack you are choosing some of — via `StackRow` / `StackPicker`. Replaces a checkbox and a "How many?" box. |
| `ReorderButtons` | The ▲/▼ pair for a hand-ordered list. The arrows say nothing out loud, so the `label` prop is what carries the meaning. |
| `.chip-row` as a single pick | A short local choice — via `ChipPicker`. A dropdown hides the answer behind a click; chips show it. Not for a long list (the Bird's every-character roster stays a `<select>`). |
| `.field-dirty` | A control carrying a staged/unsaved edit. |
| `.staged-row` | A staged row, toned by `data-staged` (add vs. remove). |
| `.panel-danger` | A destructive-area card border — `--danger`. |

Three of these carry a trap:

- **`.field` is not optional.** It is how *every* form control gets themed
  (background, border, font). A bare `<select>`/`<input>` outside `.field`
  falls back to unstyled native browser chrome and visibly breaks the theme —
  wrap it even for a single standalone control.
- **`.panel-header` vs `.section-title`.** Use `.section-title` wherever the
  heading sits beside something else that is not its own `.note` — a modal
  title next to its close button, a status band next to its value.
  `.panel-header`'s own `border-bottom` spans only the header itself, not
  whatever container it shares with a sibling, so used there it reads as an
  underline on the title rather than a divider under the row. `.panel-header`
  is for a card's own heading, where its built-in flex row already holds the
  title on the left and a `.note` on the right — that is not "beside
  something else" in the sense this rule means. Where the whole thing is a
  **bar** heading a column — `.desk-inspector-head`, `.desk-convo-head`,
  `.ops-section-head` — the BAR carries its own `border-bottom` and flex
  layout; the heading inside it stays `.section-title`.
- **`.tab-item` and `.segmented` are not the same idea.** A tab strip navigates
  between panels and is keyed on `data-active`, a styling hook. A segmented
  control has a *value*, so its pressed state lives in `aria-pressed`, where a
  screen reader can reach it. Picking by looks gets the semantics wrong.
- **A multi-select is `.chip-row`, never `.segmented`.** A segmented control
  holds one value; a set of independent toggles is chips. Reaching for
  `.segmented` because it *looks* like a row of buttons is how the GM zone
  picker ended up needing a bespoke `.segmented--wrap` to defeat
  `.segmented`'s own `overflow: hidden`, and wearing a pressed state
  (`--field-bg`) so quiet that nobody could tell what they had chosen. The
  audit desk's Family filter and the inspector's "Zones I see" are the
  reference.

Three more the GM desks now hold themselves to:

- **One control, one place.** A verb offered twice is a verb a GM has to
  choose between: `+ Effect / + Message / + Public` is one component
  (`StagingStrip.js`) used by three surfaces, and there is exactly one
  "Preview push". When a panel's header grows past two controls, the side
  trips go behind a `⋯` (`DeskRowMenu.js`) and the way out stays a button.
- **A search hint has one form**, `MatchHint.js`: a muted `· what matched`
  suffix. Never a bare field name on one surface and a value on another.
- **Reserve the space a conditional line will take.** A warning that appears
  under a control and pushes the field below it down the screen costs the
  reader their place; rendering it empty costs a little whitespace.

Pick a button variant by how important the action is, rather than defaulting to
`.btn` everywhere.

Every label a player reads — buttons, tabs, dialog titles, section headings,
placeholders — is sentence case: first word capitalised, the rest lower-case,
except proper nouns and the game's own capitalised terms (page names, Move /
Routine / Gambit, Desire, Tag / Tag Points, Resources, and the like).

## 5a. The five that had no rule

These drifted precisely because this document never said anything about them —
seven wrappers for a checkbox, eight ways to show a status, twelve shapes for
an error. Each now has one component.

| Concept | Use | Never |
|---|---|---|
| A boolean | `CheckField` (a row is selected) or `Switch` (a setting is on) | A bare `<input type="checkbox">` in a hand-rolled `<label>` |
| A dialog | `Modal`, or `useConfirm()` / `RequestDialog` on top of it; a player action's dialog is `ActionDialog` (`components/actions/`) | `.modal-overlay` markup of your own |
| What just happened | `useNotice()` — one sentence,-marked, from the server's `line` or `actions/noticeLines.js` | A dialog that just closes, or a `router.refresh()` as the only signal |
| A state | `StatusPill` with a **tone**, or `EnumPill` for a DB enum | A raw enum, or a colour picked at the call site |
| Nothing here | `EmptyState`, or `EmptyRow` in a table | A bespoke `<p className="text-muted">` |
| In flight / failed | `SubmitButton` and `FormError` | A `<form action>` with no pending state |
| Calling a `{ ok, error }` action from a button | `useActionRunner` — `run(action, arg, { onOk, onFail })`, or `call(action, …args)` for an action taking several | A hand-rolled `useTransition` + `setError` block. Every hand-rolled copy was missing the catch, so a dropped connection left the button spinning with nothing said |
| Ticking a set out of a long list | `CheckPicker`, with `usePickList` when the caller holds no selection of its own | A `<select multiple>`, or another private roster picker |
| Retire / delete in the place editor | `useRetireDelete` — the blockers-first two-step confirm | A fourth copy of the same two dialogs, worded slightly differently |

Five things about these are load-bearing:

- **`CheckField` and `Switch` carry no `"use client"`.** Nine of the app's
  booleans are in `/gm/dev`, a *server* component posting through a form
  action; the rest are client components passing `onChange`. A directive-free
  leaf serves both. Adding one would drag every server page rendering a
  checkbox into the client bundle.
- **`Switch` keeps a real named `<input type="checkbox">`**, visually hidden
  rather than replaced, because a server `<form action>` reads its `name` on
  submit. A `<button role="switch">` looks identical and posts nothing.
- **Never put `InfoIcon`/`Tooltip` inside the `<label>` `Switch` or
  `CheckField` renders.** `HoverCard` pins its panel open on click, and that
  click also bubbles to the label — toggling the control the icon was only
  meant to explain. Place the icon as a sibling of `Switch`/`CheckField`, not
  a child.
- **A chip is a LABEL; a `StatusPill` is a STATE.** This is the line the GM
  desks kept crossing, and it is what made them read as messy: `.chip` was a
  turn label, an id, a filter toggle, a count and a warning all at once, so a
  dropped live feed looked exactly like the turn number beside it. The rule:
  a chip names a thing that simply *is* (the turn, a zone, a tag, an id) and
  takes no tone; anything that could be **going wrong, done, or waiting** is a
  `StatusPill` with a tone — or an `EnumPill` when the value is a DB enum.
  Two corollaries the desks now follow. **Resting states are `neutral`.**
  "Staged" is what every row on the push tray is, so drawing it `warn` left
  the one row that had actually missed a push looking like the twenty that had
  not. And **a count is neither.** `N unread`, `N awaiting`, `5/17 solved` are
  numbers, not states: they run together as one muted text line beside the
  chips, so a header has a first thing to read instead of six equal bubbles.
  A third corollary, from the tag work: **a state a tag is in rides as a MARK
  on the face, not as a tone.** Worn, smells wrong and locked are one
  vocabulary in `TagMarks.js`, drawn identically on a chip, a sheet row and an
  item card — glyphs where it is tight, words where there is room — and
  `danger` stays the only tone `.chip` has. Each surface used to improvise its
  own: the chat drawer appended a bare `·` for equipped, the sheet row wrote
  `· worn`, and a player learning one learned nothing about the next.
- **`StatusPill` takes a tone, not a colour.** Callers say what a state *means*
  and the stylesheet decides how that looks, so a status cannot reach for a
  colour the themes have not solved. Per-domain label maps stay local — a
  Move's states are not a Request's — but they live in `web/lib/moves.js` and
  a Prisma-free module (`web/lib/auditNarrative.js` is the live example) so
  *both* faces can reach them.
- **`SubmitButton` works because `useFormStatus` reads from a child.** The page
  keeps its `<form action={...}>` and stays a server component; only the button
  is a client leaf. It cannot see a button wired by `form={id}` from outside the
  form — there is no enclosing form to read.

## 5b. `chat.css` and `sheet.css`, and the `.bar` recipe

`globals.css` used to hold Chat's rules and the sheet's rules too, alongside
every token declaration and shared primitive on the page — 10,982 lines, most
of them one page's own furniture. Shard 1 of the chat/sheet rebuild
(`/root/.claude/plans/misty-shimmying-micali.md`) split it: Chat's block moved
verbatim into `web/app/chat.css`, the sheet's into `web/app/sheet.css`, both
imported from `layout.js` right after `globals.css` (order matters — they win
any name they share with it). **Token declarations never moved.**
`web/scripts/audit-contrast.js` reads `globals.css` by a hardcoded path and
throws if the `[data-theme]` / `[data-theme="dusk"]` / `[data-theme="dawn"]`
blocks are missing, so a new colour token is always declared there, in those
blocks, whichever page's stylesheet uses it. Only *rules* live in the split
files now — `globals.css` keeps tokens, the reset, the shared primitives above,
the desks, and `/map`.

**`.bar`** is the chat pages' one column-head recipe, ported from the mockup
(`docs/design/mockups/chat/index.html`): a `bg2.png` metal strip, bold
uppercase 10px type, a `text-shadow`. The places column's head
(`<p className="bar">Places</p>`) and the feed's head (`ChatHead.js`, above
720px) both wear it, plus `.spacer` (`flex:1`, pushes trailing content to the
right edge) and `.sub`/`.crumb` for the quieter text beside the name. It
declares `flex: 0 0 auto` explicitly — the longhand, all three values pinned —
because the bar it replaced (`.panel-header` doing double duty as
`.chat-bar`) set `flex-grow: 1` by way of `.panel-header`'s own shorthand, and
a bar is the one child of a flex **column** (`.chat-places`) that must never
grow. That one un-pinned property is the whole reason the places column used
to visually break when a section folded shut (CHAT.md): once the column
stopped overflowing, the bar swallowed the free space Flexbox handed it, and
every row beneath it slid to the bottom of the screen. The fold itself is
gone now too (CHAT.md) — the mockup never had one, and it was a second,
independent way to hide a place with something unread in it.

## 6. Page shell

`web/app/components/PageShell.js` — a component, not a convention. Every
top-level page is:

```jsx
<PageShell width>
  <PageHeader title subtitle actions />
  …
</PageShell>
```

`width` is `narrow` / `default` / `wide` / `full`, and that's the whole menu —
it replaced five ad-hoc `max-w-*` values chosen per page. `full` drops the
centring for a page whose own grid is the width; it still keeps the shell's
padding, which is what separates it from the desk exception below. (The
character sheet used it once. It now draws its own full-width body under the
shared `AppHeader` with no `PageShell` at all — still an ordinary scrolling
page, just not a centred one: `SHEET.md` §1.)

`PageHeader`'s `actions` slot takes anything belonging beside the title: a
sub-nav, a faction switcher.

**Don't hand-roll `mx-auto flex max-w-… p-6 sm:p-8` or a bare `<h1>`.** That
was a documented convention for months and drifted anyway, which is why it is
now a component.

The one sanctioned exception is the `(desk)` route group, which now holds
four GM workspaces: `/gm/turns` (adjudication), `/gm/players` (the player
desk), `/gm/audit`, and `/gm/dev` (the game-level Dev Panel, `DEV-PANEL.md`
§11). A workspace owns its whole screen — no PageShell, no centred max-width;
the `.desk-*` layout family in `globals.css` is its layout — but everything
inside it still uses the tokens and the shared control classes. Within that
exception, `DeskHeader.js` is PageHeader's desk equivalent — title/meta/
actions slots over `.desk-header`, `<h1 className="section-title">` — and all
four desk pages use it, `/gm/dev` included. Don't hand-roll `.desk-header`
markup in a new one. Every desk's left rail is `DeskRail.js` on the shared
`.desk-rail` family — `/gm/dev`'s and `/gm/economy`'s section navs are
`variant="sections"`, which is what the old `.ops-*` and `.audit-*` rail
classes became.

Desks **do** carry the nav rail. `(desk)/layout.js` renders the same
`.app-shell` + `AppRail` + `.app-main` as `(app)`, so a desk is
full-viewport-*minus-rail*. They did not always: the adjudication desk rendered
bare, and the only ways out were a hand-placed "Exit" link and an Escape
keypress that navigated away from an empty selection. With two desks, the way
between them cannot be a link each one remembers to carry.

`.desk-queue-row` has two shapes sharing one class name: the adjudication
desk's (and `/gm/audit`'s) plain-button row is the unscoped default, and the
player desk's link-plus-affordances row is scoped under
`.desk-body--players .desk-queue-row` so its layout only applies there.

`.desk-shell` is deliberately **not positioned and carries no z-index**.
`Modal.js` renders `.modal-overlay` in-tree rather than through a portal, so a
stacking context on the shell traps every desk modal at that element's level —
and under 720px `.app-rail` is a fixed bottom bar at `z-index: 30`, which puts
those modals underneath it. Read `ADJUDICATION.md` §3 and `PLAYER-DESK.md`
before adding a third page there.

A page's `loading.js` is `<SkeletonPage width title panels />` from the same
file, so a skeleton physically cannot disagree with its page about width or
title. `panels` is an array of bar-width percentages roughly tracing what
lands. The one exception is `web/app/(app)/loading.js`, the group fallback: it
renders no title, because it can't know which page is arriving.

**A page paints before the server answers.** The route's `loading.js`
skeleton is what a browser sees on its FIRST visit; every visit after that
paints the page's last data from a local snapshot and refreshes underneath
(`web/lib/snapshot/`, `CHAT.md` §5c). A new page that ends in one client
component should be wired that way from the start.

## 7. List shell

Every long list in the app is the same object.
`web/app/components/DataTable.js` is the single engine —
`useTableState({rows, searchFields, filterDefs, initialSort, initialFilters, pageSize})`
returning `pageRows`/`page`/`setPage`/`total`/`totalPages` alongside the
filtered `visible`, plus `SortHeader`, `FilterBar` and `TableScroll`.
`web/app/components/Pager.js` is the one pager.

Three things about it are load-bearing:

- **Paging is client-side everywhere except `/gm/audit`**, which pages
  server-side over `?page=` so a filtered view stays linkable. That's why
  `Pager` has **no `"use client"` directive** and takes precomputed
  `prevHref`/`nextHref` there instead of the `onPage` callback the in-memory
  tables pass — a function prop cannot cross a server→client boundary.
  `/archive` was the second of those and is now a **keyset scroll** instead:
  the page renders the first screen and `/api/archive` returns the next on a
  `sentAt|id` cursor. Its filters still live in the URL, so the view stays
  shareable — it is only the scroll position that no longer is. The cursor is
  deliberately not `seq`: seq is assigned at INSERT, so a message recovered
  after the bot was down carries its real `sentAt` and a brand-new seq, and
  ordering by it would file the line under the day it was recovered rather than
  the day it was said.
- **Changing the search, a filter or the sort resets to page 1 inside the
  setters, never in an effect.** `react-hooks/set-state-in-effect` is an error
  in this repo, and the setter version lands in the same render anyway.
- **`initialFilters` seeds filter state once at mount**, exactly as
  `initialSort` does — it is an *initial* value, never a synced prop. The GM
  tables use it to open on the viewer's zone; making it re-apply on prop change
  would drag a GM who chose "All" back to their own zone after every
  adjudication.
- **List height is one token, `--list-h`**, shared by `.table-scroll` (tables),
  `.list-scroll` (the `/notes` card board) and `.message-list` (a DM thread).

A card list with no header row to hang a `SortHeader` off passes `sortOptions`
to `FilterBar` instead, which is what `/notes` does.

## 8. Confirm dialog

For any "are you sure?" moment, use the shared dialog rather than a one-off
modal or `window.confirm`. `web/app/components/ConfirmProvider.js` mounts once
in `web/app/layout.js` and exposes `useConfirm()`:

```js
const confirm = useConfirm();
if (!(await confirm({ title, message, confirmLabel, cancelLabel }))) return;
```

All fields are optional. It renders through `Modal`, which owns the overlay,
the panel, Escape, `role="dialog"`, the focus trap and returning focus to
whatever opened the dialog — so every dialog in the app gets those whether it
asked or not. **Never hand-roll `.modal-overlay` markup**: eleven dialogs once
did, and between all of them exactly one bound Escape and one set
`role="dialog"`.

**`Modal`'s focus effect depends on `open` and nothing else, and `onClose` is
read through a ref.** Do not "fix" that dependency array. Nearly every caller
passes an inline arrow, so `onClose` has a new identity on every render; with it
in the deps, one keystroke in a dialog field re-ran the whole effect — the
cleanup pulled focus back out of the field, and the body re-focused the top of
the panel. A GM could type exactly one character into the adjudication panel
before focus jumped to the Dev-panel button in the header and popped its
tooltip. Initial focus also deliberately skips `.modal-header`: `actions` is a
jump link, and `Tooltip` wraps its content in a `tabIndex={0}` span that would
otherwise be the first focusable in the dialog.

### Modeless dialogs — `modeless`

A dialog on a GM desk is a problem the rest of the app doesn't have. The desks
are three live columns, and the right-hand one (`InspectorColumn.js`) exists to
be *browsed* — Sheet, Tags, Moves, Archive, DMs for whoever was last clicked.
A backdrop over it means a GM cannot look someone up while writing about them,
which is most of what staging a message is.

`Modal`'s `modeless` prop drops the modal half and keeps the dialog:

- transparent, click-through overlay (`data-modeless="true"`), so the page
  behind stays live;
- no Tab focus trap and no `aria-modal` — walking out into the inspector is
  the point;
- no backdrop dismissal, because there is no backdrop to click;
- **Escape only when focus is inside the panel.** A GM who has clicked out into
  the inspector and pressed Escape meant it for what they're looking at;
- focus is returned to whatever opened the dialog only if the dialog still had
  it, tracked live through a `focusin` listener (by the time a passive effect's
  cleanup runs the panel is detached and `document.activeElement` is already
  `<body>`, which is why the blocking path's restore is unconditional);
- the header is a **drag handle** (`useDragPanel.js`), so a panel can be shoved
  aside. It pins `position: fixed` with inline `top`/`left`, never a
  `transform` — a transformed ancestor becomes the containing block for
  `position: fixed` descendants, and `HoverCard` pins itself that way from
  inside dialogs. The rect (width included) is frozen on the first
  `pointerdown`, not at mount, so the panel does not jump; the position is
  per-mount and not persisted.

**It is desktop-only.** Under 1024px the desk collapses to one column and a
floating panel over live content with no dim is worse than a modal, so
`modeless` degrades to an ordinary blocking dialog. The gate is read in JS with
`useSyncExternalStore` over `matchMedia`, so the CSS and the focus/Escape
behaviour cannot disagree about which mode a dialog is in.

Every desk keyboard guard asks `dialogHoldsKeyboard()` (exported from
`Modal.js`) rather than `document.querySelector(".modal-overlay")`: a floating
dialog does not swallow a keystroke aimed at the page behind it unless it
actually holds focus. `useGatedRefreshPoll` deliberately still counts every
overlay — a floating composer's unsaved text has to hold off a
`router.refresh()` just the same.

**What stays blocking.** Anything asking a question that needs an answer:
every `useConfirm()`, and the Dev Panel's typed-name Delete. So does every
player-facing dialog. The opted-in surfaces are the `/gm/turns` composers
(message, declaration, effect, transfer, push preview), the Dev Panel and its
own dialogs, the shared custom-tag door and the archive-context popup.

### Confirm first, transition second — always

**Never `await confirm()` inside `startTransition(async …)`.** This has now bitten
three separate components, so it is written down here rather than only in the
comments of the files that hit it.

`confirm()` resolves on a click, so the state update that mounts the dialog has
to render *immediately*. Inside an async transition scope React schedules that
render at transition priority — and the transition cannot commit until the
promise settles, while the promise cannot settle until someone clicks a dialog
that was never committed. The result is a deadlock: the dialog never appears,
`isPending` stays true forever, every control bound to it sits disabled, and the
server action is never called at all. Only a refresh escapes, which throws away
any unsaved state.

```js
// WRONG — deadlocks, and looks like "the button does nothing"
startTransition(async () => {
  if (!(await confirm({ ... }))) return;
  await doTheThing();
});

// RIGHT — human first, transition second
if (!(await confirm({ ... }))) return;
startTransition(async () => {
  await doTheThing();
});
```

The rule of thumb: a transition may wrap the *server call*, never a wait on the
*user*. If a `run()`-style helper exists, only ever hand it a function that does
no user interaction.

### Player-action dialogs — `components/actions/`

Every verb on the character sheet is one file under
`web/app/components/actions/`, mounted by `RequestActionsProvider.js` (a
router now: instant verb, fast path, or dialog — see its header). Each file
owns its own fields, its own `useConfirm`, its own submit (`useSubmit.js`) and
its own roster read (`useRoster.js`, which replaced the whole-page
`router.refresh()` that used to fire on every open). It renders exactly one
`ActionDialog`, which is `RequestDialog` plus the two states the old inline
bodies got wrong: `loading` ("Looking…", Confirm off) and `empty` (the
sentence and a lone Close — never a disabled Confirm under "Nobody here is
bound."). A dialog never raises a notice itself: it calls `onDone(line)` and
the provider says it, so every success reads the same way.

Verbs with nothing to ask — Recall, Recover, the pointer, Arm/Disarm,
Extract — do not open a dialog at all (`actions/index.js#INSTANT`); a
confirm where the Move is spent, then the notice. A dialog opened from a
person's own row with the one thing it would have asked already decided
(Bind from the HERE list) takes the same route (`FAST_PATHS`).

## 9. Mobile

These rules lived only as comments in `globals.css` until a 375px pass found
five places the page scrolled sideways. Written down here for the same reason
§6 turned the page shell into a component.

**One breakpoint owns the shell: 720px.** Below it the rail becomes a fixed
bottom bar and the touch-target rules below switch on. Note that every page's
Tailwind `sm:` is 640px, so between 640 and 720 a page has desktop padding
under a mobile nav bar. That gap is known and deliberately left alone —
unifying it means touching every page.

**The two GM desks own two more, and nothing else may read them.**
`/gm/turns` and `/gm/players` are three fixed columns — rail, work, inspector
— which leaves the middle one about 40px wide on a 768px screen. So they, and
only they, carry two extra tiers in `globals.css`:

- **Under 1024px the inspector stops being a column** and becomes an overlay
  panel behind an `Inspector` button in the desk header
  (`components/useInspectorOverlay.js`, one sessionStorage key shared by both
  desks). It is the column to give up because it is the one a GM opens on
  purpose. The overlay is `position: fixed` at `z-index: 40` — the one
  stacking context this family has, and 40 rather than anything lower because
  `Modal.js` renders in-tree, so a dialog opened inside the inspector is
  trapped at that level and has to clear the mobile nav bar's 30.
- **Under 800px the desk shows one screen at a time.** Pick a Move (or open a
  conversation) and the rail steps aside; a `← Back to queue` / `← Back`
  button at the top of the work is the way back. Stacking the two instead just
  made a column whose bottom half nobody scrolls to.

`/gm/audit` keeps its three columns at every width: its inspector is a
different component with no toggle, and hiding it would put the row detail out
of reach. Both new blocks sit **after** `.desk-body--players`' own declaration
in the file — a media query adds no specificity, so a rule for that class
written earlier simply loses to it.

**One route hides that bar: `/chat`.** Under 720px Chat is Discord's channel
view — the page header and the bottom bar both go, the scene has the whole
screen, and the app's links ride the foot of the ≡ places drawer instead
(`body:has(.chat-shell) .app-rail` in `globals.css`; `CHAT.md` §5). Nothing
else may do this: a second route without the bar is a second place to get
lost.

**The page body never scrolls sideways.** Anything wider than the viewport
scrolls inside its own container:

- Long tables use `TableScroll`, and **pass `minWidth`** when they have more
  than about six columns. Without it the columns compress to one word per line
  instead of scrolling — the frame only scrolls what is wider than it.
- A short table outside `TableScroll` still needs a frame:
  `<section className="panel overflow-x-auto p-4">`.
- `.tab-bar` scrolls itself and `.tab-item` never shrinks, so a strip of five
  tabs with counts stays reachable at 375px.
- `PageHeader` gives both halves `min-w-0`, and its `actions` slot goes full
  width below `sm:`. An intrinsically-sized control there — a `<select>` is as
  wide as its longest option — must still carry its own `max-width: 100%`.

**A tap reveals; a second tap commits.** There is no hover on a phone, so the
first touch is the click — and anywhere the app explained a control by hovering
it, a touch player had to fire the control to find out what it did. That is not
a tooltip bug, it is a whole class of them: hover-only help sitting on the same
element as a committing action. Where one turns up, move the action rather than
adding a confirm dialog in front of it. The first tap opens something — a panel,
a row's details, a menu — and the action lives inside what opened. `/chat`'s
Things drawer and `TagChip` have always worked this way; `SHEET.md` §2 and §3
are the two surfaces that were brought into line, both keyed on
`(pointer: coarse)` through `components/useIsCoarsePointer.js` so a mouse keeps
the faster path. One thing to watch when you do it: **a disabled button
dispatches no click**, so a greyed control needs `aria-disabled` instead, or its
panel can never be opened — and a greyed control's reason is exactly what a
touch player is reaching for.

**44px is the touch minimum.** `.btn`, `.btn-secondary`, `.btn-danger`,
`.tab-item` and `.menu-item` all get `min-height: 44px` under 720px, in one
block in `globals.css`. They are not 44px on desktop on purpose: at `--fs-xs`
they are ~31px there, and raising that everywhere is a redesign, not a fix. A
small control inside a table row — the row checkbox on `/gm/players`, say —
gets its hit area from the cell's padding rather than from a bigger box.

**Chat holds itself to that floor a second way.** Inside `.chat-shell`,
`(pointer: coarse)` sets every control to `--tap` (44) or `--tap-sm` (36) in
one block at the end of the `.chat-*` family in `globals.css`, keyed on the
pointer rather than on 720px for the tablet case below. The two tokens are
Chat's; the rest of the file still writes 44 and 36 out, on purpose, until a
page is touched. A dialog's Cancel joined the app-wide list above so it stands
as tall as its Submit everywhere. `.map-controls`, below, is the earlier scoped
carve-out this one follows.

The desk tiers above put their own two controls — the header's `Inspector`
toggle and the middle column's Back button — on `(pointer: coarse)` rather
than on a width, because the case a width test misses is exactly the one those
tiers are for: a 1024px tablet.

`.map-controls` is the one place that raises the floor for itself, under
`(pointer: coarse)` rather than at 720px. Its `−` / `+` / Reset are
`.btn-quiet`, which the global coarse-pointer block takes to 36px for all
fifty-odd of its call sites — right for a flush text link in a row of prose,
and not enough for the only way to zoom a map for anyone who cannot pinch. The
carve-out is scoped to that one bar so nothing else moves.

**The bottom bar respects `env(safe-area-inset-bottom)`**, and `.app-main`'s
bottom padding must include the same inset. Otherwise the rail labels sit under
an iPhone's home indicator.

**The bottom bar does not scroll.** `NavRail`'s `MOBILE_PRIMARY = 5` cap is
what keeps it reachable: items past the fifth move into the "More" sheet, so
the length of a nav list is a real design constraint. Adding a rail item means
deciding which one it displaces.
