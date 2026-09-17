---
name: Ravenheart Underground
colors:
  background: '#111e1b'
  on-background: '#efe7d6'
  surface: '#111e1b'
  surface-dim: '#111e1b'
  surface-bright: '#27443e'
  surface-container-lowest: '#111e1b'
  surface-container-low: '#172925'
  surface-container: '#1e352f'
  surface-container-high: '#27443e'
  surface-container-highest: '#27443e'
  surface-variant: '#172925'
  on-surface: '#efe7d6'
  on-surface-variant: '#9daca6'
  inverse-surface: '#efe7d6'
  inverse-on-surface: '#111e1b'
  outline: '#49625d'
  outline-variant: '#293f39'
  surface-tint: '#c8542a'
  primary: '#a8431a'
  on-primary: '#efe7d6'
  primary-container: '#c8542a'
  on-primary-container: '#efe7d6'
  inverse-primary: '#e8814f'
  secondary: '#27443e'
  on-secondary: '#efe7d6'
  secondary-container: '#1e352f'
  on-secondary-container: '#9daca6'
  tertiary: '#efd3a4'
  on-tertiary: '#111e1b'
  tertiary-container: '#27443e'
  on-tertiary-container: '#efd3a4'
  error: '#ee7f6b'
  on-error: '#111e1b'
  error-container: '#1e352f'
  on-error-container: '#ee7f6b'
  success: '#7fb27a'
  warning: '#d9973f'
  speech: '#efd3a4'
  accent-text: '#e8814f'
  accent-fill: '#c8542a'
  zone-fortress: '#c7604f'
  zone-town: '#998d6b'
  zone-forest: '#7f8c64'
  zone-hills: '#79899b'
  zone-marshes: '#8d9384'
  zone-caves: '#939d9e'
  zone-depths: '#8f7f9c'
typography:
  wordmark:
    fontFamily: UnifrakturMaguntia
    fontSize: 40px
    fontWeight: '400'
    lineHeight: 50px
    letterSpacing: 0.02em
  display-lg:
    fontFamily: Source Serif 4
    fontSize: 30px
    fontWeight: '700'
    lineHeight: 38px
    letterSpacing: 0.02em
  headline-md:
    fontFamily: Source Serif 4
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 30px
    letterSpacing: 0.02em
  title-sm:
    fontFamily: Source Serif 4
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 25px
    letterSpacing: 0.02em
  body-lead:
    fontFamily: Source Sans 3
    fontSize: 17px
    fontWeight: '400'
    lineHeight: 26px
    letterSpacing: '0'
  body-base:
    fontFamily: Source Sans 3
    fontSize: 15px
    fontWeight: '400'
    lineHeight: 23px
    letterSpacing: '0'
  body-dense:
    fontFamily: Source Sans 3
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
    letterSpacing: '0'
  label-caps:
    fontFamily: Source Sans 3
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 17px
    letterSpacing: 0.06em
  caption:
    fontFamily: Source Sans 3
    fontSize: 11px
    fontWeight: '400'
    lineHeight: 15px
    letterSpacing: '0'
  data-mono:
    fontFamily: IBM Plex Mono
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
    letterSpacing: '0'
rounded:
  sm: 3px
  DEFAULT: 6px
  md: 6px
  lg: 10px
  full: 999px
spacing:
  unit: 4px
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  2xl: 32px
  3xl: 48px
  4xl: 64px
  gutter: 24px
  margin-mobile: 24px
  margin-desktop: 32px
---

## Brand & Style

Bascinet is a month-long asynchronous megagame set in Ravenheart, a city driven
underground and kept alive by a blood-fed tower. The interface is the lamplit
inside of that place: near-black grounds with a green-teal cast, panels that
read as stone shelves lifted a step out of the dark, and one ember accent that
behaves like the only fire in the room. Nothing here is a daylight theme, and
that is a setting decision rather than a stylistic one — there is no sun in
Ravenheart to render.

