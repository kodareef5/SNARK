// Forwards raw keyboard and mouse events to the app and keeps pointer lock in
// step with what the interface wants. What a key means is decided in
// client/core. Touch controls are not implemented yet.

import type { App } from "../core/app.ts";

export function bindInput(canvas: HTMLCanvasElement, app: App): void {
  /** The viewer has clicked into the game at least once since the lock was last lost. */
  let engaged = false;
  const sync = (): void => {
    const locked = document.pointerLockElement === canvas;
    if (app.ui.wantsPointerLock && engaged && !locked) void canvas.requestPointerLock();
    else if (!app.ui.wantsPointerLock && locked) document.exitPointerLock();
  };
  addEventListener("keydown", (e) => {
    if (app.key(e.code, true, e.repeat)) e.preventDefault();
    sync();
  });
  addEventListener("keyup", (e) => {
    if (app.key(e.code, false, false)) e.preventDefault();
  });
  addEventListener("blur", () => app.blur());
  canvas.addEventListener("click", () => {
    engaged = true;
    sync();
  });
  document.addEventListener("pointerlockchange", () => {
    // Escape releases the lock without telling the page which key it was.
    if (document.pointerLockElement !== canvas && app.ui.wantsPointerLock) engaged = false;
    if (document.pointerLockElement !== canvas) app.blur();
  });
  addEventListener("mousemove", (e) => {
    if (document.pointerLockElement === canvas) app.look(e.movementX, e.movementY);
  });
  canvas.addEventListener("mousedown", (e) => {
    if (document.pointerLockElement === canvas) app.mouseButton(e.button, true);
  });
  addEventListener("mouseup", (e) => app.mouseButton(e.button, false));
}
