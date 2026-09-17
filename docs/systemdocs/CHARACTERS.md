# Characters: creation, roles, and death

How a player gets a character, what the point-buy economy is, and what
happens when that character dies — plus the four-field name and the two locks
on creation. Companion to `TAGS.md` (the tag catalog), `CHANNELS.md` (the
Discord channel/permission layout) and `PROXYING.md` (personal
roles).

## 1. The shape of it

A player signs in and lands on `/character`. If they have no `ALIVE`
character — brand new to the server, or their last one died — that page
renders something other than a sheet, depending on the game's phase
(`LOBBY.md` §1). There's no separate `/character/new` route; one URL, no
redirect bounce.

- **Before the game starts** it is the **lobby**: role priorities, a
  fallback, antagonist opt-ins and a Ready button (`LOBBY.md` §2). Start Game
  rolls those into seats.
- **Assigned a seat**, the wizard below opens on step 2 with the role fixed
  and a deadline banner (`LOBBY.md` §4).
- **Otherwise** — never readied, a respawn after a burial — it is the
  wizard as described here: late join, picking from open seats.

The wizard has five steps:

1. **Role** — the role list, in seven social buckets with live seat counts.
   See §1e.
2. **Tags** — the point-buy menu.
3. **Identity** — a title (only what the build has *earned* — see §1c), a
   required first name and an optional last name.

   **Identity comes third, after Role and Tags, and has to.** A title is
   earned from the role taken and the tags held, so there is nothing to offer
   until both are picked. It also fixes the dynasty surname, which is locked
   by the role: while Identity ran first, `lastNameLocked` was read before the
   role that sets it existed, so the input could not be locked in time.

   Age is optional here (18–90). Left blank, it stays editable on `/character`
   until the player saves a number, and locks at that point — a GM can still
   correct it afterwards. It feeds the Young/Old half of a concealed alias
   (`db/lib/concealedIdentity.js`).

   A displayed name is four fields joined by
   `db/lib/characterName.js#formatCharacterName` as
   `Sir Jorren "the Blind" Vask`. The fourth, `title`, renders in quotes
   between the names and is **GM-only** — it has no input in the wizard, and
   the character sheet shows it disabled with a "make your case to a GM"
   tooltip. `Character.name` remains as a denormalized mirror of the join.
   See §1b.
4. **Antagonists** — eleven checkboxes, all off, naming the antagonist seats a
   GM hands out in secret (the Demoness, the Judge…). Pure consent data:
   nothing in the game grants from `Character.antagonistOptIns` or gates on it
   — it exists so a GM choosing who receives one can tell who is willing. Also
   **optional** — ticking nothing is a real answer, so `canAdvance` is
   unconditionally true here too.

   **Most of these are decoys.** Only two of the eleven are real seats today,
   and a GM may hand one to somebody who ticked nothing at all. That is the
   design: the list tells a player nothing about which threats exist. See
   `THREATS.md` §1.

   Opt-in rather than opt-out deliberately: a player who clicks through without
   reading has consented to nothing. It is **creation-only** — the list is set
   here and `updateCharacterProfile` never reads the key, the same lock `title`
   uses. A GM reads it on `/gm/dev?s=assignments`, which is the only surface
   that shows it. The catalog is `db/lib/threats.js` (alphabetized, so catalog
   order *is* display order — which is also what hides the real seats among the
   decoys), and `normalizeAntagonistSlugs` is the server-side allowlist —
   a server action is a public endpoint, so the checkboxes are UX and that
   function is the boundary. It drops a slug the catalog no longer carries,
   which is why renaming one needs no data migration.
5. **Confirm** — a summary, then `createCharacter`.

## 1b. Names

A displayed name is **four fields**, joined by
`db/lib/characterName.js#formatCharacterName`:

```
Sir Jorren "the Blind" Vask
 |    |         |        |
 |    |         |        `-- lastName   String?  optional, player-editable
 |    |         `----------- title      String?  GM-ONLY, renders in quotes
 |    `--------------------- firstName  String   required, player-editable
 `-------------------------- honorific  String?  a title the character EARNED
```

`honorific` is **earned, not chosen** — see §1c.

`title` is the opposite: set **only** from `/gm/dev/characters/[characterId]`.
The character sheet shows it as a `disabled` input with a "make your case to a
GM" tooltip — but the greying is not the lock. A disabled input submits nothing,
and `updateCharacterProfile` never reads the key. It does have to feed the row's
*existing* `title` back into `formatCharacterName`, or a player saving their bio
would silently strip a title a GM had granted.

### `Character.name` is a denormalized mirror

Same posture as `Character.zoneId` (`ARCHITECTURE.md` §6). It's what ~60 readers
want — `orderBy`, `select: { name: true }`, the `/gm/audit` `contains` search,
the proxy webhook username — and Prisma cannot concatenate columns in
`orderBy`/`contains`, so dropping it would force search and sort into
`OR`-over-three-columns for correctness nobody can see.

Keeping it also means the never-backfilled name snapshots
(`Note.characterName`,
`ArchiveEntry.characterName`, `AuditLog.details`) capture the titled form with
no code change — correct, since those record who did something *as they were
known then*.

**Exactly four writers** keep it honest, and every one goes through the
formatter:

| Writer | When | Title gate |
|---|---|---|
| `character/createActions.js` | Creation | `normalizeEarnedHonorific` |
| `web/lib/characterWrite.js` | GM raw edit, from the dev panel | `normalizeHonorific` (ungated) |
| `web/lib/dynasty.js#propagateDynastyLastName` | The Baron renaming his house | **none — see §1c** |
| `character/requestActions.js#changeNameRequestImpl` | A Mulligan Potion, drunk | **none — the bottle buys the word** |

A fifth must do the same.

### A name is immutable — except through a Mulligan Potion

There is **no direct player-facing rename.** A name is chosen once, in the
creation wizard, and after that `character/actions.js#updateCharacterProfile`
ignores `honorific`, `firstName` and `lastName` outright — the three inputs on
`/character` render `disabled`, but as always the disabled input is the hint
and the server action is the lock. The rest of the Bio form (appearance,
avatar, opt-ins) is untouched.

Two of those opt-ins are switches under the picture. **Ping me when the
turn advances** adds or removes the turn-ping Discord role and nothing else.
**Play on Discord too** is the mirroring switch (`CHAT.md` §6, `discordMirrored`,
default **off**): while it is off, this player's Discord account holds no game
access at all — no Location overwrite, no zone role, no room or conversation
thread — and they read and speak on `/chat` instead. It is the one switch on
this form with a cooldown of its own (two hours,
`DISCORD_MIRROR_COOLDOWN_SECONDS` in `db/lib/discordMirroring.js`), because
each flip is a burst of Discord writes;
`db/lib/discordMirroring.js#setDiscordMirrored` enforces it with the same
atomic `updateMany` guard the Location-move cooldown uses, and a refusal leaves
the rest of the save standing.