Against that atmosphere the product bar is unromantic: functionality,
usability, cleanliness, responsiveness, browser performance. The explicit thing
to avoid is the slow, laggy Discord-bot dashboard. So the mood is delivered
almost entirely through colour and two typefaces, while the mechanics stay
plain and dense — hairline borders instead of shadows, flat fills instead of
gradients, uppercase micro-labels over tables of numbers. It should feel like a
well-kept ledger in a cellar: information-dense, quick, and legible by
lamplight. Every colour pair in the system was solved against WCAG AA and is
re-checked by a script, so the gloom never costs readability.

## The Product: Bascinet

Bascinet is a month-long asynchronous megagame for 100+ players. One real-world
day is one in-game day. Players are characters in Ravenheart, a city driven
underground and kept alive by a blood-fed tower; they talk, trade, travel,
labor, craft, scheme and occasionally murder each other, while a handful of
game masters adjudicate what they declare. A website and a Discord bot automate
the mechanics so the game stays asynchronous and low-friction.

That shapes every screen. Players check in a few times a day, from a phone as
often as a desktop, and need to see **what changed since they last looked**
without reading everything. Game masters work the other way round: they need
everything at once, on one screen, and will take density over beauty every
time. Nothing in this interface is a marketing surface — there is no landing
page, no hero, no onboarding funnel, no calls to action. Every screen is a
working surface for someone who already knows why they are there.

Two consequences a designer should hold onto. First, **the data is the
interface**: a roster of 100 characters, a table of 271 tags, a feed of
everything said in a room. Whitespace that halves how much fits on screen is a
cost, not a virtue. Second, **the fiction is carried by colour and typeface
alone** — the blackletter wordmark, the serif headings, the lamplit palette —
never by decoration, illustration or ornament. The controls stay plain.

## Colors

The palette is anchored by **Banked Coal** (`#111e1b`), a near-black with a cool
green-teal cast that grounds the whole app. Above it sits a three-step surface
ladder — **Cellar Stone** (`#1e352f`) for panels and cards, **Lifted Stone**
(`#27443e`) for anything floating above them (modals, tooltips, sticky table
headers) — each step keeping roughly 1.20 contrast so a panel is always visibly
a panel. Input fields invert the move: **Cut Recess** (`#172925`) sits *below*
the surface, so a control reads as carved into a shelf rather than stacked on
top of it.

**Ember** is the single accent, and it deliberately exists as two colours.
**Ember Fill** (`#c8542a`) and **Ember Solid** (`#a8431a`) are for fills and
rules; **Ember Light** (`#e8814f`) is for text, outlines and the focus ring. One
ember cannot be both a rich fill and legible type — as text the fill measures
2.96 against the panel surface, under even the large-text floor — so collapsing
them is the one change that would break the system app-wide.

Text runs **Parchment** (`#efe7d6`) for body and **Ash** (`#9daca6`) for
secondary text, labels and table headers. **Lamplight** (`#efd3a4`) is reserved
for quoted speech in the chat feed: a warm lift of the body colour rather than a
second accent, because a competing hue there would read as a link.

Functional states are **Moss** (`#7fb27a`) for good, **Brass** (`#d9973f`) for
warning, and **Coal Rose** (`#ee7f6b`) for danger. Destructive actions always
take the danger colour, never the ember — the accent means "primary", not
"careful".

Seven **zone colours** encode the game's geography and are picked from the
painted map: Fortress terracotta, Town thatch, Forest olive, the blue-grey,
grey-green and mauve of Hills, Marshes and Depths, and mountain rock for Caves.
These are fills only — a 3px rule down the left edge of a chip — and are gated
at 3.0 contrast rather than 4.5, because none of them would clear AA and
forcing them to would mean abandoning the map's palette. Never spend one on
text.

A sibling theme ships alongside this one. **Dawn** is the same system with the
lamps up — warmer browns (`#1b1512` ground, `#362a24` surface) and a brighter
ember (`#d2691e`) — and swaps in automatically with the game's turn phase.

## Typography

Two faces do the work and two more are held in reserve. **Source Sans 3** is the
body and interface face, set at a real 15px — the system was rebuilt off that
anchor after a period where every size sat between 11 and 14px with no mid-tier
at all. **Source Serif 4** carries every heading automatically; the two are a
designed superfamily, so they share metrics and vertical rhythm for free and
headings never need a hand-applied class.

