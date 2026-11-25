// The Permissions page's API (client/admin/permissions.ts): what the store holds, and one POST for each kind of change. The
// caller has checked the admin password and, for a POST, the page's origin (server/admin/site.ts, server/main.ts).
import { changeWords } from "../../shared/permissions/commands.ts";
import type { PermissionOp } from "../../shared/permissions/model.ts";
import { CHAT_DOCUMENT, PERMISSIONS_API, PERMISSIONS_STATE, type ImportKind, type PermissionsAnswer, type PermissionsState } from "../../shared/permissions/page.ts";
import { RANK_CLUSTER, RANK_MAP, RANK_NAMES } from "../../shared/ranks.ts";
import { actorOf, onlyRead } from "../admin/gate.ts";
import { mapLabel } from "../cluster/cluster.ts";
import type { Host } from "../host.ts";
import { entryReply, readEntryJson } from "../survivor-access.ts";
import { idText } from "../survivor-ids.ts";
import { planArkApi, planCommands, planCrossChat, type Planned } from "./import.ts";

/** The most a POST may carry: an ArkApi database arrives as base64 inside it. */
export const PERMISSIONS_BODY_MOST = 8 * 1024 * 1024;

const KINDS: Record<ImportKind, string> = { arkapi: "an ArkApi Permissions database", commands: "a list of Permissions commands", crosschat: "a CrossChat config" };

const answer = (a: PermissionsAnswer, status = 200): Response => entryReply(a, status);
const no = (why: string, status = 400): Response => answer({ ok: false, why }, status);

/** The console commands that ask for cheats, as `help` spells them. */
const cheatCommands = (host: Host): string[] => [...host.console.commands.values()].filter((c) => c.admin).map((c) => c.name).sort();

function worldsOf(host: Host): PermissionsState["worlds"] {
  const c = host.cluster;
  if (!c) return [{ id: 0, name: host.rules.text("SessionName") || mapLabel(host.world.reg, host.world.mapId) }];
  const ids = new Set([c.world, ...c.folder.announcements().map((a) => a.world)]);
  return [...ids].sort((a, b) => a - b).map((id) => ({ id, name: c.serverName(id) }));
}

/** What the page shows. A viewer below admin rank is shown it too, with every control off. */
export function permissionsState(host: Host, req: Request): PermissionsState {
  const by = actorOf(req);
  const perms = host.permissions;
  const snap = perms.snapshot();
  const online = new Set<number>();
  for (const c of host.game.clients) if (c?.active && !c.closed && c.pid !== 0) online.add(c.pid);
  const survivors: PermissionsState["survivors"] = [];
  for (const pid of host.survivorIds()) {
    const rec = host.records.byPid.get(pid);
    const id = rec ? idText(rec) : "";
    if (rec && id) survivors.push({ id, name: rec.name, online: online.has(pid) });
  }
  const register = perms.allIssued().map((r) => ({ id: r.id, name: r.name, world: r.world }));
  const registered = new Map(register.map((r) => [r.id, r.name]));
  const nameOf = (kind: string, key: string): string =>
    kind === "tribe" ? (host.tribes.byId.get(Number(key))?.name ?? "") : (host.survivorById(key)?.name ?? registered.get(key) ?? "");
  return {
    me: { name: by.name, id: by.id, rank: by.rank, world: perms.world },
    saved: host.cluster !== null || host.persistence !== null,
    revision: snap.revision,
    groups: [...snap.groups],
    members: snap.members.map((m) => ({ ...m, name: nameOf(m.kind, m.key) })),
    passwords: snap.secrets.map((s) => ({ id: s.id, at: s.at })),
    document: perms.document(CHAT_DOCUMENT),
    survivors,
    tribes: [...host.tribes.byId.values()].map((t) => ({ team: t.id, name: t.name })),
    register,
    commands: cheatCommands(host),
    worlds: worldsOf(host),
  };
}

function plan(host: Host, kind: ImportKind, text: string): Planned {
  const opts = { look: host.permissions, commands: cheatCommands(host) };
  if (kind === "arkapi") return planArkApi(new Uint8Array(Buffer.from(text, "base64")), opts);
  return kind === "commands" ? planCommands(text, opts) : planCrossChat(text, opts);
}

const words = (op: PermissionOp): string => changeWords(op, false);

async function post(host: Host, req: Request): Promise<Response> {
  if (Number(req.headers.get("content-length") ?? 0) > PERMISSIONS_BODY_MOST) return no("That is too large: a request is at most 8 MB.", 413);
  let sent: Record<string, unknown>;
  try {
    sent = await readEntryJson(req, PERMISSIONS_BODY_MOST);
  } catch (e) {
    if (e instanceof Error && e.message === "Request too large") return no("That is too large: a request is at most 8 MB.", 413);
    return no("That is not a request the permissions page sends.");
  }
  const by = actorOf(req);
  switch (sent.do) {
    case "op": {
      const op = sent.op as PermissionOp;
      if (typeof op !== "object" || op === null) return no("That is not a permission change.");
      if ((op.op as string) === "setSecret" || "hash" in op) return no("A survivor claims their own password in game. Nobody sets one here.", 403);
      if (op.op === "tag") return no("A tag is shown or hidden by its survivor, in game.", 403);
      const why = host.changePermissions(by, op);
      return why === "" ? answer({ ok: true, why: "" }) : no(why, 403);
    }
    case "plan":
    case "import": {
      const kind = sent.kind as ImportKind;
      if (!Object.hasOwn(KINDS, kind) || typeof sent.text !== "string") return no("That is not an import the permissions page sends.");
      const planned = plan(host, kind, sent.text);
      if (!planned.ok) return no(planned.reason);
      const { ops, notes } = planned.plan;
      if (sent.do === "plan") {
        onlyRead(req);
        const top = host.cluster ? RANK_CLUSTER : RANK_MAP;
        const asks = by.rank < top ? [`Applying it needs the ${RANK_NAMES[top]} rank.`] : [];
        return answer({ ok: true, why: "", notes: [...notes, ...ops.map(words), ...asks], ops: ops.length });
      }
      const done = host.importPermissions(by, KINDS[kind], planned.plan);
      if (done.why !== "") return no(done.why, 403);
      return answer({ ok: true, why: "", notes: [...notes], ops: done.done, refused: done.refused.map((r) => ({ what: words(r.op), why: r.reason })) });
    }
    default:
      return no("That is not a request the permissions page sends.");
  }
}

/** Answers the page's two paths, or null for another. */
export function permissionsAdmin(req: Request, path: string, host: Host): Promise<Response> | Response | null {
  if (path === PERMISSIONS_STATE) {
    if (req.method !== "GET" && req.method !== "HEAD") return new Response(null, { status: 405, headers: { allow: "GET, HEAD" } });
    return entryReply(permissionsState(host, req));
  }
  if (path === PERMISSIONS_API) return req.method === "POST" ? post(host, req) : answer({ ok: false, why: "Send a change with POST." }, 405);
  return null;
}
