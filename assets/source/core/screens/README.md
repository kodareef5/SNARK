# The default clips

The clips the Vegas ball ships with. A cluster's admin uploads more on its Screens page; those stay on that server.
A default clip goes out with the game, so it must be public domain, CC0, or made for the game by whoever supplies it.

Each clip is a folder named in lower case words joined by hyphens:

- `source.json`, tracked: the title, where the original came from and its SHA-256, the rights line players see, the
  licence as its source words it, and how it is cut and encoded.
- `clip.json`, tracked: what the encode made, with its id, size, length and colour track.
- `clip.mp4` and `poster.jpg`: art, in the `art` release as `core-screens-<folder>`, one archive to a clip.

`channels.json` lists the default channels, which a new cluster starts with: a name, the folders in order, and whether
it shuffles. A clip whose `source.json` says `"flashes": true` may not be in one.

## Adding clips

1. Put the files in a folder and fill a sheet like `sheet-template.csv`, one row to a file. `file`, `title`,
   `rights`, `licence` and either `url` (with `page`) or `by` are needed; the rest may be blank. `channels` lists
   default channels split by `;`. `start` and `length` cut it, in seconds; `poster` is a second into the cut clip, or
   `brightest`; `audio` keeps the sound.
2. `bun run clips add path/to/folder --list sheet.csv`. It checks every row before it does anything, keeps each
   original in `~/.cache/snark/video-sources` by its SHA-256, encodes to 640×360 at 600 kbit/s or the row's rate,
   joins the channels, lists the files in `distribution/source-files.txt` and writes `SOURCES.md`.
3. `python3 tools/release/pack.py art var/release --only core-screens-` packs the clips alone and pins them in
   `distribution/release.json`. Upload the archives it names: `gh release upload art var/release/<file>...`.
4. Commit the folders' JSON, `channels.json`, `SOURCES.md` and the two distribution files.

Another checkout gets them with `bun run media art core-video`; the next client build serves them.

`bun run clips make [folder...]` encodes again from the recipes (a url source is fetched; a supplied one must be in
the cache). `bun run clips check` checks every recipe, clip and channel, as the tests do. To drop a clip, delete its
folder and its line in `channels.json`, then `bun run clips check` and pack again.
