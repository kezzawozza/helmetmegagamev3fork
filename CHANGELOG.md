# Changelog

Every push, newest first, in plain language for the GM team. Written by
`npm run push` and mirrored to Discord — see CLAUDE.md.
`✚` new, `−` gone, `✎` changed.

Entries below predate this format and list files instead.

## 2026-09-16 · Every deploy was failing on the radio's tag

✎ The 243.000 radio declared itself tradeable, which items always are now — the tag sync refused the whole file, and that sync runs on every deploy

## 2026-09-16 · An item is always something you can hand over

✎ Anything in the Items category is now tradeable automatically, so a new item can never arrive as something nobody can give away or loot off a body  
− The Tradeable tickbox, gone from the item side of the GM tag maker  
✎ Assets still choose: a horse changes hands, a gallows does not  
✎ The Pretty Flower somebody made can be handed over now  
✎ The Packaging Equipment at the Factory can be carried off, at 40 lb  
− The Quickened Nerve-Braid, out of the game

## 2026-09-16 · Tribunal Ordinator gets Heavy Infantry Armor instead of Cataphract

✎ The Cataphract suit is out of the Ordinator's starting kit, replaced by Heavy Infantry Armor

## 2026-09-15 · The house typography rules are written down

✎ Straight quotes, the … glyph, a spaced em dash, and digits for anything a player counts or pays — the conventions the game's text already mostly followed are now stated in one place instead of being rediscovered each time  
✎ Claude may bring text you hand over in line with those conventions without asking. Your wording, structure and tone stay yours; only the punctuation and the glyphs get touched  
✎ Written down too: ⬢ and ¢ are two currencies at parity, not one with two spellings, so neither is ever swapped for the other in bulk

## 2026-09-15 · The Dev Panel's four broadcast sections are one

✎ Bulk actions now covers everything you do to a lot of people or a lot of places at once: move them, hand out Resources or a tag, send a DM, send a letter, or say a line the world says  
✚ A line can now go into several zones, streets or rooms at once, and a letter to as many people as you tick — one sender, one seal, one body, a sheet each  
− Send a letter and Say something as sections of their own, and the Quests panel's Broadcast tab. All three are verbs in Bulk actions now, and the old links still land in the right place  
✎ Characters, Factions, Tags and Zones are sections of the panel instead of pages you had to leave it for  
✎ Advertise on a quest now opens the line-writing box with its zone already ticked and a teaser written, and says so plainly when a cave has no summary channel to advertise into  
✎ The Depot and The Oracle are just Depot and Oracle, and Games is History, so it stops reading as a typo of Game

## 2026-09-15 · The death DM no longer plugs Deadchat

✎ That line existed to tell a new ghost the room was there, but it read as an ad for a room they're about to be dropped into anyway  
− -

## 2026-09-15 · Torture is worth 3 points now, not 4

✎ The Torture Someone desire was overpriced next to the rest of the cruelty ladder  
− -

## 2026-09-15 · A secret /analysis page for Desire balance

✎ A comprehensive, unlisted dashboard at /analysis: every Desire claim ever, who's claiming what, which desires are most powerful or most rejected, catalog coverage, and more  
✎ Reachable only by URL -- no login, never linked from any nav  
− -

## 2026-09-15 · The Cerberon radio is capitalized in the web's place list

✎ The radio nets show a display name on the web; their Discord channel names stay lowercase as Discord requires

## 2026-09-15 · Deadchat catches up on Discord, and a dead GM can speak there

✎ Web messages typed before Deadchat had a Discord channel are posted on the bot's next start; the outbox drains again after the mirror has built anything  
✎ A GM whose own character died gets their voice in Deadchat like any other ghost, instead of being told they are a ghost who cannot speak  
✎ A living GM reading Deadchat sees a line that says so, not the ghost line

## 2026-09-15 · Paper chips in the audit log name the right note

✎ The audit log's tag chips show a written note's words on hover — they were blank, the one desk last week's fix missed.  
✎ A note is matched by identity now, not by name. Every untitled note is called 'A Note', so the old lookup could have shown one player's letter under another's line.  
✎ An older log entry with no note recorded on it shows a plain chip rather than guessing.

## 2026-09-15 · The Tribune seat no longer runs out


## 2026-09-15 · The website is the master copy of the world now, and Discord mirrors it

✎ Zones, locations, rooms, links and stashes are edited live on /gm/dev/zones. The old zones sync is gone; zones.yaml is only an importer that adds what is missing and never deletes  
✚ A Discord mirror that rebuilds any missing category, channel, role or thread from the database, adopting a same-named one before it ever creates one. Preview it and press Reconcile now on /gm/dev  
✚ db:mirror and db:import-zones; the channel doctor now runs through the mirror  
✎ Playing on Discord is opt-in per character. Existing characters keep whatever they had; new ones start web-only and flip the Play on Discord too switch on /character. GMs can flip it from the dev panel  
✎ Restart Game keeps every Discord channel, role and thread and only clears messages  
✎ Deleting a place is a soft retire by default; a hard delete is superadmin-only and lists everything still pointing at it

## 2026-09-15 · The intercom draws full size and bold on web now, not as scenery

✎ The intercom announcement used to render in Chat as tiny grey scenery text, the same as a gate crossing or a smell. It now shows bold and at regular size, matching how loud it already was on Discord

## 2026-09-15 · A soul reborn mid-close no longer pays upkeep for a turn it never lived


## 2026-09-15 · Remove Corrupt from the two Brigands who bought it before the role gate

✎ A one-off script, db/scripts/ops/revoke-brigand-corrupt.js — Dunkin D and John Johnson had it from before Corrupt's Desires were role-gated. Removed, no point refund, each player DMed

## 2026-09-15 · Corrupt keeps Sheriff and Censor, both — not a swap

✎ Corrupt's five Desires ask for Cerberus, Sheriff, Censor or Incarn. It never made sense to drop Sheriff; only Censor was missing

## 2026-09-15 · Written notes are legible again, and stop hiding from their owners

✎ A note, letter or book a player wrote now shows its words when a GM hovers it — on the turns desk, the inspector and the dev panel alike. They had all been blank.  
✎ Notes, corpses, crates and photographs now appear in a character's Things drawer. They were missing from it entirely, so nobody could hand one over or throw it away.  
✚ The tag pickers have a Minted tab, so player-written notes stop burying the catalog

## 2026-09-15 · The bot recovers on its own from a broken Discord login

✎ Metempsychosis's description now tells a respawned player what they keep and what they lose  
✎ A flaky Discord connection at boot used to leave the bot silently unable to send anything — connected to the gateway but mute — until someone noticed and restarted it by hand. It now retries its own login with backoff, and restarts itself cleanly if it ever ends up in that broken state again

## 2026-09-15 · You can ask to search somebody

✚ A Search button, on the character sheet and on a person's row in chat. You ask to look through what they are carrying, and they say yes or no.  
✚ Before they answer they get one chance to hide things. Whether that works is a roll nobody is ever shown — and hiding one thing works better than hiding five, which the game says out loud since no player could work it out.  
✚ An "Automatically search?" box on Intercept, so a watch at a gate also asks to search whoever it stops. It buys the ask and never the answer: they can still say no, and they still get to hide things first.  
✎ You can search somebody in a hood, and every line still calls them what you saw. A hood hides who you are, not what is in your pockets.  
✎ Once per person per turn, and saying no uses it up — so asking is not free.  
✎ Anything worn or carried openly is found whatever the roll says, and the readout says which half was never at risk.  
✎ A pending kiss or a pending offer of a ride that nobody answered used to be reported at turn's end as an unanswered offer to teach a skill. Both say the right thing now.  

## 2026-09-15 · The dead get a room, and burying somebody no longer cuts them off

✚ Deadchat: one channel the dead talk in, on the website and on Discord. It is the only place a ghost has a voice, and nobody living can see it or hear it.  
✎ Burying a body or carving a headstone still lifts the curse, but it no longer takes away that player's view of the game. Only rolling a new character ends it now.  
− The Ghost role. Discord prints a player's roles on their profile card, so clicking a name told you they were dead.  
✎ Dead players watch from the website now. On Discord they see Deadchat and nothing else.  
✚ Ghosts can Examine people again. They look as the body they died in, and the dark does not stop them — though they cannot take photographs.

## 2026-09-15 · The Automatically ride my mount switch is gone

− The switch on the character sheet that put your horse and cart back on when you arrived somewhere. Mounts left outside now stay stowed until you equip them yourself

## 2026-09-15 · Chat's line sheet is just its verbs, and every label is sentence case

✎ The ⋯ sheet on a line has no title now, just Change, Delete, Look at, Photograph, Save to Notes. Take back is called Delete  
✎ Every button, tab and dialog title a player reads is sentence case now: Lock in, Learn skill, Add member, Price list and the rest. Names and the game's own terms keep their capitals: Notes, Bascinet, Move, Desire, Tag Points

## 2026-09-15 · Chat on a phone: one size of button

✎ Every button in Chat is one size on a phone now: 44px to tap, chips at 36. The head's three buttons, the composer's ⊕ / box / ➤, the tabs, the section headers and the drawer rows all match  
✚ Tap ⋯ on a line to change it, take it back, look at it, photograph it or save it to Notes. On a desktop the hover bar is unchanged  
✎ The right drawer is titled with the place you are reading, not 'Here'  
✎ Cancel stands as tall as the button beside it, in Chat and in every dialog  
✎ The YOU tab reads as one card: the turn is a line of text, Move… takes the full width, Things and Desires fold the same way, and each Desire slot is labelled  
✎ The places list is names only, with one mail mark on Bascinet. The Here section is called Location  
✚ The stat tiles on the Character page fit a phone screen instead of running off the edge

## 2026-09-15 · Chat's place list is split by zone now, the way Discord splits by category

✎ The Chat column groups everywhere you can read by zone, under a divider carrying the zone's name — TOWN, FORTRESS, and so on  
✎ Bascinet, the radio frequencies and your faction stay pinned at the top, above the zones, since none of them is a place on the map  
✎ Summary, Here, Rooms and Conversations read the same as before, just inside their zone's group now  
✎ A GM or a ghost watching every zone at once used to get one flat run of every Location in the game under a single "Here" heading, in alphabetical order  
✎ The zones sit in the order the map is written in, matching the Discord category list rather than the alphabet  
✎ A Location row no longer repeats its zone ("Town · Cathedral" is just "Cathedral") — the divider above it says so  
✎ Folding a section is remembered per zone, so shutting Town's Rooms leaves Fortress's open  
✎ A player standing in one zone sees no divider, and their column is unchanged

## 2026-09-15 · Sake pays more, and alcoholics get a tasting Desire

✎ Drink sake is now worth 3 points  
✚ A one-time 5-point Desire for alcoholics: sample Alcohol, Sake, Moonshine and Ravenheart Red

## 2026-09-15 · Muffled shouts garble the same everywhere

✎ A shout heard from two places away now blanks the same letters on Discord and the web, so comparing the two no longer fills in the gaps

## 2026-09-15 · Dungeons and the Shackle button

✎ Dungeons stand in the Cathedral, the Garrison and the Lifeweb; nobody can build them  
✎ A Shackle button there turns a Bound person's ropes into shackles, for good; anyone can do it and it costs no Move  
✎ Shackled is Bound in every way, but only an Escape Artist can break free: a 6 the first turn, then one easier each turn  
✎ Free still cuts shackles off

## 2026-09-14 · Breaking free now takes effect at the end of the turn

✎ A successful Break Restraints tells you so now, but you stay Bound until the turn closes  
✎ Someone cutting you loose with Free still frees you at once

## 2026-09-14 · The musketoon always shows on a look

✎ It is too big to hide in a bag

## 2026-09-14 · Only big gear shows when someone looks you over

✎ Hoods, masks, helmets, robes, one-handed swords, the shortbow and small guns now only show while you have them on  
✎ Mounts, heavy armour, shields, long weapons and banners still show either way

## 2026-09-14 · Breaking free is harder

✎ Break Restraints needs a 6 the turn you're tied up and a 5 or 6 the next; from the third turn it always works  
✎ Escape Artist needs a 5 or 6, then a 3 or better  
✎ Giant no longer makes breaking free easier

## 2026-09-14 · Streets you are only watching are read-only on Discord too

✎ A street you walked out of this turn no longer lets you post in its Room threads or react there  
✎ The channel doctor repairs the watching permissions already handed out

## 2026-09-14 · Small items no longer show when someone looks you over

✎ Cameras, food, drink, books and pocket gear are hidden from a look  
✎ Clubs, whips, the Disabler and other short weapons only show while they are out

## 2026-09-14 · Bound characters can take a Gambit

✎ Bound, Crucified and Catatonic characters can file a Gambit now; only Unconscious, Paralyzed, Seizure and Dying stop one  
✎ Routine and Labor are still off-limits while tied up  
✎ A Gambit and Break Free share the one Move each turn

## 2026-09-14 · Learn and Teach no longer show other people's skills

✎ Learn Skill lists everyone here and the skills you could learn; Teach lists everyone here and the skills you know. Nobody's sheet is shown  
✎ The roll you need is shown only after the lesson is accepted  
✎ Asking someone who doesn't know the skill still sends the offer; they can only decline, and you just see that they declined

## 2026-09-14 · Hooded people no longer show up in Learn Skill and other people lists

✎ Someone in a hood that hides the face (a Cerberus Helmet, a bag, a plague doctor mask) was still listed by real name in Learn, Teach, Heal, Kiss and the other pickers; now they are hidden like anyone who used /conceal

## 2026-09-14 · Handing someone goods tells them who handed it over

✎ "You were handed X." now reads "Ada handed you X.", or "A young man handed you X." from a hood

## 2026-09-14 · You keep seeing where you have been this turn

✎ You go on reading every place you walked into this turn, and its public rooms — but only to watch: you cannot speak or react there until you walk back in  
✎ Leaving the zone closes all of it at once, and so does the turn shift

## 2026-09-14 · Claiming a Desire from Chat works again

✎ The claim box on Chat now asks how you pulled it off; before, every claim there was refused  
✎ A page left open across a deploy no longer crashes to 'That page didn't load' when you claim a Desire  
✎ After a deploy, an old open page reloads itself instead of breaking

## 2026-09-14 · Anyone can teach now

✎ You no longer need the Teaching tag to teach — anybody can pass on a skill they hold, but it takes their whole turn and the student needs a 6  
✎ The Teaching tag costs its holder no Move at all now, carries up to three students a turn, and their students learn on a 5 or 6 — so a teacher can labor or travel and still teach  
✎ A Drill Instructor's students still succeed on a 4 on a fighting skill  
− Teaching (Lecturing), folded into Teaching itself. Nobody was compensated, but existing holders get moved onto plain Teaching rather than losing the lot  

## 2026-09-14 · The online ring is thinner, quieter, and matches the theme

✎ The green glow around an online player's face is now a thin, plain ring in the theme's accent colour

## 2026-09-14 · Travel offers no longer read as lesson offers

✎ An offer to take someone along showed up on the web as a lesson offer, for both people  
✎ Accepting a travel or kiss offer from the web's waiting list could run it as a lesson; it now does the same thing as the DM buttons

## 2026-09-14 · Accepting a ride works again

✎ Accepting an offer to travel with someone failed with "Could not reach the server"; picking someone up to bring along failed the same way

## 2026-09-14 · A horse and cart can ride indoors now — except underground

✎ A horse or cart no longer gets parked at the door of the Cathedral, Sanctuary, Inn or other surface buildings  
✎ Underground, in the Caves and the Depths, a roof still leaves your mount outside, same as before  
✚ The Square now connects directly to the North Gate and the Underquarter, so leaving town north no longer strands a cart in the Cathedral or Sanctuary

## 2026-09-14 · Sing when your hands are empty

✎ /play now works without an instrument too — a character with none sings instead  
✎ A Musician's singing settles the room for +8 (Pythagorean: +32), the instrument's own +10/+40 unchanged

## 2026-09-14 · Fix a bot-crashing syntax error from the last dead-exports sweep

✎ The bot was down: a comment got mangled into a stray statement in proxy.js, and the bot crashed on every restart

## 2026-09-14 · Retire the deferred-travel drain and other code nothing calls

✎ The old deferred-travel arrival pass and every write to the journey columns are gone; every crossing has landed at once since the map change  
− Fifteen exported helpers nothing referenced  
✎ The bot's interaction handlers are now one module per domain, with no change to any button or command

## 2026-09-14 · A branding iron, and a fix for the Mulligan Potion's Use button

✎ A smith can craft a Branding Iron; holding one opens a Brand button on anyone bound or incapacitated here — free, permanent, a -40 mood hit  
✎ The Mulligan Potion's Use button was missing from the sheet; it's back

## 2026-09-13 · Black Robes no longer cost a Move to craft

✎ A Thanati can now put on their Black Robes for free -- no more spending a whole Routine just to dress for the rite

## 2026-09-13 · Obols are now a taxable currency

✚ A faction Leader or Treasurer can now tax a member's Obols, alongside Resources  
✎ The faction roster and silo now show each officer an Obol count next to the ⬢ figure

## 2026-09-13 · Obols in smithing, key-copying, and staged deaths

✚ Smiths can now put their held Obols toward a smithing recipe's cost, mixed with the usual ⬢ payer  
✚ Skilled Blacksmiths can now copy almost any key in the game -- hold it, keep it, walk away with two  
✎ A faction invite no longer mints a new recruit every tradeable key on the silo's door  
✎ The labor-drops audit no longer corrupts its own price comment when a price changes  
✚ GMs can stage an instantaneous character death from the turn desk  
✎ A staged death now properly reincarnates a Metempsychosis holder instead of quietly skipping it

## 2026-09-13 · Documents and labor drops also sync by themselves on every push

✎ The documents list and the labor drops now update on their own when a push deploys, alongside tags and desires  
✎ Zones and #info still need a hand sync

## 2026-09-13 · Tag and desire edits reach the live game on every push

✎ Changes to the tag and desire lists now apply by themselves when a push deploys, no hand sync needed  
✎ Zones, documents, labor drops and #info still need a hand sync

## 2026-09-13 · Pushes rebase first and refuse to undo other sessions' work

✎ A push now lands on the newest master instead of overwriting whatever another session just shipped  
✎ A push that would delete lines somebody else added in the last two days stops and names them  
✎ Pushing from the shared checkout is refused while other sessions have their own worktrees

## 2026-09-13 · Chat reads all the way back, not just the last hundred lines

✎ Scrolling up in a room keeps loading what was said before, instead of stopping at the last hundred lines  
✎ The top of a scene says whether that is the beginning of the place, or a turn wipe with the archive behind it  
✚ A bigger send button when writing to Bascinet on a phone  
✎ The slash-command menu no longer runs off the side of a phone screen

## 2026-09-13 · Butchering a person now takes their organs too

✎ Butcher gives up every organ Mutilate hasn't already taken, not just Human Flesh  
✎ A body already missing a part from Torture or Mutilate won't hand out a second one

## 2026-09-13 · Arelitz Breeding's recipes stay hidden until you have the mastery


## 2026-09-13 · Lavish and Fine Meal cook with any real ingredient again

✎ Deep Morel, Tea, Honey, Sweets, Fish Roe and 40 others are legal meal ingredients again  
✎ Naming a meal you cooked is free again, and the ingredient contributes its mood again

## 2026-09-13 · A sealed letter keeps its name

✎ Sealing a letter no longer throws away what the writer called it — a closed letter now reads its title first and the wax after it, so a courier carrying two of them can tell which is which without opening one  
✎ Breaking the seal puts the bare title back on the sheet  
✚ If a letter reaches you with no name on it, the Seal dialog now lets you write one on the outside as you close it  
✎ Letters sealed before today have no title stored and read as they always did

## 2026-09-13 · Stops on the road no longer ping the GM inbox

✎ Being intercepted or ambushed now arrives as a game notice, not as mail for the GMs

## 2026-09-13 · Medics and butchers can Mutilate

✎ Any Medical skill or Butcher now shows the Mutilate button, alongside Cruel, Torturer and Thanati

## 2026-09-13 · Purse says how many resources you got

## 2026-09-13 · Four tags say their rules again

✎ Iron Liver says it takes two more drinks to move you a rung  
✎ Cruel says your torture rolls get +1  
✎ Brave says everything frightens you half as much  
✎ The Fishing Boat says it can't be out with a horse or a cart

## 2026-09-13 · GMs can check Desire claims

✎ Claiming a Desire now asks you to say how you pulled it off, and the answer is required  
✚ A Desires tab on the turn desk, listing every claim with the reason beside it  
✚ Tick a claim to mark it looked at, or reject it to take the points back and reopen the slot  
✎ A rejected claim tells the player, and the slot's lock lifts with it

## 2026-09-13 · Maggot Milk's recipe is public knowledge now

− Any Brewer should know you can squeeze a Purring Maggot without having found one first, so it no longer waits on holding the ingredient to show up on the Craft menu.

## 2026-09-13 · Curing Poisoned no longer leaves you Drained

✎ Being cured of Poisoned now just ends it, with no Drained afterwards

## 2026-09-13 · Poisoned lasts two turns and no longer leaves you Drained

✎ Poisoned now lasts 2 turns instead of 1  
✎ When Poisoned runs out on its own it just ends; being cured of it still leaves you Drained

## 2026-09-13 · A long message splits instead of bouncing

✚ The chat box counts as you approach the limit, then says what it will do: "sends as 2 messages"  
✚ Over 2000 characters a message now goes out as up to three, split between lines rather than through one. A list of goods no longer has to be posted by hand in pieces  
✚ Past three messages it is refused while you type, not after you press Send — which is what went wrong before: the refusal was the first anyone heard that a limit existed

## 2026-09-13 · Everything the patch-notes push accidentally wiped is back

✎ The nine new Depot items work again: Coffee, Bar Soap, Black River Mud, Perfume, Ravenheart Map, Pointer Device Kit, Ration Box, Box of Junk, and the ~5% medical, smithing and brewing price trims  
✎ Opening a Box of Junk or a Ration Box now tells you what you got  
✎ The audit log names who moved what again, and GMs can filter it by room  
✎ The custom tag dialog can set a weight again  
✎ Incarn can have corrupt desires again  
✎ One Caving Die warning on a crossing, not two  
✎ A GM's scenery line reaches the website again, not just Discord

## 2026-09-13 · Talking through a gate

✎ Speech in a public room at either end of a gate (Fortress Gatehouse, both Town gates, Customs) is now heard in the public rooms on the other side, as the speaker, in small text  
✎ Who's here? and the web people list now show who is standing on the other side of a gate, under that place's name

## 2026-09-13 · Quests: GMs can stage a room anywhere without a deploy

✚ A Quests panel on /gm/dev with three tabs: the quests themselves, every noticeboard in the game, and a line into any zone's #summary  
✚ A quest is a room you put anywhere — usually a cave — with one button on it. Pressing Interact spends that character's Move for the turn as a Gambit, and it lands on /gm/turns like any other  
✚ Quest gates: a required tag, or a GM naming people by hand. Set either and the room goes private  
✚ An expiry in turns. A quest nobody closes blows away the way a notice does — the room goes, the record of who touched it stays  
✚ Advertise, on a quest, jumps to the broadcaster with its zone already ticked

## 2026-09-12 · Soundproof rooms are soundproof again

✎ A shout inside one of the eleven sealed rooms — the Oubliette, the Dungeons, the offices, the Sewers — stopped leaving the room again. It had been carrying out to the whole zone since 12 September  
✎ The rooms' starter posts say **Muffled**: shouts do not carry out of here once more

## 2026-09-12 · The Economy panel is finished

✚ Flows: where every ⬢ comes from and goes, as one diagram, plus a web of who actually trades with whom  
✚ Faucets and Sinks: every source and every drain, turn by turn. The Spillway and an overdrawn purse get their own panel, since those destroy ⬢ rather than spend it  
✚ Goods: what a ware costs, what it sells back for, how many exist and how often it trades. Flags anything nobody has ever bought, and in red anything whose round trip would print ⬢  
✚ The Depot: the station's account, the Company's line against its cap, what is in flight, and the balance of trade per turn  
✚ Factions: what each silo holds and what moved through it this turn  
✎ Labor drops show what they actually paid. For what they were designed to pay, run db:audit-labor-drops — the panel will not invent that number

## 2026-09-12 · The chat feed fills its column again

✎ The scene stretches to the full width of the middle column. It was capped at 70 characters, and because the cap is left-aligned every spare pixel piled up on the right, so the page read as split down the middle with the right half empty

## 2026-09-12 · The chat rail's chips say what things are

✎ Hovering a paper in the chat panel now shows what it says — on the floor, in your pockets, and on a GM's column  
✎ Hovering a tag shows its real details: what it does, how long it lasts, what cures it  
✎ A sealed letter still shows only its seal, and somebody who cannot read still cannot read. A GM reads everything  
✚ The GM's chat column is back — who is standing there, what is stashed, and which ways out are shut

## 2026-09-12 · Editing a Gambit on the desk works again

✎ Changing a Move to a Gambit on /gm/turns was throwing an error instead of saving. Inspired was taken out of the game a while back and the desk was still reaching for it

## 2026-09-12 · Where the money goes, on a page