The one way through is the **Mulligan Potion**, and it is drunk from the
bottle: the potion sits in the Tags card like every other consumable, and its
tooltip's **Consume** button opens the identity dialog instead of spending it
on nothing. One line — *What would you like your identity to be? This is
permanent.* — then four fields, then it applies immediately and **one potion
is consumed**. There is no reason field and no Undo (`REQUESTS.md` §1) — the
potion IS the cost, which is the point of gating it on an item rather than on
a GM reading a justification afterwards.

**All four parts, and two of them are not gated anywhere else.** The prefix is
free text here rather than the earned-word dropdown creation uses: what a
bottle sells is a whole identity, so a prefix a character drank is no longer
proof they earned anything, and finding that out is somebody else's problem.
The quoted title (`Sir Jorren "the Blind" Vask`) is a GM's to grant
everywhere else in the game; this is the one player-facing form that writes
it. Both are still capped by `NAME_LIMITS`, because every writer of `name` is.

`consumeTagRequestImpl` **refuses** the potion outright, beside its sealed-
paper, camera and crate special cases, and `consumableTags()` leaves it out of
the ordinary Consume dropdown. Without both, the generic path would drop the
bottle and change nothing.

The gate had been removed at one point, leaving the tag "a flavor collectible
only" and renaming free. Free renaming quietly undermines every other identity
rule in the game — the personal Discord role, a wanted poster, a Disguise
that is supposed to be *temporary* — so it is back. **Mulligan is the
permanent path and Disguise is the temporary one**, and they do not interact:
a disguise keeps presenting its `forcedName` over whatever the real name
becomes (`PROXYING.md` §6).

**Drinking it also clears the Wanted tag.** A new name is a new man, and
buying your way off the warrant book is the sharpest thing the bottle does —
leaving the tag on would have meant the Cerberon still reading you as wanted
under a name their own book has never heard of. The posters already nailed up
are *not* recalled: they are paper, on their own clock (`PAPERWORK.md` §7).
A Disguise Kit hides the tag for three turns; this takes it off for good.
See `REQUESTS.md` §5g and `TAGS.md` (`visible: named`).

The potion is brewable (`brewing-skilled`, 2 turns, 8 ⬢) and stocked at the
Depot, so it is a thing a player can actually get. It re-validates the same cap
and dynasty-lock rules every other writer of `Character.name` enforces, and runs the same
lightweight Discord fan-out `updateCharacterProfile` used to
(`ensureCharacterRole`, and
`propagateDynastyLastName` if the renamer is the Baron) right after the
transaction commits — best-effort and outside it, same posture as every other
request that touches Discord. `REQUESTS.md` §3 has the one gap worth knowing:
Undo reverts the database but not Discord, which catches up on the player's
next Bio save.

### `NAME_LIMITS` (10/24/20/20)

Not cosmetic. Discord caps a webhook username at 80 characters and the proxy
sends `name` as-is, so the **inputs** are capped instead and the composed name
is ≤79 by construction. Both form-fed writers — creation and the GM dev panel
— apply the caps and the title allowlist server-side; both of those forms are
public endpoints. The longest title is 9 characters (Professor), so
the 10-char cap holds with the catalog as it stands.

## 1c. Titles are earned, and gender picks the form

`db/lib/titles.js` is the catalog. An entry is one **title**, not one word:
`words` is either a plain string, or a map keyed by gender.

| Title | Earned from | MAN / WOMAN / NEUTRAL |
|---|---|---|
| Sergeant | tag `sergeant` | one word |
| Cerberus | role `cerberus` | one word |
| Squire | role `squire` | one word |
| Sheriff | role `sheriff` | one word |
| Censor | role `censor` | one word |
| Knighthood | tag `knighted` | Sir / Dame / Ser |
| Nobility | tag `nobility` | Lord / Lady / Noble |
| The Baron's seat | roles `baron` `baroness` | Baron / Baroness / Baron |
| Ordination | tag `chaplain` | Father / Mother / Reverend |
| Monastic | tag `mortus`, role `incarn` | Brother / Sister / Sibling |
| Bishop | role `bishop` | one word |
| Doctor | tag `medical-skilled`, roles `esculap` `serpent` | one word |
| Professor | role `scholastic` | one word |
| Master | roles `metalsmith` `innkeeper` `headman` | one word |

**A player never picks between Lord, Lady and Noble.** Their gender decides
that; the dropdown picks between Lord and Sir. So `earnedTitles()` returns one
word per earned title, never three.

Only five titles are gendered at all. Rank and profession say nothing about
their wearer, which is why Censor, Doctor and Master sit on the flat side —
and every gendered set carries a neutral third, so nobody has to pick a side
to be styled.

Overlap is deliberate: the `bishop` role grants the `chaplain` tag, so a Bishop
may style themselves Father, Mother or Reverend instead. Same for Censor
(grants `cerberon`) and the Baron's family (grant `nobility`). **Most of
Ravenheart is untitled** — most seats earn nothing, and the picker says so
rather than showing an empty control.

Three titles hang off *purchasable* tags (`sergeant`, `knighted`,
`medical-skilled`), so they can be bought with points — but each sits behind a
membership gate already (`general-cerberon` needs `cerberon`, `general-court`
needs `courtier`), so nobody buys a title cold.

### Gender

`Character.gender` is `MAN | WOMAN | NEUTRAL`, non-null and defaulted. It is
chosen on the **last step of creation** — it has to be, because it and the
tags together decide what the title picker can offer — and never changes
afterwards.

The lock is `character/actions.js#updateCharacterProfile` **not reading the
key**, the same silence that keeps a name immutable. It deliberately does not
copy `age`'s null-until-set conditional: there is no unset state to leave open.
A GM can correct one from `/gm/dev/characters/[characterId]`, which is the only
writer after creation.

Gender does two jobs, and both used to be inferred from whichever title a
character happened to wear:

- **Which form of a title they get** — the table above.
- **The Man/Woman/Person half of a concealed alias**
  (`db/lib/concealedIdentity.js`) and the name pool Randomize draws from
  (`db/lib/nameCorpus.js#poolsFor`).

The second is a behaviour change worth knowing: an untitled woman now conceals
as "a young woman" rather than "a young person". Concealing hides the name, the
face and the seat — it was never meant to hide how someone presents, and the
alias comment always said as much. `ArchiveEntry.concealedAlias` is frozen at
send time, so a later correction never rewrites history.

### Four seats fix it

