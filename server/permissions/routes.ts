// A world's Permissions page's API (client/admin/permissions.ts): what the store holds, its history, and one POST for each
// kind of change, all under the world's own admin address. The caller has checked the admin password (server/admin/gate.ts).
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { changeWords } from "../../shared/permissions/commands.ts";
import { CHANGED_MEANWHILE, type PermissionOp } from "../../shared/permissions/model.ts";
import {
  CHAT_DOCUMENT, PERMISSIONS_API, PERMISSIONS_HISTORY, PERMISSIONS_STATE, type ImportKind, type PermissionsAnswer, type PermissionsHistory, type PermissionsSame,
  type PermissionsState,
} from "../../shared/permissions/page.ts";
import { RANK_ADMIN, RANK_CLUSTER, RANK_MAP, RANK_NAMES } from "../../shared/ranks.ts";
import { actorOf, onlyRead } from "../admin/gate.ts";
import { mapLabel } from "../cluster/cluster.ts";
import type { Host } from "../host.ts";
import { originAllowed } from "../origin.ts";
import { entryReply, readEntryJson } from "../survivor-access.ts";
import { idText } from "../survivor-ids.ts";
import { IMPORT_TEXT_MOST, planArkApi, planCommands, planCrossChat, type ImportPlan, type Planned } from "./import.ts";
import { HISTORY_PAGE_MOST } from "./permissions.ts";

/** The most a POST may carry: an ArkApi database and its -wal file arrive as base64 inside it. */
export const PERMISSIONS_BODY_MOST = 8 * 1024 * 1024;
/** The rows of history a page asks for when it does not say. */
const HISTORY_PAGE = 50;

const KINDS: Record<ImportKind, string> = { arkapi: "an ArkApi Permissions database", commands: "a list of Permissions commands", crosschat: "a CrossChat config" };
const UNCHECKED = "Check the import first: Apply makes only the changes the check showed.";
const PLAN_CHANGED = "What the import would do changed since it was checked. Nothing was changed: look at what it would do now, and apply that.";

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

/** This world's survivors with whether each is online, as the state lists them. */
function survivorsOf(host: Host): PermissionsState["survivors"] {
  const online = new Set<number>();
  for (const c of host.game.clients) if (c?.active && !c.closed && c.pid !== 0) online.add(c.pid);
  const out: PermissionsState["survivors"] = [];
  for (const pid of host.survivorIds()) {
    const rec = host.records.byPid.get(pid);
    const id = rec ? idText(rec) : "";
    if (rec && id) out.push({ id, name: rec.name, online: online.has(pid) });
  }
  return out;
}

const tribesOf = (host: Host): PermissionsState["tribes"] => [...host.tribes.byId.values()].map((t) => ({ team: t.id, name: t.name }));

/**
 * A short key for everything the state is made from: the viewer, this view of the store and each commit to it (the
 * register's raise no revision), and this world's survivors, who is online, its tribes and the cluster's worlds.
 */
export function stateKey(host: Host, req: Request): string {
  const by = actorOf(req);
  const parts: string[] = [by.name, by.id, String(by.rank), String(host.permissions.version), host.permissions.commits()];
  for (const s of survivorsOf(host)) parts.push(`${s.id}\t${s.name}\t${s.online ? 1 : 0}`);
  for (const t of tribesOf(host)) parts.push(`${t.team}\t${t.name}`);
  for (const w of worldsOf(host)) parts.push(`${w.id}\t${w.name}`);
  return Bun.hash(parts.join("\n")).toString(36);
}

/** What the page shows. A viewer below admin rank is shown it too, with every control off. */
export function permissionsState(host: Host, req: Request): PermissionsState {
  const by = actorOf(req);
  const perms = host.permissions;
  const key = stateKey(host, req);
  const snap = perms.snapshot();
  const register = perms.allIssued().map((r) => ({ id: r.id, name: r.name, world: r.world }));
  const registered = new Map(register.map((r) => [r.id, r.name]));
  const nameOf = (kind: string, key: string): string =>
    kind === "tribe" ? (host.tribes.byId.get(Number(key))?.name ?? "") : (host.survivorById(key)?.name ?? registered.get(key) ?? "");
  return {
    key,
    me: { name: by.name, id: by.id, rank: by.rank, world: perms.world },
    saved: host.cluster !== null || host.persistence !== null,
    revision: snap.revision,
    groups: [...snap.groups],
    members: snap.members.map((m) => ({ ...m, name: nameOf(m.kind, m.key) })),
    passwords: snap.secrets.map((s) => ({ id: s.id, at: s.at })),
    document: perms.document(CHAT_DOCUMENT),
    survivors: survivorsOf(host),
    tribes: tribesOf(host),
    register,
    commands: cheatCommands(host),
    worlds: worldsOf(host),
  };
}

/** The folder an ArkApi database's passing copy is made in: one beside the world's save, else the system's own. */
function importFolder(host: Host): string | undefined {
  if (host.saveFolder === null) return undefined;
  const folder = join(host.saveFolder, "permissions-import");
  try {
    mkdirSync(folder, { recursive: true });
    return folder;
  } catch {
    return undefined;
  }
}

function plan(host: Host, kind: ImportKind, text: string, wal: string | undefined): Planned {
  // A plan is made from the file as it is now, not as this map last read it: another map may have changed it since.
  host.permissions.lookNow();
  const opts = { look: host.permissions, commands: cheatCommands(host) };
  if (kind !== "arkapi") return kind === "commands" ? planCommands(text, opts) : planCrossChat(text, opts);
  const folder = importFolder(host);
  const files = { ...(wal ? { wal: new Uint8Array(Buffer.from(wal, "base64")) } : {}), ...(folder ? { folder } : {}) };
  return planArkApi(new Uint8Array(Buffer.from(text, "base64")), opts, files);
}

