// A log of lines that never waits on the disk inside a tick. Lines gather in memory and one append takes them all, at
// most one at a time, to a file for this world and day. A day has a cap in bytes. A line that cannot be written is lost
// and counted, never the game's tick.

import { appendFile, mkdir } from "node:fs/promises";

export class LineLog {
  /** Lines written, bytes written today, lines dropped (over the cap, or a write that failed). */
  written = 0;
  bytes = 0;
  dropped = 0;
  /** Bytes a day may hold. */
  cap: number;
  private readonly dir: string | null;
  private readonly name: string;
  private lines: string[] = [];
  private waiting = 0;
  private day = "";
  private made = false;
  private writing: Promise<void> | null = null;

  /** Files are `<dir>/<name>-<day>.jsonl`. With no folder nothing is kept. */
  constructor(dir: string | null, name: string, megabytes = 64) {
    this.dir = dir;
    this.name = name;
    this.cap = megabytes * 1024 * 1024;
  }

  add(line: string): void {
    if (!this.dir) return;
    const size = line.length + 1;
    if (this.bytes + this.waiting + size > this.cap) {
      this.dropped++;
      return;
    }
    this.lines.push(line);
    this.waiting += size;
  }

  /** Writes what has gathered. A write already under way is waited for and then followed by this one. */
  async flush(): Promise<void> {
    if (this.writing) await this.writing;
    if (!this.dir || this.lines.length === 0) return;
    const day = new Date().toISOString().slice(0, 10);
    if (day !== this.day) {
      this.day = day;
      this.bytes = 0;
    }
    const lines = this.lines, text = lines.join("\n") + "\n";
    this.lines = [];
    this.waiting = 0;
    const dir = this.dir, file = `${dir}/${this.name}-${day}.jsonl`;
    this.writing = (async () => {
      try {
        if (!this.made) {
          await mkdir(dir, { recursive: true });
          this.made = true;
        }
        await appendFile(file, text);
        this.written += lines.length;
        this.bytes += text.length;
      } catch {
        this.dropped += lines.length;
      }
    })();
    await this.writing;
    this.writing = null;
  }
}