`baron` and `heir` are MAN; `baroness` and `successor` are WOMAN. Declared as
`gender:` in `docs/roles.yaml` and carried on `Role.lockedGender`, so a future
gendered seat needs no code — same posture as the `leader:` / `treasurer:`
booleans beside them.

These are **the same four roles that hand down the dynasty surname**, so both
locks land on the same wizard step: the picker renders disabled with a
tooltip, and `createCharacter` stamps the seat's value over whatever was
posted, exactly as it does the surname. The GM panel does not enforce it — a
deliberate exception is a GM's to make.

### The guard that finally works

`assertTitlesResolve(prisma)` runs at the end of `db:sync-roles` (after tags,
per `SYNC.md`) and fails on an unknown tag or role slug, or a gendered entry
missing a form. It replaced `assertHonorificsCovered()`, whose condition was
`!MAN.includes(h) && !WOMAN.includes(h) && genderWord(h) !== "Person"` —
unsatisfiable, since `genderWord` returned `"Person"` exactly when the first
two held, so it never fired once.

### Losing the tag does not strip the title

A knight who is stripped of `knighted` **keeps wearing "Sir"**. The picker
stops offering the word, so changing away is a one-way door, and only a GM can
put it back or take it off from `/gm/dev/characters/[characterId]`.

That rule is why **only three call sites may normalize a title**, and each
uses the right one:

- `normalizeEarnedHonorific(value, { tagSlugs, roleSlug })` — the two paths
  where the player is *choosing* a title: creation and the Change-name request.
- `normalizeHonorific(value)` — membership in the catalog only, no earning
  check. The GM dev panel, matching `TAGS.md` §3's rule that a GM grant is
  never second-guessed. It is also the escape hatch for a title nobody can
  re-select.

Anything else that happens to touch the name must **not** revalidate.
`web/lib/dynasty.js#propagateDynastyLastName` composes straight through
`formatCharacterName` for exactly this reason: if it normalized, every time
the Baron renamed his house it would silently strip the honorific of any
family member who had since lost their granting tag.

Retired with this change: Mr., Mrs., Ms. (a courtesy register that said
nothing about a character) and Marshal (a rank with no seat behind it).
**Master survives**, repurposed from a courtesy word into the craft-master's
title and re-read as neutral.

### Age

`Character.age` (18–90, nullable) follows the same shown-but-locked posture as
`title`, from the other direction: it is the player's to set, **but only once**.
While null the `/character` input is live; the moment a number is saved it
renders `disabled` with an `InfoIcon`, and `updateCharacterProfile` refuses to
overwrite a non-null age however the form is posted. The disabled input is the
hint, not the lock. The wizard takes it optionally, and a GM can always correct
it. Read by `db/lib/concealedIdentity.js` for the Young/Old half of a concealed
alias (`PROXYING.md` §5).

### The dynasty last name

`lastName` is the player's own **except for the Baron's house**. The four Court
seats — `baron`, `baroness`, `heir`, `successor` — are one family, so the Baron
chooses the dynasty name and the other three inherit it: their last name is
never read from a form they posted.

- `db/lib/dynasty.js` (pure, in the barrel) — the slug list and two predicates.
- `web/lib/dynasty.js` — the prisma/Discord half. `dynastyLastName()` reads the
  living Baron (the seat is `multiple: false`, so `findFirst` is exact);
  `propagateDynastyLastName()` restamps the family.

The lock lives in both remaining form-fed writers, GM raw edit included, keyed
on **the role being saved** — so moving someone into a family seat renames them
in the same write. The greyed-out inputs are the hint, not the lock. (Since the
self-service edit no longer writes names at all, a player's own form cannot
reach `lastName` by any route.)

Two consequences worth keeping: a family member created before any Baron exists
simply has no last name until he rolls up; and propagation runs only after a
Baron *write*, never on his death, so a widowed house keeps the name it was
given until a new Baron overwrites it.

`propagateDynastyLastName` fires `ensureCharacterRole` per renamed character,
since the bare name feeds the role. **No `AuditLog` row** —
the rename is a consequence of the Baron's own edit, which is already logged.

### Bare names, and sorting

One surface deliberately uses the **bare** name (`formatBareName`, first +
last): the personal Discord role's name and colour seed. The role is an
`@`-mentionable access-control
primitive rather than an RP surface, and seeding the colour off the bare name
means granting or changing a title never renames or recolours anyone.

`orderBy: { name: "asc" }` on a Character would file `Sir Jorren` under S, so
the seven Character-model sites use
`[{ firstName: "asc" }, { lastName: { sort: "asc", nulls: "first" } }]`. Most
`orderBy: { name }` in the codebase is on Zone/Tag and is
untouched — **check the model before changing one.** The client-side
`characterName` sort in the GM tables still sorts the titled string, which is
fine: those tables are searched far more than sorted, and the search matches
the same string.


### 1e. The seven buckets

The picker groups roles into **Court, Clergy, Cerberon, Saviors, Business, Soil
and Outsiders**, and each card prints the zone its holder starts in.

It used to nest **Zone → Faction → Role**, which was the shape the database
stored and the shape `docs/roles.yaml` was written in. On the picker it read as
a map, and a map is not the question being asked — what a player chooses
between is a social position, and those cut across the geography. The Church
and the Order of the Silver Cross are both in Town and are both clergy; the
Company sits in the Caves and the Factory in the Marshes and both are business.

Since factions were removed (10/2026) the buckets are the *only* grouping
there is. `docs/roles.yaml` is a `groups:` map keyed by bucket slug, each role
carries its bucket as `Role.groupSlug`, and `db/lib/roleGroups.js#groupRoles`
takes a flat role list and files it.

**The slugs are in the YAML; the display names are in code.** `ROLE_GROUPS` in
`db/lib/roleGroups.js` holds the order and the labels, for the same reason
`roleCapacity.js#REOPENING_SEAT_ROLE_SLUGS` does: a typo in a label must not be
able to throw `db:sync-roles` mid-pass with rows already written. A group *key*
in the YAML that names no bucket is a different matter — `syncRoles` validates
every one against `isRoleGroupSlug()` in its up-front pass and throws before it
writes anything, since a mistyped key would otherwise file a seat under
"Elsewhere" and nobody would notice.

**A role in no bucket falls into a trailing "Elsewhere" rather than
vanishing.** That is the `Role.groupSlug` default, and it is the safe
direction: a silently dropped bucket would be a seat nobody could take,
discovered by a player rather than by us.

Bucketing is at **role** grain, and always was. The Fisherman is the standing
example — on the Factory's books once, but a man alone in the marsh with a rod
belongs under Soil. That used to need a `ROLE_GROUP_OVERRIDES` entry pointing
away from his faction's bucket; now he simply sits under `soil:` in the YAML,
and the override table is gone.

