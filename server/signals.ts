// A terminal sends SIGINT, Docker and systemd send SIGTERM, and a terminal that closes sends SIGHUP. All three stop the
// server the same way.

/** Runs `stop` once on a stop signal and exits: with 0, or with 1 if `stop` threw. */
export function stopOnSignals(stop: () => void, proc: { on(signal: string, fn: () => void): unknown; exit(code: number): unknown } = process): void {
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    proc.on(signal, () => {
      let code = 0;
      try {
        stop();
      } catch (err) {
        console.error(`the server did not stop cleanly: ${err instanceof Error ? err.message : String(err)}`);
        code = 1;
      }
      proc.exit(code);
    });
  }
}