**IBM Plex Mono** is strictly data — resource counts, dice, IDs, timestamps,
audit rows — with tabular figures on. It was the body face once, which made it
wallpaper: tables got wider, prose got harder to read, and the mono signalled
nothing because everything was mono. It now means "machine record", and only
that. **UnifrakturMaguntia**, a blackletter, appears at the login wordmark and a
couple of flavour-heavy titles; it is illegible small and reads as a mistake
anywhere else.

The scale is modular at roughly 1.2, nine steps from an 11px caption to the 40px
wordmark, with three line-heights rather than a continuum: 1.25 for headings,
1.55 for body, 1.4 for table rows. Letter-spacing has exactly two values — a
tight 0.02em on display faces, and a wide 0.06em on the uppercase micro-labels
that head every table column and form field. Those small caps carry a lot of the
app's character: they let a dense table stay scannable without rules or
striping.

## Layout & Spacing

Everything sits on a 4px grid, nine steps from 4px to 64px. Pages are centred at
one of three widths and nothing else — 3xl for forms and reading, 5xl by
default, 6xl for long GM tables — with 24px page padding on mobile and 32px from
640px up, and a 24px gap between stacked sections.

The chrome is a persistent 56px icon rail down the left, sticky at full viewport
height, with content filling the rest. Below 720px that rail becomes a fixed
72px bottom bar that respects the phone's safe-area inset and caps itself at
five items, pushing the rest into a "More" sheet.

The rule that governs everything responsive: the page body never scrolls
sideways. Anything wider than the viewport scrolls inside its own frame — long
tables in a scroll container with an explicit minimum width, tab strips
scrolling themselves, header action slots going full width and wrapping. Every
long list in the app shares one height token set to 70vh, so tables, the notes
board and a message thread are all the same object at the same size.

Game-master workspaces are the one exception to the centred page: four desks run
edge to edge at full viewport height minus the rail, as three live columns —
queue, work surface, and a right-hand inspector that stays browsable while a
composer is open.

## Elevation & Depth

Depth is carried by colour first and shadow almost never. The base tier is
border-only with no shadow at all: a hairline in a translucent light stone
(`#49625d` effective) over the panel surface. A modest `0 2px 6px` shadow exists
for lifted surfaces, and a broad `0 12px 32px` is reserved for modals — which
also sit on the raised surface tone and take the 10px radius.

Row hover is a 5% white wash rather than a border change, so a dense table
responds without flickering its structure. Focus is a single ring everywhere in
the app: 2px of Ember Light at 2px offset, on every button, field, checkbox,
switch, tab, menu item and sort header.

## Shapes

Four radii, assigned by scale rather than by taste. 3px for the small
interactive things — buttons, inputs, icon buttons. 6px for panels and cards.
10px for modals only. Fully round for chips and pills, which is the one place
the system lets a shape be soft, and it reads as a label rather than a control.
Nothing in the app is a circle except an avatar.

## Components

**Buttons** come in four weights, and the variant is chosen by how important the
action is rather than defaulting to the loudest. All share the same geometry:
7px by 14px padding, 3px radius, 12px uppercase-tracked label.

- *Primary* — solid Ember Solid fill, parchment label, brightening 12% on hover.
- *Secondary* — transparent with an Ember Light border and label, filling to a
  14% ember wash on hover.
- *Danger* — the same outline treatment in Coal Rose, 16% wash on hover.
- *Quiet* — text only, Ash, warming to Ember Light.
- Disabled is 35% opacity with the hover effect removed, everywhere.

**Panels** are the universal container: a hairline border, the cellar-stone
surface, 6px radius. Their heading is serif at 20px with a hairline rule
underneath — but a heading that sits *beside* something (a modal title next to
its close button, a section label next to its buttons) drops the rule, because
a border under text alone reads as an underline rather than a divider.

**Cards you pick** are panels with a pressed state: a 1px ember outline on
selection, 55% opacity when unaffordable, a dotted border when restricted.