`#info`'s roles-intro thread reads the same `groups:` map
(`db/lib/infoChannel.js`), so the thread and the picker cannot disagree about
where a seat belongs.

## 2. Roles

`docs/roles.yaml` is the master. `db/lib/syncRoles.js#syncRolesFromYaml`
(`npm run db:sync-roles`) reads its `groups[].roles[]` nesting into the `Role`
table, matched by `slug`.

**A role's two prose fields go to different places.** `intro` is the one-line
pitch in the creation picker. `description` is a `String[]` of plain sentences
that a player reads as their **role charter**, pinned first in `/documents`'s
Assigned tab (`DOCUMENTS.md` §2) — joined into a Markdown bullet list there,
one bullet per YAML line. It is plain prose: no Markdown, no `{tag:…}` tokens
in any of the 49 today, and the charter renderer does not promise either.

Worth knowing because it was written and synced for every role and **rendered
nowhere at all** until that card existed — an edit to `description` used to
reach no one.

**Threats are not in `roles.yaml`.** Sympathizer, the Demoness, the Judge,
the NPC monsters, the Brigands — those seats are assigned
by hand by a GM and must never appear in the player-facing picker, so they are
prose in `db/lib/threats.js` rather than role data (`THREATS.md`). They used to sit in
`zones[].threats[]`, carrying a full role's worth of fields that no sync ever
read.

It replaced the old `db/lib/factionSync.js`, which read the same file but only
ever used a handful of its fields.

### Seat caps

`db/lib/roleCapacity.js#roleCapacity(role, playerCount)` is the single source
of the cap, shared by the picker, the server action, and the GM panel:

| YAML | Column | Cap |
|---|---|---|
| `multiple: false` | `isUnique` | exactly 1, at any game size |
| `weight: unlimited` | `unlimited` | uncapped (`Infinity`) |
| `weight: N` | `weight` | `max(1, round(N * playerCount / 100))` |

`weight` reads as *seats per 100 players*, so `GameConfig.playerCount` is the
live dial: set it to 120 on `/gm/dev` and every weighted role widens by 1.2×.
`multiple: false` is deliberately **not** "1 per 100" — the Baron stays one
Baron in a 300-player game.

**Who occupies a seat** is `roleCapacity.js#seatHolderStatuses(role)`, and
the answer is normally *a living or a dead one*: a seat is spent for the run
the moment somebody takes it, and their death does not hand it back. A
Cerberus who dies takes the Cerberus's chair with him.

The exception is `REOPENING_SEAT_ROLE_SLUGS`, which is two names long — **Bum
and Migrant**. Those two count only their ALIVE holders, so they are the seats
a dead player can come back into. That is the point of them: with the curse
now stopping a new character entirely until the body is buried
(`db/lib/curse.js`), the roster needs a floor nobody can be locked out of, and
those two are it. Migrant is `weight: unlimited` besides, so it can never be
full at all.

This list used to run the other way — seventeen named seats stayed shut and
everything else refilled itself. Inverted 2026-09-18. "Taken"
means "a Character row still points at this Role": a GM deleting the dead
row from the dev panel, or moving the dead holder to another role, frees the
seat. The GM panel never checks capacity at all, so a GM can always seat
someone by hand. A slug list rather than a `roles.yaml` key: a static
rule over a fixed roster, with no column to migrate.

A role at capacity renders disabled. That's advisory only: `createCharacter`
re-counts inside the transaction that creates the character. A bare count
there is **not** enough by itself — Prisma runs at READ COMMITTED, so two
concurrent transactions can both read the same pre-insert count and both
commit, seating two Barons. What actually closes it is a `SELECT ... FOR
UPDATE` row lock taken on the Role first, the same pattern
`equipActions.js`'s equip-slot check uses, so the second attempt reads the
first's committed count. When two players sit on the last Baron seat and
both hit Confirm, the second one gets told to pick again.

### Seat reservations

A five-step wizard between "pick a role" and "the seat is actually yours" is
a long window for a capacity-1 role to vanish out from under a player mid-tag-menu.
`RoleReservation` (`db/lib/roleReservation.js`) holds a seat for **30
minutes**, refreshed on every Next after the Role step — so a careful tag
menu never costs it, but an abandoned tab frees a unique seat the same
session. `discordUserId` is `@unique`: a player can hold exactly one seat,
and reserving a different role releases the first as part of the same
upsert. Expiry is swept lazily wherever a taken count is read; there is no
cron job. The picker (`/character`) counts seated characters (per
`seatHolderStatuses`) plus everyone else's live hold, excluding the viewer's
own — so a held role reads as taken
to other players and available to its holder.

### The Leader Whitelist

A role with `whitelist: true` in `docs/roles.yaml` — carried into the DB as
`Role.requiresWhitelist` — needs the **Whitelist** Discord role
(`LEADER_WHITELIST_ROLE_ID` in `db/lib/roleIds.js`, checked by
`web/lib/discordGuild.js#isLeaderWhitelisted`). Not `leader: true`: the two
were split, because "the Baron has to lead the Court" and "who may claim this
seat" are unrelated questions. Every `leader:` seat happens to carry
`whitelist:` too, but Arbiter, Meister and Hand are whitelisted without
leading anything. Without it the card renders
disabled, exactly like a role at capacity, and with no explanation — the
reservation is explained once in `#info`, not repeated on every card.

Same shape as every other gate here: the disabled card is presentation, and
`createCharacter` re-checks before it writes. Superadmins bypass.

The requirement is **not** switchable. `GameConfig.leaderWhitelistEnabled` was
a Dev Panel switch; it is an orphan column now, and the gate is simply always
on.

### Which seats a look reads

`examine_visible` in `docs/roles.yaml` — `Role.examineVisible` in the DB —
decides whether examining somebody prints their role. It defaults to **true**,
which is the opposite of every other flag in that file, and on purpose: nearly
every seat here is a public office, and the Bishop, the Sheriff and the
Innkeeper are known to be what they are. Four carry `examine_visible: false`:
**Brigand Leader, Brigand, Tribunal Ordinator and Tribune**, the seats that live
on not being known.

An opaque seat reads as **nothing at all** — not "Unknown". A hidden role and a
character with no role look identical, the same way a Desire nobody may read is
absent rather than blanked. A hooded character prints no role either, whatever
their seat, alongside printing no name and no appearance.

The title printed is `Character.roleTitle` — the character's own, which a GM may
hand-edit to "Disgraced Knight" — and the seat's flag only decides whether it is
read at all. It is frozen onto each line the character says
(`db/lib/examineSnapshot.js`, `PROXYING.md` §4a), so a look answers for the
moment that line was said, and an opaque seat's title never enters the frozen
payload in the first place.

