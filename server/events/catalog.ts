// The event table: everything the server tells a module, and everything a module may refuse or change. One row is one
// event. The bus, the reference page and the tests are derived from these rows, as the settings are from theirs (D87).
// A "wired" event is raised in code today. A "stub" has its place in the code and is not raised yet. A "planned" one
// waits for a feature.

import { FEATURES, type Feature } from "../../shared/features.ts";

export interface EventRow {
  /** "tribe.join". The part before the dot is its group. */
  readonly name: string;
  /** "before": raised before the thing happens, and a handler may refuse it or change what `changes` lists. "after": told once it has. */
  readonly phase: "before" | "after";
  readonly fields: readonly string[];
  /** Fields of a "before" event a handler may write. */
  readonly changes: readonly string[];
  /** What a plugin for ARK's unofficial server API hooks for the same purpose, or "" if it has nothing like it. */
  readonly ark: string;
  /** The file it is, or will be, raised in. */
  readonly at: string;
  readonly status: "wired" | "stub" | "planned";
  readonly waits: Feature | "";
  /** Raised often enough that its site must cost nothing when nobody listens. */
  readonly hot: boolean;
  readonly doc: string;
}

const rows: EventRow[] = [];

type Standing = "wired" | "stub" | Feature;

/** `fields` is a list of names, with `!` after each a "before" handler may change. */
function ev(name: string, phase: EventRow["phase"], fields: string, ark: string, at: string, standing: Standing, doc: string, hot = false): void {
  const all = fields === "" ? [] : fields.split(" ");
  rows.push({
    name,
    phase,
    fields: all.map((f) => f.replace("!", "")),
    changes: all.filter((f) => f.endsWith("!")).map((f) => f.slice(0, -1)),
    ark,
    at,
    status: standing === "wired" || standing === "stub" ? standing : "planned",
    waits: standing === "wired" || standing === "stub" ? "" : standing,
    hot,
    doc,
  });
}

ev("server.start", "after", "tick map fresh", "the game mode's init and begin play", "server/host.ts", "wired", "The world is loaded and the first tick is about to run.");
ev("server.tick", "after", "tick", "a per-frame tick callback", "server/host.ts", "wired", "A tick has run.", true);
ev("server.second", "after", "tick", "a once-a-second timer callback", "server/host.ts", "wired", "A second of game time has passed.");
ev("server.save", "after", "tick folder", "SaveWorld", "server/host.ts", "wired", "An autosave mark: a backup has been asked for.");
ev("server.saveFailed", "after", "code since", "", "server/host.ts", "wired", "A commit failed. The world runs on and it will be tried again.");
ev("server.saved", "after", "tick", "", "server/host.ts", "wired", "Commits succeed again after failing.");
ev("server.stop", "after", "why", "the engine's exit, the crash report", "server/host.ts", "wired", "The server is stopping. The last commit follows.");
ev("server.settings", "after", "names source", "", "server/host.ts", "wired", "Settings changed while running, from the console or the live file.");
ev("server.broadcast", "after", "text", "the admin broadcast", "server/commands/core.ts", "ops", "An admin spoke to everyone.");
ev("command", "before", "byPid name line source", "console commands and RCON packets", "server/console.ts", "wired", "A console command is about to run.");
ev("command.ran", "after", "byPid name line source", "", "server/console.ts", "wired", "A console command ran. This is the audit trail.");

ev("session.login", "before", "name address isNew", "the pre-login, ban and exclusive-join checks", "server/game.ts", "wired", "Someone is asking to join. No body exists yet.");
ev("session.join", "after", "pid name isNew", "the new-player handler", "server/host.ts", "wired", "A session has a survivor.");
ev("session.presence", "after", "pid connected", "", "server/host.ts", "wired", "A survivor's connection came or went. Its body may linger.");
ev("session.leave", "after", "pid why", "logout and kick", "server/host.ts", "wired", "A session ended.");
ev("session.create", "before", "name", "the create-character request", "server/own.ts", "wired", "A survivor is about to be made.");
ev("session.spawn", "after", "pid first why", "the first spawn, and taking a body", "server/host.ts", "wired", "A survivor's body entered the world.");
ev("session.respawn", "before", "pid bed wait!", "the respawn-at-point request", "server/beds.ts", "wired", "A dead survivor is about to come back.");
ev("session.admin", "after", "pid", "the admin-detected notice", "server/commands/core.ts", "wired", "A session enabled cheats.");
ev("zone.enter", "after", "pid zone", "an actor overlap beginning", "server/host.ts", "limits", "A body entered a zone.");
ev("zone.leave", "after", "pid zone", "an actor overlap ending", "server/host.ts", "limits", "A body left a zone.");