**Tables** are the densest surface and get the most care. 13px body on a 1.4
line-height, headers in 12px uppercase Ash with wide tracking, hairline row
separators, top-aligned cells, and a 5% wash on row hover. One engine drives
every list in the app — search, filters, sort, and paging that resets to page
one inside the setter.

**Inputs** are always wrapped: a column with an uppercase Ash label above a
control on the recessed field background with a hairline border and 8px by 10px
padding. This wrapper is not optional — an unwrapped input falls back to native
browser chrome and visibly breaks the theme. A control holding an unsaved edit
gains a 1px ember outline.

**Chips** are the pill vocabulary: hairline border, recessed fill, 12px, fully
round, with a pinned 1.25 line-height so chips from different call sites line
up. An active chip takes an ember border and ember label. A wrapping row of them
is the house form for a multi-select — never a segmented control, which holds
one value and says so through its pressed state.

**Status pills** take a *tone*, never a colour: muted, good, warn, bad, accent.
Callers say what a state means and the stylesheet decides how it looks, so no
status can reach for a colour the themes have not solved.

**Navigation** is a tab strip — 12px Ash labels, a 2px transparent underline
that turns ember when active, the strip scrolling itself with a hidden
scrollbar — plus the left icon rail for top-level movement.

**Modals** centre on a 55% black scrim at 100 z-index, panel maxing at 32rem
(with narrow, wide and widest variants), 85vh scroll, raised surface, 10px
radius, broad shadow, right-aligned actions. On the GM desks a modeless variant
drops the scrim entirely and turns the overlay click-through, so a master can
keep browsing a character sheet while writing about them.

**Touch targets** rise to a 44px minimum below 720px for every button, tab and
menu item. They stay around 31px on desktop deliberately; raising it everywhere
is a redesign rather than a fix.

## The Chat Panel (`/play`)

The most important screen in the app, and the one most likely to be redesigned
badly. It is the game's live room: where a player stands somewhere, sees who
else is there, reads what has been said, says something back, and acts on the
world around them.

### Why it exists

Two reasons, both load-bearing. **Anonymity** — the game also runs on Discord,
where a channel's member list exposes which real account is standing in which
room; the web panel is the only place a player can be present without being
identified. **Speed** — earlier web surfaces routed a message through a server
action and a full re-render, which felt slow enough to break the illusion of a
conversation. This page does not use that path: it holds one server-sent-event
stream, appends rows as they arrive, and paints its last known state from a
local snapshot before the server answers.

### The shape

Three columns on desktop, `15rem | 1fr | 20rem`:

- **Left — Places.** Where you can be and where you can talk: the Location you
  are standing in, its public Rooms, the private Rooms your keys open, your
  conversations, a system summary, and a direct line to the game itself. Each
  row can carry an unread dot.
- **Centre — the Feed and composer.** The room's header with its name and the
  current turn, then the messages: character avatar, name, timestamp, what they
  said. Quoted speech is tinted. Things the *world* says — a gate opening, a
  smell, somebody moving goods — are quieter subtext lines, deliberately
  under the conversation rather than in it. A NEW divider marks where the
  reader left off, typing indicators sit at the bottom, and the composer is
  pinned below the feed.
- **Right — the game suite.** Stacked panels: the place's description and
  noticeboard; HERE, the people present; THIS ROOM, what is lying around and
  the buttons to Drop, Take, Transfer or use the intercom; TRAVEL, the
  destinations reachable from here as cards showing cost; and YOU — the turn,
  your declared move, resources, carry weight, conditions, desires and a link
  to your sheet.

It fills the viewport (`100dvh`) and scrolls **inside** its regions. The
document itself never scrolls, because a chat that scrolled the page dragged
the header away every time somebody spoke.

### What it has to do

- **Show what changed, not everything.** An unread dot means a message in a
  conversation or one that names you — never ambient scenery. A dot that lights
  for everything is a dot that means nothing.
- **Feel instant.** New messages arrive live. The page paints from a local
  snapshot on every visit after the first, then refreshes underneath.
