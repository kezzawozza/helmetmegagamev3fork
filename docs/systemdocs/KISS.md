# Kissing

The Kiss button on `/character` and on a person's row in `/chat`. Read
[`LESSONS.md`](LESSONS.md) §3 first — this is that Offer handshake with no
skill, no die, no Move and no turn pass, and everything below is a delta
from it.

It exists because the game had many ways to hurt somebody and almost none to
be kind to them. Every other thing that lifts a mood is something you buy or
build: a drink, a meal, a roof, a confession, music. This one lifts it
because another player agreed.

**Every line this verb speaks is Bascinet's own.** Worth knowing before you
touch the copy: the wording in `db/lib/kiss.js` is settled.

## 1. The rules

- Anyone picks somebody standing where they stand and presses **Kiss**. They
  get a DM with Accept / Decline; **nothing happens until they press one.**
- On Accept **both** dials move **+17** — the same figure a confession is
  worth (`MOOD.md`) — **plus what the other person's looks are worth** (§1a).
  **Nobody else is told** (§5).
- **It costs no Move**, files no `Action`, rolls nothing, and no turn pass
  touches it.
- What holds it back instead is two rations. **Asking** has a **2-hour
  cooldown**. The **mood** is worth something **once per turn per person**.
- Both sides must be at the same Location and unconcealed
  (`db/lib/presence.js`), both alive, and neither in any state §2 refuses.
- You cannot kiss yourself, the dead, or anyone you cannot see.

Constants: `KISS_COOLDOWN_MS`, `KISS_SELECT` in `db/lib/kiss.js`;
`KISS_BLOCKING_SLUGS` in `db/lib/constants.js`; `EVENTS.KISS` in
`db/lib/mood.js`.


## 1a. Appearance, and which way it points

A kisser's looks are paid to **the person they kiss**, never to themselves —
being pretty is not a thing that cheers you up, it is a thing that cheers up
whoever you kiss. So the two terms **cross over**, and each side is computed
independently from the other's tags.

| Tag | Worth, to the other person |
|---|---|
| `pretty` | +6 |
| `beautiful` | +12 |
| `seductive` | **+75** |

Seductive **stacks on top of** a face; pretty and beautiful are one tier chain
(`beautiful` carries `parentTag: pretty`), so only one of them is ever held and
the code takes the **max** of the two rather than trusting that. A GM grant
walks past the tier rule, and a hand-granted pair would otherwise pay twice.

The table is `KISS_APPEARANCE` in `db/lib/kiss.js`; `applyKissMood` only adds
the number it is handed, so the mood tables stay the record of what an *event*
is worth and nothing there has to know that Pretty exists.

**`in-love` is the one bonus that does NOT cross**, and it is deliberately not
in that table. A Love Tablet (`DEPOT.md` §3) is a fact about the evening
rather than about a face, so it pays **+80 to both sides if either side holds
it** — one tablet between two people is enough, and two tablets are worth no
more than one. It lives in its own `inLoveBonus` helper for exactly that
reason: a row in `KISS_APPEARANCE` would be crossed silently along with the
rest, which is the bug that shape prevents.

**Sizing.** `EVENTS.KISS` is 17, Ecstatic starts at 64 and the dial clamps at
82 (`db/lib/mood.js`). So Seductive alone carries anyone at −22 or better
straight into Ecstatic and its **+1 Gambit**. That is the Courtesan's seat
working as intended, not an accident of the arithmetic — and it is why the
ration in §4 has to stay a gate rather than a cap.

## 2. Who may not, and why it is a capability

Prohibitions live in **two** places on purpose, split by which question is
being asked.

**Incapacity → `db/lib/incapacitation.js`.** `KISS` is a fourth capability
beside `ACT`, `SPEAK` and `SHOUT`, and `expandCaps` says **ACT implies
KISS**. That one line is the whole "a kiss needs somebody who can answer"
rule: Bound, Dying, Unconscious, Crucified, Paralyzed, Seizure and Catatonic
all already block ACT, so all of them refuse a kiss without a second list
existing to drift from the first.

