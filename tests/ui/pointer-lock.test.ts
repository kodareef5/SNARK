import { expect, test } from "bun:test";
import { LOCK_FREE, LOCK_KEEP, LOCK_TAKE, LOST_ESCAPE, LOST_TO_FIELD, LOST_TO_SCREEN, LockRule, lostLock } from "../../client/core/pointer-lock.ts";

test("The mouse is taken only after a click on the world", () => {
  const rule = new LockRule();
  expect(rule.step(true, false)).toBe(LOCK_KEEP);
  rule.click();
  expect(rule.step(true, false)).toBe(LOCK_TAKE);
});

test("Closing a screen by key takes the mouse back with no second click", () => {
  const rule = new LockRule();
  rule.click();
  expect(rule.step(true, false)).toBe(LOCK_TAKE);
  // The inventory opens: the mouse is given back.
  expect(rule.step(false, true)).toBe(LOCK_FREE);
  // It closes by key: the lock is asked for again.
  expect(rule.step(true, false)).toBe(LOCK_TAKE);
});

test("A refused lock waits for the next click on the world", () => {
  const rule = new LockRule();
  rule.click();
  rule.refused();
  expect(rule.step(true, false)).toBe(LOCK_KEEP);
  rule.click();
  expect(rule.step(true, false)).toBe(LOCK_TAKE);
});

test("A request already out is not made twice", () => {
  const rule = new LockRule();
  rule.click();
  rule.pending = true;
  expect(rule.step(true, false)).toBe(LOCK_KEEP);
});

test("A lost lock opens the menu on Escape, keeps the dock, and lets go for other screens", () => {
  // Escape: the body was played and still wants the mouse.
  expect(lostLock(true, true)).toBe(LOST_ESCAPE);
  // F2 opened the dock, which keeps the field: it must not be shut by letting go.
  expect(lostLock(false, true)).toBe(LOST_TO_FIELD);
  // The inventory opened: everything held lets go.
  expect(lostLock(false, false)).toBe(LOST_TO_SCREEN);
});