**The same split decides a name's colour.** A speaker's name in the feed and in
Chat's people column is painted by their role GROUP — six coloured estates, with
Outsiders and Elsewhere wearing none (`db/lib/roleGroups.js#roleGroupHue`,
`DESIGN-SYSTEM.md` §2). That is not a second rule to keep in step with this one:
all four opaque seats live in those two uncoloured buckets, so a colour can never
name one. `db/test/roleGroupColour.test.js` fails the build if a re-bucketing in
the YAML ever breaks that, which is the only thing holding it.

None of this reaches a GM: the ⚜️ dossier and `/gm/players` print every role.
It is also deliberately absent from the creation picker and the role charter —
"this seat is opaque to a look" is exactly the hint you do not want printed
beside the four seats that carry it.

### The starting package

Picking a role decides almost everything:

- `zoneId` — from `starting_zone` (a Zone **slug** from `docs/zones.yaml`).
  `createCharacter` then calls `syncCharacterZoneRole(uid, null, zoneId)`, and
  **that role is the character's whole Discord channel access** — there are no
  per-Location channels and no per-member overwrites to grant any more
  (`CHANNELS.md` §3). A `starting_zone` must be a *presence* zone: the Caves
  group is a container, not a place, and the role sync refuses it.
- `isLeader` / `isTreasurer` — from `leader: true` / `treasurer: true`.
  These were once entries in `starting_tags`; they're booleans on
  `Character`, not Tags (`TAGS.md` §6).
- `starting_tags` — granted free, as `CharacterTag` rows with source
  `GM_GRANT`, on top of anything bought.
- `bank_account` — opens a `BankAccount` fingerprinted to the new character:
  `treasury` for nearly every seat (hard-backed by the real `obol` tags in
  the Keep's Vault), `offshore` for the Merchant and his Dockers (no vault
  behind it). Absent for the Black Hills — the Tribunal and the Brigands
  arrive with no account at all, and open one later at the counter's
  **Create an account** button, the same as any spawned antagonist. The
  account itself opens EMPTY; a starting purse is physical `Obol xN` tags
  from `starting_tags` instead, because a seeded balance on day one would be
  a claim with nothing behind it. See `DEPOT.md` §0g.

The sync **throws** on a `starting_tags` name that isn't in the catalog or a
`starting_zone` slug that isn't a standable zone, rather than half-applying. A
typo can't ship characters missing part of their package.

One thing arrives on top of the YAML package, in `createCharacter`:

- **The map they wake up with.** `db/lib/startingMemories.js` says which
  Locations each seat is made already knowing, and `seedMemories()` writes
  them. See `MAP.md` §6a.

There was a second, and it went with the Commoner role: a Commoner who picked
no trade was granted the Farmer kit, because the three `commoner-*` kits were
point-buy tags gated on that role and nothing forced a choice. The role, the
kits and the fallback are all gone.

## 3. The point economy

```
budget = GameConfig.startingTagPoints      (default 8, live on /gm/dev)
       + role.extra_starting_points        (Outsider +4; no other role sets it)
```

There is no Cursed discount any more. It used to take 6 off and cancel the
role's bonus; a cursed player now makes no character at all (§4), so there is
no cheap character left to price.

`web/lib/characterCreation.js` holds this arithmetic, and is imported by the
wizard, the server action, and the GM panel so the number a player is shown
and the number the server enforces cannot drift apart.

`Tag.pointCost` is **signed**. Positive costs points; negative *grants* them
(the drawbacks, Old and Frail at `-5` each). Summing signed costs means
both directions fall out of one subtraction, and `remaining >= 0` is the only
completion rule. Every negative-cost tag is `purchasableAfterStart: false` —
a drawback you could buy mid-game would be a point farm.

Drawbacks face **two** ceilings, and a build stops at whichever it reaches
first: at most `GameConfig.maxDrawbackTags` of them may be bought (**6** by
default), claiming back at most `GameConfig.maxDrawbackPoints` points in total
(**8** by default). The point cap matches `startingTagPoints` exactly: you can
never claim back more than you started with. Both dropped together on
2026-09-16, from 13 and 12. Both are live on `/gm/dev`. Either alone leaves a
hole: a count cap spends the same slot on a −1 as on a −11, and a point cap
alone never stops a pile of small ones. The role's own starting tags land as
`GM_GRANT` and never pass through the purchase path, so the Meister's free
Frail and the Headman's Old count against neither. `TAGS.md` §4a is the full
rule.

Leftover points are kept, not lost: they land on `Character.tagPoints`.

Fulfilling a Desire is the only way points are *earned* in play. A
character may hold up to `GameConfig.desireSlots` Desires `ACTIVE` at once
(default 2), one per slot, each independently set/cancelled/fulfilled
(`DESIRES.md`, `REQUESTS.md` §5).
Spending happens through the `/store`'s point-buy purchases (`BUY_TAGS`),
which check the balance up front and refuse a cart that would take it below
0 — so unlike `Character.tagPoints` at creation, the in-play balance never
goes negative.

### Two menus, one component

`web/app/components/PointBuy.js` takes an `afterStartOnly` flag:

- **Creation** passes `false` — every `purchasable` tag is on offer, so a
  launch-only pick like "Secretly an Android" is available exactly once.
- **The mid-game store** passes `true` — only `purchasableAfterStart` tags.
  The component is built and shared; the mid-game route itself isn't wired up
  yet.

Tags sort by cost then name, so point-granting drawbacks lead each category.
Cost renders `+N` in `var(--accent)` (red, it costs you) and `-N` in
`var(--positive)` (green, it pays you) — `costColor()` in
`characterCreation.js`, shared with `TagChip.js`.

## 4. Cursed

`Cursed` is a **database fact**, worked out by `db/lib/curse.js`:

> A player is cursed when their **most recent body** is still lying in the
> world, and they have no living character.

Both halves are already columns, so there is no `cursed` field to keep in step
with anything. `Character.buriedAt` is stamped by `BURY_CHARACTER` and by
`ENGRAVE_HEADSTONE` and cleared on a revive; having an ALIVE character ends the
curse, because it is not meant to outlast the Bum or Migrant it forced.

**Most recent**, not "any". A player who leaves several bodies behind answers
for the last one only. Counting every body would mean that somebody whose
corpse was destroyed — butchered, or exploded by a Rite of Sacrifice — could be
locked to Bum or Migrant at −6 for the rest of the game.