ev("chat.say", "before", "pid channel text!", "the chat send, and the chat callback", "server/chat.ts", "wired", "A survivor is about to say something.");
ev("chat.said", "after", "pid channel text heard", "the per-recipient delivery, as a count", "server/chat.ts", "wired", "Something was said, and how many heard it.");
ev("name.set", "before", "what text!", "name filters", "server/game.ts", "wired", "A survivor, a tribe, a creature or a bed is about to be named.");

ev("damage", "before", "target victim kind team byPid byTeam item type zone scale!", "three take-damage hooks and the tribe-war question", "server/combat.ts", "wired", "A blow is about to land on a body or a structure. A scale of 0 stops it.", true);
ev("damaged", "after", "target victim kind team byPid byTeam item type zone taken blocked killed left", "", "server/combat.ts", "wired", "A blow landed.", true);
ev("death", "after", "victim cause killer rider credit team item far", "the player's and the creature's death", "server/host.ts", "wired", "A body died. `credit` is the survivor to reward: the killer, or the rider of the killer.");
ev("death.cache", "before", "pid keep!", "the death inventory", "server/death.ts", "wired", "What the dead carried is about to be left in a cache.");
ev("body.out", "after", "pid out", "", "server/host.ts", "wired", "A body was knocked out, or woke.");
ev("projectile.hit", "after", "byPid ammo target", "the projectile's impact", "server/projectiles.ts", "wired", "Something loosed or thrown struck.");

ev("xp.gain", "before", "pid source amount!", "the add-experience call", "server/progression.ts", "wired", "A body is about to gain experience.");
ev("level.up", "after", "pid from to", "the level-up call", "server/progression.ts", "wired", "A body gained a level.");
ev("stat.spend", "before", "pid stat", "the level-up request", "server/progression.ts", "wired", "A point is about to be put into a stat.");
ev("engram.learn", "before", "pid engram", "the engram-points request", "server/progression.ts", "wired", "An engram is about to be learned.");

ev("creature.spawn", "before", "kind why x z level! colours!", "the creature's begin play", "server/creatures.ts", "wired", "A creature is about to enter the world at (x, z): `why` is wild for the world's own and admin for one an admin asked for.");
ev("tame.allow", "before", "pid kind level byPid team how", "the allow-taming question, and tame limits", "server/taming.ts", "wired", "A creature is about to become somebody's.");
ev("tame.done", "after", "pid kind level byPid team how te", "the tame call", "server/taming.ts", "wired", "A creature became somebody's.");
ev("creature.order", "before", "pid byPid order", "", "server/taming.ts", "wired", "A tame is about to be told to follow, stay or change stance.");
ev("ride.mount", "before", "pid mount", "the can-ride question", "server/riding.ts", "wired", "A survivor is about to mount.");
ev("ride.dismount", "after", "pid mount", "", "server/riding.ts", "wired", "A survivor got off.");
ev("breed.mate", "before", "mother father", "the allowed-to-mate question", "server/breeding.ts", "wired", "Two tames are about to mate.");
ev("breed.egg", "after", "mother father pid", "", "server/breeding.ts", "wired", "An egg was laid, or a pregnancy began.");
ev("breed.hatch", "after", "pid kind", "the baby's creation", "server/breeding.ts", "wired", "A young one was born.");
ev("breed.grown", "after", "pid", "", "server/breeding.ts", "wired", "A young one is grown.");
ev("imprint", "after", "pid byPid quality", "the imprint call", "server/breeding.ts", "imprinting", "A young one was cared for.");
ev("creature.unclaim", "after", "pid team", "claim and unclaim", "server/taming.ts", "decay", "A tame stopped being anybody's.");
ev("carry.allow", "before", "pid byPid", "the can-carry question", "server/riding.ts", "flyers", "A creature is about to pick a body up.");

ev("build.place", "before", "byPid team kind x y z yaw target", "the is-allowed-to-build question", "server/build.ts", "wired", "A piece is about to be set down.");
ev("build.placed", "after", "byPid ref kind", "the placed-structure call and its overrides", "server/build.ts", "wired", "A piece was set down.");
ev("structure.act", "before", "byPid ref action", "demolish, pick-up and access", "server/build.ts", "wired", "A piece is about to be picked up, demolished, repaired, locked or opened.");
ev("structure.gone", "after", "ref kind team cause byPid", "the structure's death, and auto-demolish", "server/build.ts", "wired", "A piece is gone: destroyed, fallen, picked up, demolished or decayed.");
ev("structure.owner", "after", "from to n", "the change of team", "server/tribes.ts", "wired", "Structures changed owner.");

