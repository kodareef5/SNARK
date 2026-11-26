type Bytes = Uint8Array<ArrayBuffer>;

interface PartStream {
  write(data: Bytes): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
}

interface PartHandle {
  write(data: Bytes, at: { at: number }): number;
  flush(): void;
  close(): void;
}

export interface PartFile {
  createWritable?(): Promise<PartStream>;
  createSyncAccessHandle?(): Promise<PartHandle>;
}

/** Commit one part and release its writer even when a write or commit fails. */
export async function writePart(file: PartFile, data: Bytes): Promise<void> {
  if (file.createWritable) {
    const stream = await file.createWritable();
    try {
      await stream.write(data);
      await stream.close();
    } catch (error) {
      await stream.abort().catch(() => {});
      throw error;
    }
    return;
  }
  if (!file.createSyncAccessHandle) throw new Error("no disk writer");
  const handle = await file.createSyncAccessHandle();
  try {
    if (handle.write(data, { at: 0 }) !== data.length) throw new Error("short disk write");
    handle.flush();
  } finally {
    handle.close();
  }
}

/** Disk mutations run in order. Two pending writes of the same hash share one result. */
export class DiskWrites {
  private tail: Promise<void> = Promise.resolve();
  private readonly byHash = new Map<string, Promise<boolean>>();
  private count = 0;
  private readonly changed: () => void;

  constructor(changed: () => void) {
    this.changed = changed;
  }

  get pending(): number {
    return this.count;
  }

  save(hash: string, write: () => Promise<boolean>): Promise<boolean> {
    const queued = this.byHash.get(hash);
    if (queued) return queued;
    this.count++;
    const saved = this.after(write).catch(() => false).finally(() => {
      if (this.byHash.get(hash) === saved) this.byHash.delete(hash);
      this.count--;
      this.changed();
    });
    this.byHash.set(hash, saved);
    this.changed();
    return saved;
  }

  /** A later write gets a new place after the deletion, even for a hash already queued. */
  remove(remove: () => Promise<void>, hash?: string): Promise<void> {
    if (hash === undefined) this.byHash.clear();
    else this.byHash.delete(hash);
    return this.after(remove);
  }

  private after<T>(run: () => Promise<T>): Promise<T> {
    const next = this.tail.then(run);
    this.tail = next.then(() => {}, () => {});
    return next;
  }
}
