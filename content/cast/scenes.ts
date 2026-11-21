// Cast's scenes and reaction tables: what the city's people do, and how they answer a player, as data. A scene's roles
// are cast from people the engine keeps (or new extras); each role plays its script, which ends by leaving toward where
// no player is. Choices are what the planner (or the rules, at random) decides; a step with `when` plays only for its
// choice. A few of each kind, enough to run; the rest is for the teams filling the catalogue.

import type { ReactionTable, Scene } from "../../shared/cast/catalogue.ts";

const FOLK = ["cast:pedestrian", "cast:worker", "cast:tourist"];
const BEACH = ["cast:beachgoer", "cast:tourist", "cast:jogger"];
const PISTOL = "core:pistol";

export const SCENES: Scene[] = [
  {
    id: "cast:errand_walk", name: "Errand", about: "Someone on an errand: walks to a shop or a corner, waits or checks a phone, and goes on.",
    roles: [{ role: "walker", archetypes: FOLK, count: [1, 1] }], place: { tags: ["storefront", "corner", "sidewalk"] },
    script: {
      walker: [
        { do: "goto", to: "place" },
        { do: "emote", emote: "phone", s: [4, 10], when: { errand: "call" } },
        { do: "emote", emote: "check_wrist", when: { errand: "late" } },
        { do: "wait", s: [3, 8], when: { errand: "browse" } },
        { do: "leave" },
      ],
    },
    choices: { errand: ["browse", "call", "late"] }, tags: ["calm"], needs: ["walk"], weight: 6, cooldown: 60, most: 300,
  },
  {
    id: "cast:meet_friend", name: "Meeting a friend", about: "Two people meet on a corner, greet each other, talk a while, and walk off together or apart.",
    roles: [{ role: "a", archetypes: FOLK, count: [1, 1] }, { role: "b", archetypes: FOLK, count: [1, 1] }], place: { tags: ["corner", "plaza", "park"] },
    script: {
      a: [
        { do: "goto", to: "place" }, { do: "sync", name: "met" }, { do: "say", line: "greet" }, { do: "emote", emote: "wave" },
        { do: "emote", emote: "talk", s: [10, 30] }, { do: "emote", emote: "laugh", when: { mood: "friendly" } },
        { do: "emote", emote: "cross_arms", s: [4, 8], when: { mood: "awkward" } }, { do: "leave", pace: "stroll" },
      ],
      b: [
        { do: "goto", to: "place" }, { do: "sync", name: "met" }, { do: "face", to: { role: "a" } }, { do: "emote", emote: "wave" },
        { do: "emote", emote: "talk", s: [10, 30] }, { do: "emote", emote: "shrug", when: { mood: "awkward" } }, { do: "leave", pace: "stroll" },
      ],
    },
    choices: { mood: ["friendly", "awkward"] }, tags: ["social", "calm"], needs: ["walk", "emote", "speech"], weight: 4, cooldown: 120, most: 360,
  },
  {
    id: "cast:search_spot", name: "Looking for something", about: "Someone hunts about a spot for something they lost, and finds it or gives up.",
    roles: [{ role: "seeker", archetypes: ["cast:pedestrian", "cast:tourist"], count: [1, 1] }], place: { tags: ["park", "plaza", "sidewalk", "beach"] },
    script: {
      seeker: [
        { do: "goto", to: "place" }, { do: "emote", emote: "think" }, { do: "say", line: "search" }, { do: "goto", to: "slot" },
        { do: "emote", emote: "kneel", s: [3, 6] }, { do: "goto", to: "slot" },
        { do: "say", line: "found", when: { ending: "found" } }, { do: "emote", emote: "cheer", when: { ending: "found" } },
        { do: "emote", emote: "shrug", when: { ending: "gave_up" } }, { do: "leave" },
      ],
    },
    choices: { ending: ["found", "gave_up"] }, tags: ["calm"], needs: ["walk", "emote", "speech"], weight: 2, cooldown: 300, most: 300,
  },
  {
    id: "cast:couple_stroll", name: "A stroll", about: "A couple strolls by, stops to talk or laugh, and strolls on.",
    roles: [{ role: "a", archetypes: [...FOLK, "cast:beachgoer"], count: [1, 1] }, { role: "b", archetypes: [...FOLK, "cast:beachgoer"], count: [1, 1] }],
    place: { tags: ["beach", "park", "plaza"] },
    script: {
      a: [{ do: "goto", to: "place", pace: "stroll" }, { do: "sync", name: "stop" }, { do: "emote", emote: "talk", s: [6, 16] }, { do: "emote", emote: "laugh" }, { do: "leave", pace: "stroll" }],
      b: [{ do: "goto", to: { role: "a" }, pace: "stroll" }, { do: "sync", name: "stop" }, { do: "face", to: { role: "a" } }, { do: "emote", emote: "talk", s: [6, 16] }, { do: "leave", pace: "stroll" }],
    },
    tags: ["calm", "social"], needs: ["walk", "emote"], weight: 3, cooldown: 120, most: 300,
  },
  {
    id: "cast:group_hangout", name: "Hanging out", about: "A few friends gather at a spot to chat or dance, then drift off.",
    roles: [{ role: "friends", archetypes: ["cast:pedestrian", "cast:worker", "cast:beachgoer"], count: [3, 5] }], place: { tags: ["plaza", "park", "corner", "beach"] },
    script: {
      friends: [
        { do: "goto", to: "slot" }, { do: "sync", name: "gathered" }, { do: "face", to: "place" },
        { do: "emote", emote: "talk", s: [20, 60], when: { vibe: "chatty" } }, { do: "emote", emote: "laugh", when: { vibe: "chatty" } },
        { do: "emote", emote: "groove", s: [20, 40], when: { vibe: "dancing" } }, { do: "leave", pace: "stroll" },
      ],
    },
    choices: { vibe: ["chatty", "dancing"] }, tags: ["social"], needs: ["walk", "emote"], weight: 2, cooldown: 300, most: 420,
  },
  {
    id: "cast:jog_by", name: "A jogger", about: "A jogger runs past, maybe nods at whoever is about.",
    roles: [{ role: "runner", archetypes: ["cast:jogger"], count: [1, 1] }], place: { tags: ["sidewalk", "beach", "park"] },
    script: { runner: [{ do: "goto", to: "place", pace: "run" }, { do: "emote", emote: "nod" }, { do: "leave", pace: "run" }] },
    tags: ["calm"], needs: ["walk"], weight: 4, cooldown: 60, most: 180,
  },
  {
    id: "cast:cop_beat", name: "Police patrol", about: "Officers walk a beat: stop at a corner, look about, have a word, and move on.",
    roles: [{ role: "cops", archetypes: ["cast:cop"], count: [1, 2] }], place: { tags: ["beat", "corner", "sidewalk", "plaza"] },
    script: {
      cops: [
        { do: "goto", to: "place" }, { do: "emote", emote: "hands_on_hips", s: [3, 6] }, { do: "face", to: "player" }, { do: "say", line: "patrol" },
        { do: "goto", to: { spot: "beat" } }, { do: "emote", emote: "watching_you", when: { mood: "suspicious" } }, { do: "leave" },
      ],
    },
    choices: { mood: ["routine", "suspicious"] }, tags: ["calm", "busy"], needs: ["walk", "speech"], weight: 2, cooldown: 400, most: 480,
  },
  {
    id: "cast:gang_standoff", name: "Gang standoff", about: "Two from each of two gangs meet on a corner, draw pistols and trade words; someone backs down, shots fly, or they turn on whoever is watching.",
    roles: [{ role: "red", archetypes: ["cast:gang_red"], count: [2, 2] }, { role: "teal", archetypes: ["cast:gang_teal"], count: [2, 2] }],
    place: { tags: ["corner", "parking", "quiet"] },
    script: {
      red: [
        { do: "goto", to: "place", pace: "walk" }, { do: "face", to: { role: "teal" } }, { do: "hold", item: PISTOL }, { do: "say", line: "warn" }, { do: "sync", name: "drawn" },
        { do: "wait", s: [3, 7] }, { do: "say", line: "taunt" },
        { do: "emote", emote: "throat_slash", when: { ending: "back_down" } },
        { do: "attack", target: { role: "teal" }, when: { ending: "shoot_out" } },
        { do: "attack", target: "player", when: { ending: "turn_on_player" } },
        { do: "leave", pace: "run" },
      ],
      teal: [
        { do: "goto", to: "place", pace: "walk" }, { do: "face", to: { role: "red" } }, { do: "hold", item: PISTOL }, { do: "say", line: "warn" }, { do: "sync", name: "drawn" },
        { do: "wait", s: [3, 7] },
        { do: "emote", emote: "head_shake", when: { ending: "back_down" } },
        { do: "attack", target: { role: "red" }, when: { ending: "shoot_out" } },
        { do: "attack", target: "player", when: { ending: "turn_on_player" } },
        { do: "leave", pace: "run" },
      ],
    },
    choices: { ending: ["back_down", "shoot_out", "turn_on_player"] }, tags: ["tense", "hostile"], needs: ["walk", "weapon", "speech"], weight: 1, cooldown: 1200, most: 240, hostile: true,
  },
  {
    id: "cast:cart_queue", name: "Food cart", about: "A vendor sets up a cart and a line forms; each is served, eats a bite and goes.",
    roles: [{ role: "vendor", archetypes: ["cast:vendor"], count: [1, 1] }, { role: "customers", archetypes: [...FOLK, "cast:beachgoer"], count: [3, 8] }],
    place: { tags: ["cart", "queue", "plaza", "beach"] },
    script: {
      vendor: [{ do: "goto", to: "place" }, { do: "say", line: "sell" }, { do: "serve", s: [90, 180] }, { do: "leave" }],
      customers: [{ do: "goto", to: "place" }, { do: "queue" }, { do: "say", line: "buy" }, { do: "emote", emote: "eat", s: [3, 6] }, { do: "leave", pace: "stroll" }],
    },
    tags: ["calm", "busy", "social"], needs: ["walk", "queue", "speech"], weight: 2, cooldown: 600, most: 420,
  },
  {
    id: "cast:beach_crowd", name: "Beach crowd", about: "The beach fills: people lie in the sun, sit and chat, or dance, and drift home as it ends.",
    roles: [{ role: "beachgoers", archetypes: BEACH, count: [20, 200] }], place: { tags: ["beach"] },
    script: {
      beachgoers: [
        { do: "goto", to: "slot", pace: "stroll" },
        { do: "emote", emote: "lie_back", s: [60, 240], when: { vibe: "lazy" } },
        { do: "emote", emote: "groove", s: [40, 120], when: { vibe: "party" } },
        { do: "emote", emote: "sit_cross", s: [30, 120] },
        { do: "leave", pace: "stroll" },
      ],
    },
    choices: { vibe: ["lazy", "party"] }, tags: ["crowd", "calm"], needs: ["walk", "emote"], weight: 1, hours: [[9, 19]], cooldown: 1800, most: 900,
  },
  {
    id: "cast:flash_mob", name: "Flash mob", about: "Strangers drift into a plaza, then all at once break into the same dance, cheer, and scatter.",
    roles: [{ role: "dancers", archetypes: ["cast:pedestrian", "cast:tourist", "cast:beachgoer", "cast:worker"], count: [8, 24] }], place: { tags: ["plaza", "beach", "landmark"] },
    script: {
      dancers: [
        { do: "goto", to: "slot" }, { do: "emote", emote: "phone", s: [2, 6] }, { do: "sync", name: "start" },
        { do: "emote", emote: "disco", s: [12, 12] }, { do: "emote", emote: "raise_roof", s: [6, 6] }, { do: "sync", name: "end" },
        { do: "emote", emote: "cheer" }, { do: "leave", pace: "run" },
      ],
    },
    tags: ["crowd", "comic", "social"], needs: ["walk", "emote"], weight: 0.5, cooldown: 3600, most: 300,
  },
  {
    id: "cast:drive_to_meet", name: "Picking someone up", about: "A car pulls up, its driver greets a friend waiting at the curb, and they drive off.",
    roles: [{ role: "driver", archetypes: ["cast:pedestrian", "cast:worker"], count: [1, 1] }, { role: "friend", archetypes: FOLK, count: [1, 1] }],
    place: { tags: ["parking", "road"] },
    script: {
      driver: [{ do: "drive", to: "place" }, { do: "sync", name: "met" }, { do: "say", line: "greet" }, { do: "wait", s: [3, 6] }, { do: "leave", pace: "drive" }],
      friend: [{ do: "goto", to: "place" }, { do: "emote", emote: "check_wrist" }, { do: "sync", name: "met" }, { do: "emote", emote: "wave" }, { do: "leave" }],
    },
    tags: ["calm", "vehicle"], needs: ["walk", "drive", "speech"], weight: 2, cooldown: 300, most: 360,
  },
  {
    id: "cast:fender_bender", name: "Fender bender", about: "Two cars meet at a junction a little too closely; the drivers get out, argue or apologise, and drive off.",
    roles: [{ role: "a", archetypes: FOLK, count: [1, 1] }, { role: "b", archetypes: FOLK, count: [1, 1] }], place: { tags: ["road"] },
    script: {
      a: [{ do: "drive", to: "place" }, { do: "sync", name: "bump" }, { do: "say", line: "angry" }, { do: "emote", emote: "point" }, { do: "emote", emote: "facepalm", when: { mood: "argue" } }, { do: "wait", s: [4, 10] }, { do: "leave", pace: "drive" }],
      b: [{ do: "drive", to: "place" }, { do: "sync", name: "bump" }, { do: "say", line: "apology", when: { mood: "sorry" } }, { do: "say", line: "angry", when: { mood: "argue" } }, { do: "emote", emote: "shrug" }, { do: "wait", s: [4, 10] }, { do: "leave", pace: "drive" }],
    },
    choices: { mood: ["sorry", "argue"] }, tags: ["comic", "vehicle"], needs: ["drive", "speech", "emote"], weight: 1.5, cooldown: 600, most: 240,
  },
  {
    id: "cast:drive_by", name: "Drive-by", about: "A gang car slows past a rival corner or a player and its passenger opens fire. Waits on passengers that can aim from a seat.",
    roles: [{ role: "driver", archetypes: ["cast:gang_red", "cast:gang_teal"], count: [1, 1] }, { role: "shooter", archetypes: ["cast:gang_red", "cast:gang_teal"], count: [1, 1] }],
    place: { tags: ["road", "quiet"] },
    script: {
      driver: [{ do: "drive", to: "place" }, { do: "sync", name: "pass" }, { do: "leave", pace: "drive" }],
      shooter: [{ do: "hold", item: PISTOL }, { do: "sync", name: "pass" }, { do: "attack", target: "player", when: { target: "player" } }, { do: "leave", pace: "drive" }],
    },
    choices: { target: ["rival", "player"] }, tags: ["hostile", "vehicle", "tense"], needs: ["drive", "weapon"], weight: 0, cooldown: 2400, most: 120, hostile: true, placeholder: true,
  },
  {
    id: "cast:lost_family", name: "Lost tourists", about: "Tourists on the wrong side of town, map in hand, asking anyone the way. Waits on children's bodies and a gang reaction.",
    roles: [{ role: "family", archetypes: ["cast:tourist"], count: [2, 3] }], place: { tags: ["quiet", "corner"] },
    script: { family: [{ do: "goto", to: "place" }, { do: "emote", emote: "think" }, { do: "say", line: "lost" }, { do: "face", to: "player" }, { do: "wait", s: [10, 20] }, { do: "leave" }] },
    tags: ["sad", "social"], needs: ["walk", "speech"], weight: 1, cooldown: 900, most: 300, placeholder: true,
  },
  {
    id: "cast:gang_chase", name: "Gang chase", about: "One gang member runs past with two rivals after him, shots flying wide. Waits on a chase step.",
    roles: [{ role: "runner", archetypes: ["cast:gang_teal"], count: [1, 1] }, { role: "chasers", archetypes: ["cast:gang_red"], count: [2, 2] }],
    place: { tags: ["sidewalk", "road"] },
    script: {
      runner: [{ do: "goto", to: "place", pace: "run" }, { do: "leave", pace: "run" }],
      chasers: [{ do: "hold", item: PISTOL }, { do: "goto", to: { role: "runner" }, pace: "run" }, { do: "leave", pace: "run" }],
    },
    tags: ["tense", "hostile"], needs: ["walk", "weapon"], weight: 0, cooldown: 1800, most: 120, hostile: true, placeholder: true,
  },
];

