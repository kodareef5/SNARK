// The world's sounds' code, kept out of the script a page waits for before its first frame (D1107). Nothing is heard
// before it is needed: the sound library starts only once the sounds' rows have come, after the first frame, and a page
// starts muted. The app fetches this file once it has a device to play on; tests and tools that hear a client import
// it up front. Loading it hands the app what it makes and drives the sounds with.

import { cueKey } from "../../shared/sound/cues.ts";
import { App } from "./app.ts";
import { soundCommand } from "./sound/command.ts";
import { Sounds } from "./sound/sounds.ts";
import { hearSession, soundView } from "./sound/view.ts";

const CODE = { Sounds, hearSession, soundView, soundCommand, cueKey };
export type SoundCode = typeof CODE;

App.late = CODE;
