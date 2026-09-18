# Item sprites

The PNGs in this folder are from OpenSourceWeb, the open-licensed archive of
the BYOND game Lifeweb / Farweb:

https://github.com/SS13-Special-Codebases-Archive/OpenSourceWeb (commit edb003d)

Its README licenses all icons and sounds under Creative Commons Attribution-
ShareAlike 3.0 (https://creativecommons.org/licenses/by-sa/3.0/). So:

- Credit the source. This file is that credit, and the public credits line in
  `docs/handbook.md` names it too.
- Anything derived from these images (a recolour, a crop, a slice) carries the
  same license. Code and CSS that merely reference them do not.
- Commercial use is allowed.

The same grant already covers the five chrome textures in
`web/public/assets/chrome/` — see that folder's ATTRIBUTION.md, which explains
why Bascinet relies on the OpenSourceWeb notice rather than the stricter NC-ND
one on the SS13-Source-Archive/Farweb mirror. **The repository's CODE is
GPLv3/AGPLv3 and none of it is used here.** Only the art is taken, under the
separate CC BY-SA grant its README gives.

## How these got here

OpenSourceWeb ships its art as BYOND `.dmi` files, which are PNGs carrying a
zTXt chunk that describes the sprite sheet inside. Each was split into its
individual frames, then filtered down to one canonical frame per subject —
no `_blood` gore variants, no animation frames past the first, and the
south-facing frame only for directional sprites.

Each kept frame was then **cropped to its own content and padded back to a
square**. No pixel is redrawn, recoloured or resampled; only fully transparent
margin is removed. This is the one modification, and it exists because these
are floor sprites: OpenSourceWeb draws a bottle small and low inside a
tile-sized frame, so an icon that mapped the whole frame into 16px rendered it
as a five-pixel speck. The crop is a derivative work and carries the same
CC BY-SA 3.0 terms as the original, which is why it is written down here.

Files are named after the source sprite, not the tag, so several tags that
should look alike — the keys, the untitled books — share one file.

A tag names its file through `sprite:` in `docs/tags.yaml`, which
`db/lib/syncTags.js` checks really exists. Anything without one draws its
TagGroup's lucide glyph instead, exactly as the whole catalog did before.
No font from either repo is shipped. They are third-party and not covered by
the grant.
