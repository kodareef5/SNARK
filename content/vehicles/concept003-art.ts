import rig from "./concept003-rig.json" with { type: "json" };

type Point = readonly [number, number, number];
type Quad = readonly [Point, Point, Point, Point];
type Edge = readonly [Point, Point];

function point(v: readonly number[]): Point {
  return [v[0]!, v[1]!, v[2]!];
}

function points<K extends string>(rows: Record<K, number[]>): Record<K, Point> {
  return Object.fromEntries(Object.entries<number[]>(rows).map(([name, v]) => [name, point(v)])) as Record<K, Point>;
}

const joints = points(rig.pivots);
const anchors = points(rig.anchors);

function skin(rows: readonly Edge[]): Quad[] {
  return rows.slice(1).map(([c, d], i) => [rows[i]![0], rows[i]![1], d, c]);
}

// Each pair runs from the lower edge to the upper edge of the donor panel.
const frontDoor: Edge[] = [
  [[1.05, .29, .89], [1.05, .82, .99]],
  [[1.07, .29, .17], [1.06, .88, .17]],
  [[1.07, .30, -.018], [1.05, .97, -.045]],
];
const rearDoor: Edge[] = [
  [[1.07, .30, -.018], [1.05, .97, -.045]],
  [[1.07, .31, -.86], [1.07, .94, -.86]],
  [[1.08, .62, -1.06], [1.05, 1.00, -1.06]],
  [[1.05, .99, -1.24], [1.04, 1.055, -1.24]],
];
const frontGlass: Edge[] = [
  [[1.05, .824, .82], [1.03, .92, .82]],
  [[1.062, .85, .43], [.89, 1.30, .43]],
  [[1.05, .875, .09], [.88, 1.345, -.076]],
];
const rearGlass: Edge[] = [
  [[1.065, .90, -.225], [.88, 1.35, -.15]],
  [[1.065, .92, -.77], [.89, 1.33, -.77]],
  [[1.04, 1.015, -1.06], [1.02, 1.09, -1.06]],
];

function side(rows: readonly Edge[], sign: number): Quad[] {
  const reflect = ([x, y, z]: Point): Point => [sign * x, y, z];
  return skin(rows.map(([lower, upper]) => [reflect(lower), reflect(upper)]));
}

// The two broad panes follow the crown and the rake of the glazing on its centreline.
function canopy(sections: readonly (readonly [z: number, halfWidth: number, edgeY: number, centreY: number])[]): Quad[] {
  return [-1, 1].flatMap(sign => skin(sections.map(([z, x, y, centre]) => [[0, centre, z], [sign * x, y, z]])));
}

const windscreen = canopy([[.46, .8, 1.35, 1.374], [.9, .98, 1.07, 1.296],
  [1.4, .98, .98, 1.156], [1.86, .93, .90, 1.00], [2.39, .52, .73, .76]]);
const backlight = canopy([[.46, .8, 1.36, 1.38], [-.42, .8, 1.40, 1.429],
  [-.99, .86, 1.37, 1.409], [-1.58, 1.015, 1.09, 1.353], [-1.91, .96, 1.09, 1.14]]);

const doorNames = ["door_left", "door_right", "door_rear_left", "door_rear_right"] as const;
const sideGlassNames = ["glass_left", "glass_right", "glass_rear_left", "glass_rear_right"] as const;

const breakablePanels = [
  ...doorNames.map((bone, door) => ({
    bone, door, hinge: joints[bone], faces: side(door < 2 ? frontDoor : rearDoor, door % 2 ? -1 : 1),
  })),
  { bone: "glass_front", faces: windscreen },
  { bone: "glass_rear", faces: backlight },
  ...sideGlassNames.map((bone, door) => ({
    bone, door, hinge: joints[doorNames[door]!], faces: side(door < 2 ? frontGlass : rearGlass, door % 2 ? -1 : 1),
  })),
];

// These fixed sections cover the end caps, wheel arches and centre pillars around the door openings.
const shotPanels: Quad[] = [
  ...[-1, 1].flatMap(sign => [
    ...side([[[1.04,.25,1], [1.04,.82,1]], [[1.09,.25,1.6], [1.01,.96,1.6]],
      [[.99,.25,2.26], [.98,.71,2.26]]], sign),
    ...side([[[1.07,.27,-.87], [1.07,.31,-.87]], [[1.08,.27,-1.06], [1.08,.62,-1.06]],
      [[1.08,.27,-1.25], [1.05,1.02,-1.25]], [[1.01,.27,-1.94], [1.01,1.02,-1.94]]], sign),
    ...side([[[1.05,.97,-.045], [.83,1.395,-.111]], [[1.04,.97,-.126], [.83,1.395,-.18]]], sign),
  ]),
  [[-.99,.25,2.26], [.99,.25,2.26], [.96,.71,2.26], [-.96,.71,2.26]],
  [[-1.01,.27,-1.99], [-.99,1.03,-1.99], [.99,1.03,-1.99], [1.01,.27,-1.99]],
];

export const CONCEPT003_ART = {
  id: "core:concept003", bones: Object.keys(joints), pivots: Object.values(joints), anchors,
  envelope: { min: point(rig.envelope.min), max: point(rig.envelope.max) },
  wheelRadius: joints.wheel_front_left[1], shotPanels, breakablePanels,
} as const;
