# Title and survivor entry

Open the cluster root or a world’s own URL to reach the title. Direct world links may add `?screen=roster` or `?screen=link`. The roster is scoped to the browser identity and world. A character’s level, appearance and inventory remain on its world. A linking code lasts five minutes. The owning browser approves one named survivor. Recovery requires a separately saved one-use code.

## Retaking the native art

Build the client after changing a model. Start a server using the built Miami map and that client. With the server running, run the following from the repository root. The hostname and port are those of your Miami world.

```sh
bun run title:retake --world http://localhost:8799/miami/ --video
bun run title:retake --world http://localhost:8799/miami/ --regions
bun tools/build-entry.ts client/dist
```

Chrome renders the live map, Pteranodon, saddle and rider from the built asset packs. FFmpeg encodes the stills and fallback loop in `client/entry/media`. Omit `--video` to retake only the stills. Use `--out` to review replacements in another directory first. The normal client build also packages this media. The route coordinates, light and shot times live in `client/core/title-route.ts`. The camera and native actor arrangement live in `client/entry/flight.ts`.

The region pass takes a native aerial picture at each public spawn. The card gallery also uses the map teams’ saved camera views in each city’s `reports/world1` directory. The build sizes those images for the browser.

## Survivor activity

The roster shows the world’s level, XP, last login in the viewer’s local time, and cumulative connected play time. Tracking starts on the survivor’s first session with this version. Earlier activity appears as unrecorded. The record travels with the survivor and is shared by its authorized browsers.

## Registering a private server

In **Find a server → Register your server**, enter the public world URL. Publish the displayed TXT record at `_snark.<your-hostname>`, then select **Check DNS record**. Save the management token and set the name, map, visibility and password indicator. An unlisted world can share its direct world URL. The game enforces its configured password at login.

A directory endpoint is served at `/directory`. For durable registrations, run it with a saved world. Worlds in the same cluster share its directory database. To use a different directory, set `SNARK_DIRECTORY_URL` to its full endpoint. For live occupancy, set that variable and `SNARK_LISTING_TOKEN` on the registered world and start it with its public, absolute `--public-url`. It announces every minute. Search marks the listing offline after three minutes without an announcement.