`isPlayerCursed(prisma, discordUserId)` is the single answer and
`cursedUserIds(rows)` the bulk one; the bulk form is **pure over rows already
loaded**, because the two GM roster desks and the channel doctor all hold the
whole `Character` table already. `CURSE_SELECT` is exported for callers that
narrow their `select` — omit `buriedAt` and the rule reads `undefined`.

**Curse must never be read off a live Discord role.** Any failed role write —
a 429 during the grant, a GM clearing it by hand, a player leaving and
rejoining the guild — would hand out a free full-points unrestricted re-roll.
A half-configured deploy (the role env var set on one service, not the other)
makes this silent rather than loud.

The role still exists, renamed **Ghost**, and now does one job: read-only
channel access for the dead (`CHANNELS.md` §5, `db/lib/ghostAccess.js`). Its id
is hardcoded in `db/lib/roleIds.js`. **Nothing reads it to decide anything.**
The channel doctor reconciles it one-directionally, database → role, so a
disagreement costs a dead player some channels until the next pass rather than
costing them points.

**While cursed, a player makes no character at all.** `/character` shows them
the refusal instead of the wizard, and both `createCharacter` and
`reserveRoleAction` refuse independently — a server action is a public
endpoint. Only a superadmin is exempt.

This got much sharper on 2026-09-18. It used to be a discount in reverse: a
cursed player could still roll, restricted to **Migrant** or **Bum** at **6
fewer points**. Death now stops you playing until somebody does something
about your body, which is also what makes the burial verbs worth a player's
half-turn.

**Metempsychosis is the one way past it** (`db/lib/reincarnate.js`,
`TAGS.md` §4a). It leaves no body to bury and rolls the holder straight into a
new character on death, into whatever seat is open — in a full game Bum or
Migrant, since those are the only two that reopen (§"Who occupies a seat"),
but a role nobody ever took is fair game. That, rather than the +4 points it
also carries, is what the tag buys.

**Players lift it themselves, by burying the body — or, failing that, by
carving a stone.** Two requests do it (`REQUESTS.md` §5d,
[`CORPSES.md`](CORPSES.md)). `BURY_CHARACTER` needs the dead character's actual
**corpse tag**, held or lying in a room the filer can reach, and spends **half**
their Move; `ENGRAVE_HEADSTONE` is the answer to a body nobody can find,
costing 3 ⬢ and the same half a Move, and matching a **typed** first name
game-wide. Either one stamps
`buriedAt`, which is the whole of it — no Discord round trip is involved in
lifting a curse any more. That is the fiction the setting has always carried —
`docs/documents.yaml`'s Respawning entry says to wait until your body is
buried, and the Mortus role exists to do the burying.

**Butchering a corpse does not lift the curse.** Destroying a body is not
burying it, and that is exactly why Engrave exists: somebody whose corpse was
cut up and scattered has no body left to bury, and a stone is the only way out.
This now falls out of the rule rather than needing code — butchering never
stamps `buriedAt`.

**A GM overrides it from the character dev panel.** `Character.cursedOverride`
is a three-state column: `null` means "work it out", `true` and `false` force
the answer and nothing recomputes over the top. It replaces the old
narrative-punishment move of adding or removing the role by hand in Discord,
which the database taking over the truth took away. It deliberately does **not**
write `buriedAt` — stamping that to lift a curse would also take the body out of
the world, un-lootable and gone from every target menu.

(`CharacterStatus.CURSED` still exists in the enum and is unrelated — it's an
unused leftover, kept only because dropping a Postgres enum value is a risky
migration.)

## 4b. Launch gating

Character creation is behind **two independent locks**, both of which must be
open:

1. `GameState.phase` — RUNNING or ENDED (`LOBBY.md` §1). "The doors are
   open." A GM or a Playtest-role holder may also create during CLOSED or
   LOBBY, which is the lobby's Skip button. There is no separate switch any
   more.
2. The hardcoded `PLAYER_ROLE_ID` (`db/lib/roleIds.js`), or the Playtest role.
   "You are on the list."

The enforcement boundary is `createCharacter`
(`web/app/(app)/character/createActions.js`), checked **before** any point-buy
validation. `/character` additionally renders `CreationClosed.js` instead of the
wizard, so the reason is legible up front rather than arriving as an error after
four steps.

A **superadmin bypasses both** (`web/lib/superadmin.js#isSuperadmin`, checked in
`createCharacter` and mirrored in `/character`'s render so the host sees the
wizard). That's host/developer access, not a game permission — it exists so the
host can roll a test character without flipping the live toggle for everyone.
Enforcement still lives in the server action; the page-level check is
presentation.

**The gate covers character creation only.** Everything else — `/documents`
especially — stays readable. That's the point: the site goes up before the game
opens so players can read the rules.

## 5. Death

Setting a character to `DEAD` used to write a column and nothing else — it
even left `ensureCharacterRole` renaming and recoloring the dead character's
Discord role afterward. `web/lib/discordGuild.js#killCharacter`, called from
`updateCharacterRaw` on the transition **to** `DEAD`, now does the cleanup:

1. **Explicitly revokes every viewing grant** (`revokeAllCharacterAccess`),
   before the role is deleted — it needs both the role id and the Discord user
   id. It strips **every** zone role (removing one they don't hold is a no-op,
   so all six cost less than trusting possibly-stale state about which they
   held) and sweeps their member overwrites off every zone channel and the
   special channels, under either key.

   This used to be a free side effect of step 2: Discord drops every overwrite
   tied to a role the moment the role goes. That holds only while access is
   keyed on the *personal* role — a zone role outlives the character, and a
   member overwrite is not tied to the personal role either, so a dead
   character's player would keep seeing the room they died in. It sweeps
   blindly rather than trusting `Character.zoneId`, since a half-failed role
   swap leaves a grant on the zone they left and death is the wrong moment to
   trust that invariant.
2. Deletes the personal Discord role.
3. Nulls `discordRoleId` — it's `@unique`, and a dangling id would have
   `ensureCharacterRole` PATCHing a deleted role forever.
4. Grants the Ghost role — the seat, not the curse (§4).
5. Writes a `DEATH` row to the transcript (`ARCHIVE.md`).
6. Clears `CharacterTag.equipped` on every held tag. A corpse doesn't wield
   things, and a Revive later shouldn't walk back in with gear locked to
   slots that may have moved. It also keeps the loot panel (below) from
   rendering an item as if it's still worn.

`updateCharacterRaw` skips the role/zone sync entirely for a non-`ALIVE`
character.

### The corpse is lootable, the row survives

