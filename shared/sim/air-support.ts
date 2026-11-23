import type { BitReader, BitWriter } from "../net/codec.ts";

export const AIR_BAYS = 6;
export const AIR_ACTION = {
  trailer: 0, ground: 1, cancel: 2, panels: 3, launch: 4,
  payload: 5, leave: 6, unhitch: 7, dismiss: 8, select: 9,
} as const;
export const AIR_PHASE = { inbound: 0, follow: 1, lower: 2, release: 3, outbound: 4 } as const;

export interface AirPose { x: number; y: number; z: number; yaw: number }
export interface AirCarrier extends AirPose {
  id: number; phase: number; loaded: boolean; trailer: boolean; jaws: number;
}
/** A drone rack: `id` is its trailer's record, `ent` the trailer's entity handle, drawn where that entity is. */
export interface AirPod extends AirPose {
  id: number; ent: number; hitched: boolean; open: number; slots: number; selected: number;
}
export interface AirDrone extends AirPose {
  id: number; pitch: number; fuel: number; bay: number;
}
export interface AirSupportView {
  tick: number; carriers: AirCarrier[]; pods: AirPod[]; drones: AirDrone[];
  flight: number; pod: number; order: number; notice: string;
}
export function emptyAirSupport(): AirSupportView {
  return { tick: 0, carriers: [], pods: [], drones: [], flight: 0, pod: 0, order: 0, notice: "" };
}

export const AIR_VIEW_LIMIT = 96;

function writePose(w: BitWriter, row: AirPose & { id: number }): void {
  w.u32(row.id);
  w.f32(row.x);
  w.f32(row.y);
  w.f32(row.z);
  w.f32(row.yaw);
}

function readPose(r: BitReader): AirPose & { id: number } {
  const row = { id: r.u32(), x: r.f32(), y: r.f32(), z: r.f32(), yaw: r.f32() };
  if (!row.id || !Number.isFinite(row.x + row.y + row.z + row.yaw)) r.overflow = true;
  return row;
}

function share(value: number): number { return Math.round(Math.max(0, Math.min(1, value)) * 255); }

export function writeAirSupport(w: BitWriter, v: AirSupportView): void {
  w.u32(v.tick);
  w.u32(v.flight);
  w.u32(v.pod);
  w.u32(v.order);
  w.string(v.notice);
  w.u8(v.carriers.length);
  for (const row of v.carriers) {
    writePose(w, row);
    w.u8(row.phase);
    w.bool(row.loaded);
    w.bool(row.trailer);
    w.u8(share(row.jaws));
  }
  w.u8(v.pods.length);
  for (const row of v.pods) {
    writePose(w, row);
    w.u32(row.ent);
    w.bool(row.hitched);
    w.u8(share(row.open));
    w.bits(row.slots, AIR_BAYS);
    w.u8(row.selected);
  }
  w.u8(v.drones.length);
  for (const row of v.drones) {
    writePose(w, row);
    w.f32(row.pitch);
    w.u8(share(row.fuel));
    w.u8(row.bay);
  }
}

export function readAirSupport(r: BitReader): AirSupportView | null {
  const view = emptyAirSupport();
  view.tick = r.u32();
  view.flight = r.u32();
  view.pod = r.u32();
  view.order = r.u32();
  view.notice = r.string(256);
  const carriers = r.u8();
  if (carriers > AIR_VIEW_LIMIT) return null;
  for (let i = 0; i < carriers; i++) {
    const row = { ...readPose(r), phase: r.u8(), loaded: r.bool(), trailer: r.bool(), jaws: r.u8() / 255 };
    if (row.phase > AIR_PHASE.outbound) return null;
    view.carriers.push(row);
  }
  const pods = r.u8();
  if (pods > AIR_VIEW_LIMIT) return null;
  for (let i = 0; i < pods; i++) {
    const row = { ...readPose(r), ent: r.u32(), hitched: r.bool(), open: r.u8() / 255, slots: r.bits(AIR_BAYS), selected: r.u8() };
    if (row.selected >= AIR_BAYS) return null;
    view.pods.push(row);
  }
  const drones = r.u8();
  if (drones > AIR_VIEW_LIMIT) return null;
  for (let i = 0; i < drones; i++) {
    const row = { ...readPose(r), pitch: r.f32(), fuel: r.u8() / 255, bay: r.u8() };
    if (!Number.isFinite(row.pitch) || row.bay >= AIR_BAYS) return null;
    view.drones.push(row);
  }
  return r.overflow ? null : view;
}
