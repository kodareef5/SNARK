import dimensions from "./van-dimensions.json" with { type: "json" };

const point = (x: number, y: number, z: number) => [x, y, z] as const;

/** Model-space metres, with the driver's left at +X and the nose at +Z. */
function vanArt<K extends keyof typeof dimensions>(kind: K) {
  const d = dimensions[kind];
  const cargo = kind === "panel_van";
  const hinge = (side: number) => point(side * d.hingeX, d.hingeY, d.hingeZ);
  const slider = (side: number) => point(side * d.slideX, d.slideY, d.slideZ);
  const wheel = (side: number, end: number) => point(side * d.halfTrack, d.wheelRadius, end * d.halfWheelbase);
  const seat = (side: number, z = d.seatZ) => point(side * d.seatX, d.seatY, z);
  const entry = (side: number, z = d.seatZ) => point(side * d.entryX, 0, z);
  const eye = (side: number, z = d.seatZ) => point(side * d.seatX, d.seatY + .52, z + .05);
  const steering = point(d.seatX, d.steeringY, d.steeringZ);
  const base = {
    seat_driver: seat(1), seat_front_passenger: seat(-1),
    approach_left: entry(1), approach_right: entry(-1), exit_left: entry(1), exit_right: entry(-1),
    door_left: hinge(1), door_right: hinge(-1), door_slide_right: slider(-1),
    camera_driver: eye(1), camera_front_passenger: eye(-1), camera_chase: point(0, d.height * .58, 0),
    steering, exhaust_left: point(.56, d.wheelRadius * .73, -d.halfLength + .052),
  };
  return {
    id: `core:${kind}` as const, ...d,
    envelope: { min: point(-d.halfWidth, 0, -d.halfLength), max: point(d.halfWidth, d.height, d.halfLength) },
    bones: ["chassis", "wheel_front_left", "wheel_front_right", "wheel_rear_left", "wheel_rear_right",
      "door_left", "door_right", "steering_wheel", ...(cargo ? [] : ["door_slide_left"]), "door_slide_right"],
    pivots: [point(0, 0, 0), wheel(1, 1), wheel(-1, 1), wheel(1, -1), wheel(-1, -1),
      hinge(1), hinge(-1), steering, ...(cargo ? [] : [slider(1)]), slider(-1)],
    base,
    rearSeats: {
      seat_rear_left: seat(1, d.slideZ), seat_rear_right: seat(-1, d.slideZ),
      approach_rear_left: entry(1, d.slideZ), approach_rear_right: entry(-1, d.slideZ),
      exit_rear_left: entry(1, d.slideZ), exit_rear_right: entry(-1, d.slideZ),
      camera_rear_left: eye(1, d.slideZ), camera_rear_right: eye(-1, d.slideZ), door_slide_left: slider(1),
    },
  };
}
const { base: cargoCab, rearSeats: _cargoRear, ...cargoArt } = vanArt("panel_van");
export const PANEL_VAN_ART = { ...cargoArt, anchors: {
  ...cargoCab, approach_cargo_right: point(-cargoArt.entryX, 0, cargoArt.slideZ),
} };
const { base: familyCab, rearSeats, ...familyArt } = vanArt("caravan");
export const CARAVAN_ART = { ...familyArt, anchors: { ...familyCab, ...rearSeats } };
