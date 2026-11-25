// The admin page's stop for an update: a deployed world has no console to type `doexit` at.
//
//   POST /admin/stop   {"seconds":60}     the server stops after a countdown; every page waits and comes back by itself
//                      {"cancel":true}    a stop that was said is taken back
//
// Behind the admin pages' gate, which the caller has passed. The answer says the seconds left, -1 for no stop.

import type { Host } from "../host.ts";
import { actorOf } from "./gate.ts";
import { body, refusedWrite } from "./supply-routes.ts";

const JSON_HEADERS = { "content-type": "application/json", "cache-control": "no-store" };

export function stopAnswer(host: Host, req: Request, at: string): Response | Promise<Response> | null {
  if (at !== "/admin/stop") return null;
  const json = (ok: boolean, why: string): Response => new Response(JSON.stringify({ ok, why, left: host.stopLeft }), { status: ok ? 200 : 400, headers: JSON_HEADERS });
  const no = refusedWrite(req);
  if (no) return no;
  const by = actorOf(req);
  return body(req, 1024).then((b) => {
    if (b === null) return json(false, 'A stop is {"seconds":60} or {"cancel":true}.');
    const say = (line: string): void => void host.acts.write(by, line);
    if (b.cancel === true) {
      const was = host.stopCancel();
      if (was) say("doexit cancel");
      return json(was, was ? "" : "No stop was set.");
    }
    if (typeof b.seconds !== "number") return json(false, 'A stop is {"seconds":60} or {"cancel":true}.');
    const why = host.stopIn(b.seconds);
    if (why === "") say(`doexit ${b.seconds}`);
    return json(why === "", why);
  });
}
