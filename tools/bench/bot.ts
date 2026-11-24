// A client that only does what the server can observe, for the benches that need many players and not their screens.

import { BitReader, BitWriter } from "../../shared/net/codec.ts";
import type { LoopbackEnd, LoopbackNet } from "../../shared/net/loopback.ts";
import { BOX_SELF, CMD_MOVE, InputBuffer, KEY_BYTES, PROTOCOL_VERSION, S_SNAPSHOT, nextCommandSeq, writeCommand, writeHello, writeInputs } from "../../shared/net/protocol.ts";
import { CH_RELIABLE, CH_UNRELIABLE } from "../../shared/net/transport.ts";
import { defaultLook } from "../../shared/anim/look.ts";
import { Rng } from "../../shared/rng.ts";

/** Says hello, sends inputs, acknowledges snapshots. */
export class Bot {
  readonly end: LoopbackEnd;
  private readonly inputs = new InputBuffer(64);
  private readonly w = new BitWriter(256);
  private readonly r = new BitReader();
  private readonly rng: Rng;
  private serverTick = 0;
  private sent = 0;
  private moveX = 0;
  private moveZ = 0;
  private yaw = 0;

  constructor(net: LoopbackNet, name: string, contentHash: number, seed: number) {
    this.rng = new Rng(seed);
    this.end = net.connect();
    this.end.onMessage = (_ch, data) => {
      if (data[0] !== S_SNAPSHOT) return;
      this.r.reset(data);
      this.r.u8();
      const tick = this.r.u32();
      if (tick > this.serverTick) this.serverTick = tick;
    };
    const w = this.w;
    const key = new Uint8Array(KEY_BYTES);
    for (let i = 0; i < KEY_BYTES; i++) key[i] = this.rng.int(256);
    writeHello(w, PROTOCOL_VERSION, contentHash, 0, name, 0, key, defaultLook());
    this.end.send(CH_RELIABLE, w.bytes());
  }

  private seq = 0;

  /** Sends the inventory screen's CMD_MOVE for a whole stack between two slots of the bot's inventory. */
  move(from: number, to: number, item: number): void {
    const w = this.w;
    w.reset();
    writeCommand(w, (this.seq = nextCommandSeq(this.seq)), CMD_MOVE);
    w.bits(BOX_SELF, 1);
    w.varint(from);
    w.bits(BOX_SELF, 1);
    w.varint(to);
    w.u16(0);
    w.u16(item);
    this.end.send(CH_RELIABLE, w.bytes());
  }

  update(worldTick: number): void {
    const target = (this.serverTick || worldTick) + 3;
    if (target <= this.sent) return;
    if (this.rng.int(45) === 0) {
      this.moveX = this.rng.int(255) - 127;
      this.moveZ = this.rng.int(255) - 127;
      this.yaw = this.rng.int(65536);
    }
    let count = 0;
    for (let t = Math.max(this.sent + 1, target - 3); t <= target; t++) {
      this.inputs.set(t, this.moveX, this.moveZ, this.yaw, 0, this.rng.int(40) === 0 ? 1 : 0);
      count++;
    }
    this.sent = target;
    this.w.reset();
    writeInputs(this.w, this.inputs, this.serverTick, target, count);
    this.end.send(CH_UNRELIABLE, this.w.bytes());
  }
}