A dead character is not deleted, and their `CharacterTag` and `⬢` stay on the
row — until somebody buries them. `Character.buriedAt`, set by a
`BURY_CHARACTER` (or `ENGRAVE_HEADSTONE`) request, takes the body out of the
world: it stops being
lootable, draggable and bindable, and it drops out of every zone target menu.
Revive clears it, so a revived character is never a live person marked buried. Anyone standing in the zone the character died in can `TRANSFER_TAG`
or `TRANSFER_RESOURCES` **in the `LOOT` direction** to lift `tradeable` tags or ⬢
off the corpse — see `REQUESTS.md` §5. The `/character` page shows a "Bodies
here" panel to any living character in a zone that has a corpse; that
panel is the **only** player-facing surface that spells out that someone
died. Every other list (the transfer target picker, for one) renders a
DEAD character as a normal row with no status pill, and every GM surface
still shows the raw `status`.

### Guild-leave is no longer a death — it's a countdown

A player leaving the guild no longer kills their character on the spot.
`guildMemberRemove.js` calls `db/lib/playerDeparture.js#markPlayerDeparted`:
the character goes **Catatonic** immediately (the same tag the AFK pass
grants), `Character.leftGuildAt` and `catatonicSinceTurn` are stamped, the
personal role is renamed grey (`<name> • Catatonic`) but **kept** — it's held
by nobody, so it leaks nothing, and `@`-mentions keep resolving while the
body still stands — and the alert posts to `#leave`. Then the clock runs:
after `GameConfig.catatonicDeathTurns` turns (default 4) the Catatonic death
pass (`TURN-ENGINE.md` §2 7b) kills them at close with the full §5 cleanup.
The Cursed grant is **conditional** there, not skipped-by-rule: granted if
the player is somehow back in the guild, silently skipped if not.

Rejoining in time is a real rescue: `guildMemberAdd.js` clears
`leftGuildAt`, re-grants the Player and zone roles and the narrowcast
overwrites (Discord stripped everything with the membership), and posts a
rejoin note to `#leave` — but the character stays Catatonic until they
**act or speak in character**, at which point the flagging pass's clear
branch wakes them and nulls the countdown.

Leaves the bot sleeps through are caught at the next startup by
`bot/src/lib/leaveReconcile.js`, which diffs the living roster against
actual guild membership and runs the same departure path (alerts prefixed
`[caught at startup]`). It carries a hard rail — an empty or suspiciously
thin member fetch aborts loudly rather than flagging the roster.

