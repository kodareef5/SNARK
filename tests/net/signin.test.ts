// The sign-in gate at the hello (server/signin/method.ts), with no Discord in it.
import { expect, test } from "bun:test";
import { hashKey } from "../../server/records.ts";
import { KEY_METHOD } from "../../server/signin/method.ts";
import { frontPasses } from "../../server/front.ts";
import { REJECT_SIGNIN } from "../../shared/net/protocol.ts";
import { Harness, testKey } from "../fixtures/net.ts";

test("a server with nothing set signs in by the browser key and asks nothing", () => {
  const h = new Harness();
  expect(h.host.rules.text("SignIn")).toBe("key");
  expect(h.host.signin.method).toBe(KEY_METHOD);
  expect(h.host.signin.entry()).toBeNull();
  expect(h.host.signin.method.subject(hashKey(testKey("Ada")))).toBe("");
  const ada = h.join("Ada");
  h.run(300);
  expect(ada.state).toBe("active");
});

test("a SignIn that names no method lets nobody in", () => {
  const h = new Harness();
  expect(h.host.setSetting("SignIn", "discrod")).toBe("");
  const ada = h.join("Ada");
  h.run(300);
  expect([ada.state, ada.closeReason]).toEqual(["closed", REJECT_SIGNIN]);
  expect(h.host.survivorRecord("Ada")).toBeUndefined();
  expect(h.host.setSetting("SignIn", "KEY")).toBe("");
  const again = h.join("Ada");
  h.run(300);
  expect(again.state).toBe("active");
});

test("the front passes a sign-in's POST to its world", () => {
  expect(frontPasses("POST", "/signin")).toBe(true);
  expect(frontPasses("POST", "/signin/discord/callback")).toBe(false);
  expect(frontPasses("GET", "/signin/discord/callback")).toBe(true);
});
