// What the browser says of the game's saved files: whether it keeps them when it is short of room, and how much room it
// gives the site. The page's end of the asset worker (client/assets/port.ts) holds one, and the data utility shows it.

/** The browser's storage manager, as much of it as is asked here. Any of it may be missing. */
export interface StorageAsker {
  persisted?(): Promise<boolean>;
  persist?(): Promise<boolean>;
  estimate?(): Promise<{ usage?: number; quota?: number }>;
}

export class StorageInfo {
  /** Whether the browser keeps the files when it is short of room, as it last said: null until it says, and where it cannot. */
  persisted: boolean | null = null;
  /** Whether it was asked this visit to keep them, and its answer: null until it gives one. */
  asked = false;
  granted: boolean | null = null;
  /** Bytes the site holds and the most it may hold, as the last `refresh` heard, and the time that refresh was asked, in ms. Null before any. */
  usage: number | null = null;
  quota: number | null = null;
  at: number | null = null;
  private readonly storage: StorageAsker | undefined;
  private estimating = false;

  /** Asks at once whether the files are kept. */
  constructor(storage: StorageAsker | undefined) {
    this.storage = storage;
    storage?.persisted?.().then((kept) => (this.persisted = kept || this.granted === true), () => {});
  }

  /** Asks the browser to keep the files, once a visit: the player asked for them, so they should not be the first it clears. */
  keep(): void {
    if (this.asked || !this.storage?.persist) return;
    this.asked = true;
    this.storage.persist().then(
      (kept) => {
        this.granted = kept;
        if (kept) this.persisted = true;
      },
      () => (this.granted = false),
    );
  }

  /** Asks how much the site holds and may hold, at `nowMs`. One question at a time; the answer comes later. */
  refresh(nowMs: number): void {
    if (this.estimating || !this.storage?.estimate) return;
    this.estimating = true;
    this.storage.estimate().then(
      (e) => {
        this.usage = e.usage ?? null;
        this.quota = e.quota ?? null;
        this.at = nowMs;
        this.estimating = false;
      },
      () => (this.estimating = false),
    );
  }
}
