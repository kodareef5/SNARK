// The wire's codes take their numbers from the order they are declared in (shared/codes.ts), so nothing here names one.

import { expect, test } from "bun:test";
import { counter, flags } from "../../shared/codes.ts";
import * as P from "../../shared/net/protocol.ts";
import * as C from "../../shared/sim/character.ts";

/** The codes of one kind: the exports whose names begin with `prefix`, less any that are sizes. */
const codes = (from: Record<string, unknown>, prefix: string, not: readonly string[] = []): number[] =>
  Object.entries(from).filter(([k]) => k.startsWith(prefix) && !not.includes(k)).map(([, v]) => v as number);

test("a counter gives the next number, and flags the next bit", () => {
  const next = counter();
  expect([next(), next(), next()]).toEqual([1, 2, 3]);
  expect(counter(0)()).toBe(0);
  const bit = flags();
  expect([bit.count(), bit(), bit(), bit(), bit.count()]).toEqual([0, 1, 2, 4, 3]);
});

test("every code of a kind has its own number and fits where it travels", () => {
  const kinds: [prefix: string, most: number, not?: string[]][] = [["C_", 15], ["S_", 255], ["CMD_", 255], ["OWN_", 255], ["EVENT_", 255, ["EVENT_NAME_BYTES"]]];
  for (const [prefix, most, not] of kinds) {
    const of = codes(P, prefix, not).sort((a, b) => a - b);
    expect([prefix, of]).toEqual([prefix, of.map((_, i) => i + 1)]);
    expect(of.length).toBeLessThanOrEqual(most);
  }
});

test("every flag of a kind is a bit of its own, and the kind fits its word", () => {
  // A button's aliases in flight share a bit with the key they are.
  const kinds: [from: Record<string, unknown>, prefix: string, bits: number, not?: string[]][] = [[P, "HELLO_", 8], [P, "RULE_", 16], [C, "BTN_", 16, ["BTN_BRAKE", "BTN_ROLL"]]];
  for (const [from, prefix, bits, not] of kinds) {
    const of = codes(from, prefix, not).sort((a, b) => a - b);
    expect([prefix, of]).toEqual([prefix, of.map((_, i) => 1 << i)]);
    expect(of.length).toBeLessThanOrEqual(bits);
  }
});

test("an input's buttons take a bit each on the wire, and the mask keeps only them", () => {
  const buttons = codes(C, "BTN_");
  const all = buttons.reduce((a, b) => a | b, 0);
  expect([P.BUTTON_BITS, P.BUTTON_MASK]).toEqual([C.buttonCount(), all]);
  const inputs = new P.InputBuffer(4);
  inputs.set(1, 0, 0, 0, 0, 0xffff);
  expect(inputs.buttons[1]).toBe(all);
});
