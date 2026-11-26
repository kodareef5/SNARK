# Distributing SNARK

The clone contains the engine, client, server, game content, tools, tests, editable art recipes and metadata, and five authored city definitions. Of the planning notes it keeps the three generated reference pages and the benchmark record under `planning/`. The other notes are kept outside this repository, so some links into `planning/` lead nowhere. The release manifest pins the optional binary files, which GitHub CLI downloads from the repository named in the manifest.

## What the releases hold

Two releases carry the binary files that Git does not. `distribution/release.json` pins every file by name, size and SHA-256.

- **`art`** holds the painted game's inputs: textures, converted packs, sounds, music, fonts and the third-party models the art conversions read. There is one archive to an asset, such as a creature, a vehicle or a set of sounds. `distribution/source-files.txt` lists every file in them. Reference pictures, films and concept models are not included.
- **`map-kits`** holds one prepared kit to a city: the layers the map build reads, without the 8 to 10 GB of public downloads they were made from.

The public [Map kits release](https://github.com/kodareef5/SNARK/releases/tag/map-kits) keeps earlier kits alongside Maps v3. Each filename includes its content hash, so a checkout downloads the edition its manifest pins. The [Art release](https://github.com/kodareef5/SNARK/releases/tag/art) uses the same naming scheme.

Built clients and built maps are not published. Both must match one exact commit, and both come from the steps below.

## Installing

Run `bun run media list` to see what this commit pins and what is installed here.

- `bun run media art` installs every art archive beside the tracked recipes. `bun run media art core-creatures-dodo` installs one, and `bun run media art core-sfx` installs every archive whose name starts that way. Once every archive the manifest pins is installed, `bun run build` builds the painted game. Until then a build uses generated geometry and the built-in HUD. Blender is only needed to convert art again.
- `bun run media kit CITY` restores one city's prepared cut to `var/mapdata/CITY`. `bun tools/maps/city.ts CITY` then makes `var/maps/CITY.snmap`. Stages whose code has changed since the kit was packed run again; the ones after the downloads need only the Python environment in [the map pipeline's notes](../tools/maps/README.md).

Downloads are kept under `~/.cache/snark` (or `SNARK_CACHE`) and checked before unpacking, so an interrupted run can be repeated. A later run fetches only archives that are missing or changed. Each art archive is unpacked there once, and every checkout on the machine hard-links its files from that copy, so a second checkout downloads nothing and takes no more disk. A file you have edited is left alone and stops the installation, unless the installer itself put it there or you pass `--force`.

The linked files are read-only, because writing into one would change it in every checkout. A tool that writes a new file and renames it over the old one changes this checkout alone, as `bun run art` does. Do not `chmod` one: `bun run media art NAME --copy` gives this checkout writable copies of an asset it will rebuild.

`bun run check` installs missing or newly pinned art itself when the machine already holds the archives, and downloads nothing. A run that skipped tests for missing art fails with `NOT A GATE`. Where the art is not installed at all, `bun run check -- --no-art` lets those tests skip and says how many did.

To host the game, run `bun run build`, build a map for each city, and start a server for each as [the server's notes](../server/README.md) describe.

To add the wiki, install Chrome or Chromium with WebGL 2 and put `cwebp` on your path. Run `bun run wiki` after building the client and maps. Miami supplies the section scenes, and each supported city map adds its own gallery. The build caches the photos in `.cache/wiki/photographs` and writes the site to `client/dist/wiki`. Open `/wiki/` on the game server to read it.

## Packing

1. `distribution/source-files.txt` is the inventory of binary inputs. With those files installed, `python3 tools/release/pack.py art OUTPUT` writes one archive to an asset and pins them in `distribution/release.json`. An asset that did not change packs to the same file as before. With `--only PREFIX` it packs only the assets named so and leaves every other pin alone, so new art needs only its own files installed: `--only core-screens-` packs the default screen media (`assets/source/core/screens/README.md`).
2. On the machine that built the cities, `bun tools/maps/kit.ts pack all` and then `python3 tools/release/pack.py kits OUTPUT` do the same for the kits.
3. Upload the files the releases do not have yet with `gh release upload art OUTPUT/*` and `gh release upload map-kits OUTPUT/* --repo kodareef5/SNARK`, then commit the manifest.

City builds are manual. GitHub Actions is disabled.

## History

This branch is cut from the main branch of a private repository. It keeps every change to the retained paths, including merge history, with the original dates. Commits that changed only omitted files are absent, and rewritten commits have new IDs. Commit messages still quote the original IDs. Look up either ID in `distribution/history-map.tsv`. Commits that changed only planning notes are kept with those notes. The other omitted commits are recorded in `distribution/omitted-commits.jsonl` with their original IDs, parents, dates and full messages. The private repository remains the source for old binary revisions and unmerged branches.
