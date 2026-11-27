// Cast that is off asks for no save, and turning it off keeps its last change.
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { castAct } from "../../server/admin/cast.ts";
import { Harness } from "../fixtures/net.ts";

test("Cast off is never saved; turned off, its last state is saved once its people are gone, and then no more", () => {
  const dir = mkdtempSync(join(tmpdir(), "cast-quiet-"));
  try {
    const h = new Harness({ entityRadius: 1 }, 2, 30, { dbPath: join(dir, "world.db"), wakeRadius: 1 });
    h.join("Ana");
    const cast = h.host.cast;
    const store = h.host.persistence!.store;
    let asked = 0;
    const serialize = cast.saved.serialize;
    cast.saved.serialize = () => (asked++, serialize());

    h.run(130_000);
    expect([cast.cast.settings.enabled, cast.saved.dirty, asked, store.meta("cast")]).toEqual([false, false, 0, null]);

    expect(castAct(h.host, { op: "set", name: "CastEnabled", value: "true" })).toBe("");
    expect(castAct(h.host, { op: "spawn", scene: "cast:flash_mob" })).toBe("");
    h.run(70_000);
    expect(asked).toBeGreaterThan(0);
    expect(typeof store.meta("cast")).toBe("string");

    expect(castAct(h.host, { op: "set", name: "CastEnabled", value: "false" })).toBe("");
    for (let n = 0; n < 120 && (cast.cast.settings.enabled || cast.stage.count > 0); n++) h.run(5000);
    expect(cast.stage.count).toBe(0);
    // Within a minute of the last of them leaving, the save holds what they left behind.
    h.run(70_000);
    expect([cast.saved.dirty, store.meta("cast")]).toEqual([false, cast.cast.save()]);

    const after = asked;
    h.run(130_000);
    expect([cast.saved.dirty, asked]).toEqual([false, after]);
    h.host.shutdown();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