/** A digest of a plan's changes, in order: the same changes give the same digest. */
export const planDigest = (p: ImportPlan): string => createHash("sha256").update(JSON.stringify(p.ops)).digest("hex");

const words = (op: PermissionOp): string => changeWords(op, false);

/** What a check answers: the plan's notes and changes in words, and its digest. */
function checked(host: Host, req: Request, p: ImportPlan): PermissionsAnswer {
  const top = host.cluster ? RANK_CLUSTER : RANK_MAP;
  const asks = actorOf(req).rank < top ? [`Applying it needs the ${RANK_NAMES[top]} rank.`] : [];
  return { ok: true, why: "", notes: [...p.notes, ...p.ops.map(words), ...asks], ops: p.ops.length, digest: planDigest(p) };
}

/** The value a whole-value change was refused over, as the store holds it now. */
function currentOf(host: Host, op: PermissionOp): string | number | undefined {
  if (op.op === "setChat") return host.permissions.group(op.group)?.chat;
  if (op.op === "setRank") return host.permissions.group(op.group)?.rank;
  if (op.op === "setDocument") return host.permissions.document(op.name);
  return undefined;
}

async function post(host: Host, req: Request): Promise<Response> {
  // A change is taken only from a page this server served, whatever the password.
  if (!originAllowed(req.headers.get("origin"), req.headers.get("host"), "")) return no("Open the permissions page on this world.", 403);
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
      const refuse = (why: string): Response => (host.acts.refused(by, by.rank, changeWords(op, false), why), no(why, 403));
      if ((op.op as string) === "setSecret" || "hash" in op) return refuse("A survivor claims their own password in game. Nobody sets one here.");
      if (op.op === "tag") return refuse("A tag is shown or hidden by its survivor, in game.");
      const why = host.changePermissions(by, op);
      if (why === CHANGED_MEANWHILE) return answer({ ok: false, why, current: currentOf(host, op) }, 409);
      return why === "" ? answer({ ok: true, why: "" }) : no(why, 403);
    }
    case "plan":
    case "import": {
      const kind = sent.kind as ImportKind;
      if (!Object.hasOwn(KINDS, kind) || typeof sent.text !== "string") return no("That is not an import the permissions page sends.");
      // Reading what was sent is work inside the server's tick, so even a check is an admin's.
      if (by.rank < RANK_ADMIN) return no("An import is checked and applied from an admin's rank.", 403);
      if (kind !== "arkapi" && sent.text.length > IMPORT_TEXT_MOST) return no(`That is too long to paste as one import: ${IMPORT_TEXT_MOST / 1024} KB at most. Bring it in as several.`, 413);
      if (sent.wal !== undefined && (typeof sent.wal !== "string" || kind !== "arkapi")) return no("A -wal file goes only beside an ArkApi database.");
      if (sent.do === "import" && (typeof sent.digest !== "string" || sent.digest === "")) return no(UNCHECKED);
      const planned = plan(host, kind, sent.text, sent.wal as string | undefined);
      if (!planned.ok) return no(planned.reason);
      if (sent.do === "plan") {
        onlyRead(req);
        return answer(checked(host, req, planned.plan));
      }
      if (planDigest(planned.plan) !== sent.digest) {
        return answer({ ...checked(host, req, planned.plan), ok: false, why: PLAN_CHANGED }, 409);
      }
      const done = host.importPermissions(by, KINDS[kind], planned.plan);
      if (done.why !== "") return no(done.why, 403);
      return answer({ ok: true, why: "", notes: [...planned.plan.notes], ops: done.done, refused: done.refused.map((r) => ({ what: words(r.op), why: r.reason })) });
    }
    default:
      return no("That is not a request the permissions page sends.");
  }
}

const reading = (req: Request): boolean => req.method === "GET" || req.method === "HEAD";
const onlyGet = (): Response => new Response(null, { status: 405, headers: { allow: "GET, HEAD" } });

/** The history, newest first: `before` a sequence number, at most `most` rows. It holds no address and no secret. */
function history(host: Host, url: URL): PermissionsHistory {
  const before = Number(url.searchParams.get("before"));
  // One row more is asked for than answered, to know whether more are left.
  const most = Math.min(HISTORY_PAGE_MOST - 1, Math.max(1, Math.floor(Number(url.searchParams.get("most"))) || HISTORY_PAGE));
  const rows = host.permissions.history(Number.isSafeInteger(before) && before > 0 ? before : Number.MAX_SAFE_INTEGER, most + 1);
  return { rows: rows.slice(0, most), more: rows.length > most };
}

/** Answers the page's three paths, `path` as the world's admin pages are matched, or null for another. */
export function permissionsAdmin(req: Request, path: string, host: Host): Promise<Response> | Response | null {
  if (path === PERMISSIONS_STATE) {
    if (!reading(req)) return onlyGet();
    const key = new URL(req.url).searchParams.get("key");
    if (key !== null && key === stateKey(host, req)) return entryReply({ same: true, key } satisfies PermissionsSame);
    return entryReply(permissionsState(host, req));
  }
  if (path === PERMISSIONS_HISTORY) return reading(req) ? entryReply(history(host, new URL(req.url))) : onlyGet();
  if (path === PERMISSIONS_API) return req.method === "POST" ? post(host, req) : answer({ ok: false, why: "Send a change with POST." }, 405);
  return null;
}
