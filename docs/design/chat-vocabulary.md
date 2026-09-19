# Chat's visual vocabulary

Derived from `docs/design/mockups/chat/index.html` — 307 lines of stylesheet,
read rule by rule. This is the Phase 0 deliverable of
[`CHAT-REBUILD.md`](../systemdocs/CHAT-REBUILD.md), and the reason it exists is
arithmetic: `web/app/chat.css` is 3,104 lines defining ~149 classes the mockup
never names. Copying the mockup answers about 10% of the rebuild. The other 90%
is applying *these rules* to surfaces the mockup never drew.

**Read this before adding any surface to chat.** If a new thing fits no rule
here, the rule gets decided and written down here first — that is the whole
point. Improvising one more surface is how the page got the way it is.

`DESIGN-SYSTEM.md` still owns the app-wide rules (tokens, `.btn`, `.field`,
`.chip`, the ban on hardcoded colour). This doc is chat's dialect of them.

---

## 1. Depth — the one rule everything obeys

The mockup has a strict ladder. Every surface sits on exactly one rung, and the
rung is chosen by **what the thing is**, not by how much it wants to stand out.

| Rung | Fill | Edge | What sits here |
|---|---|---|---|
| **WELL** | near-black + an **inset** shadow | `HARD` | Something you put something *into*: the say box, the mode select, a meter, the You plate's inner well |
| **BLOCK** | `--sunk-wash-deep` (0.42) | `RULE` frame | A framed container inside a column, and the decree block |
| **COLUMN** | `--sunk-wash` (0.30) | `HARD` outer | The places column, the aside |
| **GROUND** | the lit, fully-textured tile | `HARD` top | The feed. The brightest surface on the page |
| **CHIP** | lighter than ground, opaque | `RULE` | A small raised label: a tag, a person, a stash item |
| **CONTROL** | lighter again | `LIT` bevel | A button |
| **FLOAT** | `--surface` / `--surface-raised`, opaque | `RULE` | Modal, popover, tooltip, menu — the only things allowed above the ground |

**The shape of it:** things you *put things into* are cut down; things that *are
things* sit up; the scene you read is the lit middle. A container is never
raised above the ground it sits on — that was the old bug, and it measured 1.01
separation against the mockup's 1.16.

Two consequences worth stating, because both have been got wrong before:

- **A well is not just a dark fill.** It is dark *plus* `box-shadow: inset …`.
  Without the inset it reads as a lighter rectangle, not a hole.
- **A chip is the only small thing allowed to be lighter than its ground.** A
  badge, a count, a state marker — those are not chips; see §4.

## 2. Edges — three, and they are not interchangeable

| Name | Token | Means |
|---|---|---|
| `HARD` | `--border-lo` | An outer **cut** — where a surface ends. The bottom of a girder, the outside of a column, the rim of a well, a badge's border |
| `RULE` | `--border` | An **interior division** — a block's frame, a chip's border, the line under a section heading |
| `LIT` | `--border-hi` / `--rivet` | A **bevel or a state marker** — a button's raised edge, the active row's left bar |

The mockup writes `HARD` as literal `#000`. We have `--border-lo` (#0b0907) for
it. **Never a hardcoded hex** — `DESIGN-SYSTEM.md` §2, and there are currently
zero in the app.

`--rivet` is struck brass and marks *where you are*. `--border-hi` is a lamp
catching metal and marks *a thing you can press*. Using the lamp for position
makes the open room read as an alarm — that exact mistake was in the rail until
recently.

## 3. Type — three rungs, and only three

| Rung | Token | Used for |
|---|---|---|
| **10px** | `--fs-3xs` | Caps. Every heading and every label: girder heads, section heads, zone dividers, tags, badges, timestamps |
| **11px** | `--fs-xs` | Secondary text and controls: a person's name in a list, a sub-line, a button |
| **12px** | `--fs-base` | Things you actually read: a place name, a transcript line, what you are typing |

`--fs-3xs` (10px) is **caps only, never prose**. It exists for this and nothing
else, and it is not in the Tailwind bridge on purpose.

Tracking rises as the heading gets quieter: `.bar` at `0.06em`, `.sect` and a
block's head at `0.09em`, `.zone-div` at `0.1em`. (The mockup is mildly
inconsistent here — a block's head is a girder but tracked like a section. The
rebuild should pick one; girder heads all take `--ls-wide`.)

**`text-shadow: 0 1px 0 <HARD>` is the stamped-into-metal mark.** Every girder
heading and every badge carries it. Nothing else does.

## 4. Headings — two kinds

- **GIRDER** — the `bg2.png` strip at a fixed **26px**, 10px caps, `--text-hi`,
  `HARD` bottom edge, `RULE` top edge, stamped shadow. It heads a **container**:
  a column, or a block. *Every girder in chat is the same height* — the sprite
  scales to the bar, so a taller bar draws a bigger girder, which is what made
  the feed's head look wrong beside the aside's.
- **QUIET** — no strip, 10px caps, `--muted`, sitting in the flow. It heads a
  **run inside** a container: the Mail/Radio/Here/Rooms sections. A `DIVIDER`
  (`.zone-div`) is a quiet head with a `RULE` under it and a colour, marking a
  whole zone.

The test: *does this head a box, or a list inside a box?* Box → girder. List →
quiet.

## 5. Rows

`.place` is the canonical row and every list row in chat should follow it:

- A full-width `<button>` with the browser's styling reset.
- `border-left: 3px solid transparent` — the **state marker**, always present so
  nothing shifts when it lights.
- **Indented past the marker**, so the run sits under its heading rather than
  level with it. This is what makes the column read as sections rather than one
  flat list.
- 12px, resting at `--text` — not `--muted`. A row that rests muted leaves
  nothing in reserve for hover and unread, which is how three states ended up
  fighting over two colours.
- States climb: rest `--text` → hover/unread `--text-hi` + `--row-hover` →
  active a top-lit gradient, `--rivet` marker, bold.

**Never use `--surface` for a row's hover.** It is lighter than the column's
sunk ground and inverts the ladder.

## 6. What floats, and nothing else

Only these leave the ladder: modals, popovers, tooltips, the `/` and `@` menus,
sticky table heads, and the map's overlay controls (opaque on purpose — a
translucent control would show terrain through itself).

Everything else on the page is cut into the ground.

## 7. The three sprites

`bg.png` (32×16 metal, the rail and the girder), `chatbg.png` (512×512 ground
tile), `stats-LFWB.png` (the You plate). All `image-rendering: pixelated`.
`DESIGN-SYSTEM.md` §3a asks for integer scaling; the girder at 26px is the one
knowing exception, taken because it matches the mockup exactly.

---

## Applying this

Every class in the rebuilt `chat.css` should be justifiable as: *this rung, this
edge, this type rung, this heading kind.* A surface that needs a rule this doc
does not have is a decision to make **here first**, in one line, before it is
built.