`ACT` is not a sufficient proxy in *either* direction, which is why `KISS`
is its own column rather than an alias:

- **`mute` keeps it.** It blocks only SHOUT. `TAGS.md` §5f is emphatic that
  over-gating that tag "removed the PLAYER from the game rather than the
  character from a conversation" — a mute smith is still a smith, and still
  has a mouth.
- **`broken-jaw` loses it** and keeps ACT. The injury *is* the mouth.

The `KISS`-only rows are three groups: nobody home (`asleep`, `blind-drunk`,
`hallucinating`, `madness`, `sepsis`, `pain-shock`, `stupid`,
`disabled-shocked`), the mouth (`broken-jaw`, `wired-jaw`, `choking`,
`vomiting`), and nothing left (`gibbed`, `exploded-chest`).

**Fiction → `KISS_BLOCKING_SLUGS` in `db/lib/constants.js`.** The short
hand-written list of things that are not an incapacity at all — a Ghoul walks
and works and is still not kissing anyone. `ghoul`, `rage`,
`servant-of-tzchernobog`, `apex-form`, `broken`, `broken-enslaved`,
`phrygian-toxin`, `installed-poison-tooth`. Same posture as
`FINISHABLE_SLUGS`: deliberately shorter than it could be, and every addition
should cost somebody a keystroke.

**A covered face is derived, never listed.** Anyone wearing an equipped
`Tag.concealsIdentity` piece is refused, through
`presentedIdentity.js#concealmentFrom`. That covers every helm, mask, hood and
the bag in the catalog today and anything added tomorrow. It is also the
honest half of "you can't kiss a concealed person": `presence.js` filters the
`/conceal` **wish column**, which a `forcesConceal` helmet never sets, so
without this a knight in a closed helm would be on every picker.

### What is deliberately allowed

**No disease gate at all.** Leper, Pox, Consumptive, Feverish, Infected,
Festering and the rest all kiss freely. Bascinet's call, and the same posture
`TAGS.md` §5f takes about what is not gated.

Nor is taste, belief or appearance blocked: `prudish`, `eunuch`, `pacifist`,
`saint`, `chaplain`, `pious`, `mimes-vow`, `biter`, `disfigured`, `scarred`,
`ugly`, `unhygienic`, `depressed`, `teratophobia`, the three True Forms, and
every limb mutilation all keep the button. The game's convention is that a
build locks **Desires** rather than removing a verb — `eunuch` and `prudish`
already lock the `romance` family in `docs/tags.yaml`, which is the right
place for "would refuse".

**`demoness` must stay able to kiss.** The voluntary kiss is how a Break is
sealed (`docs/tags.yaml`, the `demoness` description). Blocking it would
remove the cult's own mechanic.

## 3. The three audit actions, which are not interchangeable

| `actionType` | Written by | What it is for |
|---|---|---|
| `kiss` | the ask (`requestActions.js#kissRequestImpl`) | **the cooldown clock.** `kissCooldownLeft` reads the newest one by `actorDiscordUserId`. |
| `kiss_accepted` | `acceptKiss`, one per side | the record that it happened |
| `mood_kissed` | `mood.js#applyKissMood`, one per side | **the per-turn mood ration** |

Keeping the first two apart is load-bearing. If Accept wrote `kiss` rows, then
**being kissed would start a two-hour wall on the person who said yes** —
punishing them for agreeing.

All of them set `turnId` (`REQUESTS.md` §1a): it costs nothing now and it is
the only thing that lets a ration ever count them.

## 4. Why the rations are AuditLog rows and not columns

A once-a-turn gate needs no migration, so this takes the cheap one. It cannot
be a magnitude cap instead, and that is firmer since §1a arrived — a Seductive
kiss is worth several times `EVENTS.KISS` on its own, so a cap sized to one
ordinary kiss would silently eat most of it. `applyKissMood` counts a
`mood_kissed` row the way the Cathedral's relief counts `mood_cathedral`, and
the whole feature's migration is **one enum value**.

