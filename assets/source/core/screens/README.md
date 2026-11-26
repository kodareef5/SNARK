# The default screen media

The clips and still images every cluster's screens start with: the Vegas ball, billboards, TVs and laptops. A
cluster's admin uploads more on its Screens page; those stay on that server. A default item goes out with the game, so
it must be public domain, CC0, or made for the game by whoever supplies it.

Each item is a folder named in lower case words joined by hyphens:

- `source.json`, tracked: the title, where the original came from and its SHA-256, the rights line players see, the
  licence as its source words it, and how it is cut and encoded. `kind` is `"clip"` (the default) or `"image"`.
  `types` lists the types of screen it is offered on (`orb`, `billboard`, `tv`, `laptop`); with none it is offered on
  every type. An image may say `"format": "png"` for flat art; it is a JPEG otherwise.
- `clip.json`, tracked: what the encode made, with its id, size, length and colour track. An image's has
  `"kind": "image"`, `seconds` 0 and one colour sample.
- The art, in the `art` release as `core-screens-<folder>`, one archive to an item: `clip.mp4` or `image.jpg` /
  `image.png`, and `poster.jpg`.

An image is fitted to 1280 pixels on its long side, never upscaled, and must come out under 400 KB.

`channels.json` lists the default channels, which a new cluster starts with: a name, the folders in order, whether it
shuffles, its `type` (the ball where it says none) and `still`, the seconds each image holds (8 where it says none, 2
to 120). Names are unique across every type. A channel holds only items offered on its type. An item whose
`source.json` says `"flashes": true` may not be in one. A fresh cluster's billboards, TVs and laptops start on their
type's first channel; the ball starts on its scenes.

## Adding items

1. Put the files in a folder and fill a sheet like `sheet-template.csv`, one row to a file. `file`, `title`,
   `rights`, `licence` and either `url` (with `page`) or `by` are needed; the rest may be blank. `kind` is clip or
   image, or blank to go by the file's ending. `types` and `channels` are lists split by `;`; an image with no types is
   offered on every type but the ball. A channel the sheet makes is for the first of its first item's types. `format`
   is png or jpeg, for an image. `start` and `length` cut a clip, in seconds; `poster` is a second into the cut clip,
   or `brightest`; `audio` keeps the sound.
2. `bun run screens add path/to/folder --list sheet.csv`. It checks every row before it does anything, keeps each
   original in `~/.cache/snark/video-sources` by its SHA-256, encodes clips to 640×360 at 600 kbit/s or the row's
   rate and images to their fitted size, joins the channels, lists the files in `distribution/source-files.txt` and
   writes `SOURCES.md`.
3. `python3 tools/release/pack.py art var/release --only core-screens- --private kodareef5/snark_private` packs the
   items alone and pins them in `distribution/release.json`. Upload the archives it names:
   `gh release upload art var/release/<file>...`.
4. Commit the folders' JSON, `channels.json`, `SOURCES.md` and the two distribution files.

Another checkout gets them with `bun run media art core-screens`; the next client build serves them.

`bun run screens make [folder...]` encodes again from the recipes (a url source is fetched; a supplied one must be in
the cache). `bun run screens check` checks every recipe, item and channel, as the tests do. To drop an item, delete
its folder and its lines in `channels.json`, then `bun run screens check` and pack again.
