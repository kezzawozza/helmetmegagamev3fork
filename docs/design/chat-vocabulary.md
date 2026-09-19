# Chat's visual vocabulary

Derived from `docs/design/mockups/chat/index.html` — 307 lines of stylesheet,
read rule by rule — then checked against all 149 classes in `web/app/chat.css`
that the mockup never names. This is the Phase 0 deliverable of
[`CHAT-REBUILD.md`](../systemdocs/CHAT-REBUILD.md).

The reason it exists is arithmetic. `chat.css` is 3,104 lines; the mockup's is
307. Copying the mockup answers about a tenth of the rebuild. The other nine
tenths is applying a language it only *implies* to surfaces it never drew — and
those were each improvised separately, which is why the page stopped reading
like the thing it came from.

**Read this before adding any surface to chat.** A thing that fits no rule here
gets a rule written here first, in one line. That is the whole guard.

`DESIGN-SYSTEM.md` owns the app-wide rules (tokens, `.btn`, `.field`, `.chip`,
the ban on hardcoded colour). This is chat's dialect of them.

---

## 1. Depth — the one rule everything obeys

Every surface sits on exactly one rung, chosen by **what the thing is**, never
by how much it wants to stand out.

| Rung | Fill | Edge | What sits here |
|---|---|---|---|
| **WELL** | near-black + an **inset** shadow | `HARD` | Something you put something *into*: the say box, a meter, the You plate's inner well |
| **BLOCK** | `--sunk-wash-deep` (0.42) | `RULE` frame | A framed container inside a column; the decree/notice block in the feed |
| **COLUMN** | `--sunk-wash` (0.30) | `HARD` outer | The places column, the aside |
| **GROUND** | the lit, fully-textured tile | `HARD` top | The scene. The brightest surface on the page |
| **CARD** | `--surface`, hover `--surface-raised` | `RULE` | A clickable thing holding content — bigger than a label, not a container. A travel node |
| **CHIP** | `--surface-raised`, opaque | `RULE` | A small raised label: a tag, a person, a stash item |
| **CONTROL** | raised, bevelled | `LIT` | A button |
| **PLATE** | a stretched sprite | `HARD` | An ornamented frame around a well. Only `you-frame` |
| **RAIL** | `bg.png`, 8px wide | `HARD` left, `RULE` right | A structural member between two columns. Holds nothing |
| **STICKY BAR** | opaque, **matching the ground it is pinned over** | `RULE` on the side it scrolls away from | A bar pinned inside a scrolling surface |
| **FLOAT** | `--surface-raised`, opaque, elevation shadow | `RULE` | Modal, popover, tooltip, menu |
| **NONE** | — | — | A layout wrapper with no surface of its own |

**The shape of it:** things you *put things into* are cut down; things that *are
things* sit up; the scene you read is the lit middle. A container is never
raised above the ground it sits on — that was the old bug, and it measured 1.01
separation where the mockup gets 1.16.

Three things that have been got wrong before:

- **A well is not just a dark fill.** It is dark *plus* `box-shadow: inset …`.
  Without the inset it reads as a lighter rectangle, not a hole.
- **GROUND is painted twice, on purpose** — on `.chat-body` (so the columns'
  translucent washes have something to darken) and on `.chat-feed`. Both wear
  the same tile at full strength. They are one rung, not two.
- **A STICKY BAR takes the ground it is pinned over**, because its whole job is
  to hide what slides under it. Over the feed it matches the feed; inside a
  column it matches the column. It must be opaque, and it must not be *lighter*
  than what it covers — a sticky bar that floats above the scene contradicts the
  ladder. (Today the three of them use three different values. See §8.)

## 2. Edges — three, and they are not interchangeable

| Name | Token | Means |
|---|---|---|
| `HARD` | `--border-lo` | An outer **cut** — where a surface ends |
| `RULE` | `--border` | An **interior division** — a frame, a chip's border, a line under a heading |
| `LIT` | `--border-hi` / `--rivet` | A **bevel or a state marker** |

The mockup writes `HARD` as literal `#000`; we have `--border-lo`. **Never a
hardcoded hex.**

`--rivet` is struck brass and marks *where you are*. `--border-hi` is a lamp on
metal and marks *a thing you can press*. Using the lamp for position makes the
open room read as an alarm — that exact mistake was in the rail until recently.

## 3. Type — three rungs, and only three

| Rung | Token | Used for |
|---|---|---|
| **10px** | `--fs-3xs` | Caps. Every heading and label: girder heads, section heads, zone dividers, tags, badges, timestamps |
| **11px** | `--fs-xs` | Secondary text and controls |
| **12px** | `--fs-base` | Things you actually read |

`--fs-3xs` is **caps only, never prose**, and is deliberately not in the
Tailwind bridge.

**`text-shadow: 0 1px 0 <HARD>` is the stamped-into-metal mark.** Every girder
heading and every badge carries it. Nothing else does.

## 4. Headings — two kinds

