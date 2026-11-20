# Title and survivor entry

Open the cluster root or a world’s own URL to reach the title. Direct world links may add `?screen=roster` or `?screen=link`. The roster is scoped to the browser identity and world. A character’s level, appearance and inventory remain on its world. A linking code lasts five minutes. The owning browser approves one named survivor. Recovery requires a separately saved one-use code.

The idle title shows a still. Play flyover streams the recorded loop. The creator renders the survivor on a small local heightfield. Selecting a world prepares its boot assets and the chosen spawn sector (up to 2 MiB). On faster connections the menu also warms up to 128 KiB of shared coarse wildlife pages and one opening music layer, capped at 2 MiB. These optional downloads run in the background and can be interrupted by joining.

## Retaking the native art

Build the client after changing a model. Start a server using the built Miami map and that client. With the server running, run the following from the repository root. The hostname and port are those of your Miami world.

```sh
bun run title:retake --world http://localhost:8799/miami/ --video
bun run title:retake --world http://localhost:8799/miami/ --regions
bun tools/build-entry.ts client/dist
```

Chrome renders the live map, Pteranodon, saddle and rider from the built asset packs. FFmpeg encodes the stills and fallback loop in `client/entry/media`. Omit `--video` to retake only the stills. Use `--out` to review replacements in another directory first. The normal client build also packages this media. The route coordinates, light and shot times live in `client/core/title-route.ts`. The camera and native actor arrangement live in `client/entry/flight.ts`.

The region pass takes a native aerial picture at each public spawn. The card gallery also uses the map teams’ saved camera views in each city’s `reports/world1` directory. The build sizes those images for the browser.

## The wiki's studio

A wiki entry with a model has a View in 3D button. It opens `studio.html?id=<content id>` over the entry's picture. The page draws that one thing on the title's beach with the game's own renderer, as the flight does, with no server. A creature or the survivor plays any clip it has, the survivor's emotes among them. It plays them through `Characters.override`, which is null in the game. A vehicle can turn its wheels or rotor. Drag or use the arrow keys to turn the view, and the wheel, a pinch or plus and minus to zoom. The logic lives in `client/core/studio`. The page tells the wiki `ready` or `error`, and the wiki keeps its picture where 3D cannot be shown (D889). `bun run probe -- --wiki --shots <dir>` opens it for a creature, the survivor, a vehicle and two items.

## Survivor activity

The roster shows the world’s level, XP, last login in the viewer’s local time, and cumulative connected play time. Tracking starts on the survivor’s first session with this version. Earlier activity appears as unrecorded. The record travels with the survivor and is shared by its authorized browsers.

## Listing a server

**Find a server** lists the worlds of the directories a world names, as ARK's server list does. A world is listed by
announcing itself, so there is nothing to register. Give it its public HTTPS address on port 443 and the directories
to be listed in:

```sh
SNARK_DIRECTORY_URL="https://one.example/directory https://two.example/directory" \
  bun server/main.ts --public-url https://play.example.org/miami --db var/world.db
```

Every minute it announces that address to each directory, and its `entry-world.json` then says it asks to be listed. A
directory reads that file at that address itself, for the name, map, players and whether a password is asked, so an
announcement can list nothing the world does not say, and no world that did not ask. Its card also shows PvE or PvP
(from `serverPVE`), a blurb (`ServerDescription`), a Discord invite (`DiscordUrl`) and short tags for sorting and
filtering later (`ServerTags`: `rates=3x, region=eu`), all in `[SnarkSettings]` and checked by `shared/listing.ts`
wherever they pass. A listing is offline three minutes
after its last announcement and gone a week after. Its title searches the same directories. A world given none is
listed nowhere, and its server list shows only its cluster. The game enforces its configured password at login.

`--directory` makes a world host a directory of its own at `/directory`. It lists itself there, and its title searches
it too. The file is beside the save (`<save>.directory.sqlite`), or `directory.sqlite` in a cluster's folder, which its
worlds share. Its operator keeps a world out of it for good with `bun server/directory.ts <file> hide <address>`;
`bun server/directory.ts <file>` lists them all.
