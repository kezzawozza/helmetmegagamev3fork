# OpenSourceWeb sprite library

Pixel art from **OpenSourceWeb**, the open-licensed archive of the BYOND game
Lifeweb / Farweb:

https://github.com/SS13-Special-Codebases-Archive/OpenSourceWeb (commit edb003d)

Its README licenses all icons and sounds under **Creative Commons
Attribution-ShareAlike 3.0**
(https://creativecommons.org/licenses/by-sa/3.0/). The repository's *code* is
GPLv3/AGPLv3 and none of it is here — only the art, under that separate grant.
Anything derived from these images (a recolour, a crop, a slice) carries the
same license. Code and CSS that merely reference them do not.

Credit the source. Bascinet's public credit is the Credits section of
`docs/handbook.md`.

## What this folder is for

**A library to pick from, not something the app serves.** It sits outside
`web/public/` on purpose: 11,239 files have no business in a deploy. When a
sprite is wanted for something, copy it into the folder that surface owns —
`web/public/assets/items/` for an item tag's art, `web/assets/helms/` for a
concealing helm — and reference it from there.

Bascinet already uses it in three places:

| Where | What |
|---|---|
| `web/public/assets/items/` | item tag art (`Tag.sprite`, TAGS.md §4c) |
| `web/public/assets/helms/` | the face a concealed wearer shows (`Tag.concealSprite`) |
| `web/public/assets/chrome/` | the textures under the page (DESIGN-SYSTEM.md §3a) |

Each of those folders carries its own ATTRIBUTION.md, because each is a
redistribution in its own right.

## What is in here, and what is not

OpenSourceWeb ships art as BYOND `.dmi` files — PNGs carrying a zTXt chunk
that describes the sprite sheet packed inside. `scripts/osw/extract-dmi.py`
reads that chunk and splits each sheet into its frames. 342 sheets yield
25,520 frames; this folder holds the **11,239 canonical ones**, filtered down
to one frame per subject:

- no `_blood` gore variants (138)
- no animation frames past the first (10,406) — `foo_f1.png` is kept, `_f2` up is not
- south-facing only for directional sprites (6,563) — `foo_S.png` is kept, `_N`/`_E`/`_W` are not
- no `_sheets/` originals (342) — the unsplit `.dmi` files themselves

**Nothing here is modified.** Each file is the frame exactly as it came out of
the sheet. (`web/public/assets/items/` holds *cropped* copies — that folder's
ATTRIBUTION.md explains why.)

If you need something the filter dropped — a walk cycle, a north-facing frame,
a bloodied blade — re-run the extractor against a fresh clone:

```
python3 scripts/osw/extract-dmi.py <path-to-OpenSourceWeb-clone> <output-dir>
```

It writes every frame, unfiltered. Directory structure mirrors the source
repo's `icons/` tree, so a path here maps back to the `.dmi` it came from.

## Finding something

The two top-level folders are `food/` and `other/`, mirroring the source. The
directories worth knowing, for a low-fantasy game:

- `other/weapons/` — the medieval arms: bardiche, bastard sword, buckler,
  flail, boneclub, and the rest. Lifeweb is not a pure space station.
- `other/severed/` — organs and body parts.
- `other/clothing/{hats,masks,suits,gloves,shoes,belts,amulets}/`
- `other/{items,objects,miscobjs,storage,personal}/` — the general grab-bag.
- `other/{mining,surgery,prothesis,books,library,paper,painting}/`
- `food/{harvest,food,cooking,seeds,drinks,kitchen}/`

Most of the rest is space-station infrastructure — pipes, doors, atmospherics,
computers, turrets — and will not serve Ravenheart.