✚ An Economy panel at /gm/economy: what the town is worth right now, what it minted and burned this turn, who is hoarding, and a searchable book of every ⬢ that moved  
✎ Every ⬢ that moves is now written down — labour, the Depot, hand-overs, hunger, tax, the cult. Nothing in the game plays differently  
✎ The Spillway and an overdrawn purse used to destroy ⬢ with no trace anywhere. Both leave a record now, and the panel shows them  
✎ The panel checks itself: if what the book says an account holds does not match what it actually holds, that is on the front page  
✚ A Health section listing anything moving money without saying so, which is a to-do list rather than an error  
✎ The books only start today. Run db:backfill-economy to reconstruct what it can from the audit log; what it cannot is labelled rather than guessed

## 2026-09-12 · A bird's letter can be answered from the web

✎ Replying to a letter no longer needs Discord — the Reply is on the web too  
✚ An Answer a letter dialog, on your sheet, in Chat's ✉ menu, and on the letter itself  
✎ The bird still waits on an answer row now opens the reply, instead of the Send Bird dialog  
✎ A letter whose bird has already gone no longer sits on that list as a job you cannot do

## 2026-09-12 · Patch notes get their own Discord thread

✚ A /patchnote script that posts player-facing notes into a dated thread in #patch-notes  
✎ The words are never AI-generated -- the script refuses without a heading and at least one note

## 2026-09-12 · Eleven rooms go soundproof, for real this time

✚ Eleven rooms are soundproof — a shout inside them stays inside them

## 2026-09-12 · Crossing into the Caves warns you first

✎ A crossing into Caves or Depths now warns you the Caving Die will roll on every step, before you commit the travel  
✚ The Incarn role can now pick up the corrupt-only Desires the Cerberus and Sheriff already had  
✎ Fixed a grammar slip in the Shroom Mound's description

## 2026-09-12 · Name who moved what, and let GMs filter the audit log by room

✎ Transfer and pickup rows in the audit log now say who took/left/ handed what, and to or from where  
✚ Location and Room filters on /gm/audit, and on the CSV export

## 2026-09-12 · The caving 1 lock releases automatically again

✎ Rolling a 1 in the caves still locks you in the zone, but it no longer holds forever — if nobody adjudicates it, the lock lifts on its own at the turn's end, same as before.


## 2026-09-12 · A caving 1 pins you until a GM resolves it, push or no

✎ Rolling a 1 in the caves used to lock you in only until the turn ended — the push auto-resolved every unresolved TROUBLE roll and the hold lifted with it. Now nothing resolves a roll but a GM's Mark resolved, so the hold survives the push and holds indefinitely until adjudicated.  
✎ A stale unresolved roll now rides the live Caving lens regardless of which turn it belongs to, and can still be resolved from History — the one thing that made the old auto-release necessary in the first place.

## 2026-09-12 · Price trims across medical, smithing and brewing, and nine new Depot items

