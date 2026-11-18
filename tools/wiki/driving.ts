// What the wiki says of how a vehicle drives, from what handling.ts measured: the table on its page, its top speed among
// its facts, and the tables on the vehicles' page that set the fleet side by side. Every figure is a measurement's.

import { num, time } from "../../client/core/wiki/format.ts";
import type { Cell, Entry, Table } from "./catalogue.ts";
import { CIRCLE, CRAWL, KMH, NEAR, type BoatHandling, type Handling, type RoadHandling, type RotorHandling } from "./handling.ts";

const kmh = (v: number): string => `${num(v / KMH, 0)} km/h`;
const knots = (v: number, short = false): string => `${num((v * 3600) / 1852, 0)} ${short ? "kn" : "knots"}`;
const metres = (m: number): string => `${num(m, m < 10 ? 1 : 0)} m`;
const km = (m: number): string => `${num(m / 1000, 0)} km`;
const secs = (s: number): string => (s < 60 ? `${num(s, 1)} s` : time(s));
const ordinal = (n: number): string => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th")}`;

const wheels = (h: RoadHandling, short: boolean): string =>
  h.front === null ? (short ? "All, by load" : "All four, each by the load on it")
  : h.front === 0 ? (short ? "Rear" : "The rear")
  : h.front === 1 ? (short ? "Front" : "The front")
  : short ? `All, ${num(h.front * 100, 0)}% front` : `All four, ${num(h.front * 100, 0)}% of the drive to the front`;
const drives = (h: BoatHandling, short = false): string =>
  `${short ? h.drives : h.drives === 1 ? "One" : h.drives === 2 ? "Twin" : String(h.drives)} ${h.drive}${h.drives > 1 ? "s" : ""}`;
const farthest = (h: BoatHandling): string => (h.cruise === h.top ? `${km(h.rangeCruise)}, flat out` : `${km(h.rangeCruise)} at ${kmh(h.cruise)}`);

/** How the figures were measured, said of one vehicle or of each in a table. */
const roadNote = (of: string): string => `Measured when this wiki was built, by driving the game's own model of ${of} with one survivor aboard on level open ground, which is what every street of a city is to a wheel. Full throttle from rest; braking is the reverse key held, as a driver brakes; the turning circle is the one its body sweeps at full lock at walking pace; round the circle ${CIRCLE} m across, the fastest it keeps within a metre of the line for a lap.`;
const boatNote = (of: string): string => `Measured when this wiki was built, by running the game's own model of ${of} on open water with its pilot aboard. Full throttle from rest: its top speed is where it stops gaining, and "to its top speed" to within ${num(NEAR * 100)}% of it. Turning is full helm at full throttle, the circle at its top speed and turning about from rest. It has run on, the throttle cut, once it is down to ${kmh(CRAWL)}; its farthest is at the throttle, tried in tenths, that takes it farthest.`;
const rotorNote = (of: string): string => `Measured when this wiki was built, by flying the game's own model of ${of} with its pilot aboard over level ground, the stick fully forward with the height held; holding Shift tips it further. It stops with the brake, X, held.`;

export function topSpeed(h: Handling, short = false): string {
  return h.movement === "boat" ? `${kmh(h.top)}, ${knots(h.top, short)}` : kmh(h.top);
}

