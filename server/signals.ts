// A terminal sends SIGINT, Docker and systemd send SIGTERM, and a terminal that closes sends SIGHUP. All three stop the
// server the same way.

/**
 * Runs `stop` on a stop signal and exits when it is done: with 0, or with 1 if `stop` threw. A stop may take a
 * moment, to let its pages leave (main.ts stopGently). A second signal while it does is told `hurry`, and stops at once.
 */
export function stopOnSignals(stop: (hurry: boolean) => void | Promise<void>, proc: { on(signal: string, fn: () => void): unknown; exit(code: number): unknown } = process): void {
  let stopping = false;
  const failed = (err: unknown): void => {
    console.error(`the server did not stop cleanly: ${err instanceof Error ? err.message : String(err)}`);
    proc.exit(1);
  };
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    proc.on(signal, () => {
      const hurry = stopping;
      stopping = true;
      try {
        const done = stop(hurry);
        if (done instanceof Promise) done.then(() => proc.exit(0), failed);
        else proc.exit(0);
      } catch (err) {
        failed(err);
      }
    });
  }
}
