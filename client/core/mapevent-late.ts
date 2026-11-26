// The map events' code, kept out of the script a page waits for before its first frame: the feed's reader, the views of
// each type of part, the scene's pass and what hears them. It is fetched the first time a session is told of an event
// (mapevent-load.ts); tests and tools that draw one import it up front. Loading it hands the pass to every scene.

import { MapEventHearing } from "./mapevent/hearing.ts";
import { readShown, type MapEventsCode } from "./mapevent/shown.ts";
import { MapEventPass } from "./render/passes/map-events.ts";
import { Scene } from "./render/scene.ts";

const CODE: MapEventsCode = { Pass: MapEventPass, read: readShown, hearing: (from) => new MapEventHearing(from) };

Scene.mapEvents = CODE;
