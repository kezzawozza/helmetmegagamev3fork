# Rebuild /chat from the mockup's bones

A skeleton, not a finished design: the phases and the checklist are the point,
and the **Open decisions** at the bottom are unanswered on purpose. Tick items
off here as phases close. `DESIGN-SYSTEM.md` still holds the styling rules;
this doc is only about the rebuild of `/chat`.

## Context

`/chat` was originally ported from `docs/design/mockups/chat/index.html` and
still carries its class vocabulary — `.bar`, `.place`, `.sect`, `.zone-div`,
`.block`, `.you-frame`. But the interface grew by accretion on that skeleton and
no longer reads like it.

An incremental CSS pass already landed (contrast, type scale, girder, rail
density, composer stability). It fixed real measured defects and did not, and
could not, fix the shape:

| | mockup | master |
|---|---|---|
| Aside under "You" | 3 blocks | **8**, plus a drawer and a Sheet link |
| Places column | flat sections | fold chevrons on every heading + a tail strip |
| Composer | `[mode] [textarea] [Send]` + one hint | tools row, in-box send, two menus |
| | one HTML file | **51 files, ~14,100 lines** |

So: **rebuild the presentation on the mockup's skeleton and port master's
features into it**, rather than keep sanding the existing one.

## The line: what is rebuilt, what is kept

The most important decision here, and what keeps a rewrite from being reckless.

**REBUILT** — every component that renders, plus `chat.css` in full. New files
under `web/app/(app)/chat/next/` so master keeps working until cutover.

**KEPT, untouched** — the game's logic and transport. `actions.js` (~2,716
lines), `dmActions.js`, `commands.js` (a registry and dispatch contract, not
UI), and the transport stores. None of this has a design problem.

**SPLIT WITH CARE** — `Chat.js` (SSE connection, reconnect/backoff, cursor and
gap logic — transport — tangled with all the layout) and `Feed.js` (2,408
lines: row rendering *and* composer behaviour *and* command handling). Separate
along the presentation/behaviour line; do not rewrite the transport halves.

Measured, so the size is honest:

| | lines | |
|---|---|---|
| Kept outright | **4,392** | `actions.js` 2,716 · `commands.js` 241 · stores 1,435 |
| Rebuilt | **~6,500** | Chat, Feed, PlacesColumn, both asides, the blocks |
| Split with care | **~3,200** | hooks, dialogs, `PlacePanel.js`, `page.js` glue |

**The seam already exists and is one line wide.** `ChatView.js` is a 29-line
shim: `page.js` builds one object, `ChatView` spreads it into `<Chat>`. Swapping
that for `<ChatNext>` leaves `page.js`, the snapshot machinery and both
providers untouched. That one line is the whole cutover.

### Two things that are NOT chat's to rewrite

- **`TranscriptLine.js` lives in `web/app/components/`, not under `chat/`**, and
  `/archive` and the GM desk's DM thread render through it too. Rewriting it is
  a three-surface change. Default: keep its variant contract, restyle via CSS.
- **`seenStore` / `notifiedStore` hold a durable localStorage contract** —
  cross-tab and cross-reload. Keep the read/write API and storage format; only
  their rendering (badges, OS notifications) is presentation.

## The bones

Straight from the mockup. This is the target, not a suggestion:

```
.app                    grid: 186px | 8px | 1fr | 8px | 252px
  .places   .bar · .sect/.zone-div headings · .place rows
  .rail     metal strip (bg.png)
  .feed-wrap  .bar (name · crumb · spacer · count)
              .feed (.row variants · .daybreak · .decree)
              .composer (.say-row + .hint)
  .rail
  .aside    .bar "You" · .you-frame > .you-well
            .block ×3 — Turn · Here · N · Waiting on you · N
```

Three blocks in the aside. Not eight.

## Feature checklist

Nothing gets dropped silently. Anything the rebuild chooses not to carry is
listed under **Open decisions** and answered by Bascinet, not quietly left out.

**Places column** — Mail (DM, Deadchat) · Radio (nets, party) · per-zone groups
in server order · zone divider only when ≥2 zones · Summary/Here/Rooms/
Conversations/Elsewhere · "Here" vs "Locations" pluralisation · active ·
unread · notified count badge · vantage · mail glyph · hover-card descriptions ·
section + zone folds · tail (view-as, push bell, mark-all-read) · foot slot.

**Feed rows** — speech · emote · system/ambient · shout / shout-near / muffled ·
OOC · whisper · intercom block · decree block (blackletter) · daybreak · NEW
divider · backlog-edge row · skeleton · empty state.

**Feed interactions** — hover action bar and its touch ⋯ twin · inline edit
(5-min window) · ArrowUp recalls last line · delete own · GM remove any · look
at speaker · photograph · save to Notes · mentions · alias/hood handling with
GM real-name · search (debounced, everywhere/here, jump + flash) · sticky
scroll + "N new" pill · backlog pagination with anchor-preserving restore ·
notice cards · run-grouping (7-min) · live-arrival fade.

