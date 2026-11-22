// A queue: a line of people at a place, served from its head. The first thing of its kind in SNARK; Cast's food cart
// uses it, and anything with a line (a ticket booth, a club's door, a bus stop) can. Each member has a slot, the head's
// at the place and each after it `spacing` metres further along the line's direction; served, the head leaves and the
// rest move up one. Players may stand in a line too: a member is any id.

export interface QueueLine {
  x: number;
  z: number;
  /** The way the line runs from its head: along (sin yaw, cos yaw) in the world's x and z, radians. */
  yaw: number;
  spacing: number;
}

export class Queue {
  readonly line: QueueLine;
  readonly cap: number;
  private readonly members: string[] = [];

  constructor(line: QueueLine, cap: number) {
    this.line = line;
    this.cap = cap;
  }

  get length(): number {
    return this.members.length;
  }

  /** Joins at the back; false when full or already in it. */
  join(id: string): boolean {
    if (this.members.length >= this.cap || this.members.includes(id)) return false;
    this.members.push(id);
    return true;
  }

  /** Leaves from wherever in it, and those behind move up. */
  leave(id: string): void {
    const i = this.members.indexOf(id);
    if (i >= 0) this.members.splice(i, 1);
  }

  /** The head is served and goes; it is returned, or null for an empty line. */
  serve(): string | null {
    return this.members.shift() ?? null;
  }

  /** 0 for the head; -1 for one not in it. */
  place(id: string): number {
    return this.members.indexOf(id);
  }

  head(): string | null {
    return this.members[0] ?? null;
  }

  /** Where the member at `place` stands. A gentle curve every eight keeps a long line off a wall and looking like one. */
  slot(place: number, out: { x: number; z: number } = { x: 0, z: 0 }): { x: number; z: number } {
    let x = this.line.x, z = this.line.z;
    for (let i = 0; i < place; i++) {
      const yaw = this.line.yaw + Math.floor(i / 8) * 0.35;
      x += Math.sin(yaw) * this.line.spacing;
      z += Math.cos(yaw) * this.line.spacing;
    }
    out.x = x;
    out.z = z;
    return out;
  }

  ids(): readonly string[] {
    return this.members;
  }
}