- **Keep its place.** The open room lives in the URL, so a reload returns to it
  and Back leaves the way it came.
- **Work on a phone.** Below 900px the right column folds into a bottom sheet
  behind a `⋯` button; below 720px the places column becomes a scrolling tab
  strip with unread dots and the people present become an avatar strip under
  the header. The full ladder is `≥1200` three columns, `900–1200` narrower
  flanks, `720–900` aside folded, `≤720` one column.
- **Never leak identity.** Nothing on this screen may show which real account
  is behind a character.

### Redesigning it: the rules

Density here is a **requirement**, not an accident. A version of this screen
with fewer panels, more air and a calmer feed is not an improvement — it is a
different, worse product, because the removed panel was the one that let a
player act without leaving the conversation.

So a redesign may change spacing, hierarchy, type treatment, the weight of
borders and surfaces, and how the eye is led to the feed. It may **not** remove,
merge, rename, reorder or invent sections; may not turn the right column into a
drawer on desktop; may not replace the plain controls with illustrated ones; and
may not lighten the palette. If the redesign makes the screen hold less, it has
failed.

## Design System Notes for Stitch Generation

### Language to Use

Describe screens as *underground, lamplit, dense but calm*. Ask for near-black
green-tinged grounds, panels a clear step lighter, a single warm ember accent
used sparingly, hairline borders rather than shadows, and small uppercase
tracked labels over dense data. Ask explicitly for **no gradients, no glass, no
glow, no large colourful icons** — the aura is understated, and small unicode
marks stand in for iconography. Say "ledger", "cellar", "lamplight"; avoid
"vibrant", "playful", "airy".

### Color References

- Banked Coal `#111e1b` — page ground
- Cellar Stone `#1e352f` — panels and cards
- Lifted Stone `#27443e` — modals, tooltips, sticky headers
- Cut Recess `#172925` — input fields, recessed below the surface
- Parchment `#efe7d6` — body text
- Ash `#9daca6` — labels, secondary text, table headers
- Ember Fill `#c8542a` / Ember Solid `#a8431a` — fills and rules only
- Ember Light `#e8814f` — accent text, outlines, focus ring
- Lamplight `#efd3a4` — quoted speech
- Moss `#7fb27a` / Brass `#d9973f` / Coal Rose `#ee7f6b` — good, warning, danger

### Component Prompts

> A dark underground game dashboard panel on a near-black green-tinged ground.
> One card with a hairline border and a serif heading underlined by a thin rule,
> containing a dense data table: 12px uppercase tracked column headers in muted
> sage, 13px rows in warm parchment, hairline separators, numbers in a
> monospace face with tabular figures. No shadows, no gradients.

> A character sheet screen, two columns, centred at about 1024px. Left: a
> portrait plate and a wrapping row of small fully-rounded chips, the active
> ones outlined in warm ember. Right: stacked panels with uppercase micro-labels
> above recessed input fields. One solid ember primary button and one ember
> outline secondary button, bottom right, small and tightly tracked.

> A game-master workspace running edge to edge: a 56px icon rail on the far
> left, a narrow queue column of selectable rows, a wide central work surface,
> and a right-hand inspector panel. Dense, flat, hairline-separated, lamplit
> dark. A floating composer panel over the work surface with no dimming scrim.

### Incremental Iteration

Change one dimension at a time. The accent is the easiest thing to get wrong —
if a generated screen reads as too warm or too loud, the fix is almost always
"use the ember only for the primary button and the active state, and leave
everything else in stone and parchment". If a screen reads flat, raise the
panel a step rather than adding a shadow. If it reads busy, cut the icons before
cutting the data.

### Non-negotiables for Implementation

1. No hardcoded hex in a component — every colour comes from a CSS custom
   property so it tracks the active theme.
2. Ember fill and ember text are different tokens. Never collapse them.
3. Danger, not accent, for destructive actions.
4. Monospace is data only. Headings take their serif from the tag.
5. Every form control is wrapped in the field/control class.
6. One shared component per concept — dialog, boolean, status, empty state,
   pending button — rather than a second one at the call site.