**Composer** — speech / command modes · voice dropdown · GM system composer ·
`/` menu · `@` mentions · chip arguments · per-command limits + counter ·
command answer line · refusal returns text · tools ✉ menu · drafts · slowmode
(countdown, optimistic hold, 429 retry) · autosize · typing ping and indicator ·
disabled states per place kind · Enter-vs-send by pointer type.

**Slash commands (12)** — `/move` `/travel` `/conceal` `/shout` `/ooc` `/roll`
`/play` `/look` `/converse` `/decree` (GM) `/add` `/remove`.

**Player aside** — You frame (mood, resources, purse, carry, StatusStrip) ·
TurnCard · HereList + per-person menu · Waiting on you · PlaceCard (fixtures,
Examine, Depot/Factory/Research/Map) · PartyRack · RoomPanel (stash) ·
TravelNodes · ThingsDrawer · DesiresBlock · Sheet link.

**GM aside** — tab strip (Place/Room/Travel/GM) · GmHereList opening the Dev
Panel · hooded rows showing real names · zone picker rail · GmPlaceBox.

**Dialogs** — Noticeboard (player + GM) · Converse · Word · Bell · Pray ·
Turret · ATM · Dropbox · Depot-turret · Quest-interact · Intercom · Move ·
Decree · PhotoReadout · LookReadout · Map overlay.

**DM pane** — pseudo-place, no seq · renders `DmThread` (shared with the GM
desk) · own optimistic send with `clientNonce` · visibility-gated seen marks ·
own length cap.

**Realtime** — one SSE connection with reconnect/backoff and wake-on-visibility ·
typing · deletes · places diff · gap recovery · mention detection into
notifiedStore · push notifications · row-cache instant paint · backlog prefetch
(players, capped 12).

**Phone** — Places drawer (≡, swipe) under 720px · aside drawer under 900px ·
MembersStrip face-pile · Enter becomes newline · ⋯ sheet replaces hover bar ·
map becomes a route not an overlay · nav links in the drawer foot.

## Phases

Each ends with something that runs; no phase leaves the tree broken.

1. **Scaffold** — `next/` directory, grid shell, `chat.css` rewritten from the
   mockup's stylesheet. Static content at the right shape, behind a flag.
2. **Places column** — real data, groupings, states.
3. **Feed** — every row variant, sticky scroll, backlog, search, notice cards.
   Biggest phase; expect it to overrun.
4. **Composer** — modes, commands, menus, drafts, slowmode, limits.
5. **Aside** — You frame + the mockup's three blocks; survivors of the
   decisions below go in as folds.
6. **GM aside + DM pane.**
7. **Phone** — drawers, swipe, tap floors, ⋯ sheet.
8. **Cutover** — flip `ChatView.js`, delete the old files in one commit so the
   diff shows exactly what went.

## Open decisions

Bascinet's, not mine — several are live game systems with docs behind them.
Needed before Phase 5.

- **The five aside blocks the mockup has no room for** — Place, Party, Room,
  Travel, Desires, plus Things. Fold, relocate (`/character`, `/map`), or keep
  the column long?
- **The places tail strip** — view-as, push, mark-all-read. View-as is a GM
  tool and needs somewhere to live.
- **Fold chevrons** — the mockup's sections don't fold, and the state resets on
  reload anyway.
- **Composer tools row and in-box send** — back to the mockup's three controls?
- **The static `.hint` line** — the mockup has one; it is also text, and the
  standing instruction is less text.
- **Is `TranscriptLine.js` in scope?** Restyling it touches `/archive` and the
  GM desk.

## Risks

- **A rewrite loses things quietly** — the checklist above is the mitigation.
- **Scale** — not a one-sitting job even with the data layer kept.
- **Two implementations live at once** through phases 1-7.
- Constraints from the CSS pass still hold: no new copy, no hardcoded colours,
  no `position`/`z-index`/`transform` on the columns (traps `Modal.js`'s in-tree
  overlay), no `overflow` on the composer box.

## Verification

Per phase: `npm run lint --workspace=web`, `npm run build --workspace=web`,
`npm run audit:contrast --workspace=web`, `npm run dev:check`.

Visual: boot the local stack and screenshot each phase beside
`docs/design/mockups/chat/screenshot.png`. **`echo $DATABASE_URL` first** — this
container exports a Railway one that shadows the local `.env`, along with
`AUTH_SECRET`, `DISCORD_TOKEN` and `RAILWAY_TOKEN`; prefix with `env -u`.

At cutover: walk the whole checklist against the new build, item by item, with a
living character and a GM seat, desktop and phone.
