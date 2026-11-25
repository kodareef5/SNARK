// The world takes mouse lock on a fresh click. Overlay and keyboard events only release it.
import type { App } from "../core/app.ts";

export function bindInput(canvas: HTMLCanvasElement, app: App): void {
  const mouse = new Set<number>();
  let lockedBefore = false, pending = false, escapedAt = -Infinity;
  const locked = () => document.pointerLockElement === canvas;
  const release = () => { if (locked() && !app.ui.wantsPointerLock) document.exitPointerLock(); };
  const clear = () => { mouse.clear(); app.ui.inspect = false; app.ui.dock.reset(); app.blur(); };
  const code = (e: KeyboardEvent) => e.code || (["Enter", "Escape", "Tab"].includes(e.key) ? e.key : "");
  function key(e: KeyboardEvent, down: boolean): void {
    if (e.isComposing || (code(e) === "Escape" && performance.now() - escapedAt < 150)) return;
    const source = app.ui.touch && app.ui.typing ? 2 : 0;
    if (app.key(code(e), down, e.repeat, source)) e.preventDefault();
    release();
  }
  addEventListener("keydown", e => key(e, true));
  addEventListener("keyup", e => key(e, false));
  addEventListener("blur", clear);
  document.addEventListener("visibilitychange", () => { if (document.hidden) clear(); });
  addEventListener("resize", () => { if (app.ui.touch && !app.ui.typing) clear(); });
  const coarse = matchMedia("(pointer: coarse)");
  coarse.addEventListener("change", () => { clear(); app.ui.inputDevice = coarse.matches ? 2 : 0; });
  canvas.addEventListener("pointerdown", e => { app.ui.inputDevice = e.pointerType === "touch" ? 2 : 0; });
  canvas.addEventListener("click", async e => {
    if ((e as PointerEvent).pointerType === "touch" || locked() || e.button !== 0) return;
    app.ui.clickWorld();
    if (pending || !app.ui.wantsPointerLock) return;
    pending = true;
    try { await canvas.requestPointerLock?.(); }
    catch { /* A browser can refuse a lock until the next deliberate click. */ }
    finally { pending = false; release(); }
  });
  addEventListener("click", release);
  document.addEventListener("pointerlockchange", () => {
    if (!locked() && lockedBefore) {
      mouse.clear();
      if (app.ui.wantsPointerLock) {
        app.ui.escaped();
        escapedAt = performance.now();
      }
      app.blur();
    }
    lockedBefore = locked();
  });
  addEventListener("mousemove", e => { if (locked() && app.ui.wantsPointerLock) app.look(e.movementX, e.movementY); });
  addEventListener("wheel", e => {
    if (locked() ? app.wheel(e.deltaY, e.deltaMode) : app.ui.wheel(e.deltaY)) e.preventDefault();
  }, { passive: false });
  canvas.addEventListener("mousedown", e => {
    if (locked() && app.ui.wantsPointerLock) { mouse.add(e.button); app.mouseButton(e.button, true); }
  });
  addEventListener("mouseup", e => { if (mouse.delete(e.button)) app.mouseButton(e.button, false); });
  canvas.addEventListener("contextmenu", e => e.preventDefault());
}