- **GIRDER** — the `bg2.png` strip at a fixed **26px**, 10px caps, `--text-hi`,
  `HARD` bottom, `RULE` top, stamped shadow. It heads a **container**. Every
  girder in chat is the same height: the sprite scales to the bar, so a taller
  bar draws a bigger girder, which is what made the feed's head look wrong
  beside the aside's.
- **QUIET** — no strip, 10px caps, `--muted`, in the flow. It heads a **run
  inside** a container. A **DIVIDER** is a quiet head with a `RULE` under it and
  a colour, marking a whole zone.

The test: *does this head a box, or a list inside a box?* Box → girder. List →
quiet.

**Every BLOCK's head is a GIRDER.** There is currently one that is not; see §8.

## 5. Rows, and their four states

`.place` is the canonical row; every list row in chat follows it.

- A full-width `<button>` with styling reset.
- `border-left: 3px solid transparent` — the state marker, always present so
  nothing shifts when it lights.
- **Indented past the marker**, so a run sits under its heading rather than
  level with it. This is what makes a column read as sections rather than one
  flat list.
- 12px, resting at `--text` — **not `--muted`**. A row resting muted leaves
  nothing in reserve, which is how three states ended up fighting over two
  colours.

The four states are a property of the row, not four different surfaces:

| State | |
|---|---|
| rest | `--text`, transparent |
| hover | `--text-hi` + `--row-hover` |
| unread | `--text-hi`, bold name |
| **occupied** | top-lit gradient `--surface`→`--bg`, `--rivet` left marker, bold, inset hairlines top and bottom |

**Never use `--surface` for a row's hover** — it is lighter than the column's
sunk ground and inverts the ladder.

## 6. What floats, and nothing else

Only these leave the ladder: modals, popovers, tooltips, the `/` and `@` menus,
sticky table heads, and the map's overlay controls (opaque on purpose — a
translucent control would show terrain through itself). Everything else is cut
into the ground.

A STICKY BAR is **not** a float. It scrolls away, it carries no elevation
shadow, and it belongs to the surface it is pinned inside.

## 7. The sprites

`bg.png` (the rail and the girder strip), `chatbg.png` (512×512 ground tile),
`stats-LFWB.png` (the You plate). All `image-rendering: pixelated`.
`DESIGN-SYSTEM.md` §3a asks for integer scaling; the girder at 26px is the one
knowing exception, taken to match the mockup exactly.

---

## 8. What the rebuild has to fix

Found by bucketing all 149 classes against the rules above, and spot-checked
line by line. These are drift, not decisions — each one is a rule broken.

| | Today | The rule |
|---|---|---|
| `.chat-person` | `all: unset`, no fill and no border at rest; only gains one on hover | A CHIP's border and fill are permanent, not hover-only. Either it is a CHIP or it is a ROW — pick one (it is a ROW) |
| `.chat-details-fold` | `--fs-2xs` (11px) | QUIET headings are rung 10. `.sect` does it correctly at `--fs-3xs`; these two do the same job at two sizes |
| `.tline-block-head` | `--fs-2xs`, no strip | It heads a BLOCK, so it is a GIRDER. The only BLOCK in chat whose head is not |
| `.chat-places-tail` | `background: var(--bg)` | It is pinned inside a COLUMN, so it takes the column's value, not flat ground |
| `.chat-search` | `--surface-raised` | Pinned over the feed → takes the feed's ground. Currently *lighter* than what it covers |
| `.chat-notices` | `--surface` | Same bar, same job, third different value |
| `.chat-mode-select` | no surface at all; defers to `Select.js` | The mockup's mode picker is a WELL. Either make it one or state the exception |
| `.chat-send` | flat `--accent-solid` border | CONTROL is defined by its bevel pair; this is the one control that drops it |
| `.zone-div` | `--warning` | A status colour borrowed for decoration, because no gold text token exists. Give the DIVIDER its own token |

**Three sticky bars, three different backgrounds** is the clearest single piece
of evidence that this rule was missing rather than broken.

## 9. What the rebuild should collapse

| | |
|---|---|
| `.chat-card` `.chat-here` `.chat-party` `.chat-room` `.chat-travel` | Five names, one shared body (`margin: 0`), all legacy. Delete or collapse to one |
| `.unread` and `.chat-head-count` | The same unread badge in two shapes |
| `.chat-search-row` | A third hand-rolled row recipe beside `.place` / `.chat-person`. Use the ROW rule |
| `.chat-menu` and `.chat-mentions` | Two FLOAT panel recipes differing only in surface token and shadow |
| `.chat-fold` and `.chat-details-fold` | Two implementations of the same chevron disclosure control |
| `.chat-composer-send` and `.chat-composer-send-btn` | Two send buttons for two composer layouts — check whether both call sites are still live |

---

## Applying this

Every class in the rebuilt `chat.css` should be justifiable as: *this rung, this
edge, this type rung, this heading kind.* A surface needing a rule this doc does
not have is a decision to make **here first**, before it is built.