Until the countdown runs out, a departed player's character is **ALIVE
everywhere**: rosters, transfer pickers, their zone. They're incapacitated
(so no day's work is open to them) and lootable-while-alive like any Catatonic
character.

## 5b. Killing and reviving from the GM panel

The Dev Character Panel (`DEV-PANEL.md`) is where a GM does this by hand, and
both directions are **microactions with a confirm**, not a `status` dropdown.

That is deliberate. Death has side effects — the whole §5 list — and a staged
form field would have to replay them at save time, which is how the old editor
ended up able to set a corpse back to `ALIVE` while leaving it with no personal
role, no channel access, and the Ghost role still on the account. Removing
`status` from the form means the panel's Apply never has to reason about a
status transition at all: it reads the live value from the database.

**Revive** is the inverse §5 never had: `removeCursedRole`, then
`ensureCharacterRole`, then
`syncCharacterZoneRole(uid, null, zoneId)` — the old zone is `null` because
`killCharacter` already stripped every zone role, so this is a pure re-grant
with nothing to move away from — then `syncCharacterNarrowcastAccess`.

**Deleting** a character is a separate, superadmin-only action, and is not the
same thing as killing them. It removes the row and everything pointing at it
through `db/lib/deleteCharacter.js`. (The `guildMemberRemove` handler used
to share it, then soft-killed instead, and now doesn't touch the row's
existence at all — leaving is a Catatonic countdown, §5.) Two
dependents are detached rather than deleted: `AuditLog.targetCharacterId` and
`Note.characterId` are nulled, because the audit trail must outlive its subject
and `Note.characterName` is already a snapshot.

## 6. Special channels (`#cerberon`)

These are the **only** per-member overwrites left in the game: zone access
rides a role now, but a special channel's grant is still keyed on
`Character.discordUserId`, reconciled after every zone change, every tag
change and on character creation. The rules themselves (who holds which radio
tag) live in one place: **`CHANNELS.md` §7**. They were duplicated here and
drifted; don't re-add them. `#intercom` is gone — the PA is a button on the
Council Room now (`CHANNELS.md` §7a) and grants nothing to anybody.

## 7. Sync order

The three YAML masters have dependencies, so order is load-bearing — this is
the order `wipeGameData`'s "Restart Game" runs them in:

```
zones  ->  tags  ->  roles
```

Roles resolve a `starting_zone` *and* validate `starting_tags`. Their delete
contracts differ and are worth knowing: zones is **fully destructive** (a
dropped Zone loses its Discord category, channels, access role and its row),
roles prunes only rows nothing references, and tags is a pure upsert that
never deletes. See `SYNC.md`.

## 8. Where the code lives

| Concern | File |
|---|---|
| Masters | `docs/roles.yaml`, `docs/tags.yaml`, `docs/zones.yaml` |
| Role sync | `db/lib/syncRoles.js`, `db/scripts/sync/sync-roles.js` |
| Which seats a look reads | `Role.examineVisible`, frozen by `db/lib/examineSnapshot.js`, read by `db/lib/examine.js` |
| Special channels | `db/lib/specialChannels.js`, `db/lib/syncSpecialChannels.js`, `db/scripts/sync/sync-narrowcast-channels.js` |
| Seat math | `db/lib/roleCapacity.js` |
| Budget/eligibility rules | `web/lib/characterCreation.js` |
| Wizard | `web/app/(app)/character/CreateCharacterWizard.js` |
| Point-buy menu | `web/app/components/PointBuy.js` |
| Creation action | `web/app/(app)/character/createActions.js` |
| Discord access + death | `web/lib/discordGuild.js` |
| Name formatting | `db/lib/characterName.js` |
| Dynasty | `db/lib/dynasty.js`, `web/lib/dynasty.js` |
| Threat catalog | `db/lib/threats.js` (see `THREATS.md`) |
| Launch gating | `db/lib/roleIds.js`, `web/lib/superadmin.js` |

## Starting obols

A few seats begin the game with coin in their pocket, so the Merchant has
somebody to trade with on turn one: Baron 25 ¢, Hand 10 ¢, Esculap 10 ¢, and
Baroness, Heir and Meister 5 ¢ each. The Merchant starts with 20 ¢ and a Depot
Keycard; every Docker starts with a Keycard. An obol is one ⬢, so those are
also the ⬢ figures.

These are authored in `docs/roles.yaml` with a **count suffix** —
`- Obol x25` — parsed by `db/lib/startingTags.js`. A bare name still means one,
which is every other entry in every other role. Repeating the name five times
could not work: `createCharacter` resolves the list with `name: { in: [...] }`,
a set lookup that collapses duplicates.

See `docs/systemdocs/DEPOT.md` §0g.


## Metempsychosis

A `mastery` tag (`TAGS.md` §4a). A character holding it who dies is rolled
straight into a new one: **a random role with a free seat,
`startingTagPoints + 4`, and no Curse.** `db/lib/reincarnate.js`.

**What it buys is the burial.** Everybody else who dies is stopped from making
a character at all until somebody puts the body in the ground or carves the
name in stone (§4). This one leaves no body to bury and waits on no mourner.
The seat it lands in is whatever is actually open, same as anyone else's — in
a full game Bum or Migrant, those being the only two that reopen on a death,
but a role nobody ever took is fair game.

**The new body is granted Metempsychosis again**, so the loop never breaks on
its own — the catalog line's "you can respawn freely and infinitely" is
literal, not flavor. Every trip through also adds one stack of
**Heightened Psychosis**, a `visible: false`, non-`mastery`, purely code-granted
counter (`docs/tags.yaml`) that nobody buys and nothing else touches:
`CharacterTag.quantity` on that tag *is* the number of lives this soul has
already spent. `db/lib/characterDeath.js#applyDeathToRow` reads the dying
character's own stack **before** the claim (and before a possible gib), the
same timing and the same reason it already reads the Metempsychosis holding
itself, and hands the count into `reincarnate()` as `priorPsychosisCount` so a
gib can never reset it to zero.

It hangs off `db/lib/characterDeath.js#applyDeathToRow` rather than off the
wizard, because **nine** callers kill people — the dying, catatonic,
ascension, nuke and turret passes, the rites, the web's own `killCharacter`,
and the staged-arbitration push (`ADJUDICATION.md` §1, `db/lib/stagedPush.js`)
— and all nine go through that one function. Hooking the wizard would have
covered one of them.

Four things worth knowing before changing it:

- **The tag is read before the claim, and off the database.** Callers pass
  `Character` rows of every shape and most carry no tags at all; a *gib*
  deletes the tag rows outright a few lines later. Asking afterwards finds
  nothing.
- **The seat is claimed under the same `FOR UPDATE` row lock the wizard
  takes** (§2). Two deaths resolving inside one turn pass must not both land
  in the last free seat. `heldSeatsByRole` + `roleCapacity` decide "full", so
  reincarnation and the assignment roll cannot disagree about it.
  **Three** exclusions: whitelisted and spawn-only (the two the assignment roll
  makes), plus the **dynasty seats**. Baroness, Heir and Successor are not
  whitelisted, so without that third one a coin flip could seat a random dead
  player in the ruling family with the Baron's surname and the seat's key —
  the largest political event in the game, with no human in the loop.
- **It builds the character the wizard would have built.** The role kit arrives
  with `expiresTurn` **stamped** (nothing backfills it, so a timed kit tag
  written without one is permanent), `Role.extraStartingPoints` counts toward
  the budget, `seedMemories` runs so the new body is not standing in a town it
  cannot see, and `discordMirrored` is carried across — read off the database,
  not off the passed row, since the nine callers select whatever they happen
  to need.
- **The player is not ghosted by their own corpse.** Both death teardowns key on
  `discordUserId`, so they reach the *person*; both now skip somebody who is
  alive again (`db/lib/deathTeardown.js#stillAlive`), and reincarnation lifts
  the ghost role itself, the way `db/lib/threatSpawn.js` does when a spawn
  brings a dead player back. It does **not** touch the Discord nickname —
  nothing in the game does any more (`PROXYING.md` §8). Renaming the account to
  the stranger the player woke up as is exactly what that removal fixed.
- **The points arrive unspent**, on `Character.tagPoints`. Skipping the wizard
  means there is no menu in which to spend them, and `/store` is that menu
  mid-game — it already spends exactly this column. No new surface.
- **The new body is a new person: name, gender and age are all rolled**
  (`rollIdentity`), and nothing is inherited from the corpse — which still
  carries its own name on itself and on its personal Discord role. The rolls
  are the same three `web/app/actions.js#startAsLocalPlayer` makes, the other
  programmatic character creator: a uniform gender from `GENDERS`
  (`db/lib/titles.js`), then a name out of `db/lib/nameCorpus.js` from the pool
  that gender names, and an age uniform across 18–65. There is no
  name-collision check because the game has none — `Character.name` is a
  denormalized display mirror, not a key, and the wizard already lets two
  players be Otto.

  Two things are deliberately **not** rolled, and either would be a bug:
  `role.lockedGender` wins over the gender roll, because three *reachable*
  seats set it (Baroness, Heir, Successor — only the Baron is whitelisted and
  already excluded), and rolling over it styles a male Baroness off the wrong
  word in `db/lib/titles.js`. And those same three wear the living Baron's
  surname, so `lastNameLocked` makes the corpus return none and the Baron
  supplies it — no living Baron, or one who never chose a name, means no last
  name, the same answer `web/lib/dynasty.js#dynastyLastName` gives.

  **The age band stops at `REINCARNATION_AGE_MAX` (65), short of the catalog's
  own `AGE_MAX` of 90**, which stays what the wizard lets a player type. A roll
  uniform across the full 18–90 averages 54, and `db/lib/concealedIdentity.js`
  reads 55 and over as "Old" — so half of every reincarnation would have woken
  up elderly, where players choosing for themselves almost never do. 18–65
  averages 41 and puts most souls in the broad middle band that gets no age
  adjective at all.

`db/lib/curse.js` is untouched: the new character is `ALIVE`, so `isCursedIn`
already returns not-cursed and the refusal never fires. The personal character role is deliberately not minted here — it is a
mentionable name token that grants nothing (`PROXYING.md` §6), the placeholder
name is about to change anyway, and the channel doctor mints any missing one on
the next bot start.

**The staged-arbitration push reincarnates a Metempsychosis holder too.**
`applyDeathToRow` runs inside the staged row's own `$transaction`
(`db/lib/stagedPush.js`), and `reincarnate()` tells that case apart from an
ordinary `prisma` singleton by checking for `.$transaction` on what it was
handed — a transaction client has none of its own — and reuses the existing
transaction instead of opening a nested one. The seat claim and the new
character/tag rows land atomically with the rest of that staged row either
way. Every other caller (the dying pass, catatonic auto-death, ascension, the
nuke, the turret passes, the rites, the web's own `killCharacter`) still
passes the bare `prisma` client, which opens its own transaction as before.

Every early return is a normal outcome, not an error: no tag, no Discord user,
another living character already, or no free seat anywhere in the game. A
player whose soul finds nowhere to go is simply dead the ordinary way.