/** A vehicle's own page: how it drives, in a row a figure. */
export function drivingTable(h: Handling): Table {
  const head: Cell[] = ["", "Measured"];
  if (h.movement === "wheeled") {
    return {
      title: "How it drives",
      head,
      rows: [
        ["0 to 100 km/h", h.reaches100 ? secs(h.to100) : `It does not reach it: ${secs(h.toTop)} to ${kmh(h.top)}`],
        ["Top speed", kmh(h.top)],
        ["Reverse", kmh(h.reverse)],
        [h.reaches100 ? "Braking from 100 km/h" : `Braking from ${kmh(h.top)}`, metres(h.braking)],
        ["Turning circle", `${metres(h.turning)} wall to wall`],
        [`Round a circle ${CIRCLE} m across`, kmh(h.circle)],
        ["Driven wheels", wheels(h, false)],
        ["Gears", `${h.gears} forward, changing by themselves; in ${ordinal(h.topGear)} at its top speed`],
        ["Power", `${num(h.power / 1000, 0)} kW at ${num(h.powerRpm)} rpm, ${num(h.power / h.mass, 0)} kW a tonne`],
        ["Range at a steady 60 km/h", h.reaches60 ? km(h.rangeSteady) : `It does not reach 60 km/h: ${km(h.rangeSteady)} at its top speed`],
        ["Range flat out", km(h.rangeTop)],
      ],
      note: [roadNote("it")],
    };
  }
  if (h.movement === "boat") {
    return {
      title: "How it handles",
      head,
      rows: [
        ["Top speed", topSpeed(h)],
        ["To half its top speed", secs(h.toHalf)],
        ["To its top speed", secs(h.toTop)],
        ["Turning circle flat out", `${metres(h.turnFast)}, slowing to ${kmh(h.turnFastSpeed)}`],
        ["Turning about from rest", `In ${metres(h.turnAbout)} of water, ${secs(h.turnAboutTime)}`],
        ["Runs on when the throttle is cut", metres(h.runOn)],
        ["Draught", `${num(h.draught, 2)} m at rest, ${num(h.draughtTop, 2)} m at its top speed`],
        ["Drive", drives(h)],
        ["Range flat out", km(h.rangeTop)],
        ["Farthest on a tank", farthest(h)],
      ],
      note: [boatNote("it")],
    };
  }
  return {
    title: "How it flies",
    head,
    rows: [
      ["Top speed, level", kmh(h.top)],
      ["Holding Shift", kmh(h.cruise)],
      ["Climbs at", `${num(h.climb, 1)} m/s`],
      ["Stops from its top speed", `${secs(h.stop)}, in ${metres(h.stopDistance)}`],
      ["A tank lasts", `${time(h.hover)} hovering, ${time(h.enduranceTop)} flat out, ${time(h.enduranceCruise)} holding Shift`],
      ["Range flat out", km(h.rangeTop)],
      ["Range holding Shift", km(h.rangeCruise)],
    ],
    note: [rotorNote("it")],
  };
}

/** The vehicles' page: a table for each kind of movement, fastest first, one row for vehicles that drive alike. */
export function fleetTables(entries: readonly Entry[]): Table[] {
  const of = <H extends Handling>(movement: H["movement"]): { names: Cell[]; h: H }[] => {
    const rows = new Map<string, { names: Cell[]; h: H }>();
    for (const e of entries) {
      if (e.handling?.movement !== movement) continue;
      const key = JSON.stringify(e.handling);
      const row = rows.get(key);
      if (row) row.names.push(", ", { id: e.id });
      else rows.set(key, { names: [{ id: e.id }], h: e.handling as H });
    }
    return [...rows.values()].sort((a, b) => b.h.top - a.h.top);
  };
  const road = of<RoadHandling>("wheeled"), boats = of<BoatHandling>("boat"), rotors = of<RotorHandling>("rotor");
  const tables: Table[] = [];
  if (road.length) tables.push({
    title: "On the road",
    head: ["", "Top speed", "0 to 100 km/h", "Braking from 100 km/h", "Turning circle", `Round a ${CIRCLE} m circle`, "Driven wheels", "Power to weight", "Range at 60 km/h"],
    rows: road.map(({ names, h }) => [names, kmh(h.top), h.reaches100 ? secs(h.to100) : "Not reached", h.reaches100 ? metres(h.braking) : `${metres(h.braking)} from ${kmh(h.top)}`,
      metres(h.turning), kmh(h.circle), wheels(h, true), `${num(h.power / h.mass, 0)} kW a tonne`, h.reaches60 ? km(h.rangeSteady) : `${km(h.rangeSteady)} at its top speed`]),
    note: [roadNote("each")],
  });
  if (boats.length) tables.push({
    title: "On the water",
    head: ["", "Top speed", "To half speed", "To top speed", "Turning circle", "Turns about in", "Runs on", "Draught", "Drive", "Farthest on a tank"],
    rows: boats.map(({ names, h }) => [names, topSpeed(h, true), secs(h.toHalf), secs(h.toTop), metres(h.turnFast), metres(h.turnAbout), metres(h.runOn), `${num(h.draught, 2)} m`, drives(h, true), farthest(h)]),
    note: [boatNote("each")],
  });
  if (rotors.length) tables.push({
    title: "In the air",
    head: ["", "Top speed", "Holding Shift", "Climbs at", "Stops in", "Hovers for", "Range flat out", "Range holding Shift"],
    rows: rotors.map(({ names, h }) => [names, kmh(h.top), kmh(h.cruise), `${num(h.climb, 1)} m/s`, `${secs(h.stop)}, ${metres(h.stopDistance)}`, time(h.hover), km(h.rangeTop), km(h.rangeCruise)]),
    note: [rotorNote("each")],
  });
  return tables;
}
