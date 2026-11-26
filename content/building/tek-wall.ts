// Both faces mirror these dimensions in metres about the centre of the wall.
export const TEK_WALL = {
  width: 3, height: 3,
  panelX: 1.235, panelY: 1.29, panelZ: 0.05, fieldZ: 0.086, corner: 0.16,
  railX: 1.3, railY: 1.08, railZ: 0.084, railHalfWidth: 0.010,
} as const;

/** Fixed palette entry of the white-cyan emitter lens. */
export const TEK_RAIL_COLOUR = 64;

/** Dark cyan in the flat palette and an optical insert on a lit Tek casting. */
export const TEK_INLAY_COLOUR = 28;

/** The projector outline uses metres along and across the diagonal from its corner. */
export const TEK_JAW = {
  origin: 1.415, low: .073,
  foot: [[.051, .025], [.174, .185], [.307, .213], [.501, .143], [.742, .048], [.728, .027], [.280, .038]],
  cap: [[.112, .054], [.190, .149], [.306, .174], [.486, .121], [.638, .064], [.650, .051], [.281, .065]],
  copperRuns: [.285, .361, .437], copperZ: .087,
} as const;

export function jawDepth(run: number): number { return .100 - .018 * Math.SQRT2 * run; }

export function jawContact(run: number): readonly (readonly [number, number])[] {
  return [[run, -.051], [run + .030, -.054], [run + .030, .054], [run, .051]];
}

export const TEK_LATCH = {
  low: .068,
  foot: [[1.079, -.449], [1.165, -.455], [1.239, -.376], [1.233, -.246], [1.153, -.245], [1.079, -.316]],
  cap: [[1.096, -.416], [1.149, -.422], [1.207, -.363], [1.204, -.276], [1.166, -.276], [1.095, -.335]],
  tab: [[1.102, -.379], [1.136, -.392], [1.181, -.345], [1.178, -.318], [1.158, -.322]], tabZ: .1,
} as const;

export function latchDepth(x: number): number { return .095 + .035 * (x - 1.10); }
