// Forwards raw keyboard and mouse events to the app and keeps pointer lock in step with what the interface wants.

import type { App } from "../core/app.ts";

export function bindInput(canvas: HTMLCanvasElement, app: App): void {
  /** The viewer has clicked into the game at least once since the lock was last lost. */
  let engaged = false;
  let lockedBefore = false;
  let escapedAt = -Infinity;
  const sync = (): void => {
    const locked = document.pointerLockElement === canvas;
    if (app.ui.wantsPointerLock && engaged && !locked) void canvas.requestPointerLock?.()?.catch(() => { engaged = false; });
    else if (!app.ui.wantsPointerLock && locked) document.exitPointerLock();
  };
  // A phone's on-screen keyboard names a key but gives it no code.
  const code = (e: KeyboardEvent): string => e.code || (e.key === "Enter" || e.key === "Escape" || e.key === "Tab" ? e.key : "");
  addEventListener("keydown", (e) => {
    if (code(e) === "Escape" && performance.now() - escapedAt < 150) return;
    if (app.key(code(e), true, e.repeat)) e.preventDefault();
    sync();
  });
  addEventListener("keyup", (e) => {
    if (app.key(code(e), false, false)) e.preventDefault();
    sync();
  });
  addEventListener("blur", () => { app.ui.inspect = false; app.blur(); });
  // A finger on the world brings up the touch controls (client/core/touch.ts), and never locks a pointer it does not have.
  canvas.addEventListener("pointerdown", (e) => { if (e.pointerType === "touch") app.ui.inputDevice = 2; });
  canvas.addEventListener("click", (e) => {
    if ((e as PointerEvent).pointerType === "touch") return;
    engaged = true;
    sync();
  });
  addEventListener("click", sync);
  document.addEventListener("pointerlockchange", () => {
    // Escape releases the lock without telling the page which key it was.
    const locked = document.pointerLockElement === canvas;
    if (!locked && lockedBefore && app.ui.wantsPointerLock) {
      app.ui.openMenu();
      escapedAt = performance.now();
    }
    if (!locked) app.blur();
    lockedBefore = locked;
  });
  addEventListener("mousemove", (e) => {
    if (document.pointerLockElement === canvas) app.look(e.movementX, e.movementY);
  });
  // The orbit camera takes the wheel while it is on; otherwise the browser has it as before.
  addEventListener("wheel", (e) => {
    if (document.pointerLockElement === canvas && app.wheel(e.deltaY, e.deltaMode)) e.preventDefault();
  }, { passive: false });
  canvas.addEventListener("mousedown", (e) => {
    if (document.pointerLockElement === canvas) app.mouseButton(e.button, true);
  });
  addEventListener("mouseup", (e) => app.mouseButton(e.button, false));
  // The right button is the secondary action, not a menu.
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
}
