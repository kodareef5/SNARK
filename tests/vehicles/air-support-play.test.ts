import { expect, test } from "bun:test";
import { AIR_PHASE } from "../../shared/sim/air-support.ts";
import { airYard } from "../../tools/urban/air-yard.ts";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import type { Screen } from "../kit/screen.ts";
import { ScreenHarness, screen, tap } from "../kit/screen.ts";

function click(view: Screen, label: string): void {
  const f = view.app.ui.frame;
  const button = f.nodes.slice(0, f.count).find(n => n.interactive && n.text === label);
  if (!button) throw new Error(`Missing ${label}. Screen shows ${f.nodes.slice(0, f.count).map(n => n.text).filter(Boolean).join(" / ")}`);
  view.app.pointer(0, button.key, button.x + button.w / 2, button.y + button.h / 2, 0);
}

test("the cab calls a trailer and launches its fourth bay through the radio", () => {
  const h = new ScreenHarness({}, 19, 20, { dev: true, map: Uint8Array.from(airYard()), clips: NO_CLIPS, rigs: [] });
  try {
    const s = h.open("freight-driver");
    const view = screen(h, s);
    h.run(1000);
    const semi = [...h.host.records.byPid.values()].find(r => h.reg.ids[r.kind] === "core:semi")!;
    const e = h.host.records.entOf.get(semi.pid)!;
    tap(h, view, "KeyE");
    h.run(1600);
    expect(s.driving).toBe(e);
    tap(h, view, "KeyJ");
    expect(view.app.ui.air.open).toBe(true);
    click(view, "Request trailer");
    h.run(400);
    expect(s.airSupport.order).toBeGreaterThan(0);
    const seen = new Set<number>();
    for (let i = 0; i < 120 && !s.airSupport.pod; i++) {
      h.run(400, () => { for (const c of s.airSupport.carriers) seen.add(c.phase); });
    }
    expect(seen.has(AIR_PHASE.lower)).toBe(true);
    const pod = s.airSupport.pods.find(p => p.id === s.airSupport.pod);
    expect(pod?.hitched).toBe(true);
    tap(h, view, "KeyJ");
    click(view, "Open rack");
    h.run(3000);
    expect(s.airSupport.pods.find(p => p.id === pod!.id)?.open).toBe(1);
    tap(h, view, "Digit4");
    click(view, "Launch bay 4");
    h.run(300);
    expect(s.airSupport.flight).toBeGreaterThan(0);
    expect(s.airCamera.id).toBe(s.airSupport.flight);
    expect(s.driving).toBe(e);
    expect(s.airSupport.pods.find(p => p.id === pod!.id)!.slots).toBe(0b110111);
    tap(h, view, "KeyE");
    expect(s.airSupport.flight).toBe(0);
    expect(s.airCamera.id).toBe(0);
    expect(s.driving).toBe(e);
  } finally { h.host.shutdown(); }
});
