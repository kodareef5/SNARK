// Both faces mirror these dimensions in metres about the centre of the wall.
export const TEK_WALL = {
  width: 3, height: 3,
  panelX: 1.235, panelY: 1.29, panelZ: 0.05, corner: 0.16,
  railX: 1.3, railY: 1.08, railZ: 0.084, railHalfWidth: 0.010,
} as const;

/** Fixed palette entry of the white-cyan emitter lens. */
export const TEK_RAIL_COLOUR = 64;
