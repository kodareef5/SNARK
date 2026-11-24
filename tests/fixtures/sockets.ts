// Today's sockets as slots of the lattice, for tests that hold the forms and the keyed store to today's poses.

// Where the slot a socket means is, from the piece that offers it: half-sides along its X and Z, quarter storeys from its
// level to the slot's, and quarter turns to the slot's facing. Sockets are today's, in the order socketsFor gives them.
export type Slot = readonly [i: number, j: number, lvl: number, quarters: number];
const BESIDE: Slot[] = [[0, 2, 0, 0], [2, 0, 0, 0], [0, -2, 0, 0], [-2, 0, 0, 0]];
const EDGES: Slot[] = [[0, 1, 0, 0], [1, 0, 0, 1], [0, -1, 0, 2], [-1, 0, 0, 3]];
const HERE: Slot[] = [[0, 0, 0, 0]];
const ABOVE: Slot[] = [[0, 0, 4, 0]];
export const SOCKET_SLOTS: readonly (readonly [target: string, piece: string, slots: Slot[]])[] = [
  ["foundation", "foundation", BESIDE],
  ["foundation", "ceiling", BESIDE],
  ["ceiling", "ceiling", BESIDE],
  ...["wall", "doorframe", "windowframe"].flatMap((w) => [["foundation", w, EDGES], ["ceiling", w, EDGES]] as [string, string, Slot[]][]),
  // A pillar on a floor's middle, and one under it. Under a foundation the slot is not the socket's own pose: CHANGED.
  ["foundation", "pillar", [[0, 0, 0, 0], [0, 0, -4, 0]]],
  ["ceiling", "pillar", [[0, 0, 0, 0], [0, 0, -4, 0]]],
  ["pillar", "pillar", [[0, 0, 4, 0], [0, 0, -4, 0]]],
  ["foundation", "stairs", HERE],
  ["ceiling", "stairs", HERE],
  ...["wall", "doorframe", "windowframe"].flatMap((under) => ["wall", "doorframe", "windowframe"].map((on) => [under, on, ABOVE] as [string, string, Slot[]])),
  // The face either side of the edge above a wall.
  ...["wall", "doorframe", "windowframe"].map((w) => [w, "ceiling", [[0, 1, 4, 0], [0, -1, 4, 0]]] as [string, string, Slot[]]),
  ["doorframe", "door", HERE],
  ["doorframe", "door_open", HERE],
  ["pillar", "ceiling", ABOVE],
];
/** The one socket whose own pose is not its slot's: a pillar under a foundation ends at its top plane, not its underside. */
export const CHANGED = "foundation pillar 1";