ev("item.gain", "before", "pid item why n!", "the allow-add question and the item-added notice", "server/items.ts", "wired", "A stack is about to be made: harvested, crafted, given by an admin.", true);
ev("item.move", "before", "byPid from to item n", "the remote-inventory questions", "server/own.ts", "wired", "A stack is about to move between two inventories.");
ev("item.use", "before", "byPid item", "the allow-use question and the use request", "server/own.ts", "wired", "An item is about to be eaten, drunk or used.");
ev("item.drop", "before", "byPid item n", "the drop request", "server/own.ts", "wired", "A stack is about to be dropped.");
ev("container.open", "before", "byPid pid", "inventory access", "server/game.ts", "wired", "A box, a body or a creature's bag is about to be opened.");
ev("craft.start", "before", "pid item count!", "the can-craft question and the craft request", "server/progression.ts", "wired", "A crafting job is about to be queued.");
ev("craft.done", "after", "pid item n", "the finish-crafting call", "server/progression.ts", "wired", "Something was made.");
ev("harvest", "after", "pid node item n", "the harvested call", "server/harvest.ts", "wired", "A node gave something.");

ev("tribe.create", "before", "pid name!", "the new-tribe call", "server/tribes.ts", "wired", "A tribe is about to be founded.");
ev("tribe.created", "after", "pid team name", "", "server/tribes.ts", "wired", "A tribe was founded.");
ev("tribe.invite", "before", "byPid pid", "", "server/tribes.ts", "wired", "A survivor is about to be invited.");
ev("tribe.join", "before", "pid team", "the add-to-tribe call", "server/tribes.ts", "wired", "A survivor is about to join a tribe.");
ev("tribe.joined", "after", "pid team", "", "server/tribes.ts", "wired", "A survivor joined a tribe.");
ev("tribe.leave", "after", "team pid why heir disbanded", "leaving, removal and the passing of ownership", "server/tribes.ts", "wired", "A survivor left a tribe or was put out of it.");
ev("tribe.renamed", "after", "team name", "the rename request", "server/tribes.ts", "wired", "A tribe has a new name.");
ev("tribe.log", "after", "team text", "the tribe log", "server/host.ts", "tribes", "A line was written to a tribe's log.");
ev("tribe.rank", "after", "team pid rank", "promote and demote", "server/tribes.ts", "tribes", "A member's rank changed.");
ev("tribe.war", "after", "team other", "the tribe-war call", "server/tribes.ts", "tribes", "Two tribes are at war, or no longer.");
ev("tribe.alliance", "after", "team other", "the alliance question", "server/tribes.ts", "tribes", "Two tribes are allied, or no longer.");

ev("transfer.out", "before", "op pid what", "the upload of a character, a creature or items", "server/host.ts", "transfers", "Something is about to leave for another server.");
ev("transfer.in", "before", "op what", "the download of a creature, the arrival of a player", "server/host.ts", "transfers", "Something is about to arrive from another server.");
ev("transfer.done", "after", "op what", "", "server/host.ts", "transfers", "A transfer finished at both ends.");
ev("cluster.message", "after", "from topic body", "cross-server chat", "server/host.ts", "transfers", "Another server of the cluster said something.");
ev("perm.changed", "after", "account group", "the permissions plugin's callbacks", "server/host.ts", "ops", "What an account may do changed.");
ev("ban.changed", "after", "account banned", "ban and unban", "server/host.ts", "ops", "An account was banned or let back.");
ev("points.changed", "after", "account delta reason balance", "the shop's add-points call", "server/host.ts", "points", "An account's points changed.");
ev("limit.hit", "after", "pid team what", "structure and tame limit plugins", "server/host.ts", "limits", "Something was refused because a limit was reached.");
ev("protect.changed", "after", "team on", "offline raid protection", "server/host.ts", "offline", "A tribe's protection came on or went off.");

ev("module.loaded", "after", "name", "", "server/events/modules.ts", "wired", "A module finished its setup.");
ev("module.failed", "after", "name event", "", "server/events/bus.ts", "wired", "A handler threw eight times running and was switched off.");

export const EVENTS: readonly EventRow[] = rows;
const BY_NAME = new Map(EVENTS.map((r, i) => [r.name, i]));

/** The index of an event in `EVENTS`, or -1. */
export function eventIndex(name: string): number {
  return BY_NAME.get(name) ?? -1;
}

/** What is wrong with the table itself. Empty when it is sound. */
export function eventFaults(): string[] {
  const out: string[] = [];
  if (BY_NAME.size !== EVENTS.length) out.push("an event name is used twice");
  for (const r of EVENTS) {
    if (!/^[a-z]+(\.[a-zA-Z]+)?$/.test(r.name)) out.push(`${r.name}: an event is named "group.what"`);
    if (r.status === "planned" && !(r.waits in FEATURES)) out.push(`${r.name}: a planned event names the feature it waits for`);
    if (r.status !== "planned" && r.waits !== "") out.push(`${r.name}: only a planned event waits for a feature`);
    if (r.phase === "after" && r.changes.length > 0) out.push(`${r.name}: nothing may be changed after the fact`);
    if (new Set(r.fields).size !== r.fields.length) out.push(`${r.name}: a field is listed twice`);
    if (r.doc === "") out.push(`${r.name}: an event says what it is`);
  }
  return out;
}
