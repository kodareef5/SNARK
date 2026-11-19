# Distributing SNARK

The clone contains the engine, client, server, game content, tools, tests, editable art recipes and metadata, and five authored city definitions. Of the planning notes it keeps the three generated reference pages and the benchmark record under `planning/`. The other notes are kept outside this repository, so some links into `planning/` lead nowhere. The release manifest pins the optional binary files, which GitHub CLI downloads from this repository's releases.

## Review status

No media has been packed for the current source, so the manifest lists no files and a clone builds with generated geometry. `distribution/source-files.txt` is the current inventory of binary inputs. City builds are manual. GitHub Actions is disabled.

## Installing

Run `bun run media list` for the compressed download sizes. The installer verifies file sizes and SHA-256 before unpacking. An interrupted download can be retried. If an installed file has local edits, installation stops at that file and preserves it. Install a new release in a fresh checkout to keep local edits and earlier map cuts available.

- `client` installs the ready-to-serve client and wiki under `var/release-client`. The server loads the boot pack, rigs, and clips from this same client.
- `map CITY` installs the v9 map, bridge entrance metadata, source notices and download records under `var/maps`. The server produces compressed parts as needed. To precompute them, run `bun tools/map.ts pack var/maps/CITY.snmap`.
- `kit CITY` restores one prepared cut to `var/mapdata/CITY`. Run `bun tools/maps/city.ts CITY` to make the map. A kit includes the prepared layers, stage hashes and OSM extract used by the world stage. Raw elevation and other upstream downloads stay on the preparation machine.
- `art` restores all seven parts of the editable art set beside their tracked recipes. The verified installation writes the local `assets/.art-installed` marker. Full game builds use the converted packs, material sources and audio. Blender is only necessary when rebuilding art that uses Blender.

## Preparing another release

1. Build from a clean, named source commit. Update the art recipes and city definitions in Git. Keep upstream dataset requests, licences and SHA-256 records with their city.
2. Update `distribution/source-files.txt` when adding or retiring binary inputs. With the full source inputs installed, run `python3 tools/release/pack-sources.py OUTPUT` to package the art. The inventory keeps old experiments, local saves and temporary downloads out of releases.
3. Build the client and wiki into a clean output directory. Archive its contents under `var/release-client/`. Put the core BC and ASTC texture files in their own archives so each upload stays below 2 GiB. For each city, run the map pipeline and `bun tools/maps/kit.ts pack CITY`. Package the playable map and matching entrances, source notices and download records under `var/maps/`.
4. Create a new release tag. Attach the files to a draft release. Pin the tag, source revision, filenames, byte counts and SHA-256 values in `distribution/release.json`. Test a fresh source build, one client/map install, and a kit rebuild. Match the uploaded digests and set the manifest status to `published` when publishing. Keep older releases available to commits that reference them.

## History

This branch is cut from the main branch of a private repository. It keeps every change to the retained paths, including merge history, with the original dates. Commits that changed only omitted files are absent, and rewritten commits have new IDs. Commit messages still quote the original IDs. Look up either ID in `distribution/history-map.tsv`. Commits that changed only planning notes are kept with those notes. The other omitted commits are recorded in `distribution/omitted-commits.jsonl` with their original IDs, parents, dates and full messages. The private repository remains the source for old binary revisions and unmerged branches.