`MOVE_MOOD_TURN_CAP`'s heavier machinery (`moveMoodTurnId` / `moveMoodUsed`,
a guarded `updateMany`) earns itself on movement, where a dozen small steps
have to part-spend one allowance. Nothing here needs that.

The **ask** spends the cooldown, not the answer, and a decline does not refund
it. That is the whole point: otherwise asking a whole room costs nothing and
the picker becomes a way to find out who is willing.

## 5. Nobody hears it

**A kiss is private.** The only two people told are the two who agreed to it,
each by DM — "You kissed Ada." to the asker, "Ada kissed you back." to them.
Nothing is written to the room, the Location, the feed or the archive, and no
third party is told anything.

It was not always so. Until 2026-09-10 the accept posted one `-#` line —
`-# Ada and Celeste kissed.` — into whichever Room the two shared, or the
Location's own channel when they shared none. Bascinet cut it: the room being
told is a kiss cam, and the two dials moving is the whole mechanic. The lines
it had already written were deleted from the live game at the same time.

`placeForKiss` and `sayItHappened` went with it, and `presentedIdentity` is no
longer imported here at all — with no line to write there is no name to
present. `db/lib/placeLine.js` stays where it is; the rites use it.

## 6. What it does NOT do

- **No bot change.** `offerRow.js` owns the `offer:accept:` prefixes and
  `interactionCreate.js` routes on the prefix, not the kind. The web's own
  Accept/Decline (`DmActionRow.js` → `dmAnswer.js`) works for free too.
- **No Desire is claimed.** `kiss-someone`, `dem-offered-kiss` and
  `dem-kiss-a-broken` stay GM-adjudicated. Blocking `broken` in §2 is what
  keeps `dem-kiss-a-broken` a GM's job rather than a button.
- **No turn pass.** `offerExpiryPass.js` already expires every PENDING offer at
  turn close, kind-agnostic, so a kiss nobody answered dies with the day.

## 7. The gate is your own mouth, never the room

The Kiss button greys on `kissBlocked` — **your own** broken jaw, your own
Rage, your own hood — resolved server-side in `web/lib/peoplePools.js` so the
greyed button and `kissRequestImpl`'s refusal read the same sentence.

It must **never** grey on whether anybody here would say yes. That is the rule
at the top of `actionRegistry.js`, and this verb could break it more loudly
than most: a button that lit up only when somebody kissable was standing there
would be free scouting on every page load.

`kissTargets` is menu hygiene only. `kissAuthority` runs again in
`createKissOffer` on whatever id is posted, and **again** on Accept — a DM can
sit unanswered for hours, and in that time either of them can be bound,
hooded, drugged or killed.

## 8. Known wart

`installed-poison-tooth` is on the fiction list, and a greyed button is a
**tell**: it is the only tag on that sheet which could explain the refusal, so
the gate quietly leaks a secret to the person carrying it. The alternatives
were letting the kiss go through normally, or letting it kill both parties.
Blocked is what shipped.

## 9. Where the code lives

| File | What |
|---|---|
| `db/lib/kiss.js` | the rules: `kissAuthority`, `kissBlock`, `createKissOffer`, `acceptKiss` |
| `db/lib/incapacitation.js` | the `KISS` capability and ACT-implies-KISS |
| `db/lib/constants.js` | `KISS_BLOCKING_SLUGS` |
| `db/lib/mood.js` | `EVENTS.KISS`, `applyKissMood` |
| `db/lib/dmAnswer.js` | the Accept branch, shared by both faces |
| `db/test/kiss.test.js` | the pure half |
| `web/app/(app)/character/requestActions.js` | `kissRequestImpl` |
| `web/lib/peoplePools.js` | `kissTargets`, `kissBlocked` |
| `web/app/components/actions/KissDialog.js` | one picker |
