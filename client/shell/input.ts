// Forwards keys and the mouse to the app, and keeps the mouse lock in step with what the interface wants (pointer-lock.ts).
import type { App } from "../core/app.ts";
import { LOCK_FREE, LOCK_TAKE, LOST_ESCAPE, LOST_TO_FIELD, LockRule, lostLock } from "../core/pointer-lock.ts";

export function bindInput(canvas: HTMLCanvasElement, app: App): void {
  const rule = new LockRule();
  const mouse = new Set<number>();
  let lockedBefore = false, escapedAt = -Infinity;
  const locked = () => document.pointerLockElement === canvas;
  const sync = (): void => {
    const step = rule.step(app.ui.wantsPointerLock && !app.ui.touch, locked());
    if (step === LOCK_FREE) document.exitPointerLock();
    if (step !== LOCK_TAKE) return;
    rule.pending = true;
    Promise.resolve(canvas.requestPointerLock?.())
      .catch(() => rule.refused())
      .finally(() => { rule.pending = false; if (!app.ui.wantsPointerLock && locked()) document.exitPointerLock(); });
  };
  const clear = () => { mouse.clear(); app.ui.inspect = false; app.blur(); };
  // A phone's on-screen keyboard names a key but gives it no code.
  const code = (e: KeyboardEvent) => e.code || (["Enter", "Escape", "Tab"].includes(e.key) ? e.key : "");
  function key(e: KeyboardEvent, down: boolean): void {
    if (e.isComposing || (down && code(e) === "Escape" && performance.now() - escapedAt < 150)) return;
    const source = app.ui.touch && app.ui.typing ? 2 : 0;
    if (app.key(code(e), down, e.repeat, source)) e.preventDefault();
    sync();
  }
  addEventListener("keydown", e => key(e, true));
  addEventListener("keyup", e => key(e, false));
  addEventListener("blur", clear);
  document.addEventListener("visibilitychange", () => { if (document.hidden) clear(); });
  // A phone turned lets go of every finger: a contact held through it would stay pressed. The address bar's resize does not.
  matchMedia("(orientation: portrait)").addEventListener("change", () => { if (app.ui.touch) clear(); });
  const coarse = matchMedia("(pointer: coarse)");
  coarse.addEventListener("change", () => { clear(); app.ui.inputDevice = coarse.matches ? 2 : 0; });
  canvas.addEventListener("pointerdown", e => { app.ui.inputDevice = e.pointerType === "touch" ? 2 : 0; });
  canvas.addEventListener("click", e => {
    if ((e as PointerEvent).pointerType === "touch" || e.button !== 0 || locked()) return;
    rule.click();
    app.ui.clickWorld();
  });
  // After every click, on the world or on a node that closed a screen.
  addEventListener("click", sync);
  document.addEventListener("pointerlockchange", () => {
    // Escape lets go of the lock without telling the page which key it was.
    if (!locked() && lockedBefore) {
      const lost = lostLock(app.ui.wantsPointerLock, app.ui.playingField);
      for (const button of mouse) app.mouseButton(button, false);
      mouse.clear();
      if (lost === LOST_ESCAPE) {
        app.ui.escaped();
        escapedAt = performance.now();
      }
      // The dock opened by a key keeps its page, and the keys keep moving the body.
      if (lost !== LOST_TO_FIELD) app.blur();
    }
    lockedBefore = locked();
  });
  addEventListener("mousemove", e => { if (locked() && app.ui.wantsPointerLock) app.look(e.movementX, e.movementY); });
  // The orbit camera takes the wheel while the mouse is locked; otherwise the interface has it.
  addEventListener("wheel", e => {
    if (locked() ? app.wheel(e.deltaY, e.deltaMode) : app.ui.wheel(e.deltaY)) e.preventDefault();
  }, { passive: false });
  canvas.addEventListener("mousedown", e => {
    if (locked() && app.ui.wantsPointerLock) { mouse.add(e.button); app.mouseButton(e.button, true); }
  });
  addEventListener("mouseup", e => { if (mouse.delete(e.button)) app.mouseButton(e.button, false); });
  // The right button is the secondary action, not a menu.
  canvas.addEventListener("contextmenu", e => e.preventDefault());
}
