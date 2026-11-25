import { expect, test } from "bun:test";
import { LOCK_FREE, LOCK_KEEP, LOCK_TAKE, LockRule } from "../../client/core/pointer-lock.ts";

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