export const REACTIONS: ReactionTable[] = [
  {
    id: "cast:folk",
    rows: [
      { on: "attacked", do: "flee", line: "attacked" },
      { on: "gunshot", do: "flee", line: "flee" },
      { on: "danger", do: "flee", line: "flee" },
      { on: "bumped", do: "say", line: "angry" },
      { on: "wave", if: { social: 0.4 }, do: "wave" },
      { on: "wave", do: "glance" },
      { on: "talk", if: { social: 0.3 }, do: "say", line: "talk" },
      { on: "talk", do: "glance" },
      { on: "stare", if: { bold: 0.6 }, do: "say", line: "stare", chance: 0.5 },
      { on: "stare", do: "glance" },
      { on: "near", do: "step_aside", line: "near", chance: 0.3 },
      { on: "near", do: "step_aside" },
    ],
  },
  {
    id: "cast:vendor",
    rows: [
      { on: "attacked", do: "flee", line: "attacked" },
      { on: "gunshot", do: "cower" },
      { on: "danger", do: "flee", line: "flee" },
      { on: "talk", do: "say", line: "talk" },
      { on: "wave", do: "wave" },
      { on: "near", do: "say", line: "sell", chance: 0.4 },
      { on: "near", do: "glance" },
      { on: "stare", do: "say", line: "sell" },
      { on: "bumped", do: "say", line: "angry" },
    ],
  },
  {
    id: "cast:cop",
    rows: [
      { on: "attacked", do: "fight", line: "warn" },
      { on: "gunshot", do: "fight", line: "warn" },
      { on: "danger", do: "fight" },
      { on: "talk", do: "say", line: "talk" },
      { on: "wave", do: "glance" },
      { on: "stare", do: "say", line: "patrol", chance: 0.5 },
      { on: "stare", do: "glance" },
      { on: "near", do: "glance" },
      { on: "bumped", do: "say", line: "patrol" },
    ],
  },
  {
    id: "cast:gang",
    rows: [
      { on: "attacked", do: "fight", line: "angry" },
      { on: "gunshot", if: { bold: 0.7 }, do: "fight" },
      { on: "gunshot", do: "flee" },
      { on: "danger", do: "flee" },
      { on: "stare", if: { bold: 0.6 }, do: "say", line: "warn" },
      { on: "stare", do: "say", line: "talk" },
      { on: "talk", do: "say", line: "talk" },
      { on: "wave", do: "say", line: "talk", chance: 0.5 },
      { on: "wave", do: "glance" },
      { on: "near", if: { bold: 0.8 }, do: "say", line: "warn", chance: 0.5 },
      { on: "near", do: "glance" },
      { on: "bumped", do: "say", line: "angry" },
    ],
  },
];