− Coffee actually cures Tired now, and costs a little more for it  
− Bar Soap removes Unhygienic outright  
− Black River Mud grants Inspired — your next Gambit rolls with advantage, spent the instant it wins one (db/lib/advantage.js's Lucky mechanic, minus the permanence)  
− Perfume grants Alluring Scent  
− Ravenheart Map reveals every surface Location at once  
− Pointer Device Kit mints a linked pair that always know where the other one is  
− Ration Box opens into one of five bad meals, or nothing at all  
− Box of Junk grants 0-4 ⬢, randomly

## 2026-09-12 · Canned Crabmeat joins the Merchant's shelf


## 2026-09-12 · Low-tier consumables drop a obol at the Merchant


## 2026-09-12 · Pain Shock and Cripple can't cross a zone for free

− A dazed Pain Shock and a legless Cripple lose the free zone crossing, same as Crippled Leg and Missing Leg already do — they can still act, fight and walk a zone freely, but crossing into another one costs the Move unless someone rides or escorts them  
− Both tags' descriptions now say so

## 2026-09-12 · Merchant buy prices cut ~7% across the board


## 2026-09-12 · Arelitz Breeding is a mastery skill, not a starting one


## 2026-09-12 · Arelitz breeding is gated behind a skill now


## 2026-09-12 · Fertilizer is worth twice as much now

✎ Fertilized Fields gives farming +8 ⬢ instead of +4, over the same two turns

## 2026-09-12 · An arterial bleed kills you the same day now

✎ Arterial Bleed, Phrygian Toxin and Crucified now kill at the end of the turn you take them, instead of spending an extra day on death's door first  
✎ Every wound, illness and treatment clock comes down a rung — most two-turn tags are one turn now, three are two, four are three  
✎ An untreated deep wound goes septic overnight. A sprained ankle is three days instead of four, a bandage two instead of three  
✎ Infected to dead is five turns now, not six

## 2026-09-12 · Oracle: staged narration reaches it, and cave levels stop vanishing

− A GM's own turn narration (StagedMessage) and its mechanical effects (StagedEffect) were never read at all. A PRIVATE staged message goes out as a DM with no room trace and no ArchiveEntry, so a landmine narrated that way was invisible to the chronicle by construction. Both are now windowed the same way beats/chat already are, into a new STAGED section.  
− Character.zoneId is presence-level (six zones, including the two cave LEVELS, Caves and Depths), but the seat a correspondent writes for is the cave GROUP, Underground — a `parentZoneId` relationship (db/lib/seatZone.js). Every zone-equality check in oracleInput.js compared the raw zoneId directly, so anyone actually standing in the Caves or Depths was invisible to the Underground page: not in its roster, its moves, or its chat. Now resolved through Zone.seatZoneId everywhere a zoneId is compared. The /gm/oracle rail's per-zone headcount had the identical bug and is fixed the same way.

## 2026-09-12 · Spectacles cost 6 obols at the Merchant now, down from 25


## 2026-09-12 · Giant is creation-only now


## 2026-09-12 · Oracle: a page-less zone stops borrowing someone else's chronicle


## 2026-09-12 · Fix the five Trinket ingredients missing their inlayValue


## 2026-09-11 · Appraisal: see an item's worth in obols

✎ New skill, Appraisal (1 pt): shows a tag's worth in obols on its tooltip  
✚ Merchant, Arbiter, Baron, Docker, Geschef, Banneret, Innkeeper start with it  
✚ The Manor Lord and Court Artist courtier kits grant it too  
✎ Radio's price corrected to 4 points

## 2026-09-11 · Sickle and Horseshoes join the smith's ladder

✚ Sickle: Dead Simple, +1 ⬢ to farming labor, a very small melee edge  
✚ Horseshoes: Moderate, gives a Horse one extra free zone move

## 2026-09-11 · Flatten the crafting wage curve, and lift the middle of it

− The ladder now pays 9, 10, 16, 18 and 22.5 a turn from the quick pieces up to gunpowder, where it used to run 3 to 15 — two and a half fold instead of five, so the early rungs are somewhere you can work rather than somewhere you pass through  
− Moderate and High Quality got the most; the small stuff a little  
− The top of the ladder did not move — everything under it came up

## 2026-09-11 · Intercept no longer needs an unspent Move

− The refusal on laying in wait once your Move is filed

## 2026-09-11 · Smiths and crafters get paid about a quarter more for everything

− Every sell price on the smithing and crafting ladder is up ~25%, so a day at the anvil is worth having against a day in the fields  
− The bottom of the ladder got the most: a Dead Simple piece now clears 2 instead of 1, and the Simple rung sells at 12 rather than the 11 the multiplier gave, so the quick pieces beneath it cannot out-earn it  
− Trapping Gear keeps its wage floor at 20 rather than falling to its rung's 12

## 2026-09-11 · Fewer boxes doing the same job on the GM desks

✎ The Players desk has two search boxes instead of four: Search inbox on the rail and Filter roster on the roster  
✎ One bulk-message form, wherever you start it from — the roster's Message selected now opens the same composer as the header  
✎ The roster's Cursed, Catatonic and Acted columns fold into one Flags cell, and Acted becomes a filter  
✎ The Players page no longer grows a phantom page scroll under the roster  
✎ The History lens picks what it shows and which turn on one line  
✎ The effect composer is grouped under headings with its buttons pinned at the bottom  
✎ The Oracle header says when the chronicle was last written  
✎ /gm/dev/threats links land on the assignments section instead of a 404

## 2026-09-11 · The GM desks read top to bottom

✎ The Move desk now puts the Result box front and centre, with the header's four look-alike buttons folded into one menu  
✎ The staging buttons live in one strip and Preview push in one place, instead of three copies and two  
✎ Staged rows are two calm lines instead of eight things on one  
✎ Both rails get to the first row after two lines of filters, not five  
✎ Pressing Escape closes an open composer first; a second Escape closes the Move  
✎ With nobody picked, the inspector shows where the desk stands — open, solved, staged, who has not acted  
✎ The audit search filters as you type, and the character dev bar's thirteen icons sit in five labelled groups

## 2026-09-11 · A drink is a nudge now, and Drunken Master finally pays

✎ Tipsy costs half a tier instead of a whole one, Wasted 1.2 instead of 2, a Hangover half a tier  
✎ Drunken Master is worth +1.9 tiers whenever there is a drink in you, so Tipsy lands at +1.4 and Wasted at +0.7 — it used to key on Tipsy alone, cancel it to exactly nothing, and go dead entirely on the second drink  
✎ The rungs stop stating their own number, since what a drink costs now depends on who is drinking it

## 2026-09-11 · A tag mentioned inside another tag is readable again on your sheet

✎ Opening a tag on `/character` that mentions another tag (a wound's cure, a poison's antidote) now lets you hover that mention too, instead of showing dead text

## 2026-09-11 · Play your lute from the website too

✎ Playing an instrument now works from Chat, not just Discord — same cooldown and mood lift either way

## 2026-09-11 · The adjudication desk stops wiping your work

✎ Picking a Move no longer makes the next save, solve, pin or background check redraw the whole desk — the redraw was what ate your Result box, an open composer, the zone filter and the selection  
✎ Move links now read /gm/turns?sel=move/… — old links still work, they redirect  
✎ A stale page snapshot from an earlier turn can no longer delete the text you are typing  
✎ If the desk ever resets again, the browser console now says why

## 2026-09-11 · The GM pages speak one visual language

✎ A warning is now amber or red everywhere — Missed push, an overdue seat, a dropped live feed — instead of the same grey pill as a label  
✎ Every GM page shows the same turn chip in the same place, including when no turn is open  
✎ The desk headers rank their chips: turn and lock stay, counts become quiet text, only problems get colour  
✎ On the Players rail, pinned, handled and muted no longer light the same colour, and hovering a row no longer looks like selecting it  
✎ Dev sits with the other Gamemaster pages in the side nav  
✎ A dozen small labels fixed: Claimed · you, a close button instead of one labelled Esc, the roster tab counts what it shows, the tray's hide/expand pair is one control

## 2026-09-11 · The GM desks fit a tablet and a phone

✎ Under about 1024px wide the inspector becomes a panel you open from the header, so the desk itself gets the room  
✎ Under about 800px the queue or roster and the desk take turns on screen — pick a row, work it, then Back to queue  
✎ A half-typed reply in the Players desk only pauses the background check for ten minutes, not forever

## 2026-09-11 · The desk's own tidy-ups

✎ A page load that started before another GM's Solve can no longer make the Move look unsolved for a moment  
✎ A half-written Result box on a Move somebody else solved is dropped rather than shown over the Solved card, and an old forgotten draft no longer stops the desk checking for changes  
✎ The unread badge tracks the game's clock, not your computer's, so a fast clock can't hide new mail  
✎ Retrying a message that deliberately began with » keeps it

## 2026-09-11 · Resend only reaches the people who never got the message

− On a message pushed before the delivery ledger existed, Resend rebuilds the ledger from what the push recorded, so it retries only the recipients who bounced instead of everyone  
− A message that reached Discord but whose bookkeeping failed is never resent; it stays claimed and is reported  
− A recipient who bounced during the push is retried when the push resumes  
− Two recipients without a Discord account no longer collapse into one delivery

## 2026-09-11 · Every message the push sends is written down per recipient

✎ A staged message now records, per recipient, whether it went out — the tray shows Sent · 1 failed and names who bounced, and Resend retries only them  
✎ A push that dies mid-delivery picks up where it left off and tells nobody twice  
✎ A Trouble caving roll nobody resolved by the push resolves itself, so the caver is not stuck in the zone another day  
✎ A resent public declaration now reaches the Hall feed too  
✎ The /dm command leaves an audit entry

## 2026-09-11 · The adjudication desk goes live

✎ What another GM stages, solves or rejects shows up on your desk within a second, no reload — a small chip in the header says when the desk has dropped back to its slower check  
✎ If you are mid-sentence in a Result box, another GM's edit to that same Move waits until you save rather than overwriting you

## 2026-09-11 · The GM desks stop losing what you typed

✎ A half-written Result box survives a reload, a deploy or a wrong click — it comes back exactly as you left it, until you save or solve  
✎ A fresh deploy no longer kicks the desk into a full page reload mid-work; the desk notices on your next action and offers the reload chip instead  
✎ On the Players desk, opening somebody no longer resets the roster's search and filters, and Back works without a reload

## 2026-09-11 · Messages to players stop going wrong

✎ A reply you send twice, or retry after a bad connection, lands exactly once — a failed send now stays in the thread with Retry and Discard instead of vanishing  
✎ Opening a conversation clears its unread mark and it stays cleared, on the rail and on the Players badge in the side nav  
✎ The /gm command now leaves an audit entry

## 2026-09-11 · The adjudication desk keeps its own rows now

✎ Staging, solving and rejecting update the desk the moment the server answers, instead of waiting for the page to reload — the case where a write landed but the screen never changed is gone  
✎ The desk reconciles a late page payload against what you just did, so a slow load no longer undoes a fresh staging or brings back a deleted row

## 2026-09-11 · Clicking a name on the Players desk is instant now

✎ Opening a conversation no longer loads a page. It paints in about a tenth of a second, clicking through several people in a row doesn't queue them up any more, and going back to someone you had open a minute ago is free.  
✎ Back, Forward, pasted links, ⌘K and the old /gm/messages links all still work — the address bar follows what you've opened rather than causing it.  
✎ Paging back through a long conversation stopped blocking whatever you did next.  
✎ Three faults in yesterday's live-feed work, found in review: a reader that closed its tab could leave the server waking for every message in the game forever; switching conversation rebuilt the live connection each time; and the chime was being swallowed for anything that arrived during a reconnect — which was the very thing that feed was built to fix.

## 2026-09-11 · Brigands start able to work

✚ Both Brigand roles start with Laboring (Basic)  
✎ The four Brigands already in the game have been given it

## 2026-09-11 · Searching the rail no longer holds up your next click

✎ Typing in the rail's search box used to block whatever you did next, because the search and the click went through the same queue — so 'type a name, click the row' made the click wait for a scan of every message in the game. It doesn't any more, and a search you've typed past is now abandoned instead of running to the end.

## 2026-09-11 · Opening a conversation stops asking Discord twice

✎ The desk was fetching the whole server member list twice over to draw one conversation — once for names, once for GM faces — on two separate caches that expired at different moments. It reads it once now. This was the slowest thing on the page, and the reason opening somebody sometimes hung for seconds with no pattern to it.  
✎ The audit log and the turn desk were doing the same thing, so they get quicker too.

## 2026-09-11 · The message desk hears a reply the moment it lands

✎ A player's reply now appears on the Players desk by itself — in the rail and in the open conversation — instead of waiting for the desk to go and ask. It arrives in a fraction of a second.  
✎ The desk no longer chimes for a message it then fails to show you. There was a timing hole where it could hear something arrive and throw it away a moment later; you would only see it after a reload.  
✎ When the live connection does drop, the desk says so in the header rather than looking healthy and quietly showing you nothing. It keeps working in the meantime, just up to half a minute behind.  
✎ The desk stopped asking the database what changed twenty times a minute per person, which was part of why clicking around it felt slow.

## 2026-09-11 · The message desk stops stalling and going deaf

✎ Opening somebody on the Players desk is quicker. The desk was quietly loading every conversation in the rail in the background just in case you clicked it, so the one you actually clicked queued up behind the rest.  
✎ Clicking a name now shows you something straight away instead of sitting on the last conversation until the new one is ready.  
✎ A hiccup talking to Discord no longer makes a quiet conversation come back as 'not found'.  
✎ One broken conversation no longer takes the whole desk down with it — the rail stays, and you can click somebody else.  
✎ The desk keeps listening for new mail after a deploy. It used to stop updating silently while the chime went on ringing, which is why you would hear a ping and find nothing there until you reloaded.

## 2026-09-11 · Merge PR #41: Prospecting pays properly, and Keen Eye is worth taking

✎ Every Prospecting table's drops are up by about half again — the raise is all in what you find, base pay is untouched. Junk with no sale value (Rock, Bear Trap) is cut rather than padded around, since a rarity band's share is fixed and dropping a worthless member concentrates it on what is left.  
✚ Gold Fleck, and six ore finds behind Keen Eye  
✎ Keen Eye now needs Prospecting before it can be bought, the same way its sibling labour skills need their trade  
✎ Keen Eye turns up one modest find on every face of the die rather than a rare windfall, so it never makes a day worse — verified across all 29 Prospecting locations: floor +1.79 ⬢ a labour, average +2.12, none hurt  
✎ Fourteen tags the draft-mark sweep deleted by accident are back — onion, boar loin, hard cheese and eleven others, restored verbatim. Several were still named by the labour drop tables and the room stashes, so the whole sync threw on the first one.  
✎ The labour drop audit prices Lockboxes and consumables again instead of calling them worthless

## 2026-09-11 · You can't start a fight once your Move is spent

✎ Attack and Intercept now refuse if you have already filed your Move for the turn — unless that Move is a Gambit, so writing the fight up first and pressing the button second still works  
✎ The refusal sits on the button inside the dialog, not the icon on the sheet: Break off, Stop watching and Let them go are never blocked  
✚ A watch already set still fires, and a zone crossing now counts as a spent Move like any other

## 2026-09-11 · The turn desk shows a whole fight in one row

✎ A group ambush is one row on the Other tab now, instead of one row per person jumped — everyone caught is listed under it  
✚ Each person in a fight links straight to the Move they filed, so their Gambit is one click from the row  
✚ A ✕ beside any fight on the Other tab calls it off and tells both people

## 2026-09-11 · The Oracle lands at the lock instead of a quarter hour into the window

✎ The six zone pages are written at the same time rather than one after another  
✎ It starts on the Moves lock itself, not two minutes after  
✎ The Oracle's rail item is an eye

## 2026-09-11 · You can whisper with a hood and hand it things, helmet on

✚ Take a masked stranger aside: Converse from their row in Here, with them already ticked  
✚ Let one into a conversation or a private room — the + Add button and /add list them as "a young man"  
✚ Transfer sits on a hood's row too. It always reached them; the dropdown was the only way to find it  
✎ Heal, Loot, Bind, Harm, Kiss, Teach and Confess call somebody by their forced name — a Beast was listed under the name underneath it  
✎ Nothing about a mask leaks by being invited: the page is never told who is behind one, and the room hears "a young man was added"  
✎ Discord is unchanged. /add there names a character by their role, and a hood has no role to name

## 2026-09-11 · The action bar stops sitting on the words of a run

✎ On a phone the Change / Take back / Look at buttons show only for the message you tap, instead of covering the second line of every run  
✎ On a desktop the words keep clear of the bar that appears on hover

## 2026-09-11 · The header says when Moves lock, in your own time

✚ Every page header now carries a LOCK chip: the time Moves stop being accepted, in your own timezone, counting down in minutes  
✚ It turns MOVES LOCKED once the window shuts, and says nothing at all when the clock is frozen or the turn is too short to have a cutoff  
✎ The adjudication desk's own 'moves lock in 2h 14m' is gone — it wears the same chip as everybody else now

## 2026-09-11 · Cutting Godflesh stops costing your turn

✎ Extract has its own cooldown now: once per in-game day, so one cut covers both turns of that day. Cut again and it says you already harvested Godflesh today.  
✎ Somebody who cuts and files nothing still gets their labor, so a cutting day now pays the Godflesh and a labor on top of it.  
− The Move a cut used to spend. Nothing is filed on /gm/turns for one any more.

## 2026-09-11 · The places drawer no longer covers its own rows on a phone

✎ The chime, the tick and the app's links sit under the places instead of over them, and the links are two columns

## 2026-09-11 · Picking a picture no longer pretends it has been uploaded

✎ The note on the Browse button said your picture had been uploaded and a GM would review it. It said that before anything had been sent, and it stayed on screen while you chose a file — so people believed it, never pressed Save, and their picture never went anywhere. Two uploads landed in eleven days while players wrote in asking how long approval takes.  
✚ Choosing a file now says to press Save, and the confirmation only appears once the save has really gone through  
✚ Any size of picture works now: the browser shrinks a big photo before sending it, so a 20MB phone photo goes up as a few hundred KB  
✎ A photo taken with the phone held sideways is no longer stored sideways

## 2026-09-11 · A resolved caving encounter's Result can be edited again

✎ The Result box on a caving encounter stays editable after you mark it resolved — a Save button now sits beside Mark resolved, the same way the Move desk works. Before this, resolving an encounter took away the only button that saved the box, so anything typed afterwards looked accepted and was thrown away when the desk closed.

## 2026-09-11 · Quotes with formatting inside them are highlighted again

✎ Quoted speech is tinted again when there is anything formatted inside it — italics, bold, strikethrough, a link, somebody's name. It never was, which quietly meant most quotes, for as long as the tint has existed.  
✎ ||Spoilers|| with formatting inside them stay hidden now too, the same bug and the same fix.  
✎ A name or a price with formatting in it no longer breaks the little chip it sits in, so a character called Bob *the Blade* Marley reads as a mention instead of as raw braces.  
✚ A test that fails if any of that stops working again.

## 2026-09-11 · Chat on a phone is Discord's channel view

✎ On a phone the feed now takes most of the screen instead of a quarter  
✎ ≡ opens the places as a drawer from the left; swipe right does the same  
✎ The people button opens the place, travel and you panels from the right; swipe left does the same  
✎ The box is one line and grows as you type, on a desktop too  
✎ Bascinet's pane and the faction panel wear the same head as the feed  
✎ The keyboard on Android no longer covers the composer  
− The tab strip, the face strip and the ⋯ sheet on a phone

## 2026-09-11 · A zone crossing asks before it happens

✎ Crossing into another zone now asks first — which zone, what it spends, and how many people come with you  
✎ Picking a place twice no longer crosses a zone: Go is the only way out of one. A hop inside your own zone is unchanged  
✎ Enter stops at a crossing too, on the Travel panel and on the map

## 2026-09-11 · The Censor can teach, and can lecture three at once

✚ The Censor now starts with Teaching (Lecturing), so he can train up to three people on one Routine

## 2026-09-10 · Uploading your own picture works again

✎ It has been failing for almost everyone since the game opened. A photo over about a megabyte vanished on Save with no error at all — only two players ever got one through, both tiny files.  
✚ A picture that is too big now says so the moment you pick it, and names its size  
✎ The note on Browse no longer reads as a queue you wait in. Your picture is live the moment you save it; a GM reviews it afterwards.

## 2026-09-10 · A caving 1 keeps you in the zone until a GM has looked at it

✎ Rolling a 1 in the caves now holds you in that zone until a GM adjudicates the roll. You can still walk the level — camp, regroup, push deeper — you just cannot leave until somebody has dealt with what found you.  
✎ Nobody can escort you out of it either; a held caver is left standing and the party goes on without them.  
✎ The Stepstone will not carry you out of it.  
✎ Marking the roll resolved on the Caving lens is what frees them, and nothing resolves on its own at turn end.

## 2026-09-10 · A GM's message rail says where somebody is, and stops losing people who moved

✎ The zone on a person in the message list is now where they are standing, not where their faction is seated — those disagree for ten of the seventy living characters  
✎ A GM watching some zones sees a person if their faction is seated there OR they are standing there; before, a Town player who walked into the Forest fell off the Town GM's rail while the chip beside the gap still said Town

## 2026-09-10 · Traits you were born with can be bought during play

✎ Eagle Eyes, Keen Hearing, Brave, Giant, Pretty, Beautiful, Ambidextrous, Light Sleeper, Knighted, Old Blood, Kleptomaniac, Pacifist and Mime's Vow were shut out of the shop by mistake, so a character who did not take sharp eyes at the start could never get them  
✎ Corrupt could be bought mid-game for points, which was a way of printing them; it is closed, along with eleven items and assets that had drifted into the shop — six wax seals, two hoods, the Cerberon radio, the Fishing Boat and the Cart  
✚ The shop now refuses any tag that pays you points at all, and the tag sync refuses to load a catalogue that breaks either rule, so neither can drift again  
✎ The Oracle's pages are laid out now — the main thing, what is going on, what needs a ruling — instead of a list of who arrived and what they were handed

## 2026-09-10 · A full browser cache can no longer stop a GM typing

✎ Typing to a player no longer stops working when the browser's storage fills up

## 2026-09-10 · The Oracle cannot write half a page any more

✎ A page that runs past its length limit is now an error rather than a page that quietly stops mid-sentence and reads as the whole account of the turn  
✚ More room for a long turn's page, and longer to wait for a slow model

## 2026-09-10 · You can see what a thing is before you pick it up

✎ Moving things now shows each item as a chip with its weight, and hovering one tells you where it is worn, what it stops and what it does in a fight  
✚ An empty equipment slot now also offers what a room here is storing that fits it. Picking one takes it and puts it on in a single click  
✎ The Tag Catalog was never showing In a fight, Armour or Worn on any tag at all. All three are there now  
✎ Two-handed weapons said they took one hand, and layered armour never said which layer it sat at  
✎ A helpless person's pockets deliberately stay a name and a weight, with no card

## 2026-09-10 · A channel somebody has spoken in reads bright

✚ A channel somebody has spoken in now reads bright in the places column, not just a small dot  
✎ Gamemasters get unread marks at all. They had none, because the mark only ever lit for a conversation or a mention of your own character, and a GM has neither  
✎ Scenery still lights nothing. A gate crossing, a smell, a turn banner is the game talking to itself  
✚ A tick at the foot of the places column marks everything read at once. That foot no longer scrolls out of reach

## 2026-09-10 · The Incarn may be styled Brother

✎ The Incarn is a warrior monk, so the role now earns the monk's title — Brother, Sister or Sibling, whichever their gender picks — the same word the Mortii already wear

## 2026-09-10 · The Oracle page fills the screen again

✎ The Oracle's three columns each scroll on their own now, so the page stops ending halfway down with dead space under it  
✎ A synopsis reads as prose again — paragraphs, headings and lists are spaced, and a long page keeps a readable line width instead of running the full width  
✎ The zone counts in the rail sit at the right edge instead of running into the zone name

## 2026-09-10 · The Squeeze briefing says what a cube is worth

✚ A line on the Squeeze document giving the 7 ⬢ Depot price and the cut the Merchant has traditionally taken

## 2026-09-10 · A cube of Squeeze sells for 7

✎ Up from 5. A factory day is 56 ⬢ for eight cubes, about four times a good farming day, and a full wagon is 420 ⬢

## 2026-09-10 · A letter can be given a name

✚ A letter can be given a name when you first write it. Leave it blank and it is A Note, the way every sheet was  
✎ A name is set once, on the first write. Adding to a sheet later cannot rename it, and the letters already written stay A Note  
✎ Sealing still replaces the name with whose wax is on it, so a sealed letter tells a courier nothing  
✎ A book or letter called @everyone can no longer ping the server from a noticeboard

## 2026-09-10 · The Browse note says what actually happens to an upload

✎ The hover on Browse now reads “Your image may be approved or denied.” It used to promise approval before the picture went live, which was never how it worked

## 2026-09-10 · Being hurt costs less in a fight, and being clumsy is no longer Pitiful

✎ Missing Fingers cost more of your fighting skill than a Peg Leg did, while being cheaper to take. It is now the smaller of the two  
✎ Every drawback you can buy at creation now costs about as much fighting skill as a bonus of the same price pays for. Most were charging double  
✎ Wounds and illnesses hurt less across the board. Two mortal wounds still leave you helpless; one no longer does it on its own  
✎ Pitiful now takes a real injury to reach. A single trait like Clumsy or Fat used to put a healthy person in the same band as somebody tied to a chair  
✎ Eleven of the sixty living characters were Pitiful in melee and fifteen in ranged. It is three and three now, and nobody came out worse

## 2026-09-10 · A forger can copy the Merchant’s stamp too

✎ The Merchant’s Wax Stamp was the one office stamp a Forger could not make. Now they all are

## 2026-09-10 · Anyone can work the Factory floor, skill or no skill

✎ A Laboring skill is no longer needed to Labor — without one the day earns nothing, and the readouts show a dash instead of a range  
✎ The Godard Factory works for anybody standing on it, which is what was stopping the Banneret  
✎ Nobody is auto-assigned an unpaid day, except in the Factory where the shift is worth something  
✚ Prospecting shows up in the Move dialog's labor readout, which it had been missing since it was added

## 2026-09-10 · The draft marks come off, and the rule goes with them

− The little double daggers that marked drafted prose. They are gone from the handbook, the tag descriptions, every DM and every screen  
✎ The Other lens's empty line reads No miscellaneous requests

## 2026-09-10 · A cart can come into the Factory, Customs and the Depot

✎ The Godard Factory, Customs and the Depot no longer park your horse and cart at the door, so a wagon can be loaded where the crates are  
− Shuttling crates out to the marsh one at a time before the cart could be hitched

## 2026-09-10 · An uploaded portrait now waits for a GM to look at it

✚ A portrait a player uploads now waits on the Other lens of the adjudication desk, with the picture shown  
✚ Keep and Reject on that row. Reject puts the character back to their letter plaque and tells the player why  
✎ The Browse control's promise that art needs GM approval is now a thing the game actually does  
✎ Portraits built in the appearance maker are not queued. They are assembled from art that was already approved

## 2026-09-10 · The faction roster's lines are straight again

✎ The rules under a faction's Members table were drawn at different heights per row, worst on your own row where the buttons are hidden

## 2026-09-10 · Earning a compliment is worth one point now

✎ Earn a compliment drops from 3 points to 1, and comes back every 5 turns instead of every 3

## 2026-09-10 · The Oracle sees hoods, disguises and the intercom; Kiss someone is tier 1

✎ The chronicle now reports someone pulling a hood up or letting it down, putting on a disguise, and anything said over the intercom — all three were invisible to it before  
✎ Kiss someone is a tier 1 Desire on a 3 turn cooldown, down from tier 3 on 4

## 2026-09-10 · The Oracle's zone rail is the same rail as the other desks'

✎ The Oracle's zone buttons fill the rail and sit flush, instead of floating as centered bubbles — they now use the same rail row the adjudication and player desks do  
✎ The Turn dropdown on the Oracle desk follows the theme again

## 2026-09-10 · The Oracle's front page can be written at all, and one-word names link

✎ The Oracle's front page is written again — it never could be, so every turn's chronicle was six zone pages and nothing tying them together  
✎ A character with a one-word name is a link in the chronicle again, instead of a dead mention

## 2026-09-10 · Watching Underground finally hands over the caves

✎ A GM watching Underground now reads the Caves and the Depths. Every cave Location and room was invisible to them, on Chat and to the ambient line both  
✚ Zones I see, at the foot of the audit desk and of Chat's right column  
✎ The picker stops forgetting which zones you ticked when a page paints from its saved copy  
− The bare Underground row in a GM's place list, which opened nothing

## 2026-09-10 · The loot table's resource finds work again

✎ Finding 1 or 2 loose Resources on a labor roll had never actually reached the game — the entries were written in a shape the table could not read, and the whole loot sync refused to run because of it  
✎ Fixed and synced: 287 draws live, 15 of them resource finds

## 2026-09-10 · Rejecting a Move no longer asks for a reason it cannot take

✎ Reject on the turns desk fires straight away instead of opening a dialog that always refused

## 2026-09-10 · Steady hands and Clumsy are mutually exclusive

✎ Steady and Clumsy can no longer be held together

## 2026-09-10 · The Oracle is written when the Moves lock, not after the push

✎ The turn's chronicle is now drafted a couple of minutes after Moves lock, so a GM has it in front of them for the whole adjudication window instead of after the rulings are over  
✎ An Oracle page now runs lock to lock, so the late chat, the GM's own adjudications and everything the midnight push fires appear on the next turn's page  
✎ The Oracle desk shows the open turn, and opens on the newest turn that has actually been written  
✎ Auto-labor Moves reach the chronicle again — filed at the push, they belonged to no page at all  
✚ Draft this turn, on the Oracle panel, replacing Draft the last turn

## 2026-09-10 · The verb tooltips say it in your words now

✎ Craft, Destroy, Transfer, Loot, Free and Butcher read the way you wrote them, and Learn Skill's greyed reason is shorter

## 2026-09-10 · Two performing Desires repriced

✎ Perform for at least 5 people is worth 2 points now, not 3, and comes back after 4 turns instead of 3  
✎ Perform for at least 15 people asks for 20 now, and can only be claimed once ever  
− The Prospector's Pick claiming to be good for breaking rock or worrying at a lock

## 2026-09-10 · A kiss is nobody else's business

− The line the room used to hear when two people kissed. Nobody is told now but the two of them

## 2026-09-10 · The verbs on the sheet explain themselves on hover again

✎ Every button on the verb strip now tells you what it does when you point at it, the same as everywhere else in the app  
− The line under the strip that a greyed verb used to print its reason on: the reason is in the hover now  
✚ A sentence for Craft, Destroy, Transfer, Loot, Free, Butcher and Write, which had none written for them

## 2026-09-10 · The 100-coin Desire asks for obols, not goods

✎ Have 100 ¢ in your inventory at once — obols are weightless, so the goal is reachable; 100 ⬢ of carried goods was not, at a cap of 84

## 2026-09-10 · The cult buys paper by the ream too

✎ The Thanati shelf sells a Stack of Paper at 3 ⬢ instead of single sheets at 1

## 2026-09-10 · The Merchant sells paper by the ream

✚ The Depot stocks a Stack of Paper at 3 ⬢, which unpacks into twenty sheets  
− Loose single sheets are off the Merchant's shelf

## 2026-09-10 · The radios work on the web now

✚ A Radio section on Chat: the frequencies you are carrying a radio for, sitting under Summary  
✚ Speaking on a radio from the web reaches Discord, and a line typed on Discord reaches the web  
✎ A radio you can only listen on says so, instead of telling you that you are a ghost  
✎ The radio channels get their names put right on the next sync, so #watch stops being called that

## 2026-09-10 · Tell the two radio nets apart

✎ The archive keeps the two radio nets as separate scenes instead of pooling both under one "Elsewhere"  
✎ A mention on a radio net now says which frequency it was on, instead of always naming the Watch  
✎ The channel doctor stopped rebuilding each character's access once per channel

## 2026-09-10 · Nine masteries: capstone tags you can only buy once the game is running

✚ A new kind of tag, a mastery: never available at character creation, only from the store once play has started. They wear a star  
✚ Lucky — you roll every Gambit twice and keep the better die, the Caving Die and the laboring die included  
✚ Manic — your Desire slots never need a rest between claims  
✚ Metempsychosis — when you die your soul wakes in a new body: a random open seat, a new name, face and age, six extra tag points and no Curse  
✚ Amor Fati — being crucified, wounded or tortured lifts your mood by half what it would have cost you, and the everyday miseries stop touching you  
✚ Imperturbable — nothing moves your mood off Fine, and there is nothing in you for a torturer to break  
✚ Second Wind — wounds, maimings and infections cost you nothing in a fight, though illness and blindness still do, and death's door still ends one  
✚ Brewing (Distilling) — every brewing recipe yields two for the price of one  
✚ Laboring (Scavenging) — your laboring turns something up far more often, and a good day never hands you an injury  
✚ Laboring (Tireless) — you can work through exhaustion at half yield, so you can labor every turn  
✚ Musician (Pythagorean) — your playing lifts everyone in the room three times as much

## 2026-09-10 · A second radio net: 27.065

✚ Radio (27.065), 20 off the Thanati shelf — a radio hardset to one frequency, and everyone holding one both hears and speaks on it  
✚ Its own channel, separate from the Cerberon's net and cleared at Dawn like the rest  
✎ The radio category is no longer cut twice when a fresh guild provisions both nets at once

## 2026-09-10 · The sheet says who you are where the face is

✚ Your name, your role and your faction sit in the character sheet's top row now, beside a face three times the size it was
✎ The page header above it just says Character

## 2026-09-10 · Guns beat bows, and the crossbow stops being the best ranged weapon

✎ Every firearm now counts for more in a fight than every bow — the powder half of the ranged ladder starts where the bows stop  
✎ The Kpfw-6 Avtomat is the best gun in the game, then the CTT4&3 Rifle  
✎ The Crossbow drops from a full tier to half a tier, and its description says so  
✎ The Disabler stays where it was — it is a tool, not a gun

## 2026-09-10 · Prospecting brings up ore, and steel is a quick smelt

✚ Prospecting, a fourth kind of labor — two new places to work it, the Underquarter and the Undercroft  
✚ Silver and Steel are real things now: the silver and steel weapons and armour each spend one  
✎ Steel is a quick smelt — 4 ⬢ and a third of a turn, so three ingots fit in one Routine  
✎ A steel weapon or piece of armour costs the same ⬢ it always did, but takes a turn less at the anvil  
✚ Lockboxes turn up in the drop die, and Lockpicking finally does something  
✎ The drop die pays out real things now instead of bare Resources

## 2026-09-10 · Equipping works again

✎ Equipping anything threw an error instead of equipping it. A variable inside the equip transaction was shadowing the row being equipped, so the write blew up before it ran

## 2026-09-10 · A cube of Squeeze is worth 5

✎ A cube of Squeeze now sells for 5 ⬢ at the Depot, up from 4 — a factory day is about three times a good farming day

## 2026-09-10 · Built, not build

✎ The brewery's refusal reads properly

## 2026-09-10 · Bascinet's words for the three buildings, and a brewery needs a brewer

✎ A brewery only works while someone who can brew is standing in the inn  
✎ Bascinet's own wording on the three new buildings and their refusals

## 2026-09-10 · A smith can sign their work

✚ A smith can put their own name and words on a piece they make, for 1 ⬢ more  
✎ It takes Smithing (Skilled) to sign anything. A basic smith still forges the dagger, they just cannot put their name on it  
✎ Eleven plain arms can be signed — the cudgel, work knife, dagger, spear, gladius, mace, battle axe, halberd, broadsword, war hammer and bastard sword — and every piece of armour and headgear. The named and exotic weapons, the bows and the guns cannot  
✎ Armour stacks now, so a character can hold more than one breastplate

## 2026-09-10 · The tool line in the Move dialog is signed off

✎ The Includes… line under a Location's yields loses its ‡

## 2026-09-10 · There is a shrine at the bottom of the Chasm, and a god behind it

✚ A Shrine of an Old Man in the Chasm, needing Caving to get in, with a Pray button  
✚ Praying makes you a plaything of Xom: every turn something may happen to you, and about one turn in a hundred it kills you  
✚ Cause Chaos, the only Desire a plaything of Xom has left  
✎ Opening a conversation is one piece of code now instead of three

## 2026-09-10 · Three new buildings: a brewery, a rookery and a stage

✚ A Brewery at the Old Cock Inn, racking one Alcohol a turn into the cellar  
✚ A Rookery, worth six bird flights a day instead of one  
✚ A Makeshift Stage, which plays every six hours and cheers up whoever is there  
✎ A building can now name the one place it belongs, and be raised indoors there

## 2026-09-10 · Your words for the Move dialog, and File it becomes Lock In

✎ The Move button reads Lock In, and so does the confirm  
− The 'a filed Move is final' warning in the confirm, and the guidance line under the box  
✎ The labor readout reads 'You would labor at the X tier'  
✎ A shut turn says 'Moves were locked.'

## 2026-09-10 · A good mood wears off by morning

✎ Happiness now falls 40 a turn instead of 4, so a drink or a kiss is worth having on the day and not for the week  
✎ Recovery from a bad mood is unchanged at 4 a turn — fear and grief still take their time  
✎ Ecstatic and its +1 Gambit are now something you arrange, not something you hold

## 2026-09-10 · The Oracle calls NanoGPT, and its desk stops explaining itself

✎ The Oracle now points at NanoGPT rather than OpenRouter. The same model under the same id, so only the endpoint moves, and an endpoint typed in by hand is left alone.  
✎ The Oracle desk and its settings drop their explainer paragraphs. The page is now just the record and the controls.

## 2026-09-10 · The Oracle writes up each turn for the gamemasters

✚ The Oracle: at the end of a turn, a plain written account of what happened in each zone, plus a front page pulling them together. Read it at the new Oracle desk  
✚ Clicking anyone's name in an account pulls their sheet, their move and their messages up beside it  
✚ Any gamemaster can rewrite a page they disagree with, and the rewrite is what later turns are told  
✚ Two switches on the Dev panel: Enable turns the writing on, Playtest keeps the desk to superadmins while it is being tried out  
✎ It knows what happened over the last three turns, so it can say what somebody has been up to rather than only what they did today

## 2026-09-10 · Filing a Move now tells you what you need before you press it

✚ The Move box shows how long is left to file, and what the ground under you is worth if you pick Labor  
✚ A Move you cannot make — no Laboring skill that reaches where you stand — says so before you spend the press, not after  
✚ What you type into the Move box is kept if you close it by accident, per character and per turn  
✚ A confirm step on File it, because a filed Move is final  
✎ Labor's help line now reads "Work the day using your best Labor skill", on Discord too

## 2026-09-10 · A pass over the sheet, the map, the Depot and the Lifeweb

✎ The sheet is squarer: Crafting & building moved under the Bio, and your ⬢ and your pounds are no longer printed twice on the band  
✎ The map keeps where you were and how far in you were zoomed when you flip between the surface and underground — they are the same plate, so it is the same view. It only re-frames when the layer you switched to has nothing you know in sight  
✎ The Depot opens from anywhere now, greyed, instead of throwing the Merchant back at their character sheet. Standing at the counter is still what works it  
− The GM panel on the Lifeweb, and the page itself, for GMs. It is a Mortus surface; a superadmin still reads it and still moves the Blood  
− "One turn of work — this is your Move for the turn" from the Craft dialog  
− The line under "Destroy it?" naming the thing and saying it is not coming back  
− The Desires note saying Nobility shuts every Desire at tier 1. The lock still holds, and each one still says "Locked by Nobility" on its own row  
− The line in the Faction panel telling you which seat you hold in it

## 2026-09-10 · Shelter brings you back to Fine, not past it

✎ A roof only ever mends a mood as far as Fine. The Inn, the Keep, the Sanctuary and the Cathedral mend it faster, but none of them makes anybody happy  
✎ Sleeping indoors used to be worth a net +8 every night forever, so a bed alone could carry somebody up to Ecstatic in about ten nights and hold them there. It can't now  
✎ What still lifts a mood into the good bands: a drink, a meal, a treat, tea, a coffee, a smoke, music, an absolved confession, a kiss, being healed, or getting what you wanted from a Desire  
✎ Climbing out of a bad mood is exactly as fast as it was — the cap only blocks crossing over into the good half

## 2026-09-10 · Bascinet's wording, and the draft marks are gone

✎ Your edits are in: the refusals, empty states, DMs and dialog copy across the game now read the way you rewrote them  
− The double dagger. It is off every string, comment, document and YAML master in the game — only CLAUDE.md still mentions it  
− The explainer paragraphs in the Intercept and Warrant dialogs, the bell's help line, and the web-only note under the turn ping  
✎ A shout now says it only works in a room or a conversation, instead of saying there is nobody to hear it

## 2026-09-10 · A great mood now helps your Gambit rolls

✚ Ecstatic, a new mood band above Happy: it gives +1 on every Gambit roll  
✎ The mood dial used to stop inside Happy, so a really good mood had nowhere left to go. It reaches higher now  
✎ A player is told when they reach Ecstatic, the same way they are told about Afraid and Panicking  
✎ Worth an eye: anyone sleeping at the Inn, the Keep or the Sanctuary gains ground every night, so they can park at Ecstatic and hold that +1

## 2026-09-10 · Shouting, playing and rolling belong in a room or a conversation

✎ A shout, an instrument and a die now only work in a room or a conversation — not out on the street, and not in a zone's summary channel  
✎ The street is scenery: the summary is for the big picture, not for the moment you are living in

## 2026-09-09 · The Stepstone goes anywhere above ground, and a warrant catches every namesake

− The Stepstone now takes you to any place on the surface, whether or not you have been there  
− It still will not carry you underground, so the caves are walked into or not at all  
− An arrest warrant on a name two living men answer to now marks both of them, instead of refusing and sending the officer to a GM  
− The warrant book lists names only; it no longer prints anyone's role

## 2026-09-09 · The Meals & Kitchens paper is gone

− The Meals & Kitchens document is deleted, so cooks and Nobility no longer receive it  
− The Innkeeper and Inn Staff no longer start with it  
− An empty DM thread now reads the same as an empty room

## 2026-09-09 · Document tidy: the Pusher goes private, Concealing goes away

− The Concealing Your Identity document. The handbook still covers it  
− The note above the Recipes table about secret recipes  
✎ The Pusher's paper is no longer public. It goes to the Pusher, the Cerberus, the Baron and the Hand  
✎ A Dead Simple recipe now reads "Dead Simple: up to 4 a turn"  
✎ A kept ingredient reads "(not used up)"  
✎ Respawning: it's the Church and the Mortii's job to help souls pass on

## 2026-09-09 · Anyone in the watchtower can work the gate

− Whoever can reach a watchtower may now work its winch. The gate's own opener list is gone, so getting into the tower is the whole permission model  
− A gate still refuses somebody who is not standing at it


## 2026-09-09 · The Smithing and Crafting paper is gone

− The public Smithing and Crafting sheet, with the whole tier table and every recipe on it  
✎ The Cerberon armory line no longer points at it

## 2026-09-09 · The Dev Panel stops scrolling off the bottom of the screen

✎ Flipping a config toggle no longer throws you to the bottom of a blank page  
✚ On a phone the Dev Panel is one scrolling page instead of a box inside a box

## 2026-09-09 · Laboring hurts less, and the Depths give up their dead

✎ A bad roll while laboring is now a clean day about a third of the time, instead of always costing you something  
✎ Hunting wounds are lighter across the board, and a Grievous Wound is roughly a fifth as likely as it was  
✚ Hunting the Depths now brings back a Skinless, Nekker or Graga corpse — and, rarely, an Aberrant Heart  
✎ An Aberrant Heart is worth 55 ⬢, and the Withheld Recipes sheet now says where four ingredients actually come from  
✎ Wounds from a labor find now heal on their own; they were permanent

## 2026-09-09 · The lobby's antagonist boxes tick All or None

✎ The pregame page is headed Lobby, and the fallback dropdown reads If none are available  
✎ Whitelisted antagonist boxes no longer sit indented as if they belonged to the one above  
✚ All and None buttons over the antagonist boxes

## 2026-09-09 · Four settings stop being settings

− The whitelist always gates a gated role; the switch that could turn it off is gone  
− The portrait maker is always open, and the fantasy parts are always off  
− The face the turret spares is no longer a box on the Dev Panel — the Merchant's own name is written when he is created

## 2026-09-09 · Every ephemeral reply speaks in one voice

✎ The short messages only you can see — refusals, confirmations — now all read the same way, with the chevron and italics  
✎ Fixed /conceal printing raw code at players, and its two replies losing an asterisk  
✎ The bird, the noticeboard and room storage answered in a different voice than everything else; they don't now

## 2026-09-09 · The archive is a page you can actually read

✎ The archive is rebuilt. A real header row with the line count, a slim search bar with the rest of the filters behind one button, and chips saying what is narrowed so a filter can't be silently on. The old eight controls in one row had no widths on them, which is why they wrapped raggedly and every dropdown truncated at once.  
✚ It scrolls now instead of paging. What you are reading is still in the link.  
✚ Faces, behind a toggle — the face frozen onto the line when it was said, so a later disguise or a rename can't rewrite it. A hood still shows the mask, and a hooded line still doesn't hand the browser anything to match it to a named one with.  
✚ Scenes are a toggle too, and a scene now carries its zone's colour.  
✎ A line the world said reads as the world saying it, rather than as somebody called "Unknown" — bells, smells and gate crossings were drawing as ordinary speech.  
✎ The day header actually sticks. It never has: the box around the transcript was clipping it to itself.  
✎ A concealed speaker's name no longer gets cut off. "Young Man (Sir Alder)" was one character over the limit, so the most interesting name in the archive was the one thing it truncated.  
✚ Every line has a link you can copy, arrivals and deaths and moves each get their own mark, an edited line says so, and clicking a name or a place narrows to it.  
✎ The folded events render properly instead of showing raw braces.  
✚ A loading skeleton, so a first visit isn't a blank page.

## 2026-09-09 · Launch sweep: Turn 1 clock, the Game Ended post, and spawned antagonists

✎ Start Game now restamps Turn 1's clock, so the Move cutoff on /chat, the sheet and /gm/turns is today's instead of the day the game was wiped  
✎ Start Game reposts the #turns console with the started line on it, so the buttons stay at the bottom and the cutoff shows  
✎ The Game Ended post no longer cuts through the middle of a name when the roster runs past one Discord message  
✎ End Game says whether the reveal actually reached #turns, and the Game section has a Post the reveal again button  
✎ End Game reposts the #turns console with the Move cutoff gone, since the clock is stopped  
✎ A spawned antagonist now wakes knowing their seat's part of the map, the same as a wizard-made character  
✎ A GM who readied up and then used Skip no longer gets rolled a second seat
## 2026-09-09 · The Stepstone is not a skeleton key

✎ The stone only takes you somewhere you have actually STOOD. It used to accept anywhere you had SEEN from a doorway, and a locked gate is listed-but-shut on purpose — so it would have stepped through every locked door and gated crawl anyone had ever stood next to  
✎ Somebody holding you stops the stone, the same as it stops a walk  
✎ Stepping cuts your escort party loose instead of leaving them pointed at you from another zone

## 2026-09-09 · A game has no number at all now, and there is a list of them

− The last two places a game was called Game 13: the Game Ended post in #turns, and the chip on the dev panel's Game section, which shows the game's short id instead  
✚ A Games section on the dev panel: every game there has ever been, what it was called, how it ended, its days, turns, characters and deaths, whether its transcript is in a packet, and a link into it  
✎ The archive picks a game by its id only. An old /archive?game=3 link now sends you to the current game rather than resolving to whichever game once held 3  
✎ Old archive packets still import: the reader follows the current schema and ignores the number the file carries

## 2026-09-09 · Bascinet's words on the Kiss button

✎ Every line the Kiss verb says is now written rather than drafted, so none of it carries a draft mark any more  
✎ A hood or a helmet now refuses with "You can't kiss when you have a Hood on" instead of "Not through your Hood"  
✎ The help under the button is just "Ask somebody for a kiss", and a greyed button says "You can't kiss right now"  
✎ Asking says "Waiting on response"  
− The line under the picker explaining the two-hour wait

## 2026-09-09 · Who's here is back on the page, and the web stops the turn ping

✎ The people standing where you are are drawn at the top of the Place panel again, so you no longer press a tab to find out who you are in a room with  
✚ On a phone the ⋯ sheet finally lists the people, and between 720 and 900 pixels wide — where the sheet is up but the face strip is hidden — they were drawn nowhere at all  
✚ The party rack is reachable on a phone now; it used to live inside a tab a phone never drew  
✎ Playing from the web now takes your turn-ping role off too. It was being kept, so you were pinged twice a day about #turns — a channel the switch had just closed to you, carrying a message that is deleted and reposted every turn, so there was nothing there by the time you looked. The Bio card says so, and the ping comes back if you switch off

## 2026-09-09 · The stone and the draught do what they say

✚ Raven Draught: a Send a message button. Pick anyone in the game, type a line, and they hear it — no zone to guess, no letter, no reply. It says "Sent." whether or not anyone was alive to hear it, so it can't be used to ask  
✚ Stepstone: step to anywhere you know — somewhere you have stood, or seen from a doorway. It costs no ⬢ and not your Move  
− The Illusion Crystal is out of the catalog and off the Depot shelf

## 2026-09-09 · An interception ends however you leave, and so does a hold

✚ Being taken away now lets your prisoner go. Walking off already did; a GM moving you, a rite dragging you or a Bulk Move did not, so a victim could stay pinned to the end of the turn by somebody three zones away with nobody able to free them  
✎ The cancelled-interception letter is sent before the Discord channel work, so a hiccup in the middle of a move can no longer take somebody's watch away without telling them  
✚ A GM teleporting somebody to nowhere cancels their watch too. It was the one move that ran nothing, so the watch sat waiting and came back to life if anything put them back  
✎ The dialog says the watch ends when you leave, however you leave — not just when you walk  
✎ The audit log tells a watch you stopped apart from one a move ended

## 2026-09-09 · You can kiss somebody now

✚ A Kiss button on the sheet and on a person's row in Chat. You pick somebody standing with you and they get a DM with Accept or Decline — nothing happens until they press one.  
✚ A kiss lifts BOTH moods by 15, the same as a confession. It costs no Move and rolls nothing.  
✚ Two things hold it back: you can only ask once every two hours, and the mood is only worth something once a turn per person. Kissing all afternoon lifts you one band, not eight.  
✚ The room hears one quiet line saying it happened.  
✎ Who can't: the helpless (bound, dying, unconscious, crucified, asleep), the mouth injuries (a broken or wired jaw, choking, vomiting), the states with nobody home, Ghouls, Rage, Broken, and anybody with their face covered. Illness is NOT a gate — lepers kiss freely. Nor is Prudish, Eunuch, Pacifist or Saint: a build locks Desires, not buttons.

## 2026-09-09 · Sell instant cameras on the Thanati shelf

✚ Purchase Gear at the hideout now stocks an Instant Camera for 3 ⬢

## 2026-09-09 · You lie in wait in one place, and leaving cancels it

✎ An interception is now set in one place and works in that place only. It used to be read live off wherever you happened to be standing, so a watch set at the gatehouse followed you around Ravenheart and was still stopping strangers on the far side of the map days later  
✚ Any move at all ends it — walking, being carried along by somebody, a GM moving you, a rite — and you are told: "You left, so your interception was canceled."  
✚ The dialog names the place you are waiting in, and says that walking away ends it  
✎ Catching somebody once a turn is now counted against the catcher rather than against the watch, so stepping out of the room and setting a new one no longer buys a fresh set of catches  
✎ A watch survives a GM pressing Resync, a revive, and a character's first placement — none of those is a move

## 2026-09-09 · Tap the map to put a place card away

✚ Tapping open ground on the map unpicks the place you had selected, so the card gets out of the way  
− The zoom bar is gone on a phone — pinch does that, and the bar was sitting on top of Headwaters and the Mountain  
✎ The map's own Surface / Underground switch is all that is left over the plate on a phone

## 2026-09-09 · Archive packets can be kept on a disk of your own

✚ npm run archive:pull syncs every packet in the bucket down to a local folder, skipping what is already there  
✎ Every download is re-read and re-hashed before it is kept, and a bad one is moved aside so the next run fetches it again  
✎ Packets can never be committed: the repo is public and a transcript names the character behind every /conceal

## 2026-09-09 · A finished game becomes one file, and leaves the database

✚ An Archive this game button on /gm/dev. It writes the whole transcript out to one file, checks it reads back, and deletes nothing  
✎ Restart Game now asks whether the game that is ending is worth keeping. Discard throws its transcript away for good; Keep needs a packet written first, and refuses without one  
✎ Either way the transcript leaves the database, so a playtest stops leaving a permanent entry in the archive picker  
✚ npm run archive:export, archive:import and archive:exports for doing it by hand  
✎ The archive picker names a game by its dates or a label now, never Game N  
✎ An archived game shows how it ended and where its transcript went, instead of an empty page  
✎ A bot restart can no longer repost an old game's lines into today's channels

## 2026-09-09 · The edit refusal just says no

✎ Trying to edit something older than five minutes now says "You can't edit that any more." instead of explaining itself

## 2026-09-09 · Mind reading is out of the game

− Mindreading and the Succubus Draught are gone: the tags, the brewing recipe, the row on the player's recipe paper and the BREWING.md entry  
✎ Bruised says the wound will heal

## 2026-09-09 · The tags say what they are, not what you have

✎ 328 tag descriptions rewritten from the player's pass: object-first wording instead of "You have a…", and the effect stated plainly  
✎ Relentless costs 7 ⬢ instead of 9 ⬢

## 2026-09-09 · Both turrets say the same short thing

✎ The turret lines are much shorter, and both guns now use the same wording — hit, graze, death and the sounds in the yard  
✎ Arming the Depot turret is one confirm instead of a confirm and then a second dialog  
− The Docker's warning about the Depot turret, and the turret half of the Merchant's License  
− The block telling a Merchant a GM has to put his face on file — the Depot has learned it at character creation for a while now

## 2026-09-09 · The Play page is Chat now, and it has had a proper going-over

✎ The page is called Chat, in the rail and in the address bar. Old /play links still work  
✎ A filed Move reads as its own words instead of a pill with your sentence captioned under it  
✚ Place, Here, Room, Travel and You are tabs in the right column now, and it remembers which one you left open  
✎ Each panel is a card, so a long description and a one-line status strip stop looking like the same thing  
✚ A Send button on a desktop. There was none at all, and nothing said Enter would send  
✎ Typing a command puts a strip across the composer saying what it will do, with a way out  
✚ Sections in the left rail fold shut, and stay shut. A folded one still shows anything unread in it  
✎ Lines light up as you point at them, opening a place no longer fades a hundred old lines in at once, and New messages floats over the feed with a count  
✚ Zone and Location above the place you are reading, so you can tell where you are standing

## 2026-09-09 · A new game starts under its own sky

✎ A new game no longer inherits the last one's ending: no nuke banner, no epilogue, and the bomb can be armed again  
✎ Resuming an ended game takes the reveal back down instead of leaving it hanging off a game that is being played  
✎ Fixed the crash that was breaking the character sheet and the dev panel whenever a Desire gate was read

## 2026-09-09 · You can lay in wait, and travel arrives when you make it

✚ An Intercept button on the sheet: name who you are watching for, write them a line, and stop them when they walk in where you stand  
✚ Safe holds somebody two minutes and hands them your message; Ambush holds them until the turn ends, or until you let them go — file a Gambit if you mean them harm  
✎ A crossing that costs your Move no longer waits for the turn to end. You arrive the moment you go, and the far zone's channels open with you  
✎ A hood beats a name: watching for Lord Greeblus will not catch him hooded. Watch for anyone concealed instead  
✎ Nobody can be carried out of an ambush by a friend, and one watch catches a given person once a turn

## 2026-09-09 · A room says what it looks like

✎ Every place on the web now shows its own description under its name, opened with a click. A room's words used to have nowhere to appear at all  
✚ The little result popups render italics and bold instead of printing the asterisks  
✎ The Mood box's heading sits level with the boxes beside it again

## 2026-09-09 · A turn finishes saying what it has to say

✎ The turn's Discord half is now recorded as it goes out, so a deploy that kills the app mid-announcement no longer loses the rest of it  
✎ An unfinished turn is finished on the next advance, and by the bot the moment it restarts  
✚ The Rite of Ascension kills everyone, not just the game

## 2026-09-09 · Restart Game forgets the Depot too

✎ A Restart Game now resets the Depot. It was the one machine the wipe never touched, so the turret, the generator, the Merchant's account, the docked shuttle and the face on file all carried into the next game — which is how a turret nobody had armed shot the people in the caves

## 2026-09-09 · The arrival letter stops stuttering its »


## 2026-09-09 · Chat shows how loaded you are

✚ A load bar under the Resources and weight chips in Chat's You panel — it fills as you pick things up and turns red once you are over your cap, so being Overburdened is something you can see coming instead of being told about  
✚ Hovering a thing in your pockets now says what it weighs, quantity included, so you can tell what is worth putting down  
✎ The ⬢ and pounds chips each redden for their own cap now. Being over on Resources used to turn the POUNDS number red, which said nothing true about what you were carrying

## 2026-09-09 · Leper is an illness, Blessing is cheaper, and the daggers come off

✎ Leper now sits under Health · Illness instead of General, so it reads and inspects like the ailment it is  
✎ Blessing costs 3 points instead of 5  
✎ The Held row says "3 slots" instead of "3 hands / empty", and an empty slot's menu says what it is waiting for  
✎ The draft marks are off the web UI's error and empty-state copy — Pyrias's sweep

## 2026-09-09 · Wielding five swords costs five hands, not one

✎ Equipping something out of a stack now takes one slot per item — the rest stay in the pack, and three knives out of five fill three hands  
✎ The equip rack draws one cell per item worn, so a stack no longer sits in a slot wearing a ×5 badge  
✎ A second hat, or a fourth knife, is refused the same way two different helms always were  
✎ Resetting a Move gives back the zone crossing it queued, so the travel menu unlocks and the day's free crossings come back  
✎ The map redraws when somebody else moves you — an escort, or a leader dragging the party  
✎ The travel panel counts the boat's extra crossing, which it was quietly leaving out  
✚ The GM inspector's Sheet tab shows a character's combined armour, melee and ballistic

## 2026-09-09 · The off hand is gone; you hold four things now

− The Off hand row on the sheet. A shield goes in your hands like anything else, and the row is called Held  
✎ You have four hands' worth instead of three, which is exactly what a shield plus three hands already allowed, so nobody's kit is refused by this  
✎ Two shields at once are legal now, because hands are the only limit on what you hold

## 2026-09-09 · Wanted follows the face, and the Cerberon can hand it out

✎ A Wanted man is only read as wanted while he is under his own name — a hood or a Disguise Kit's false name now takes it off the read, which is what the tag always said it meant  
✚ An Arrest Warrant button for the Censor, the Sheriff and a Cerberus: type a man's whole name and he is Wanted. Costs nothing and puts up no paper  
✚ A Check Wanted button for every Cerberon — the warrant book, hoods and all  
✎ Drinking a Mulligan Potion clears your warrant. A new name is a new man  
✎ Engrave matches the whole name now, not the first name, so two dead men called Jorren can each get their stone

## 2026-09-09 · A filed Move is final, and the rope beats the arrangement

− A Move can no longer be edited once it is filed. You get one Move a turn and it stands; only a GM changes one now
✎ The filed Move reads on one line on the sheet — its kind joins the turn chips, its words sit under them — instead of opening a second row that tripled the box
✚ You can now take a prisoner off whoever is walking with them. Tying somebody up used to lose to a friend who had asked first, so a captor could not take their own captive
✎ Corpses and members of a faction you lead come off somebody else's party the same way. A willing follower still doesn't — you ask a person, you don't take them
✎ Being told you can't take somebody now says why, instead of the person quietly not being in the list at all

## 2026-09-09 · A name in an old line stays the name that was said

✎ Starred lines, journal entries and the transcript now read the way a line reads in the hall — they were showing raw braces and asterisks instead  
✎ Mentioning somebody records the name they were going by, so putting on a disguise or taking a new name no longer rewrites what an old line said  
✎ A conversation's member list shows somebody hooded as a stranger, instead of naming them and drawing their face  
✚ The @-mention role follows a disguise now, colour and all  
✎ A journal entry no longer names or draws a disguised character

## 2026-09-09 · The caves roll the die every time you walk in, not just the first

✎ Walking back into a cave location you already saw today rolls the Caving Die again — retreating through the dark is still walking through the dark  
− The one-roll-per-location-per-turn cap, which made backtracking out of the Depths silent and read as a broken die  
✎ Nothing rations rolls now but the walk cooldown on /gm/dev, so expect more finds and more Trouble on the Caving lens — raise that cooldown if it gets loud

## 2026-09-09 · The street has no mouth, and the floor says what it is

✎ The chat box is gone from a Location: there is a line there now saying to step into a room, the summary or a conversation to speak  
− Shouting from the open street. A shout is a voice, and the street takes none  
✚ Hover an item lying on a room's floor and it tells you what it is, instead of just its name  
✚ The same hover on the things in your own pockets

## 2026-09-09 · The map pinches to zoom on a phone

✚ Pinch to zoom the map, and a two-finger drag pans it  
✚ The zoom buttons and the places themselves are thumb-sized on a touch screen  
✎ On a phone the place card is a sheet laid over the map instead of a strip under it, so the map gets the whole screen  
− Tapping a place twice no longer travels there on a phone — the card's Go button does, so a stray tap cannot spend a crossing

## 2026-09-09 · Fear is now the Mood system, and it goes both ways

✎ Your mood is a word in its own box on the character sheet, between Carrying and Gambit die: Happy, Pleased, Content, Fine, Uncomfortable, Stressed, Anxious, Afraid, Panicking. Grey at Fine, red at Panicking, and hovering it says what moves it  
✚ A mood can now be GOOD. It runs +64 down to -100, so a drink, a decent meal or a night at the Inn is worth something to somebody who was already calm  
✚ Eating lifts a mood: any proper meal, a Fine Meal, sweets, honey, honeyed cakes, fish roe, a pumpkin, a coffee, a sky lantern, a firecracker  
✎ Only Afraid and Panicking are DM'd now, and only on the way in. The other seven bands say nothing — a player crossing into Stressed and back used to get two DMs about it  
✎ Only Afraid (-1) and Panicking (-2) touch the dice. A good mood is its own reward  
✎ Every mood drifts back toward Fine overnight now, from either direction — a fright wears off, and so does a good evening  
− The five Condition tags. The band is read off the number, so a GM can no longer hand-grant one that fights the dial  
✎ The GM's dial on the Dev Panel is "Mood", -100 to +64, and it finally shows the real value instead of 0 for everybody  
✎ Tea and a chrism's blessing say what they do in plain words instead of naming tags that no longer exist

## 2026-09-09 · Horses and carts no longer fit in a crate

− The Package button no longer accepts a Horse, Cart, Fishing Boat or Motorcycle  
✎ They carry no weight, so a crate of one came out at 1 lb and a hand-cart could be walked indoors as anonymous cargo  
✎ The Depot still ships a horse crated, the same as before

## 2026-09-09 · A hood works on Discord again, and the Bio card stops taking it off you

✎ A hood you chose to wear hides you on Discord again. Anything you typed on the website reached the channel under your own name and face, so the hood worked on the website and did nothing where people were reading it.  
✎ Saving your Bio card no longer takes your hood off. It used to clear the setting whenever nothing concealing was worn at that moment, so tidying your appearance, or ticking Play from the web, quietly unmasked you until you noticed — and you could not set it again until the hood was back on.  
✎ Looking back at something said under a disguise reads properly once the disguise has worn off. Every line said under one used to turn into an anonymous hooded stranger three turns later.  
✚ The Dev Panel shows whether someone is playing from the web, and whether they are concealed. Neither was visible to a GM anywhere before, and the conceal line says when the setting is on but nothing is being worn, which is the state a player reports as their disguise not working.  
✎ A message the bot cannot repost is taken down and handed back on one more path, where it used to be left in the channel under the player's real Discord name.

## 2026-09-09 · Speak is a slash command now, not a button

− The 🔊 Speak button on the #turns console  
✎ /message opens the compose box wherever you run it, and tells you where to run it if you can't speak there  
✎ The button's destination picker could never list a Room thread or a Conversation, which is exactly where talk happens

## 2026-09-09 · The Supply Kit says what it is for

✎ The Supply Kit's description: "Open it to gain resources and a nice surprise."

## 2026-09-09 · The End turn confirm just asks

✎ Ending a turn asks the question and nothing else — the paragraph explaining Needs, the upkeep and the channel wipe is gone

## 2026-09-09 · The horse spends its own free move first

✎ A rider who stables their horse at an indoors door keeps the free crossing they never spent. Riding in used to be charged to your own move, and then the horse's move left with the horse — two crossings, one ride, none left.  
✎ The same for a boat: crossing the water no longer eats the crossing you had on land

## 2026-09-09 · The turn's effects read as one line

✎ What the turn will change now reads as one wrapping line separated by dots, instead of a list that made the box taller than the turn card beside it
✎ Past three effects the rest fold behind a "+N more"
✎ The Butcher button's icon is a ham. It was meant to be a cleaver, but an outlined rectangle at that size reads as a saucepan
− The Carrying tile no longer opens a breakdown when clicked — it is a number like the three beside it

## 2026-09-09 · A burial and an engraving are heard where they happen

## 2026-09-09 · Four things about you, and the buying screen tells the whole truth

✚ You can keep four things about you at once; the equipped rig counts them like it counts hands  
✎ The head's outer layer is named Outer, the same as the body's  
✎ The buying screen now says who else can see a tag, whether it conceals you, what it weighs, how long it lasts and where it is worn  
✎ Armour values are back on the buying screen, having quietly shown nothing at all

## 2026-09-09 · Location channels go quiet on Discord too

✎ Players can no longer type in a Location channel on Discord, the way they already couldn't on the web  
✎ The channel doctor no longer throws everyone out of a Location channel when it runs in full

## 2026-09-09 · Randomizing a portrait now suits the character's gender

✎ The masculine hairstyles are men only now; the unisex ones stay open to anyone  
✎ A woman no longer randomizes into a beard, and a man still can  
✎ The picker itself is unchanged: every style is still there to pick by hand

## 2026-09-09 · Merge PR #31: Scholastics can research secret recipes in the Cathedral

✚ The Scholastic can Research an ingredient they are carrying, in the Cathedral. It takes the Move as a Gambit, and the answer arrives at the end of the turn  
✚ A 6 or better turns up a recipe nobody else can see — one of the seven GM-only craftables, dealt once per character and minted as a note in their hands  
✚ Every failed attempt on the same ingredient makes the next one easier, so a sixth try cannot miss. It resets once that ingredient gives something up  
✚ A Research button on the tag's own row, and on the Cathedral's place card in Chat

## 2026-09-09 · Take Pyrias's tag description rewrites

✎ 152 tag descriptions rewritten from PR #33 — the double daggers are off  
✎ Only the wording changed; no tag was added or removed by this

## 2026-09-09 · The buttons in Bascinet's messages work on the web

✎ Anything the game asks you to answer by message — a lesson, a confession, a bind, being taken along, a seat, a spawn, holding a door open — now has its Accept and Decline in the Bascinet pane, not only in Discord  
✚ Somebody playing entirely on the web can take a seat now. Before, the offer arrived and there was nothing to press  
✚ An offer that has already been answered, or run out, stops showing buttons instead of leaving a dead one to click

## 2026-09-09 · Click a place twice to go there

✚ Picking a place twice travels — on the map and in the Travel panel — so an ordinary hop no longer means clicking the place, crossing to the card, and clicking Go  
✚ Enter goes to the place you have picked  
✎ The walk cooldown drops from 60 seconds to 3  
✎ A way you hold no key to now says "This way isn't open to you."

## 2026-09-09 · A nekker is lighter than it was

✎ A nekker corpse weighs 35 rather than 45 — a spindly thing should be the lightest body you can pick up, and it was sitting closer to a person than to its own description.

## 2026-09-08 · Structures are in the recipe book, and a body weighs what it weighs

✚ Bodies weigh something now. A person is 50 lb — under the 71 lb cap, so you can carry someone and still walk with your kit. Giant makes a heavier body and Dwarf or Frail a lighter one; a frail dwarf is 28 lb.  
✚ And whatever is still on them comes too, since their gear never leaves their sheet. A body in full plate is 105 lb, which is about the most anyone can shift — strip it first and it drops back to 50. Strong deliberately doesn't make you heavier dead; it isn't a tax on a trait somebody paid for.  
✎ Structures now appear in the Recipes tab. They were being dropped on the grounds that raising one isn't crafting, but it is the same Craft button and the same recipe, and a player planning a Palisade had nowhere to read that it costs four turns and 40 ⬢.

## 2026-09-08 · Cave characters come back to the GM desks

✎ Characters standing in the Caves or the Depths are on the player desk again, for a GM who has picked their zones  
✎ Their conversations are back in the inbox, so a DM from someone underground can no longer go unseen  
✎ Caving rolls reach the Underground GM instead of nobody
## 2026-09-09 · The new sheet is the character page now, and the Ledger is gone

✎ /character is the rebuilt sheet: the band with your Move and every verb, the equip rig, and your tags as rows in cards. The old chip-and-panel sheet is gone.  
− The Ledger entry on the rail. Its address still works and lands on /character, so an old link is not broken.  
✎ The sheet scrolls as one page again. The columns were each scrolling inside themselves, which was wrong for a page where nothing arrives while you read it.  
✎ The Move button sits beside the day and phase instead of below them, so the turn box is a line rather than a block.  
✎ Routine, Gambit and Labor are explained on the web in the same words the Discord modal uses.

## 2026-09-08 · The silo picker stops naming rooms you have never seen

✚ "Where does the faction bank?" now only offers rooms the officer has stood in and can open — it used to read out the name and address of every secret room in the district, the Inn's Cellar and the Order Chambers included  
✎ The faction's current silo is always on the list, even for an officer who has no key, so re-pointing it can never blank out  
✎ An officer with no key can no longer move the silo behind a door they cannot open — depositing into a locked silo is unchanged

## 2026-09-08 · Stealth reaches the gates, and a forger can copy any stamp

✚ Stealth is a real skill now: cross an unwatched gate and it announces nothing at all, cross a guarded one and it records only what a passer-by saw, not your name  
✚ A forger can craft every wax stamp in the game, the Baron's and the Bishop's included — so the only two routes to a Baron's mark are taking it off the Baron or forging one  
✚ A gibbed death leaves no corpse behind at all, just a Gibbed mark where the tags were  
− The Inscrutable tag, and with it the rule that shut your Desire to every reader  
✎ Ambush Predator costs less, and it, Forger and Mountaineering all say what they actually do

## 2026-09-08 · The travel lines say you'll arrive next turn

✎ "You arrive next turn" now reads "you'll arrive next turn" everywhere it appears, the two departure lines included, so they all match
## 2026-09-08 · The sheet on /ledger is rebuilt, and equipment goes in slots now

✎ Your tags are rows in cards by kind now, not one heap of chips. Wounds sort by how soon they turn and say what they become and what the cure costs; skills group by family and show the next rung; items group by kind with their weight against your cap.  
✎ Click a tag and it opens where it sits. Items and wounds carry Use, Equip, Give, Destroy and Heal on the row itself.  
✚ A search box over your tags, for the sheets that have got long  
✎ The top of the sheet holds still while the columns scroll: your Move is filed and edited from there, your state and carry are on it, and every verb is one row of buttons instead of a panel. A greyed verb says why when you press it.  
✚ A line saying what the turn will change: what runs out or turns worse, what finishes, where you arrive, and whether dinner is covered  
✎ Escape takes you back to the game from the sheet.  
✎ Equipment is places on the body, not a count of six. Three head layers, three body layers, an off hand, three hands, a ride and what it tows, and as many small things as you like. A two-handed weapon takes two hands. So a bastard sword on the back and a pistol on the hip, but not eight swords.  
✎ The rig draws those places: click an empty one and it lists what you carry that fits. It will not offer a cart indoors or a boat beside a horse without saying why.  
− The flat equipment-slot number on the Dev Panel

## 2026-09-08 · A traveller can walk their own zone while they wait on the road

✎ Spending your Move to cross into another zone no longer pins you in place for the rest of the day — you can still walk the zone you set out from and talk to whoever is in it  
✎ The roads out of the zone draw closed while you are on one, and say where you are already headed  
✎ You land at the place you paid to reach whichever corner of the zone you spent the day in, and there is still no turning back

## 2026-09-08 · The Unlocks list on a tag stops printing bigger than the tag itself

✎ The "Unlocks N Desires" block on a tag now reads a step smaller than the tag's own description, instead of a step larger than it

## 2026-09-08 · Nothing said while the bot is asleep is lost any more

✚ Messages typed while the bot is down are recovered when it wakes. Under two hours old they go back in the room as the character, exactly as if the bot had caught them live. Older than that the words are kept in the archive and the raw message is taken down, but the scene is left alone — dropping an hours-old line into a room that moved on reads as talking to yourself. The author gets one quiet note either way.  
✎ The real problem was worse than the missing words: until the bot came back, the message sat in the channel under the player's own Discord name, for anyone to see. That is the half this closes first.  
✚ The bot now also checks after a dropped connection, not only after a restart. Everything else it catches up on runs once per process, which was fine for a stale nickname and not fine for somebody's words.  
✎ A channel the bot can't tidy up in is left alone and logged, rather than reposting a message it can't then remove — that would duplicate it on every restart until the next wipe.  
✚ The bot has tests now, for the first time.  
✎ Two door notices were still tagged the old way after the inbox rework.

## 2026-09-08 · The GM inbox shows the last message again, not the player's role

− dmPreview hands back the line itself; the rail and the live delta were still reading it as { preview }, so every row a GM message touched showed "Baroness" or "Commoner" in place of the message

## 2026-09-08 · Chat stays in the room you opened

✎ The open room no longer jumps back to the street when the page refreshes itself, and a bare /play comes back to the room you last had open  
✎ Chat's live stream reconnects itself after a drop — a phone waking, a blip, a redeploy — and picks up exactly what it missed; it says Reconnecting… when that takes a while, and a signed-out tab says so instead of retrying forever  
✎ Walking, keys and conversations refresh the right column quietly, with no blank flash, and a reconnect no longer refreshes the whole page  
✎ What you typed in one room stays in that room: switching rooms starts the box clean and brings the words back when you return  
✎ Notice cards, faces and the members strip loading no longer shove you off the bottom of the scene  
✎ The phone's tab strip scrolls to the open tab  
✎ The column's once-a-minute re-reads pause while the tab is hidden  
✎ "Add to …" on a person now says why it was refused  
✎ A mention's browser notification opens the place it happened in, the turn notification opens the Bascinet pane, and tapping one no longer reloads a Chat that is already open

## 2026-09-08 · The buttons overhaul: every action answers back, and the Dev Panel stops asking why

✎ Every button on the sheet and on /play now says what it did, in a small notice at the corner of the screen — "Ada is tied up.", "Took 3 Paper from the Cellar.", "Ada has to agree first."  
✎ Recall Comrades, Recover Equipment, Use Pointer, Arm/Disarm and Extract run on the click, with no dialog; a one-line confirm where the Move is spent  
✎ Recall Comrades shows the roster on the page instead of DMing it; Recover's button says what it will hand back and greys with "You have both."  
✎ Every greyed-out action explains itself in its tooltip  
✎ Transfer, Loot, Take, Drop and Give are one dialog: two chip rows for the direction, then a count per stack. Destroy, Package and Purchase Gear pick the same way  
✎ Opened from a person's own row, Bind, Free, Torture, Crucify and a one-affliction Heal ask their one question and run  
✎ Small pickers are chips, not dropdowns: who you're treating, whose body, which room, which skill  
✚ The HERE list on /ledger, above the Actions rack, with the same per-person menu /play has  
✎ An empty dialog shows the sentence and Close, not a dead Confirm  
✎ Opening a dialog no longer re-renders the whole sheet; it reads its own roster  
✎ On a phone every dialog is a bottom sheet with the buttons pinned in reach  
✎ On the Dev Panel, Kill, Restore turn and Spend turn are one confirm each, and Transfer ⬢ no longer demands a typed reason

## 2026-09-08 · The GM inbox stops shouting, and the loading flashes are gone for real

✎ Every DM now says how much of the GM inbox it deserves, so system notices stop crowding real conversations off the players desk — a forgotten one is quiet now rather than loud  
✎ The page skeletons are actually gone this time: an earlier push kept the files by mistake, so pages were still blanking out on the way to the next one  
✚ A Seats Out table on the Dev desk — who has been offered a seat, not taken it yet, and how long they have left  
✎ Portraits and avatar uploads are on by default; a game no longer starts with faces switched off and nobody remembering to turn them on  
− Soundproof rooms

## 2026-09-08 · A dead character keeps Bascinet's messages, and the desk stops throwing

✚ A player whose character has died can still read and answer Bascinet on /play. The messages column used to vanish with the body, which left a web-only player no way to read a DM at all  
✎ The GM players desk was failing on every load — two things it used were never imported  
− Spawning a threat no longer offers roles that are seats of their own as a cover role  
✎ Assign now says so when it works, and says so when the seat lands but the DM does not  
✎ A push refuses to ship code importing a file git does not have, which is what left the site on a stale build for 25 minutes today

## 2026-09-08 · Egomaniac is gone, and the escort note stops stuttering

− The Egomaniac tag is removed from the catalog — it was buyable but gated by nothing, and it was never part of any role's kit  
− The note telling you somebody is travelling with you no longer opens with a doubled quote mark

## 2026-09-08 · One header on every page, and the click lands before the page does

✎ Every page wears the same header bar now, with the zone, day and phase in it — the turn no longer floats in the corner of the screen  
✎ Clicking in the sidebar keeps you on the page you are reading until the next one has actually loaded, instead of blanking it to a skeleton  
✎ A caving roll is filed under the zone the die rolled in, not the roller's faction seat — a Factory member down in the Caves was showing up as Marshes, and was invisible to the Caves GM  
✎ Somebody pinged from Discord shows up as a person in Chat now, even if they are standing somewhere else; it used to print raw text  
✎ /shout clears the box the moment you send it  
✎ The Audit desk's header is the same height as every other desk's  
✎ A whitelisted role wears a dashed border in the lobby too, whether or not you hold the whitelist

## 2026-09-08 · Egomaniac is handed out, not bought

− Egomaniac is off the tag store and out of character creation — a GM grants it

## 2026-09-08 · Walking only frightens you so much, and the times in your messages read as times

✎ A long day's walking can only frighten you so much now. The wild and the caves still cost you for every step you take into them, but what the walking alone adds in one day stops at a point. A Refugee cutting Godflesh out of the marshes was reaching Uncomfortable on the first afternoon just by doing the job the role exists to do.  
✎ Times in your messages read as times. A seat offer that showed you a raw tag now gives the actual date and a live countdown, in your own timezone, on the website as well as in Discord.  
✎ The quiet grey aside at the bottom of a message reads as a quiet grey aside, instead of starting with a stray -#.  
✎ Mentions, channels and emoji pasted into a message no longer show up as a row of numbers on the website.  
✎ The GM inbox stops treating every automatic message as mail. A seat assignment or a bird letter is a notice now; only something a person actually wrote for you sorts to the top.  
✚ A GM can lift a wrongly-applied curse from the character dev panel, instead of the player needing someone to engrave them a headstone.  
✎ A starred line from a masked speaker shows the face the room saw, not the speaker's real one.

## 2026-09-08 · Tying someone up takes the carry out of their voice

✚ A bound character's shout no longer carries. The people standing with them still hear it — someone who can see you tied up can obviously hear you — but it stops there, and every copy of it says ", but it's muffled."  
✎ Bound still does not refuse a shout, and never will: a hostage who cannot call out is a hostage nobody can play. It costs the five-minute throat timer like any other shout, and shows no error.  
✎ Two things muffle now, at two distances. A soundproof room is sealed and nothing leaves the thread; being bound is a gag and the shout reaches your own place and stops. Bound inside a sealed room is sealed.  
✎ The Bound tag now says so on the sheet.

## 2026-09-08 · Door notices stop reading as GM mail

✎ "You were let into ..." no longer lands on the GM desk as if somebody had typed it. Same for "You were named in ...", which is a ping, not a message.  
− The double dagger on the "let into" line, on both faces.  
✎ The website's DM sender now labels an unattributed message as the bot's, the way the bot's own sender already did. That is the leak this pair came  
✎ The inactivity nudge is signed by the GM who sent it, so it still reads as a real message and shows who wrote it.

## 2026-09-08 · Shouts name who shouted, and some rooms swallow them

✎ A long day's walking can only frighten you so much now. The wild and the caves still cost you for every step you take into them, but what the walking alone adds in one day stops at a point. A Refugee cutting Godflesh out of the marshes was reaching Uncomfortable on the first afternoon just by doing the job the role exists to do.  
✎ Times in your messages read as times. A seat offer that showed you a raw tag now gives the actual date and a live countdown, in your own timezone, on the website as well as in Discord.  
✎ The quiet grey aside at the bottom of a message reads as a quiet grey aside, instead of starting with a stray -#.  
✎ Mentions, channels and emoji pasted into a message no longer show up as a row of numbers on the website.  
✎ The GM inbox stops treating every automatic message as mail. A seat assignment or a bird letter is a notice now; only something a person actually wrote for you sorts to the top.  
✚ A GM can lift a wrongly-applied curse from the character dev panel, instead of the player needing someone to engrave them a headstone.  
✎ A starred line from a masked speaker shows the face the room saw, not the speaker's real one.

## 2026-09-08 · The cargo bay stops at the gate, and a trade is a trade

✎ The Merchant, the Docker and the Mercenary no longer start knowing the Migrants' camp, which was handing them the brooding grounds and both mouths of the Depths on their first morning. The Migrant, who lives there, still does  
✎ A Commoner who bought a laboring specialisation outright no longer gets a free Farmer crate on top of it  
✎ Seeding a character's memories no longer re-queries their tags once per remembered place

## 2026-09-08 · The sheet's auto-refresh stops doing work nobody can see

✎ Follow-up to this morning's Bind fix. The page was quietly re-loading itself whenever anyone at your Location was tied up or walked past — none of which changes anything on screen until you open a dialog, and dialogs now re-read the room themselves. In a crowded Town that was thirty people all reloading at once every time a turn moved them.  
✎ The one thing kept: 'Waiting for so-and-so to agree to be bound' now clears itself when they answer in Discord, because that line really is on the page.

## 2026-09-08 · Bind, Free and Loot stop needing a page refresh

✎ Somebody accepting your Bind in Discord now shows up on your sheet on its own. It always worked in the game — your page just never heard about it, so Free offered nobody and Loot refused, until you reloaded.  
✎ The same blind spot hid somebody walking in, somebody dying, and a hood going up or coming down. All three now reach the page.  
✎ Every action dialog re-reads the room as it opens, so bind, wait for the yes, then loot works with nothing in between.

## 2026-09-08 · Nobody wakes up blind, and no commoner wakes up without a trade

✚ Every seat now starts remembering the places its life would have taught it: the home cluster, plus the road that trade actually walks. A Headman opens the map already seeing the Farms he taxes; a Banneret sees every step of the run up to town  
✚ A Commoner who picks no kit now starts a farmer, instead of being able to labor but at nothing in particular  
✎ The Commoner's description is rewritten: the kits, where each trade actually pays, and what the Headman takes

## 2026-09-08 · Mute stops you shouting, not talking

## 2026-09-08 · Pruning a zone takes its channels down with it

− A retired zone no longer leaves its location channels standing in Discord

## 2026-09-08 · The shuttle stops asking for a zone sync

− The landing pad is found again, so calling and sending the shuttle works

## 2026-09-08 · A mask hides your face on the web, not just your name

✎ Wearing something over your face now changes the portrait beside your words on the web, the way it already did on Discord — a hood, a helm or a mask shows itself instead of you  
✎ Everyone in the same mask looks identical, on purpose: the picture says what is over the face, never who is behind it  
✎ A character under a forced name wears that name's plaque instead of their own face too  
✎ The face is recorded with each line as it is said, so taking a mask off never uncovers what you said while wearing it

## 2026-09-08 · Give the character sheet its Torture and Mutilate buttons back

✎ Torture and Mutilate never appeared on anyone's sheet. Both pages worked out who was allowed to press them and then threw the answer away before the buttons could read it, so they were always hidden — on the Ledger too.

## 2026-09-08 · The Assign button on the Antagonists desk actually assigns

✎ Pressing Assign on a threat seat did nothing at all — no confirm, no error, and the button then sat dead until the page was reloaded. No seat has ever been handed out that way. It asks and assigns now.  
✎ The party rack on the play page loads again for anyone with a pending "come along with me" ask, instead of failing outright

## 2026-09-08 · Give the Ledger's actions their names back

✎ On the Ledger, every action is a labelled button now — the glyph and the word, big enough to read without hovering  
✎ Its sections stand side by side in columns with a rule between them instead of stacking, which is what all that width is for  
✎ The narrow rack on the Character page is untouched

## 2026-09-08 · Open the Ledger to everyone, and let it fill the screen

✚ The Ledger is on every player's rail now, not just a superadmin's — it is there to be looked at  
✎ It takes the whole width instead of sitting in a narrow centred column  
✎ The Conceal switch lost its full stop, and the crafting panel says "Nothing in progress" when there is none

## 2026-09-08 · A second character sheet on /ledger, for superadmins only

✚ A new Ledger page: the same character, laid out as a banner of numbers over three columns — bio, everything you do, and your tags spread down a rail  
✚ Free moves, Resources, Carrying and the Gambit die now read as four tiles at the top of it, over the Move you filed this turn  
✎ Tag cards no longer split "Items" from "items" — one card per category, however the catalog spells it

## 2026-09-08 · Fix Restart Game failing on the lesson handshakes

− - it cascades from Character, which goes first.

## 2026-09-08 · Add a playtest-only switch for who may join

## 2026-09-08 · Stock the caves with thirteen more things to find

✚ Five new items: Rock, Rope, Purring Maggot, Maggot Milk and the Mining Helmet  
✚ Thirteen more entries on the caving loot table, from a rock at ultracommon to a Fragmentation Grenade and a Neoclassic Duelista at the top  
✚ Rocks are simply lying around in thirteen rooms across the Caves, the Depths, the Black Hills, the Mountain and the Headwaters, so the ground is a source and the die is a bonus  
✚ A Purring Maggot poisons you raw, but anyone with Brewing can squeeze one into a cup of Maggot Milk for 1 resource: it steadies the nerves exactly as much as tea does, and counts as a proper meal  
✚ The Merchant now sells the Mining Helmet at 14 resources and buys a Fragmentation Grenade off you for 24  
✚ Rope is craftable with no forge, for 4 resources

## 2026-09-08 · Put three rooms on the mountain pass

✚ The Mountain has a Hanging Steps, a Summit worth searching, and a warm Garden under the ice that only a caver finds  
✚ Nightshade herb, poppy pods and coca leaves grow in the Garden — the first place in the game that actually has them

## 2026-09-08 · A horse eats a resource a turn

✎ Holding a Horse now costs 1 ⬢ at the close of every turn, whether it is out or stowed in your pack  
✎ The horse is fed before you are, so a rider down to their last ⬢ keeps the animal and goes Hungry  
✎ Nobody short of the ⬢ is charged, and nobody loses their horse over it

## 2026-09-08 · Once you set out for another zone, you are on the road until next turn

− The Turn back button is gone from the Travel button on Discord and from the travel panel on Chat  
− A paid zone crossing still spends the Move when you confirm it, and you still arrive at the next turn

## 2026-09-07 · The GM desks paint at once on a return visit

− The player roster, a player's conversation, the turns workspace, the audit log, Crafts, Structures, the tag catalog and the dev panel all keep their last data in your browser and draw it in the first frame; the server's answer replaces it a moment later

## 2026-09-07 · Documents, the Depot and Notes paint at once on a return visit

− Three more pages keep their last data in your browser and draw it in the first frame; the server's answer replaces it a moment later

## 2026-09-07 · The character sheet paints at once on a return visit

− Your sheet keeps its last data in your browser and draws it in the first frame the next time you open it; the server's answer replaces it a moment later  
− Signing out clears every stored page

## 2026-09-07 · Chat paints at once on a return visit

− Chat keeps its last data in your browser and draws it in the first frame the next time you open it; the server's answer replaces it a moment later, and the live stream fills the gap  
− The stored copy is per account and is cleared when you sign out

## 2026-09-07 · Shouts carry one hop less, and the far ring says only that someone shouted

− A shout reaches three Locations out instead of four  
− At the last ring you hear that someone shouted and which way, with no garbled words: at that much static the text said nothing anyway

## 2026-09-07 · The Hall is called Chat now

− The Play page's header, every line that named the Hall, and the doc that describes it (CHAT.md) all say Chat  
− Under the hood the same rename: the components, the styles, the hook names. The keys that remember what you have seen and whether the bell is muted keep their old names, so nothing is forgotten

## 2026-09-07 · Chat fits the screen it is on

− Rooms in the left column show their description when you rest the pointer on them  
− Three widths above the phone now: the side columns shrink at 1200px and the right one folds into the ⋯ sheet at 900px, so a mid-sized window keeps a readable scene  
− The ⋯ that opens the sheet on a phone finally shows, and the floating turn chip no longer sits on top of it  
− The place card in the right column flows instead of scrolling inside a 12rem box  
− Clicking an icon button no longer pins its own label open with a ×

## 2026-09-07 · Travel cards stop cutting their descriptions off

− A location card on Travel is as tall as its three-line description needs, ends on a real ellipsis, and keeps the cost on one line under a hairline instead of squeezing the text above it

## 2026-09-07 · Paper reads like paper

− A letter, a notice, a book you hold and the text already on a sheet in the Write dialog all draw as one serif sheet now, with the writer's markdown rendered: bold, lists, quotes  
− The refusal a blind or illiterate reader gets stays flat text, so it cannot be dressed up as a letter

## 2026-09-07 · A ping reaches you in Chat too

✎ Being mentioned now shows up in your Bascinet thread on the web with an Open link to the place, the same as the DM you get on Discord  
✎ The GM desk still hides those relay lines; they are for the player

## 2026-09-07 · Bascinet logs every DM it receives

✎ A message typed to Bascinet in Discord is written to the DM record with a log line either way, so a lost one can be traced instead of vanishing  
✎ Restart Game wipes the DM thread; the Chat doc said otherwise

## 2026-09-07 · A locked Desire slot says how long it stays locked

✎ A slot on cooldown now reads Locked (1t) — turns left — instead of Opens on turn 3, on the sheet, in Chat, in the picker and on the GM's Goals tab

## 2026-09-07 · Overheard whispers give up a little more

✎ A room overhearing a Conversation now catches about 35% of the letters instead of 30% — the static is a notch lighter

## 2026-09-07 · The Bascinet conversation, tightened after review

✎ Paging back through a long conversation no longer skips messages that landed in the same instant, which a turn push does.  
✎ If the conversation fails to load it says so and offers a retry, instead of grey bars forever.  
✎ A player whose character died with the page open can still read Bascinet and write back.  
✎ A tab parked on Bascinet no longer swallows the dot and the chime while nobody is looking at it.  
✚ Writing to Bascinet is capped at twelve messages a minute, and stops when the Play page is switched off.

## 2026-09-07 · You can cut pieces off people

✚ A Mutilate button, for anyone Cruel, a Torturer, or one of the Thanati. Take one piece off somebody tied up here, or off a body you can reach — an eye, a tongue, a hand, a foot, a stomach, a heart  
✚ The piece is yours to keep, and it stays where you can trade it. Nothing eats one yet  
✎ Taking an eye leaves them Missing an Eye; taking the second leaves them Blind. A foot, then the other, leaves them a Cripple. A hand goes to Missing Fingers, then Missing Arm. The tongue leaves them Mute  
✎ The stomach and the heart kill somebody still using them. A corpse just keeps the mark  
✎ It costs nothing at all — no Resources, no Move, no turn. Press it again for the next piece, and it leaves the body where it lies  
✎ Losing a piece is worth 50 on the fear dial. A corpse feels nothing

## 2026-09-07 · Bascinet writes to you on the Play page now

✚ A Messages row at the top of the Play page's places column: Bascinet, the whole DM conversation — turn results, the Bird, GM replies — live, with a box to write back. What a player types there lands on the players desk like any DM, marked as sent from the web.  
− Yesterday under YOU. The same lines are in the Bascinet conversation, every day rather than only the last close.  
✎ A player never sees which GM answered: every reply reads as Bascinet.

## 2026-09-07 · Put back the desk and Hall pass that got reverted

✎ The desks and the Play page wear one header again, with same-sized bubbles  
✎ Each desk's loading screen draws the frame it is about to become, so the page stops jumping when it lands  
✎ The Search box on the players desk sits clear of the header again  
− The entry count on the audit log, the tracked-player count on the players desk, the Report to the GMs button and the Dev Panel's Recompute unspent Tag Points button  
✎ Room storage is clickable again, the room buttons read Drop, Take and Transfer, and a way out says where it goes  
✎ The unread dot only lights for something meant for you, not for scenery  
✚ Naming somebody on the Play page now adds them to the conversation, the way naming them in Discord already did  
✎ A broken wax seal is not a wax stamp, a letter is called A Note, and the Desire slot lock is one turn — all three were true in the database and had been undone in the code

## 2026-09-07 · The Play page has an off switch

✚ A Play page switch in the Dev panel's Features group, on by default. Off, Play leaves the rail, /play sends people to their sheet, and ⌘K stops offering places and people.  
✎ While it is off, Play from the web is shown only to a player already playing that way, so they can come back. Nobody is switched back automatically — check the players desk for web-only characters before turning it off.

## 2026-09-07 · The buttons stop explaining themselves, and books are crafted now

− Craft, Destroy, Transfer, Write, Butcher, Free and Search lose their tooltips, and eleven explanatory paragraphs come out of the dialogs. The empty states and the refusals stay.  
✚ Learn, Teach, Confess, Seal, Bury, Engrave, Bind and Move Player say one short true thing each instead
✎ The Dead folds into People Here, which is now Others. Letters is now Paper  
✚ Transfer reaches a concealed person, listed by their alias under an opaque handle, so a hood never has to say who it is to be handed a coin  
✚ Transfer also takes from someone bound or dead, which is Loot — same rules, same fear, same notice, one implementation  
✚ A blank book is an ordinary craft recipe: ten paper, no skill. Write fills one, with a title  
− Bind a Book and Tear Up a Book. A book is permanent now  
✚ A recipe can ask for ten of an ingredient (`count:`), and every surface that prints a recipe says the number

## 2026-09-07 · The Play page forgets the last game, and the dev panel stops explaining itself

✎ The Hall no longer shows the last game: /play is empty after a Restart instead of full of dead characters still talking  
− Every tooltip, section blurb and how-it-works paragraph on the GM desks  
✎ A shout arrives on one line now, instead of breaking the words onto a second  
− The double dagger on any string of four words or fewer, since there is nothing to rewrite in "Save"

## 2026-09-07 · Roleplay channels wipe every turn now, Summaries still at Dawn

✎ Location channels, Rooms and Conversations are cleared at the end of every turn instead of every other one — a scene lives for one day, not two  
✎ A Zone's Summary channel still only clears at Dawn, so what is posted there has two days to be read  
− Five Dev Panel settings nobody had ever moved: the message-wipe switch, the Desire and Catatonic master switches, auto-reconcile after a turn, and the web-only cooldown  
✎ The channel doctor's cheap reconcile now always runs after a turn advance, rather than waiting on a switch that was off

## 2026-09-07 · The Steam Automobile is gone, and a Javelin arrives

− The Steam Automobile, and the banneret desire to buy one. Nobody owned one, and the Merchant no longer stocks it  
✚ A Javelin — a Simple throwing weapon, 6 ⬢ and a turn at a forge, and it needs Ranged (Basic) to throw  
✎ The biggest ride in the game is now a horse and cart, seating six

## 2026-09-07 · Destroy is for things you own

✚ You can now throw away a letter, a book, a wax seal, a helmet or a suit of armour — 119 things that were stuck to you before  
− The Destroy button is gone from Beliefs, Torturer, Hypochondriac, Mime's Vow and Bound. Converting a Belief mid-game is a GM's to make now  
− Green is out of the game entirely, along with the Win your first ever fight Desire that was gated on it  
✎ Seven things stay un-binnable on purpose: the three monster corpses, the Nuclear Device and its Datacard, the grafted nerve braid, and the bolted-down crating bench

## 2026-09-07 · A Faction section and browser notifications on the Play page

✚ A Faction row in the places column opening your roster, with ⬢ for the Leader and Treasurer, and a way to the silo  
✚ A Notify me button beside the bell: a browser notification when you are named and when the turn opens

## 2026-09-07 · Your things, your letters and your hood on the Play page

✚ A Things drawer under You: every item and asset as a chip, with Equip, Use, Give and Destroy  
✚ A quill beside the box: Write, Seal, Bind a book, Send by bird, the sheet's own dialogs  
✚ A hood button beside the box to conceal or show your face; the box then names your alias  
✚ A Depot link at Customs for licence or keycard holders, and Extract on Godflesh ground

## 2026-09-07 · Slash commands, member controls, search and notices on the Play page

✚ Type / in the box for a command list; a chosen command becomes a chip with its own pickers: /move /travel /conceal /shout /roll /add /remove /converse /look /report  
✚ Conversations and private rooms show their members under the name, with × and an always-visible Add button  
✚ Search the scene from the magnifier in the header; results jump to the line  
✚ Pinned notices sit as cards at the top of the street feed with Read and Tear  
✚ ⌘K knows your places and the people standing with you  
✎ The feed no longer flashes empty while it loads, and every place is prefetched  
✎ Storage is chips built from the room's rows, and the column renders markdown instead of showing -# and **  
− A shout on the web is heard on Discord and kept in the archive; a die cast on the web is a line on both faces

## 2026-09-07 · The editor's copy pass, applied

− The Teaching Skills doc no longer says the teacher has to be standing where you are  
− The last of the draft marks are gone from the handbook, the documents, the roles, the Craft dialog and the player action strings

## 2026-09-07 · Torture: a Torturer can break a bound character for their secrets

− A Torture button on the character panel for anyone holding Torturer. Pick someone Bound standing where you are; one die, resolved on the spot, and it spends your Move  
− A break DMs the torturer the victim's true name and face, every tag but wounds and statuses, their last three fulfilled Desires, and the Thanati roster if they led it  
− Being tortured is +40 fear whether you break or hold, unless Pain Immunity or an Opium High numbs it. Breaking also leaves you Depressed  
− Brave characters break on a 5 or 6, Relentless only on a 6, Craven on anything but a 1. A 1 always fails  
− Cruel, a carried Trench Knife, and Torturing Equipment in reach are each +1 on the roll; Hungry, Afraid and Panic count against it like any Gambit  
− Torturing Equipment: a new kit a Torturer builds from a work knife, a hatchet and a cudgel for 2 ⬢. One waits in the Order Chambers  
− Torturer now reads "You can torture people." Every Order role but the Preacher starts with it

## 2026-09-07 · The Dinner row is gone from the character sheet

− The Dinner row on the character sheet. A noble who skips a proper meal finds out the way everyone finds out about fear: the status tag, and its one-line DM.

## 2026-09-07 · Merge PR #23: the crafting pass — real recipes, the Move economy, custom craftables, and the recipe book

✚ Recipes are enforced: every ingredient in the brewing, smithing and cooking tables is spent when the work starts  
✚ A turn's craft Routine is a budget: small crafts share one Move in fractions, and one Routine no longer buys 99 of anything  
✚ Custom craftables: badge, hat, painting and a cook's meals can be made as your own for +1 ⬢, and the wayside shrine takes an inscription  
✚ A Recipes tab on /documents, and a read-only /gm/crafts desk  
✎ Prices moved: white-honey 6, succubus 8, grenade is now Crude Grenade under Smithing, bomb needs black powder, moonshine spends a Godflesh  
✚ Art Supplies at the Depot; four new forageables (nightshade, raven's eye, poppy pods, coca leaves) that nothing drops yet — GM grant for now

## 2026-09-07 · A hidden fear dial under every character, and the phobias that sharpen it

✎ Every character now carries a hidden fear dial. Nights in the wilderness or the caves, wounds, hunger, a bad Caving Die, being bound or crucified and a death nearby all raise it; a roof, the Inn, the Keep or the Sanctuary, a drink, a lavish meal, tea, a smoke, a musician's playing, a confession and a fulfilled Desire lower it.  
✚ Five status tags show where the dial sits: Uncomfortable, Stressed, Anxious, Afraid (−1 to Gambits) and Panic (−2). A player gets one plain DM when the band changes.  
✚ A Fear intensity knob on /gm/dev, and the dial itself shown and editable on each character's Dev Panel.  
✎ Phobias are multipliers now: Claustrophobia doubles cave fear, Agoraphobia (new) the wilderness, Hemophobia (new) wounds, Teratophobia triples a bad Caving Die, Pyrophobia triples burns. Acrophobia is gone.  
✎ Brave costs 5 and halves all fear. Rough Camper halves the outdoors and the caves; Outsider and Spelunker (new, 1 pt each, behind Rough Camper) cancel one of the two. Pale halves the caves.  
− Disappointed. A noble who ends the turn without a fine or lavish meal takes fear instead, and the Merchant is Nobility now too.  
✎ Fine meals no longer calm anyone; lavish meals do.  
✚ Rough Camper on both Brigands, the Tribune, the Ordinator, the Fisherman, the Mercenary, the hunter kit, the Demoness and the Judge; Outsider on the Brigands, the Tribune, the Ordinator and the Judge; Brave on the Ordinator and the Judge; Spelunker on the Mercenary.  
✚ Wilderness and Haven markers on Locations, which Examine prints.  
✎ Also riding along from other sessions: the 71 lb carry cap, the Underquarter basements and sewer, and a fix to who may work a room's door.

## 2026-09-07 · The Play page shows your turn, your Move, your state and your Desires

✚ A turn card in the right column: the phase, when Moves close, and the Move you filed with an Edit button until the lock  
✚ A status strip: ⬢, carry, and every Status or Health tag you carry  
✚ Your Desire slots with Claim, the same as the sheet  
✚ A Yesterday block with what last turn's close told you  
✎ You may change a Move's kind once a turn; the die is never re-rolled by editing the text

## 2026-09-07 · A Move filed from the Play page now counts

✎ Filing your Move on the web left it half-made: never rolled, never applied, and it blocked filing again. It is confirmed the same way the Discord console does it now

## 2026-09-07 · The Play page is usable: a real right column, travel as nodes, no more blinking

✎ Your own line no longer changes text or loses its face a second after you send it  
✎ Unread dots clear when you open a place, and a NEW line marks where you left off  
✎ Slowmode is a countdown beside the box, not a failed send  
✚ A place card with the Location and Zone descriptions, always visible  
✚ Everyone standing here, hoods included, each with a look-at eye  
✚ Storage and fixtures shown only for the room you have open, so the Intercom is only in the Council Room  
✚ Travel is a grid of square nodes with the cost on each, tinted for a zone crossing  
✚ Look at and Photograph on other people's lines; a GM can remove a line  
− Who's here?, Secret rooms?, Examine and the travel dropdown  
✎ Summary is the first place in the column

## 2026-09-07 · Eight new tags, and the combat lines all read the same way

✚ Four new fighting specialisations: throwing weapons, sniping, reckless attack and monster hunting  
✚ Drunken Master, which needs Alcoholic and pays off while you are Tipsy  
✚ Subtle: the room no longer notices that you are whispering  
✚ Steady for deliberate hands, and Dense for a slower head  
✎ Every combat tag now names its own tree — melee, ranged, or genuinely both — and shifts tiers in the same words  
✎ The crossbow's skill line was garbled, and claimed the wrong tree

## 2026-09-07 · A copy pass over the player-facing text

✎ A reviewer's rewrite of the player documents, the handbook, the Depot and Faction pages and the action tooltips, with the grammar and punctuation tidied on the way in  
− The draft marks from every line that reviewer read: the handbook, twelve documents, the Depot and Faction pages, the action list, the offers and dialogs, and the world's ambient lines  
✎ Laboring, Teaching, the Sanctuary, the Treasurer's brief and the Merchant's brief all read shorter now

## 2026-09-07 · The Depot opens again

− Fixed: the Merchant's Depot page loaded to an error reference for everyone

## 2026-09-07 · The Baroness carries her own key

✚ A Baroness's Key. It opens the Baron's Chambers and nothing else  
✎ The Baroness starts with her own key instead of the Baron's whole ring

## 2026-09-07 · The Play page opens for a living character again

✎ Opening /play with a living character crashed the page since the right column arrived. The people column and the place buttons were handed a character without their tags.

## 2026-09-07 · A role handed out in Discord reaches the lobby within a minute

✎ The lobby and the character wizard re-read your Discord roles at most a minute old, so a Playtest or Player role granted mid-session shows up on the next reload instead of five minutes later  
✎ Ready up, Skip, and Confirm always check your current roles, so a fresh role is never refused as "not on the roster"

## 2026-09-07 · Typing, speech, mentions, the wipe, and a Scene tab for the GMs

✚ "Cersei is typing…" on the Play page, under the character's presented name, whether they type on Discord or on the web.  
✚ Discord-style text on the Play page: spoilers, subtext lines, and anything said inside quotation marks is tinted as speech.  
✚ Type @ to mention someone standing with you; the mention renders as their chip on both faces and rings a quiet chime for them on the web, which they can mute.  
✎ The Dawn wipe clears the Play page's feeds at the same instant it clears the Discord channels; the archive keeps everything.  
✚ The player desk's inspector has a Scene tab: a live, read-only view of where a character stands and the rooms around them.

## 2026-09-06 · Play from the web: a switch that takes your Discord account out of every channel

✚ A switch on your Bio, "Play from the web". Turn it on and your Discord account leaves every Location channel, Room thread, Conversation and the turns console, and your nickname is cleared, so nobody in the guild can tell which account is your character. You play from the Play page; DMs still reach you. Turn it off and everything comes back. Switching cools for two hours.  
✎ Every pass that puts an account back into a channel, from a move to the nightly channel doctor to a key changing hands, now knows to leave a web-only player out.  
✎ Fixes a fault from earlier today: the record of who is in a Conversation was missing from the deployed schema, which broke the Play page for players.

## 2026-09-06 · The world writes itself down

✎ Everything the world says into a channel is now a line in the Play page's feeds too: arrivals through a gate, smells, sounds and the bell, turret bursts, the PA, noticeboard pins and tears, whispering heard from a Room, the staged public declarations, and the turn opening in every zone.  
✎ The archive's Speech view keeps those scene lines out of the transcript, where the day dividers already fold them.

## 2026-09-06 · The Play page grows its right column: people, the place, and you

✚ Who is standing with you, with the same Look at, Heal, Transfer, Loot, Bind, Free, Harm and Move Player dialogs the sheet has, one tap from their name.  
✚ Every button the Discord anchor carries is on the Play page too: Travel with drag-along and Turn back, Examine the place, Storage, the Noticeboard, Converse, the Bell, the PA, the turret, gates and keyed doors.  
✚ Move, a Report to the GMs box, and a Waiting-on-you list of offers, threat seats, letters and lobby seats you can accept or decline from the web.  
✎ Gates, keyed doors, Move and Who's here now run one implementation for both faces.

## 2026-09-06 · Weather is gone, and every turn opens on a new photograph

− The weather system: no more clear/fog/rain/storm, no roll, and no sentence about it on the turn announcement. It gated nothing.  
− The GM's "set next turn's weather" control on the Dev Panel. The note box beside it stays.  
✚ Eight new turn photographs, four for Dawn and four for Dusk, graded to sit together as one set. One is picked when the turn opens.  
✎ A turn never repeats the picture the last turn of the same half of the day used, so no two mornings running look the same.  
✎ The picture is remembered on the turn, so a bot restart reposts the same one instead of quietly swapping it mid-turn.  
✎ Changing a turn's phase by hand on the Dev Panel now picks a fresh picture for it, which doubles as a way to re-roll one you dislike.

## 2026-09-06 · Weights back up, made real, and the carry cap down to 84 lb

✎ The 30% weight cut was an accident and is undone: everything is back on the old scale  
✎ Then a realism pass, item by item: a dagger is 1 lb, a longsword 3, a halberd 6, a war hammer 5, a crossbow 8, a knight's helm 6, a cigarette nothing  
✎ Heavy things stayed heavy: plate 55 lb, cataphract 65, a flamethrower 40, a Graga corpse 75, a Squeeze cube 17  
✎ The base carry cap is 84 lb, down from 120. A knight in full plate with sword, dagger and shield has about fifteen pounds spare  
✎ A refugee cannot carry a shift's Squeeze any more, and a Horse and Cart clears about four turns of Factory output in one trip rather than five

## 2026-09-06 · Rooms have no slowmode, and a wipe waits for Discord

✎ Room threads and Conversations carry no slowmode after all; the five minutes stays on the zone summary alone. The earlier note saying Rooms got 30 seconds was wrong and is undone here.  
✎ A Restart Game no longer loses its Room threads and anchors: creating a thread now waits out Discord's minute-long rate limit instead of giving up at 30 seconds, which is what emptied every Location channel twice today.

## 2026-09-06 · Every place on the Play page, and Location channels go quiet

✚ The Play page now shows every place you can hear: the Location, its Rooms (the private ones you hold a key or an invitation to), your Conversations, and the zone Summary, each with an unread dot. Three columns on a desk, tabs on a phone.  
✎ Location channels are scenery now, not speech. Nobody can type in one; talk happens in the Room threads, which carry a 30-second slowmode, and in the zone summary.  
✎ Who is in a Conversation is a record the game keeps, and the Discord thread follows it, so a player can be let into one without ever seeing the thread.  
✎ Moving, gaining a key or being let into a room updates your open Play tabs on the spot.

## 2026-09-06 · Everything weighs about 30% less

✎ Every item in the catalog is roughly 30% lighter; the carry cap stays at 120 lb  
✎ The weight bands are now 0 / 0.3 / 1.5 / 3.5 / 8 / 20 / 40 / 70  
✎ A Squeeze cube is 12 lb, so a refugee can now walk a full shift's output out of the Factory

## 2026-09-06 · Spectators only watch while the game is on

✎ The Spectator role sees the channels only while the game is Running or Ended; in Closed or Lobby it is denied view, so testing before launch pings nobody who came to watch  
✎ Every phase change re-checks it, and the channel doctor's cheap pass repairs any channel that drifted

## 2026-09-06 · Loot the room you're in, a sheet that keeps itself current, and a bomb that says it's armed

✎ The Loot button now lists the rooms here beside the people. Picking a room takes from its stash, the same way Transfer's From-the-room already did.  
✎ The character page refreshes itself when something on your sheet or in your Location changes, so a move made from Discord no longer leaves the old rooms in the pickers until a reload. It checks a small fingerprint every ten seconds and only reloads the page when that moves.  
✎ The Nuclear Device tag reads "armed · 2t" while the countdown is running, and its tooltip says which turn it fires on.

## 2026-09-06 · One write path, and messages you can take back

✎ Everything a character says now goes through one path on both faces, so a Stupid character babbles on the web exactly as on Discord, and the speech gate, the length cap and the autocorrect are decided once.  
✚ Edit and delete your own message on the Play page, for five minutes after you say it. The Discord ✏️ and ❌ reactions follow the same five-minute rule.  
✎ A message edited or deleted on either face changes on the other within a second, and a bot restart no longer makes older messages inert to reactions.

## 2026-09-06 · The web app's icons are now Lucide

✎ Every icon on the site is redrawn from the Lucide set at the same thin weight, so the rail, the action grid and the GM buttons all match  
✎ Six game-specific glyphs (the Tower, the ankh, the cleaver, the two headstones, the wax seal) stay hand-drawn

## 2026-09-06 · The web can speak: a live Play page

✚ A Play page on the web, right under Character: the channel of the Location you stand in, live, with a box to speak into it. What you type appears at once and reaches everyone else within a blink.  
✎ Every message a character says is now written down with where it was said, so the web page and Discord read one record.  
✚ A line typed on the web is posted into the Location's Discord channel by the bot within a second, and a bot restart never loses one.

## 2026-09-06 · The Deaf tag is gone, and the trade kits are one-per-character

− The Deaf tag. Hard of Hearing no longer conflicts with it, and the intercom no longer refuses anyone for it  
✎ The three Commoner kits conflict with each other, and so do the ten Courtier kits, so a character picks one trade at creation  
✎ Six retired tags pruned from the database: Deaf, Empathetic, Kennelmaster, Navigating, Compromising Letters, Peerless Beauty

## 2026-09-06 · Four community fixes, merged from Erdromian's and kezzawozza's pull requests

✎ A bare cart is now refused at an on-foot threshold, the same way a horse is  
✎ The Dev Panel's Kill, Spend turn, Restore turn and Transfer ⬢ dialogs have their reason box back, so Transfer ⬢ works again  
✎ Faction invites and applications have their note field back, so the 'We said' column finally shows something  
− Eating a Gunpowder Grenade

## 2026-09-06 · A Playtest role, and a leaner lobby

✚ A Playtest Discord role, handed to every Contributor: it skips the lobby and creates a character in any phase, like a GM, and counts as on the roster without the Player role  
✎ The lobby is two columns now — roles on the left, the Ready card, the fallback dropdown and the antagonist boxes on the right — with every explainer and tooltip gone  
− Starting areas from the lobby's role rows

## 2026-09-06 · The handbook and the GM docs know about the lobby

✎ The player handbook explains readying up, the roll, the deadline DM, and joining by hand after the start  
✚ LOBBY.md, the GM-side reference for phases, the roll, the creation window, End Game and what a restart keeps; the launch runbook now ends with Open lobby instead of a switch  
✎ THREATS.md says how a seat's forbidden tags work and what Assign refunds; ARCHIVE.md describes the game picker and the folded transcript

## 2026-09-06 · The archive, remade, with every past game in it

✚ A game picker on /archive: past games are readable by anyone signed in, with their reveal at the top; the current one still opens when the game ends  
✎ The transcript is a dense day-by-day read now: sticky Day · Dawn · Rain headers, a line per place, one line per thing said at the small size, no avatars  
✎ Arrivals, deaths, moves and desires fold into one muted line per run that opens on a click; the Show switch picks Speech or Everything  
✎ Zone and character filters come from the game's own rows, so a past game filters by who and where it actually had

## 2026-09-06 · Ending the game, and games that outlive the wipe

✚ The bomb going off ends the game: the clock stops, the archive opens, and the reveal follows the fireball into #turns  
✚ End Game writes a reveal — your closing note, how long it lasted, who was who with antagonist seats named and the dead marked — and posts it to #turns  
✎ Restart Game keeps the transcript now: every game is numbered and its archive stays readable; the game picker lands with the archive remake  
✎ Close lobby freezes it: Preview and Start work on a closed lobby, so nobody can ready up under a preview  
✎ An assignment DM that failed to send goes out again on the next sweep, and the reminder carries the link  
✎ From review: a rolled seat is spent by any character its player makes, spawn-only seats can't be hand-set, and the lobby's ready count refreshes itself

## 2026-09-06 · Start Game rolls the lobby into seats

✚ Preview on the Game section shows who would get what and warns about leader seats nobody wants; hand-set any row, re-roll for a fresh seed, and Start commits exactly that table  
✚ Everyone assigned gets a DM with their seat, a link to build the character, a Discord-clock deadline and a Decline button; the seat is theirs for the creation window  
✚ A reminder six hours before the window closes; past it the seat is released and late join can take it  
✎ The wizard opens on the Tags step with the role fixed for an assigned player  
✎ Every seat count now includes seats held by lobby assignments, so late join and spawns can't double-book one

## 2026-09-06 · The turret tells armour apart again

✎ A burst is far deadlier to the unarmoured and far kinder to the well-armoured  
✚ Everyone now has a flat one-in-ten chance to dodge a burst outright, armour or none  
✎ Light Infantry Armour turns a little less

## 2026-09-06 · A lobby to ready up in before the game starts

✚ While the game is gathering, /character is the lobby: set Off, Low, Med or High on every role (one High at a time), say what happens if nothing fits, tick antagonist boxes, and press Ready. It saves as you go and remembers you next game  
✚ The Game section on the Dev Panel lists who readied and what they asked for  
✚ Gamemasters get a Skip to character creation button in the lobby, for testing  
✎ Character creation is open while the game is Running or Ended; Ended stops only the clock

## 2026-09-06 · Giant, Strong and Pack Mule no longer stack

✎ Giant, Strong and Pack Mule now conflict with each other, so a build can hold only one of the three carry bodies

## 2026-09-06 · Twelve antagonist boxes, two of them the Thanati

✚ Cultist and Cultist Leader are real seats now: they grant the Thanati belief, the leader wears a mark on top, and a GM can Assign or Spawn them  
✎ The Succubus box is the Demoness seat under its own name, so the 18+ nature is plain; the Bastard, Cultist Leader, Succubus and Tribunal Ordinator boxes need the Whitelist role  
− Aberrant Emissary, False Chaplain, Neomorph, Phrygian Count, Tribunal Operations and Warlock from the opt-in list; Skinless and Windlander join it  
✎ Assigning a seat now refunds any tag it forbids that cost points, keeps drawbacks, and drops a second Belief; the DM says what went  
✎ The Assignments table shows lobby opt-ins for players without a character yet, and a WL column

## 2026-09-06 · The game has phases now: Closed, Lobby, Running, Ended

✚ A Game section on the Dev Panel with Open lobby, Start game, End game and Resume  
✎ Turns only advance while the game is Running, from the nightly cron and from End turn alike  
✎ Restart Game no longer resets the Configuration knobs; they carry over between games  
− The Open to players switch; a Running game is what opens character creation  
✎ Ending the game opens the archive to players  
✎ The Configuration section is grouped, every knob has a tooltip, and the noticeboard lifespan is finally editable

## 2026-09-06 · The marshes fish less, the Village fishes more

✎ The five open Marshes fish at 1.0 instead of 1.3
✎ The marsh Village fishes at 1.3 instead of 1.5 — still the best water in the game
✎ Corrected the Laboring doc's yield table, which had drifted off the map

## 2026-09-06 · Farming pays 9% more

✎ Laboring (Farming) now pays 15–21 ⬢ instead of 14–19

## 2026-09-06 · Travel that costs your Move takes a day

✎ A zone crossing that spends your Move now lands NEXT turn: you keep standing where you are until the day turns, so the new zone's channels no longer open the moment you press Confirm  
✎ Free zone crossings and walks inside a zone are unchanged — still instant  
✚ A Turn back button for anyone already on the road. It only clears the destination; the Move is spent either way  
✚ A book on the shelf in the Successor's Chamber

## 2026-09-06 · Ten equip slots, and the Merchant can crate his own goods

✎ Everyone has 10 equipment slots instead of 6. The one-helmet, one-cuirass, one-shield rule is unchanged  
✚ Packaging Equipment in the Company's silo in the Cargo Bay, so the Merchant no longer walks to the Factory to pack a crate

## 2026-09-06 · Tag chips say what a thing weighs

✎ A tag's hover panel now says what it weighs, and a stack says both the each and the total  
✎ Nothing weightless shows a line: a skill, a horse, a graft in your neck

## 2026-09-06 · Avatars all sit on the same dark stone now

✎ The helm avatars and the built portraits were still lighter than the letter plaques. They all share one ground again, and there is no green left in any of them

## 2026-09-06 · The Censor can read

✚ The Censor starts Literate, like every other Court seat

## 2026-09-06 · Depressed only fights the tags that touch Desires

✎ Lazy, Insomniac, Guilt Ridden, Torturer and the four phobias can sit alongside Depressed again. None of them touches the Desire system, so there was nothing for them to argue with.  
✎ Nobility and Eunuch do lock Desires, so those two now conflict where they did not before.  
✎ The test is simply whether a Personality tag locks or opens Desires at all, rather than a hand-picked list.

## 2026-09-06 · Storage and the noticeboards check the character who pressed the button

✎ Clicking Storage in a room, or opening a noticeboard, checked where somebody else was standing. Almost everyone was told "You're not here" in a room they were plainly in  
✎ Tearing a notice down would have put the paper in that other character's hands, and pinning one would have taken it out of their pack. Nothing had been pinned yet, so nobody lost anything

## 2026-09-06 · Desire names are plain prose, and thresholds read in both currencies

✎ Desire names no longer link tags — Sake and Ravenheart Red were chips while alcohol and moonshine beside them were plain text, so the picker looked half-finished  
✎ Gambling wins and Resources thresholds now read in both currencies: Win 5 ⬢/¢, Have 100 ⬢/¢, and so on  
✎ Kill someone you hate is 4pt  
✎ Save someone's life is repeatable on a 5-turn cooldown; saving a faction leader's life is the once-a-life one. They were the wrong way round  
✎ Kiss someone and Gain a lover both get a 4-turn cooldown  
✚ Get married, once a life — it replaces Gain a lover you should not have, which is retired  
✎ Confess your sins is now Successfully confess something

## 2026-09-06 · Depression crowds out everything else about you

✎ Depressed can no longer be combined with almost any other Personality tag, on top of the Addictions it already ruled out. A depressed character is depressed first and everything else second.  
✎ The six that still sit beside it are Nobility, Eunuch, Debtor, Poor Swimmer, Motion Sickness and Lightweight, none of which is really a disposition.  
✎ Depressed now gives back 8 points instead of 6, which is what the design notes always said it should be.

## 2026-09-06 · Pushing an update deploys the whole site again

✎ Every push now rebuilds both the website and the bot. Half the updates were quietly not deploying at all, which is why the site kept showing yesterday's behaviour until someone redeployed by hand  
✎ Database changes are applied automatically just before an update goes live, so a page can no longer break with a bare error code because a column was missing

## 2026-09-06 · Let a Depot Keycard work the machinery, not the money

✚ A Depot Keycard now calls the shuttle down, loads it, sends it back up, and feeds and starts the generator  
✎ The keycard still spends nothing — ordering, the ATM, the credit line, the obol counter and the turret stay on the Merchant's Licence  
✎ Only the Licence can shut the generator down, because the lights going out take the turret with them  
✎ The Feed button used to be greyed out by the very outage it existed to fix, so a dead generator was unrecoverable from the console  
✎ Working the Depot console is an ACT now — an incapacitated Merchant could order, bank and refuel from the floor

## 2026-09-06 · The whitelist points at a role that exists

✚ The Whitelist role works again — it was pointing at a role deleted in the pre-launch cleanup, so all 24 whitelisted players were locked out of every whitelisted seat with no error shown  
− - almost certainly deleted by the pre-launch cleanup and remade with a new snowflake. isLeaderWhitelisted is a plain roles.includes(), so it returned false for everybody: all 24 holders of the real @Whitelist role were locked out of every whitelisted seat, greyed with no error anywhere. The gate fails closed on purpose, which is exactly why it was silent.

## 2026-09-06 · Playtest mode is gone

− The playtest lever on the dev panel. Both of its lists were empty, so it never locked anything

## 2026-09-06 · The web app is back up

✎ A half-landed change had left the site querying two database columns that no longer existed, which took every page down. The structural-edge system is now properly gone

## 2026-09-06 · The zone picker answers on the click

✎ The Zones control now responds to a click straight away, instead of freezing for about twenty seconds  
✚ A picked zone turns orange, so you can tell at a glance which ones you have  
✎ Your GM: <Zone> Discord roles now catch up a second or two after the click, rather than holding it up

## 2026-09-06 · The bot is back up, and appearance has more room

✎ The bot had been crashing on boot since the phobia pass shipped half-committed; the missing pieces are in  
✚ Character appearance now takes 400 characters instead of 300

## 2026-09-06 · The Fisherman starts skilled at Laboring

## 2026-09-06 · The turn header is a dated subtext line

## 2026-09-06 · Knighthood is back on the picker, for a single point

✎ Knighted is purchasable again at character creation, at 1 ⬢. It stays out of the mid-game store — once play starts, knighting is the Baron's to do

## 2026-09-06 · Ten Courtier kits, and knighthood is no longer for sale

✚ Ten Courtier starting kits — Herald, Seasoned Knight, Tutor, Chaplain, Carouser, Manor Lord, Debutante, Court Physician, Court Artist and Master Engineer. Each is a crate a Courtier buys at creation and unpacks in play, priced well under what it holds  
− Knighted is off the tag picker. It is free now, and comes from the Seasoned Knight kit or a GM's hand  
✚ A hostage bag in the Order Chambers, and two hoods in the Ravine Camp  
✚ Both Brigands start with a Plebeian Hood

## 2026-09-06 · Role charters: the contributor's pass

✎ The Baron, Baroness, Hand and Meister open with new intros; the Baron keeps his intercom and the yard turret  
✎ Forty-odd charter paragraphs reworded across the Court, the Cerberon, the Church, the Sanctuary, the Town, the Company and the Brigands  
✎ Every Watchmen mention now says Cerberi  
− The zone situations (stale opening-state blurbs on every zone)  
− The You-can-crucify line on the Inquisitor, Practicus and Preacher, now that crucifixion is a structure  
✎ The Bishop is untouched

## 2026-09-06 · The Cross structure is called Crucifix

✎ Tag names have to be unique and a Cross item already exists, so the structure that crucifies people is named Crucifix. Players still read it as the cross in every line about it.

## 2026-09-06 · The new Cross structure syncs again

✎ Its slug (crucifix) differs from its name on purpose, because a Cross item already exists; the tag sync now knows that.

## 2026-09-06 · Crosses, crucifixion, and a leaner structure catalog

✚ A Fundamentalist standing at a finished Cross can Crucify anyone standing there, from the People here actions. No consent and no Move spent. The victim can still speak but do nothing else, becomes Dying at the close of the turn, and dies at the close of the next.  
✚ Cross: a new structure, 6 ⬢ and one turn, no skill needed. The Square and the Crossroads each start with one standing.  
✚ Watchtower: an elevated tower with a defence note, 20 ⬢ and two turns with Builder (Skilled).  
− Library, Jailhouse and Bridge are gone from the structure catalog.  
− The structural-edge machinery (a Bridge holding a crossing open, a Palisade holding a gate shut) is gone entirely. No edge on the map ever used it.  
✎ Forge is 15 ⬢ and two turns now (was 30 and four). Palisade takes four turns (was six). Battering Ram takes two (was three).  
✚ Two Desires: Build a Wayside Shrine (2 points, any belief but Atheist, six-turn cooldown) and Crucify a heretic (2 points, Fundamentalists).  
✚ The Undercroft has a Vault behind the Baron's key, holding 14 ⬢, 15 obols and a painting.  
✎ The Inquisitor, Practicus and Preacher role text now says they can crucify people once they build a cross.  
✎ A character who can't act (Bound, Dying, Crucified, out cold) can no longer lock in a Move from the Discord modal. Labor was already refused there; Routines and Gambits used to go through.  
✎ A Location in the zones master can now list structures that were always standing there, and the zone sync raises them.

## 2026-09-06 · Phobias, a Debtor, and a dozen new personality drawbacks

✚ Four phobias. Claustrophobia keeps you Afraid the whole time you are in the caves; Acrophobia makes you Afraid anywhere in the Black Hills and Panic at the Mountain; Pyrophobia and Teratophobia are for the GM to call  
✚ Guilt Ridden can't confess and now and then wakes Exhausted; Insomniac wakes Exhausted about one dawn in five  
✚ Lazy earns a quarter less from every day's labor, and the range on the sheet shows it; a chaplain can confess it away  
✚ Lightweight's first drink lands them Wasted, the next one Unconscious. Iron Liver now takes two drinks per rung after the first  
✚ Motion Sickness can't ride a horse or a boat, and vomits if somebody drags them across a zone on one  
✚ Poor Swimmer, and Debtor: 20 obols in hand, 40 owed, with three DEBTOR notices up at Customs the moment they arrive  
✎ Afraid now lasts one turn instead of two  
✎ You may take up to 6 drawbacks, claiming back up to 13 points

## 2026-09-06 · The bell carries by distance now, and there is a trumpet

✎ The church bell now carries by distance instead of to a fixed list of zones — loud around the Cathedral, faint out at the edges, and silent underground  
✚ A Trumpet. Carry one and a Sound Trumpet button appears on your Character page; it does what the bell does at three-quarters the range, from wherever you are standing  
✎ Both wait half an hour between soundings  
✎ Every noise the world makes now opens 'You hear' — the turret, the gatehouse rotor, the depot generator and shuttle, and whispering all say it the way a shout already did

## 2026-09-06 · The Teaching tree is a Skill now, and nobody can be taught to teach

✎ Teaching, Lecturing and Drill Instructor now sit on the Skills tab of the store instead of under General  
✎ None of the three can be taught: you can't learn Teaching from a teacher  
✎ Drill Instructor is still for the Cerberi and the Censor only

## 2026-09-06 · Selling to the Merchant pays 60% now, not a quarter

✎ Selling something to the Merchant now pays 60% of its shelf price, up from the ~44% it was before — stocking goods and trading them on is worth doing  
✎ Seven craftable or brewable wares keep a wage floor, so 60% never cuts what a maker earns

## 2026-09-06 · The Merchant stops being a laundry, and sells energy shields

✎ Depot prices are down about 18% across the board  
✎ Selling something back to the Merchant now pays a quarter of its price, not nearly half — buying a rifle and reselling it is no longer a living  
✚ Energy Shields are on the Merchant's shelf at 145 obols, the best protection against a turret that money can buy  
− The Fortress Starting Packet  
✎ Rewrites: combat, the Pusher, Ravenheart's economy, Post-Christianity, concealing, the Sanctuary

## 2026-09-06 · Trial Gamemaster is a Gamemaster in everything but name

✚ A Trial Gamemaster role that grants exactly what Gamemaster does — every /gm page, every GM channel, and the /gm and /dm commands  
✎ The Gamemasters roster now says which seat somebody holds: Gamemaster, Trial GM, or Master  
✚ Two more superadmins

## 2026-09-06 · A pass over the tag catalog: fighting skills, mountaineering, and softer drawbacks

✎ Melee (Clubs) and Shield Wall come down to 8, Duelist to 9, and Guerrilla to 5 — the fighting specialisations were priced past what most builds could reach  
✎ Mountaineering costs 2 instead of 3, and the Ravine and the Outcrop now open to it rather than to Caving — climbing had one room to Caving's three  
✎ Caving goes up to 4  
✎ Depressed, Deaf, Tremor, Arthritis, Night Blind and Migraine all refund fewer points; Glass Jaw refunds one more  
✎ Pretty and Beautiful cost 3 each and can only be bought at creation  
✎ Soft Hands no longer forbids the Laboring skills — the half-⬢ penalty is the whole tag  
✎ Clumsy and Stealth now refuse each other  
✎ Craven only locks Desires about bravery now, not violence and adventure as well  
− Insomniac

## 2026-09-05 · Avatars sit on a plate that falls into shade

✎ Every avatar background now darkens toward the bottom, so a face, a helm and a letter plaque all read as lit from above instead of pasted onto a flat slab  
✎ Concealed-identity helms are noticeably bigger — they fill their frame the way a portrait does instead of floating in the middle of it

## 2026-09-05 · A fisherman lives out in the marsh village

✚ A new Fisherman fate: one seat, easy, starting alone in the marsh Village with a rod, a boat and the key to his hut  
✚ The Old Hut, a locked room out past the village with two obols and a pet rat in it  
✎ The Banneret and the Geschef are both told there is a fisherman up north and obols in the office to pay him with  
✎ Fast Metabolism is now called Big Appetite, and the Geschef starts with one  
✎ The Banneret and the Geschef count as Ravenhearters after all  
✚ A cigarette in the overseer box  
✎ The Fates thread in #info now groups fates the way the site does, and no longer says which zone anyone starts in  
✚ A quieter way to push #info: it edits what is already there instead of reposting, so nobody gets pinged for a typo fix

## 2026-09-05 · Drinking has a ladder, and the tags that say you can't now stop you

✚ Drinking while Tipsy makes you Wasted; drinking while Wasted puts you Unconscious on the floor  
✚ Wasted and Unconscious both wear off into a Hangover  
✚ Unconscious counts as helpless: you can be looted, dragged and tied up where you fell  
✎ A GM granting the same tag twice still does nothing — only drinking climbs  
✚ Bound, Paralyzed, Unconscious, Dying, Catatonic and mid-Seizure can no longer walk out of a room, hand over a purse, butcher, buy, write or work  
✚ Mute finally does something: it stops you speaking, and nothing else  
✎ Bound deliberately still lets you shout — a hostage can call for help  
✚ Deaf can't work the Council Room intercom  
✎ Stupid now garbles ordinary channel chat, which it never actually did before  

## 2026-09-05 · The Depot's horse comes down to 110

✎ A Horse at the Depot now costs 110 ⬢ and sells back at 48 ⬢, down from 120 and 53.

## 2026-09-05 · The Merchant sells horses, and a builder can make a boat

✚ The Depot now stocks a Horse at 120 ⬢, sells one back at 53 ⬢. Mid-game he is the only horse in Ravenheart, and the price says so.  
✚ A Skilled Builder can now make a Fishing Boat: 40 ⬢ and one turn, same bench as the Cart.

## 2026-09-05 · Desires that cost nothing now cost a wait

− Six Desires that were impossible or paid for a single click: See the Windlands, Stay 2 turns in the Aberrant Pits, Experience something exciting, Perform a charitable act (the ungated one), Convert someone to the Old Ways, and Convince someone to skip mass  
✎ Every consumable — drinks, smokes, drugs, meals — now waits 3 turns before it pays again, so trying something new beats repeating the same cigarette  
✎ The one-line social Desires (a hug, a story, an insult, a chastisement) all settle at 3 turns, down from 5  
✎ Winning a game of chance now needs something actually staked  
✎ Saving a life, and a migrant being let through the Town gates, are once ever  
✎ Buying from the Merchant waits 5 turns, seeing a monster 4, torture 6  
✎ Converting someone to your religion drops to tier 3, and is now the only Desire covering conversion  
✎ The Demoness can humiliate somebody privately or publicly — two Desires, not one act paying twice  
✎ The Windlands are gone from the game's text. #info was still telling players it was one of three surface zones; it now names the five we have, and the two cave levels

## 2026-09-05 · Changelog notes stop getting cut off mid-sentence

✎ A note written as a wrapped bullet in a commit message used to lose everything after its first line break, so entries reached Discord as half-sentences ending in 'which may'. The whole bullet is posted now

## 2026-09-05 · A tag now says which Desires it unlocks

✚ Hover any tag and it now lists the Desires it unlocks, with what each one pays. 66 tags gate a Desire and not one of them said so — a player deciding whether to buy Cruel had no way to learn it opens seven goals
✚ The same list on the point-buy screen and in the Tag Catalog, so it's there at the moment you're actually spending points
✎ A Desire that needs more than the one tag says so quietly — "with Butcher", or "+ role". A tag that opens something on its own says nothing extra, because it doesn't need to
✎ Only what a tag OPENS is listed. Nothing about what it shuts — Addictions and forbidden-tag gates stay out, so the list never has to be read twice
✎ Confess your sins is now open to any Post-Christian. It's the ordinary practice of the faith, not an advanced one
✎ Fundamentalist and Pilgrim used to announce their Desires in their own descriptions. They don't have to any more

## 2026-09-05 · Scrap armour is scrap again

− Salvage Plate protects a lot less: it now sits just above padded armour and below a mail shirt, which is what scrap metal strapped to your chest is worth

## 2026-09-05 · Spare hatchets at the Godard Factory

✚ Three hatchets scattered around the Factory, which had none — one in the Logistics Room, one on the Main Floor, one in the Pub  
✎ A hatchet is the Refugee's whole job (Godflesh needs one equipped), there is no forge in the Marshes, and the crafting change earlier today put the hatchet recipe behind a forge — so a Refugee who lost theirs had no way to replace it in their own zone  
✎ Not in the Spillway, which destroys what lands in it, and not in the Overseer Box, which is the Banneret's

## 2026-09-05 · Armour is a number on the gear now, and the turrets are lethal

✚ Every piece of armour, headgear and shield carries a Melee and a Ballistic rating, shown as a word — None, Meager, Sufficient, Good, Strong, Overkill  
✎ The turrets used to read a hardcoded list of seven body armours, so every helmet, shield and the spacesuit counted for nothing; a helmet now protects you  
✎ Being shot unarmoured is properly dangerous: two fifths dying or dead, two fifths badly hurt, one fifth walking away. The best kit in the game still buries one wearer in twenty  
✚ A turret firing now shouts RRATATAT into its own Location and echoes it across every other Location in the zone, on every burst, once per burst  
✚ The turret DM names the wound you took instead of leaving you to go and look it up  
✎ Adding someone to a private room or a conversation no longer leaves an 'added X to the thread' line in the middle of the scene  
✎ Equipping something no longer freezes the sheet for five seconds — the Discord work moved off the click, and it stopped calling about rooms nobody is standing in  
✎ /conceal under a forced mask said 'take it off first', which read as the mask breaking concealment when it was granting it. It now says you are already hidden, and names the piece  
✎ Helm avatars are bigger and fade into their plate the way portraits do

## 2026-09-05 · The Caving document is in Bascinet's words now

✎ A new player-facing Caving brief: what the caves and the depths are, that moving is what triggers an encounter, that sitting still is safer, and that dangerous ones get settled at the end of the turn  
✎ It names the three things you can do down there — roll encounters, spend a Gambit hunting or scavenging or searching a room, and take on a Quest  
✎ Dropped from the old draft: the note that Customs never rolls, and the reminder that changing level costs a turn

## 2026-09-05 · The Caving document is in Bascinet's words now

✎ A new player-facing Caving brief: what the caves and the depths are, that moving is what triggers an encounter, that sitting still is safer, and that dangerous ones get settled at the end of the turn  
✎ It names the three things you can do down there — roll encounters, spend a Gambit hunting or scavenging or searching a room, and take on a Quest  
✎ Dropped from the old draft: the note that Customs never rolls, and the reminder that changing level costs a turn

## 2026-09-05 · Your role's charter opens with its own line now, and the Inquisition gets its tools

✎ Every starting role document now opens on the role's intro sentence, in italics — it used to show only in the creation picker and never again  
− Nine roles had that sentence copied into the document by hand; those copies are gone  
✚ Torturer, a 2 pt tag the Inquisitor starts with. Won't sit alongside Charitable, Pacifist, Saint or Eusoch  
✚ Barbed Net — takes Crafting and Fundamentalist both to make one, so only the Order can  
✚ The Truncheon, carried by the Censor, the Cerberi and the Practicii. Nobody can make another  
✚ Tear gas, a mace, a padded cap and a crossbow in the Order Chambers; truncheons in the Armory; pitchforks and a work knife out in the fields  
✎ The farming bonus moved off the Hatchet onto the Pitchfork, where a farmer would look for it  
✎ The Dead Simple crafting rung asked for BOTH Crafting and Smithing, not either — so the entry tier was harder to reach than the one above it. It now splits by material: wood and cord take Crafting, metal takes Smithing at a forge  
✎ The Smithing paper was missing thirteen things you can make; the Fine Meal, the Lavish Meal and Moonshine were missing from theirs. All fixed, and `npm run db:audit-craft-docs` now catches the next one  

## 2026-09-05 · Verify pass: five real holes in the camera, the shout and the die

✎ A GM's staged "Relocate to" into the Depths rolled no Caving Die at all. The old turn-start sweep used to catch those people; it rolls properly now
✎ A shout named the secret crawl it came through. It still carries through one — that part is the rule — but it no longer says which way, when the way is one nobody is supposed to know about
✎ A photograph carried the photographer's medical training, so a surgeon could photograph their own diagnosis and hand the print to somebody who couldn't have made it. The camera sees what a camera sees now
✎ A photograph unmasked a hood that had since come off, filing the print under a real name nobody in the room ever heard. It records the face the room actually saw
✎ Photos were free and unlimited. One shot per message per photographer now — the camera is still reusable, but photographing the same moment twice is the same photo
✎ The Caving desk showed only the zone, so a GM saw several identical rows for one character with no way to tell which tunnel each happened in. It names the place
✎ Shouting from inside a room put the shout everywhere except that room

## 2026-09-05 · Every room id says where it is

✎ Room ids are now always <location-stem>-<room>: keep-throne-room, inn-cellar, customs-watchtower. 98 of the 127 rooms were renamed  
✎ Nothing a player sees changed. Display names are untouched, so there are still four rooms called Watchtower and two called Road  
✎ The rule is written down in the zones.yaml header and CHANNELS.md, and it replaces the three comments that used to explain which id was already taken

## 2026-09-05 · Cameras take photos, /shout carries, and the caves only bite when you walk

✚ The Instant Camera works. React 📸 or 📷 to somebody's message and you get a Photo of them, frozen exactly as they looked right then — a real object you can hand over, stash, or have stolen. The camera is reusable; consuming one instead prints a photo of nothing.
✚ /shout, which carries four places out across the map. It muffles as it goes — clear next door, half static two places off, unintelligible at the edge — and tells hearers only which direction it came from, never who shouted.
✎ The Caving Die no longer rolls at turn start, so camping underground is free. It rolls when you walk into somewhere new down there, once per place per day, going deeper and turning back alike. Customs is now completely safe.

## 2026-09-05 · Six more books on the shelves

✚ Five new books in the Keep's Library: a pet rat manual, a volume of magical regulations, a very short story about a sword, the prophecies of Sir Thomast, and a strategy primer about legs  
✚ A cookery book in the Cathedral Pantry

## 2026-09-05 · The Road and the Manors are places now

✚ A Shrine to a forgotten saint on the road up, and a Ledge below it only the sure-footed can climb down to
✚ The Manors open: a Manor, a Cellar and a walled Garden, all three behind the Manor Key, which until now opened nothing
✚ A Ravenheart Red, an instrument and a sabre in the Manor; four obols and a cave fungus in the cellar
✎ The Road and the Manors both read the way Bascinet wrote them

## 2026-09-05 · More mercenaries and more brigands

✎ Mercenary and Brigand are both a bit likelier to come up when someone rolls for a role — weight 3 each, up from 2

## 2026-09-05 · The Practicus starts with a gas mask

✚ A Gas Mask in the Practicus's starting kit

## 2026-09-05 · Fixes from the Fortress review

✎ Squires start with a Cerberus Key, so they can get into the garrison they live in — the Barracks, the Mess Hall, the Training Yard and the Kennels were all shut to them  
− The Mess Hall's door. It's the Cerberon's silo, and a locked silo hands its key to everyone who accepts an invitation — which would have made a Cerberon invite a dispenser for the key that works every gate in the game  
✎ Binding a book now counts your paper under a lock, so two quick clicks can't turn ten sheets into two books  
✎ A shut gate now tells you where the winch is, and the Bind a Book button says how many sheets short you are  
✚ A bird and a noticeboard now refuse a book by name rather than by accident

## 2026-09-05 · Nine more books on the shelves, and the sewer is filthier

✚ Eight books in the Keep's Library: three baking guides by Madam Molley, three short pieces, and two chapters of a novel  
✚ A third chapter of that novel washed up at the Rockside Washup, for whoever has a boat  
✚ Six lots of feces in the Underquarter sewers

## 2026-09-05 · A real crate washed up in the river

✎ The crate in the Rockside Washup now holds 2 coal and a Squeeze cube, and its side reads like a real shuttle manifest instead of the old coffee-and-knives flavour

## 2026-09-05 · The Fortress is a real place, and books exist

✚ The Lifeweb is somewhere you can walk into: an outside, the chair room behind the Mortii's key, and their shacks against the wall  
✚ The Servant Wing has quarters, a kitchen, a workshop and latrines — anything dropped down the latrines is gone for good, like the Spillway  
✚ The Keep's Noble Chambers are three rooms now, one each for the Baron, the Heir and the Successor, and the Baron's key opens all three  
✚ A Meister's office, a Hand's office with a wax stamp of his own, a terrace, a nook behind the Great Hall's painting, and the pit under the throne room  
✚ The Garrison has a front counter anyone can walk up to, and everything past it needs a Cerberus key; an oubliette, and two hounds in the kennels  
✚ Books: bind ten sheets of paper into one and write it in a single pass, or tear one up to get the paper back. Five are on the shelves already  
✚ A Desire for a Scholastic to write one  
✎ The winch for every gate in the game is in its watchtower now, not out on the road — and the fortress gate finally has a watchtower  
✎ The Baron's Key is just the Baron's Key, and there are keys now for the Hand, the Meister, the Censor, the Heir, the Successor and the Mortii  
✎ The Hand no longer carries a Cerberus key  
✎ The Reliquary Chapel is open to anyone; the Silver Cross is behind its own door off it, and the Merchant would pay 300 obols for it

## 2026-09-05 · Saints are pacifists, and the Judge is off the tag catalog

− Saint now says outright that you cannot fight, not even in self-defense  
− The Judge's seat tag no longer shows up in the player Tag Catalog

## 2026-09-05 · The Town has doors, and the Cathedral has a bell

✚ The Old Cock Inn is a real building: a street, a bar, a second floor, a balcony, a kitchen, and three rooms to rent  
✚ A Sound Bell button in the Cathedral's Bell Tower, heard in the Town, the Fortress, the Forest and the Marshes, once every five minutes  
✚ Both town gates are now gatehouses with a watchtower each, and both can be opened and shut like the fortress gate — by a Cerberus, the Censor, the Baron, the Hand or the Headman  
✚ A Vestry and a Hall in the Cathedral; Sewers, an Organ Shop, the Pusher's Room and the Alleyways in the Underquarter; a storeroom behind the Smithery  
✚ Cigarettes at the Merchant, twice the price of tea, and a Desire for smoking one  
✎ The Scriptorium, the Pantry, the Warehouse, Esculap's Office and the Operating Theater are all behind keys now  
✎ The Cellar Key is the Inn Key, and opens the kitchen too  
− The Hole. The Square and the Inn now meet directly

## 2026-09-05 · Deleting a character is fast now

✎ Deleting a character took over half a minute and now takes about a second. The same wait was on every death  
✚ A whitelisted role wears a dotted border and says "Whitelisted" on its card at character creation  
✚ The star is back beside a Leader role's name in the creation picker  
✎ A role's difficulty reads Easy, Normal and Hard instead of lowercase

## 2026-09-05 · Everyone starts where they actually belong

✎ All 40 roles now name their own starting Location instead of falling through to a default. The default was the first place in the zone alphabetically, which put the whole Court in the Gatehouse, the Church in the Square and the Cerberon nowhere near the barracks  
✎ The Baron, his family and the courtiers wake up in the Keep; the Servant in the Servant Wing; the Censor, Incarn, Cerberi and Squires in the Garrison  
✎ The Church and the Order start in the Cathedral, the Sanctuary in the Sanctuary, the Innkeeper and staff in the Inn  
✎ The Bum, the Pusher and the Mortus start in the Underquarter  
✎ The Merchant, the Docker and the Mercenary start at the cave mouth; a Migrant starts two hops in, at the Stairhead

## 2026-09-05 · Confession works, and the Cathedral has something to make

✚ A Confess button. Take one of your addictions to a chaplain standing with you: it's your Gambit, their Routine, and a 5 or 6 gets it off you  
✚ The chaplain is never told what the confession is about — not in the DM asking them, not on their own Move, not when it's over. Only the penitent and the GMs ever see it  
✚ Blessing, a 5-point skill only the Church can buy, and Holy Water: one turn and 1 ⬢ a bottle  
✎ New briefs for the Bishop and the Chaplain. The old ones promised a confession mechanic that didn't exist  
✚ The Bishop starts able to make Holy Water, and both of them can teach  
✎ Sixteen tags are now marked psychological and can be confessed — the addictions, the compulsions, and a few habits. Not blindness or muteness, which share a group with them  
✎ Superstitious is off every role that started with it. The Inquisitor, Practicus and Preacher start Fundamentalist instead  
✎ Stutter is a 1-point drawback now, not 2  
− Disgraced and Bad Liar are gone from the game  
✎ The Bishop can want a confession now; that goal was locked to the Chaplain role  
✚ Three goals: sprinkle holy water on the unholy, crucify someone, and get the Baron to praise God in the cathedral

## 2026-09-05 · The cave mouth is one place, and Examine reads like a table

✎ Customs and the Depot are one place at the cave mouth — the customs yard, the storefront, the landing pad, the watchtower, the merchant's office and the cargo bay all under one roof. They used to be two Locations with no way to walk between them  
✚ A gate into the caves that can be shut, worked by the Cerberon, the Censor, the Baron, the Hand, or anyone holding a Cerberus Key  
✚ The Cerberus Key: starting kit for the Baron, the Hand, the Censor, the Incarn and every Cerberus, three spares in the Censor's Office. It opens the watchtower and works the Keep's portcullis  
✎ Examine now reads as a table — every line is a bolded topic and one short sentence, the shape the labor readout already had. Standing outdoors says so, where it used to say nothing at all  
✚ The Landing Pad's own description says whether the shuttle is sitting on it, and changes when it leaves  
✚ A Large Dock on the West Riverbank, and the hunting there is a little better for it  
− The Depot's back track through the sparse field. The road from the Crossroads is the way in

## 2026-09-04 · A GM can send anyone a letter, and the picker reads as seven groups

✚ A Send a Letter button on the Dev Panel: a bird arrives carrying a letter from whoever you say it is from — the God-King, a dead man, nobody at all  
✚ A letter can go out sealed with a mark you invent on the spot, and it reads as a seal to everyone until somebody breaks it  
✚ The reply comes back on that player's conversation on the Players desk, drawn as paper rather than as chat  
✎ Character creation now groups roles as Court, Clergy, Cerberon, Saviors, Business, Soil and Outsiders, with the faction printed on each card  
✎ The Refugee's brief now says what the job actually is

## 2026-09-04 · Minstrels can actually play something now

✚ An Instrument tag, 1 point, granted free with the Minstrel role  
✚ /play, which puts a line into the room you are standing in  
✎ The room hears it full size; the street outside only overhears it, small

## 2026-09-04 · The Forest is a real place now, and Farms moved into it

✚ Every Forest location has its rooms: 22 of them, from the Headwaters cave to the Beaver Dam, with their locked doors and their loot  
✚ The Farms are in the Forest now, with three rooms — Fields, the Village Green, and the Old Church. Getting there from the woods no longer costs a Move  
✎ Fishing pays better in the marsh: 1.3 everywhere, 1.5 at the fishing village  
✎ The Hills Camp tag is now Ravine Camp, and says which ravine it means  
✎ Caving costs 3 points instead of 5, and its description says what it actually does  
✚ The Overseer Box starts with 8 ⬢ and the Logistics Room with 2 ⬢  
✚ The Headman starts with the sewer key  
✚ Refugees start with 2 ⬢ instead of 1, and Migrants get 10 more points to build with  
✎ Three broken ways through the Forest that would have refused to open at all: the climb to the mountain, the crawl to the caves, and a road that led back to itself

## 2026-09-04 · The gun in the fortress yard works now

✚ The triple-barrelled turret on the rotor in the Gatehouse yard can be turned on. It has been described as "off" in the Baron's charter since before anything could switch it  
✚ A red Toggle Turret button in the Censor's Office. You have to be standing in the office to use it, and you have to type ARM or DISARM into the confirm — Discord has no confirm dialog, and a misclick here should not be able to shoot the Keep  
✎ It spares nobody. Unlike the Merchant's turret it reads no faces and checks no keycards: armed, it fires on whoever is in the yard, the Censor included. Armour still decides how badly, so the Cerberon's mail is worth wearing  
✎ Arming or disarming it says one line into the Gatehouse. That is the only warning anyone crossing the yard gets  
✎ It fires on entry and again at the end of every turn, the same two triggers the Merchant's gun uses

## 2026-09-04 · The Tag Catalog opens on /documents, and the building system lands

✚ A Tags tab on /documents — the whole tag catalog, searchable, each card showing what a tag costs and what it asks for  
✎ Every tag now says who may read its card: public, GMs plus whoever it already concerns, or nobody at all  
✚ Building: structures raised over several turns by a crew, standing in a Location and lending their kit to whoever works there  
✚ Fourteen things to build — a forge, a palisade, a bridge, a library, a gallows, a jailhouse, a lazarette, a trebuchet and more  
✚ A structure can hold a crossing open: a ford or a gateway nobody can open by hand until somebody builds it  
✚ A rulings desk on /gm/turns for the calls building throws up, and a /gm/structures page listing everything standing  
✎ Structures pay into Laboring, so a good workshop makes the work behind it better

## 2026-09-04 · The Watch is now the Cerberon

✎ The Watch is the Cerberon, the Captain is the Censor, and a Watchman is a Cerberus. The radio channel, the radio tags, the wax stamp, the office and the handbook page all moved with them  
✚ The Censor starts with a helmet, a shield, Melee (Shield Wall), Ranged (Basic) and the Cerberon radio system, and drops the bottle — Alcoholic is gone from the seat  
✚ Every Cerberus, and the Incarn, now start with Melee (Shield Wall). The Squire does not  
✚ Three Radio Bracelets waiting in the armory, so the Censor can equip new hires without buying any  
✚ A Merchant's Office in the Depot, behind the Merchant's Licence. A desk, filing cabinets, and a big red button  
− The Watch Badge. The gate now recognizes the Cerberon itself, plus Knighted, instead of a badge anyone could pocket  
✎ The Depot's lock moved off the Landing Pad and onto the Cargo Bay — the pad is a hole in the roof, the goods are worth a door  
✎ The Depot terminal only opens while you are standing at the Depot. Every button on it already refused from anywhere else; now the page does too  
✎ The Censor's office is described again, and the turret switch is on the wall where the documents say it is

## 2026-09-04 · The Commoner and her kits, the Arbiter, and four seats retired

✎ The Peasant is now the Commoner, and starts skilled at labor and nothing else — no default farm, no shack  
✚ Three Commoner kits at creation, each one crate you unpack when you like: Fisherman (1 pt, a boat and the fishing skill), Farmer (0 pt, a work knife and the farming skill), Hunter (2 pt, the hunting skill and Forester)  
✚ The Fishing Boat: one extra free zone crossing a turn, but only between the Forest, the Black Hills and the Marshes, plus +1 to fishing labor. It can't be out at the same time as a horse or a cart, and it waits at the door indoors  
✚ The Arbiter, a new Court seat standing in the Keep — the God-King's man in Ravenheart, behind the whitelist, starting with a sabre, a Major's Insignia and 4 obols  
✚ A God-King document explaining who Enoch II is and why the Arbiter is here. Every Court seat gets it, plus the Captain, the Merchant and the Banneret  
✚ The Meister now needs the whitelist too  
− The Diplomat. The seat is retired and its material is filed away rather than deleted, so it can come back whole. Three of its Desires are now the Arbiter's and one is the Scholastic's  
− The Herald and the Outsider. Their two woods Desires now ask for Forester, so a Commoner with the Hunter kit can reach them, and "Deliver an important message" now asks only that you can read  
− The Manor, House and Shack tags. A Manor Key replaces the Manor  
✎ Everyone in the Fortress now starts Post-Christian — the Baron's family, the Incarn, the Captain, the Watchmen and the Squire. That spends their one belief slot, so those seats can no longer pick Atheist or an Old Ways at creation without dropping it first  
✎ The Brigands are their own group now, in the Black Hills where they already camped, instead of sitting under the Town  
✎ Bum 5 → 4 seats per 100 players, Inn Staff 3 → 2, Watchman 7 → 6

## 2026-09-04 · The Leader Whitelist is now just a whitelist

✎ Whitelisting a role no longer means making its holder a faction Leader. The two are separate settings now, so a seat can be gated without leading anything — the Hand is the first one
− The star on gated role cards. A card you can't pick is greyed and says "Whitelist only" on hover instead, which the silent grey never did
✚ The Hand now needs the whitelist. Every seat that needed it before still does

## 2026-09-04 · The point-buy meter stops tripping the contrast gate

✎ No player-visible change — the meter is the colour it always was

## 2026-09-04 · One ruined face per character, and Scarred is no longer a build choice

✎ Ugly and Disfigured now conflict with each other, as both already did with Leper  
− Scarred can no longer be bought at creation

## 2026-09-04 · Two fixes on the Threats tables and the character sheet

✎ The Threats tables now use the full width instead of half the screen  
✎ Fixed a crash on /character — the profile picture field threw as soon as the page rendered

## 2026-09-04 · Leper cannot be stacked with the other ugliness

✎ Leper now conflicts with Ugly, Disfigured, Pretty and Beautiful

## 2026-09-04 · A helmet is a face: concealment now takes something over yours

✎ /conceal needs concealing headgear equipped — a bare face can no longer go unnamed  
✚ Seventeen helmets, hoods and masks, each with its own face for the room to see  
✚ Some conceal by force: a sack or a plague mask gives the wearer no say, and a turn summary honours it too  
✚ Headgear and body armor now sit in layers 1-4, so a coif goes under a helm but two helms do not go together  
✚ One shield at a time  
✚ Bound characters can no longer equip, unequip, craft or destroy — a hostage cannot take the bag off  
✚ A Leper trait, and a Leper's Hood that costs nothing if you have it  
✚ The Merchant stocks a Rat Mask; the Armory trades two Simple Helms for four Cerberus Helmets  
− The Ridiculous Hat

## 2026-09-04 · The drawback cap lands on 5 tags and 12 points

✎ A character may take 5 drawbacks claiming back 12 points, not 4 and 14

## 2026-09-04 · Four drawbacks, worth 14 points, and a Fast Metabolism

✎ A character may now take 4 drawbacks claiming back 14 points, was 6 and 12  
✚ Fast Metabolism, a -6 drawback: you eat 2 ⬢ a turn instead of 1

## 2026-09-04 · A courtier has one wax seal, not six

✎ At most one personal wax seal per courtier, at creation and in the store

## 2026-09-04 · Paperwork: paper you can write on, seal, post and tear down

✚ Write and Seal Letter on the Actions grid, for anyone with their letters  
✚ Noticeboards at the Square, the Gatehouse, the Garrison, the Factory and the Depot — pin a paper, read one, or tear it down  
✚ Paper at the Depot for 1 obol, the cheapest thing on his shelf  
✚ Six courtier wax seals, and eight office stamps each starting in the room its seat works out of  
✚ The Merchant's stamp bears his own initials, taken when he is created  
− The glyph cipher and the Read button, which paper replaces outright  
✎ The Bird carries a letter you are holding instead of typed text, and a wrong guess brings it back rather than eating it  
✎ An illiterate or blind character can now carry a letter they cannot read, and hand it to somebody who can  
✎ A Restart Game now clears crates, headstones and paper instead of leaving them in the catalog forever

## 2026-09-04 · Equipped slots stay full width instead of shrinking to the tag

## 2026-09-04 · The Spillway no longer eats a shift by accident

## 2026-09-04 · The Depot's turret learns the Merchant's face when he is created

✚ The Depot's turret now knows the Merchant's face the moment he is made, so he can arm it himself  
✎ A GM setting the face by hand is the override now, not the only way

## 2026-09-04 · The Merchant starts with 20 obols, not 30

✎ The Merchant starts with 20 ¢ instead of 30, so his first order leans harder on the Company's line  
✎ The cast starts with 80 ¢ between them rather than 90; nobody else's purse changed

## 2026-09-04 · Adds the Godard Factory, the Banneret, and the Squeeze production chain

## 2026-09-04 · An obol is one Resource, so the Merchant can sell you a cup of tea

✎ An obol is now worth one Resource instead of five, so the Depot can price a cup of tea  
✎ Everything cheap is buyable and sellable again — 32 wares used to sell back for nothing at all  
✎ Starting money and the Company's line went up five times to match, so nobody is poorer  
− The Resources/obols toggle on the console; there is nothing left for it to switch between  
− The ⬢-per-obol field on the Dev Panel

## 2026-09-04 · The Black Hills hunt evenly, and the Forest fishes better

✎ Hunting is the same everywhere in the Black Hills now, at 1.0. It was 0.8 across most of the zone with two richer spots; those are gone  
✎ Fishing in the Forest went from 0.7 to 0.9 at all six waterside places

## 2026-09-04 · Five more guns and blades on the Merchant's counter

✚ The Merchant now imports a CTT4&3 Rifle, a Kpfw-6 Avtomat, an Adamantium Sword, a Silver Sword and a BB Pistol  
The two rifles and the Adamantium Sword ship sealed, so nobody reads the crate on the landing pad before the right person opens it

## 2026-09-04 · The Depot can show its prices in obols

✚ A ⬢/¢ toggle beside the balance in the Depot cockpit, remembered per browser. Order, Price List and Hold all follow it  
✎ Obol prices on a row are exact — an 8 ⬢ ware reads 1.6 ¢ — because the counter converts on the total, not line by line. The order total, the Hold payout and the balance stay in whole obols either way  
✎ The Merchant now starts with 6 ¢ instead of 20, about 30 ⬢, and the Company will only advance him 15 ¢ instead of 60  
✚ Silencer, a 90 ⬢ Depot import the Merchant starts holding. Equip to muffle your shots

## 2026-09-04 · Laboring pays about 7% less

✎ The production coefficient drops from 1 to 0.93, in the default and in the live game  
✎ Hunting is 0-17 now, Farming 11-15, Fishing 7-13 at a full-strength location  
✎ Basic laboring is untouched on purpose — it is the floor of the economy — and Skilled's 1-4 is too coarse to move 7%

## 2026-09-04 · A dead faction Leader hands the seat on, and a founded faction survives a sync

✚ A Leader who dies gives up the seat; it passes on, skipping anyone Catatonic  
✚ db:sync-roles no longer deletes a faction a player founded once it empties  
✚ A Restart Game wipe clears silos and the factions players founded  
✎ A locked silo no longer shows its ⬢ to somebody who cannot open it  
✎ You can hand goods into a locked silo while standing at its door, not just from across the zone  
✎ Accepting an invitation hands over the silo keys; the invitee can no longer pick which  
✎ A silo has to be in the faction's own zone, and the pickers only offer those rooms  
✎ Faction rosters and member counts no longer include the dead  
✎ Two factions can no longer share a name  
✎ Anyone can found a faction from inside one, without leaving first  
✎ The faction directory is searchable and paged  
✎ Nobody is an officer of Unaffiliated, and its Leader cannot drag anybody  
✎ Hills Camp can't be destroyed — it was untradeable, so it was unrecoverable  
− Two application columns nothing read; the audit log already carried both facts

## 2026-09-04 · Factions secede, apply, and keep their silo in a room

✚ Leave a faction, apply to another, invite somebody, accept or decline  
✚ A Leader can secede from a parent faction, or rename their own  
✚ Anyone can found a new faction and become its Leader  
✚ A faction's silo is a Room now, storing tags and goods like any other stash  
✚ Deposit into your silo from anywhere in its zone; withdraw only in the room  
✚ A locked silo still takes deposits, and says it is one-way before you commit  
✚ /faction is a tabbed console; players with no faction get a directory  
✚ /gm/dev/factions gains a silo picker, a member mover and a pending list  
✚ Nine storerooms, the Armory restocked, a Baron's Study and a Ravine Camp  
✚ Six keys, a Keys tag group, and a Location group for the Brigands' camp  
✎ Brigands start in the Ravine now, not the town  
✎ Nothing branches on a faction's name any more, only its slug

## 2026-09-04 · Soft Hands has never done a day's labor, and cannot be taught otherwise

Soft Hands can no longer be held with any Laboring skill  
A lesson can no longer teach past a tag conflict, which was the way round every conflict pair in the catalog and not just this one

## 2026-09-04 · The #info rebuild works again

✎ The command that rebuilds #info from its master file had been broken since the scripts were reorganised; it looked for a docs folder that isn't there, and then choked on the roles list. #info is rebuilt and carries the new turn cadence

## 2026-09-04 · Turns are a day long now

✎ A turn is a whole real day and ends at midnight CT, instead of the two 12-hour turns a day it used to be. Dawn and Dusk still alternate, so an in-game day is two turns and takes two real days  
✎ Everything measured in turns — hunger, the Catatonic clock, corpse rot, crafting, Depot fuel, Desire locks — now takes twice as long in real time  
✎ Moves are due at 9 PM CT, and the #turns message says so in everyone's own timezone  
− The ghost wind reaction. A dead player has no voice; their unburied body is what tells the room, and it now does so every 4-10 hours instead of every 2-5  
✎ The game runs 30 real days, reaching in-game Day 15

## 2026-09-04 · The Merchant's own till, and seven things the Depot got wrong

✚ A ⬢ counter at the Depot: Resources to obols and back at one flat rate with  
− The shuttle no longer converts loose ⬢ — one rate, one place  
✎ An unopened crate sent back up is worth what is inside it, instead of nothing  
✎ You can only order one of anything you can only carry one of, instead of  
✎ Opening a crate records what actually landed, not what the crate claimed  
✎ Undoing an order that already flew down is refused instead of refunding the  
✎ A shuttle called between turns no longer parks itself forever  
✎ The generator's death can actually be heard — the line was wired to the  
✎ The shuttle landing and departing are announced, which they never were  
✎ Arming the turret with no face on file is refused, not warned about: the cure  
✎ Undoing a refuel no longer mints back the fuel already burned  
✎ Tooltips and GM help text carry their

## 2026-09-04 · The Merchant runs a station now, not a shop

✚ Obols (¢), a weightless coin worth 5 ⬢ at the Depot and nothing anywhere else  
✚ The account belongs to the station, not the Merchant — the licence carries it  
✚ Order into a manifest, call the shuttle, goods land as crates on a landing pad  
✚ Crates print their own manifest; dangerous wares ship SEALED behind a keycard  
✚ A generator that burns coal every turn and takes the Depot down when it empties  
✚ An indoor turret that reads faces, not papers — armour moves the whole table  
✚ A cockpit console with six tabs, a full price list, and a ledger  
✚ A Depot section on the Dev Panel for every number above  
− Character.depotDebt; the line lives on the station now

## 2026-09-04 · Mime's Vow, and a tag can be whitelisted to one seat

Vow of Silence is renamed Mime's Vow, and only a Minstrel can take it  
Tags can be whitelisted to a seat, not just blacklisted away from one, so a role-only tag no longer means listing the other 38 roles

## 2026-09-04 · The intercom is loud now, and it lands in the transcript

✎ The PA is no longer small grey subtext. Everything else the world says is scenery and sits under the conversation, but a loudspeaker is the opposite of scenery — and it pings everyone, so delivering it in the quietest text Discord renders was backwards  
✚ Announcements are recorded in the archive. They were the one kind of public talk missing from it  
✎ An announcement ending in ! or ? keeps its own punctuation instead of picking up a stray full stop

## 2026-09-04 · Vow of Silence is a Minstrel's, and nobody else's

Vow of Silence can only be taken by a Minstrel now  
Tags can be whitelisted to a seat, not just blacklisted away from one, so a role-only tag no longer means listing the other 38 roles

## 2026-09-04 · Nearsighted tells you to go and get spectacles

Nearsighted's description now points at Spectacles, since the tag is what unlocks Look at again

## 2026-09-03 · A body decides what it can carry, and bad eyes cannot look anyone over

Carry caps now ADD their bonuses instead of multiplying them, so a frail body costs everyone the same pounds whether or not they happen to be pulling a cart  
Giant, the priciest tag in the game, finally buys carry: +0.75, the biggest body bonus there is  
Frail, Old, Fat, Dwarf, the maimings and a dozen wounds all take a small bite out of what you can haul, floored at a quarter of the base so nobody is stuck permanently overburdened  
✚ Pack Mouse, the mirror of Pack Mule: narrow shoulders, -0.5, and 4 points back  
Strong now matches Pack Mule's carry instead of a fifth of it, having cost more and done less  
A crippled or missing leg costs you your free zone crossing, unless a horse is doing the walking. A peg leg still walks  
✚ Sun Sensitivity, a new drawback, and the first code Nearsighted and Spectacles have ever had: both now block Look at, and a greyed button says why on hover  
Twelve pairs of contradictory tags can no longer be bought together, Mute and Vow of Silence and Blind and Eagle Eyes among them

## 2026-09-03 · Drawbacks now run out two ways, not one

✚ A second limit at character creation: your drawbacks can claim back at most 12 points between them, on top of the cap on how many you may take  
✎ The cap on how many rises from 5 to 6. You stop at whichever limit you reach first  
✎ Before this, five drawbacks were five drawbacks whether they were worth 5 points or 43, so the only sensible play was to stack the worst afflictions in the book. A build could reach 55 points; it now tops out at 24  
✎ The creation screen grows a second budget bar showing what you have claimed back, with the tag count under it. Each goes red on its own, so you can see which limit stopped you  
✎ Both numbers are editable on the dev panel, and neither applies in the store — the limits belong to character creation and stop existing once play starts

## 2026-09-03 · Nobody can escalate the intercom to @everyone

✎ The PA's own @here still pings everyone in the zone. A typed @everyone, @here or role mention inside the announcement itself is now inert

## 2026-09-03 · The Baron can wave somebody into his office, and the intercom is a button again

✚ /add and /remove now work in a private room, not only in conversations — anyone already inside can let in somebody standing in the same place  
✎ A guest stays until they leave; walking out of the location shuts the door behind them, and coming back needs a fresh invite  
✎ A guest gets the whole room, not just the thread: the stash, the Transfer dialog, anything set up in there  
✎ /remove refuses somebody holding the room's key, and says to take the key instead  
✚ An Intercom button on the Council Room's table. It announces into every zone above ground except the Black Hills, and pings everyone there  
− The #intercom channel and the Intercom tag. Standing at that table is now the whole gate  
✎ Lines the world says — a gate crossing, the smell of death, whispering overheard, goods moved around a stash — are all small grey subtext now, so they stop competing with what players are writing

## 2026-09-03 · Mute and Stutter cannot be picked together, nor Dwarf and Giant

Mute now conflicts with Stutter, the way Deaf conflicts with Hard of Hearing  
Dwarf and Giant now block each other in the character creator

## 2026-09-03 · You can look someone over without saying a word to them

✚ A Look at button on the character sheet. Pick anybody standing where you are and see what a bystander could see: their face, their open injuries, whatever they are carrying openly  
✎ A concealed person stays concealed. You get the same impoverished read the magnifying-glass reaction gives, so a hood is still worth wearing  
✎ The magnifying-glass reaction only ever worked on somebody who had already spoken, which meant a guard could not size up a silent traveller without starting a conversation first. It still works, and both now show exactly the same thing  
✎ A medic still sees what their training lets them see, and a faction officer still sees a member's resources. Same rules as before, in one place now

## 2026-09-03 · A key weighs nothing: 0 becomes a real rung on the weight ladder

✎ Keys, letters, badges, spectacles and coins weigh nothing now instead of half a pound each — 0 is a real rung on the weight ladder

## 2026-09-03 · Devoted Follower needs somebody to follow

✚ Night Blind and Blind can no longer be taken together — curing Blind already leaves you Night Blind  
✚ Devoted Follower is closed to Migrants, Mercenaries, Bums, Outsiders and Pushers — nobody to be devoted to  
✎ Sewer Key weighs half a pound, like every other key

## 2026-09-03 · Hard of Hearing is worth less, and rules out Deaf

✎ Hard of Hearing gives 4 points instead of 5  
✚ Hard of Hearing and Deaf can no longer be taken together — one ear or none, not both

## 2026-09-03 · Tag stacking: set the count, and tag edits save on the spot

✎ The Dev Panel's Holds row now has a stepper showing how many they hold — type the number you want. Taking a stack of seven meals down to three is one gesture, not four clicks of Take one  
✎ Tag changes on a character's dev panel save the moment you make them, like Kill and Revive already did. No more staging a tag and hunting for Apply  
✚ Heal all, Feed and Inflict a wound now fire straight away and say what they did, instead of quietly staging  
✎ Removing a wound that leaves an aftermath behind still asks first, since putting the wound back will not clear it  
✎ One quantity control everywhere — craft, destroy, transfer, loot, the depot and both GM desks — with plus and minus buttons instead of nine slightly different boxes

## 2026-09-03 · Walking into an inn no longer empties your cart onto its floor

✎ Carrying is measured in pounds now, not item count. Every item has a weight; a horse, a cart, a house and anything grafted into you weigh nothing  
✚ Past 1.5× your cap goods simply can't be yours: a hand-over is refused, and a harvest or a cave haul that big drops around you  
✎ Overburdened no longer walls you in. It costs you your free zone moves, so you can still cross — you just spend your Move  
✚ Everyone gets one free zone crossing a turn; an equipped mount adds another, and it now works both halves of the day  
✎ Carts and horses must be equipped to do anything, and are left at the door of the Cathedral, Sanctuary, Inn, Keep, Undercroft and Factory  
✚ Workshop Equipment: a heavy craftable that smithing and building now require, held or set up where you stand. The old Workshop asset is gone  
✎ Surgical Equipment is +1 on any medical Gambit, and there is a real set in the Sanctuary's operating theatre  
✚ A medic can attempt any cure, including above their skill. It becomes a Gambit: it spends your Move and a bad roll can leave the patient worse  
✚ Routine treatment is rationed 2/3/4 a turn by medical tier. First aid is free and never counts  
✎ The Plow is an asset, so it stops weighing on a farmer's back

## 2026-09-03 · Every location can be examined, not just worked

✎ The Labor? button on every location channel is now Examine. It still says what the ground yields here, and now also what the place itself is and whether the ways out of it stand open or closed  
✚ Locations can carry attributes — facts about a place, written into zones.yaml, that Examine turns into a sentence. The Merchant's Depot is the first one to wear one

## 2026-09-03 · The changelog speaks plain language, and can be told to stay quiet

✎ Changelog entries now say what changed in the game instead of listing files  
✚ A --hidden switch on a push: nothing is written and nothing is posted  
✎ Lore and antagonist work is held back from the changelog by default

## 2026-09-03 · Weapons don't stack: you hunt with one bow, not the whole rack

```
✎ db/lib/autoLaborPass.js
✎ db/lib/laborAccess.js
✎ docs/handbook.md
✎ docs/systemdocs/LABORING.md
```

## 2026-09-03 · Changelog: every push leaves a line here and in Discord

```
+ CHANGELOG.md
+ scripts/changelog/log.js
✎ CLAUDE.md
✎ package.json
```
