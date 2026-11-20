// grunt in Pi: the conversation is the character's Director. Pi loads this file (package.json's `pi.extensions`) under
// Node, so nothing here uses Bun's own APIs (tools/check.ts).
//
// The model gets a few coarse tools (look, skills, do, tasks, stop, say) and never sends a control: it starts skills,
// which run as tasks on the runtime's own tick, and it hears back through messages that start a turn when something
// needs it (a task over, danger, a line said to the character). The operator has /grunt.

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { nearest } from "./build.ts";
import { BLUEPRINTS } from "./blueprints.ts";
import { Agenda } from "./agenda.ts";
import { brief, BriefDelivery, type Goal, type Situation } from "./brief.ts";
import { missing } from "./kit.ts";
import { compile } from "./layout.ts";
import { socketLink } from "./link.ts";
import type { PiExtensionAPI, PiTool, PiToolResult } from "./pi.ts";
import { GRUNT_VERSION } from "./protocol.ts";
import { PERSONAS, personaOf, type Persona, type PersonaInput } from "./persona.ts";
import { type Report, Runtime } from "./runtime.ts";
import { Session } from "./session.ts";
import { SKILLS } from "./skills.ts";
import { Trace } from "./trace.ts";

export const GRUNT_PACKAGE_VERSION = "0.1.0";
const SPEC = fileURLToPath(new URL("./protocol.md", import.meta.url));
/** The Director's own system prompt while a character is connected, in place of Pi's coding-assistant one. */
const DIRECTOR = readFileSync(new URL("./director.md", import.meta.url), "utf8");
const BUILDER = readFileSync(new URL("./builder.md", import.meta.url), "utf8");
/** Reports that wake the Director. Notes only wait in `look`. */
/** How long an idle mind with an open goal is left before it is told, and how often in a row. */
const IDLE_MS = 20_000, IDLE_NUDGES = 3;
/** How long the same due items wait before the idle character is told of them again. */
const AUTONOMY_MS = 180_000;
const WAKES = new Set<Report["kind"]>(["task", "danger", "clear", "addressed", "critical", "need", "connection"]);

/** Every skill and its parameters, in one line each: what game_do's description carries. */
const SKILL_LINES = Object.values(SKILLS).map((s) => `${s.name}(${Object.entries(s.params).map(([k, v]) => `${k}: ${v}`).join("; ")}): ${s.describe}`).join("\n");

interface Mind {
  rt: Runtime;
  session: Session;
  url: string;
  tracePath: string;
  flush: () => void;
  agenda: Agenda;
}

const text = (t: string, details: unknown = null): PiToolResult => ({ content: [{ type: "text", text: t }], details });
const json = (v: unknown) => JSON.stringify(v);

/** Where a character's agenda is kept between sessions: one file per character name. */
function agendaFile(name: string): string {
  const dir = process.env.GRUNT_STATE ?? join(homedir(), ".pi", "agent", "grunt", "agenda");
  mkdirSync(dir, { recursive: true });
  return join(dir, `${name.replace(/[^\w-]/g, "_")}.json`);
}

/** A character's persona: the one asked for, else one written beside its agenda (<name>.persona.json), else GRUNT_PERSONA,
 * else the stoic default. A name is a built-in persona; an object is one written out. */
function loadPersona(name: string, asked?: unknown): Persona {
  if (asked) return personaOf(asked as string | PersonaInput);
  try {
    return personaOf(JSON.parse(readFileSync(agendaFile(name).replace(/\.json$/, ".persona.json"), "utf8")) as PersonaInput);
  } catch {
    return personaOf(process.env.GRUNT_PERSONA);
  }
}

function loadAgenda(name: string): Agenda {
  try {
    return Agenda.from(JSON.parse(readFileSync(agendaFile(name), "utf8")));
  } catch {
    return new Agenda();
  }
}

function traceFile(name: string): { path: string; sink: (line: string) => void; flush: () => void } {
  const dir = process.env.GRUNT_TRACES ?? join(homedir(), ".pi", "agent", "grunt", "traces");
  mkdirSync(dir, { recursive: true });
  // Named for the character, the time and this process, so two characters started at once never share a file.
  const path = join(dir, `${name.replace(/[^\w-]/g, "_")}-${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}.jsonl`);
  let buf: string[] = [];
  const flush = () => {
    if (!buf.length) return;
    appendFileSync(path, buf.join("\n") + "\n");
    buf = [];
  };
  return { path, sink: (line) => void buf.push(line), flush };
}

export default function grunt(pi: PiExtensionAPI): void {
  let mind: Mind | null = null;
  let flusher: ReturnType<typeof setInterval> | null = null;
  // What the brief is written from, beyond the runtime: the goals given, the last failed call, the last line said.
  const goals: Goal[] = [];
  let lastError: Situation["lastError"];
  let lastSaid = -Infinity;
  const situation = (): Situation | null => (mind ? { rt: mind.rt, goals, lastSaid, agenda: mind.agenda, ...(lastError ? { lastError } : {}) } : null);
  const save = () => {
    if (mind) writeFileSync(agendaFile(mind.rt.name), JSON.stringify(mind.agenda.toJSON(), null, 1));
  };
  // Agenda items a task was started for, closed when the task ends done.
  const forTodo = new Map<string, string>();

  const delivery = new BriefDelivery();
  const wake = (r: Report) => {
    // A task done that was started for an agenda item: the item is done (a chore comes round again in its time); a
    // build done is a base worth remembering.
    if (r.kind === "task" && mind && typeof r.data?.task === "string") {
      const todo = forTodo.get(r.data.task);
      if (todo && r.data.status === "done") {
        try {
          mind.agenda.done(todo, Date.now(), r.text.slice(0, 160));
        } catch {
          // dropped meanwhile
        }
      }
      if (r.data.skill === "build" && r.data.status === "done") mind.agenda.remember(r.text.replace(/^build \S+ done: /, ""), ["base", "built"], Date.now());
      forTodo.delete(r.data.task);
      save();
    }
    if (!WAKES.has(r.kind)) return;
    // A reflex's end is news only when nothing it put aside comes back by itself (its danger was told already).
    if (r.kind === "task" && r.data?.by === "arbiter" && r.data?.status === "done" && r.data?.resumes) return;
    // The brief rides with the message that wakes the model, carrying only what is new to it.
    const s = situation();
    const b = s ? delivery.next(s) : { text: "", cards: [] };
    if (b.cards.length) mind?.rt.trace.record("brief", { cards: b.cards, chars: b.text.length, with: r.kind });
    pi.sendMessage({ customType: "grunt", content: `[game] ${r.text}${b.text ? `\n\n${b.text}` : ""}`, display: true, details: r }, { triggerTurn: true, deliverAs: "followUp" });
  };

  async function connect(url: string, name: string, owners: string[], persona?: unknown): Promise<Mind> {
    disconnect();
    const link = await socketLink(url);
    const session = new Session(link);
    const t = traceFile(name);
    const rt = new Runtime({ session, owners, trace: new Trace(t.sink), onReport: wake, lively: true, persona: loadPersona(name, persona), seed: Date.now() & 0xffff });
    link.onClose((why) => {
      if (mind?.rt !== rt) return;
      rt.halt();
      wake({ kind: "connection", text: `the game connection closed: ${why}`, t: rt.belief.now });
      mind = null;
    });
    await rt.connect(name);
    rt.run();
    flusher ??= setInterval(() => mind?.flush(), 1000);
    const agenda = loadAgenda(rt.name);
    agenda.standing(Date.now());
    mind = { rt, session, url, tracePath: t.path, flush: t.flush, agenda };
    save();
    // A character plays through the game tools alone: the coding tools are put away for this session.
    pi.setActiveTools(pi.getActiveTools().filter((n) => n.startsWith("game_")));
    // The conversation is told it is connected, so the model never goes looking for a game it already has.
    pi.sendMessage({ customType: "grunt", content: `[game] You are connected to ${url} as ${rt.name}, and play as ${rt.name}. game_look shows where you are and what is near; game_do starts a skill.`, display: true }, { deliverAs: "nextTurn" });
    return mind;
  }

  function disconnect(): void {
    if (!mind) return;
    save();
    mind.rt.halt();
    mind.flush();
    try {
      mind.session.close();
    } catch {
      // already closed
    }
    mind = null;
  }

  const need = (): Mind => {
    if (!mind) throw new Error("not connected to a game: game_connect first (or /grunt connect <url> <name>)");
    return mind;
  };

  const tools: PiTool[] = [
    {
      name: "game_connect", label: "Join a game",
      description: "Join a game that speaks the grunt protocol, as a character. Afterwards the character's senses, skills and chat are yours through the other game_ tools.",
      parameters: { type: "object", properties: { url: { type: "string", description: "ws://host:port/path of the game's grunt endpoint" }, name: { type: "string", description: "the character's name" }, owners: { type: "array", items: { type: "string" }, description: "players whose instructions the character follows" }, persona: { description: `who the character is when idle: ${Object.keys(PERSONAS).join(", ")}, or {name, about, traits: {playful, social, menacing, shy, energetic, showoff}} (0 to 1)` }, again: { type: "boolean", description: "drop the connection there is and connect anew" } }, required: ["url", "name"], additionalProperties: false },
      async execute(_id, p) {
        if (mind && !p.again) return text(`Already connected to ${mind.url} as ${mind.rt.name}. Nothing changed; pass again: true to reconnect.\n${json(mind.rt.summary())}`);
        const m = await connect(String(p.url), String(p.name), Array.isArray(p.owners) ? p.owners.map(String) : [], p.persona);
        return text(`Connected as ${m.rt.name}.\n${json(m.rt.summary())}`, { trace: m.tracePath });
      },
    },
    {
      name: "game_look", label: "Look",
      description: "What the character knows right now: itself (position, vitals, what it holds), its inventory and what it could craft, the things near it with distance and bearing, and what it is doing.",
      promptSnippet: "game_look: the character's state, surroundings and current task",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      async execute() {
        const rt = need().rt;
        // Looking while one of the Director's own tasks runs ends the turn: the game tells it when there is news.
        const busy = rt.current?.by === "director";
        return { ...text(json(rt.summary()) + (busy ? "\n(A task of yours is running; your turn ends here, and a message comes when it is over or needs you.)" : "")), ...(busy ? { terminate: true } : {}) };
      },
    },
    {
      name: "game_skills", label: "Skills",
      description: "The skills the character can run with game_do, with their parameters.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      async execute() {
        // The game's emotes, by what they are for, with the skills that play them.
        const emotes = mind?.rt.belief.emotes;
        const byTag: Record<string, string[]> = {};
        for (const e of emotes ?? []) for (const t of e.tags.slice(0, 2)) (byTag[t] ??= []).push(e.pair ? `${e.name} (for two)` : e.name);
        return text(json({ skills: Object.values(SKILLS).map((s) => ({ skill: s.name, does: s.describe, params: s.params })), ...(emotes?.length ? { emotes: byTag } : {}) }));
      },
    },
    {
      name: "game_do", label: "Do",
      description: `Start a skill as a task. It runs on its own, and your turn ends: a message comes when it ends, is blocked, or something needs you. Starting a skill that uses the body replaces the one using it now, so don't start one to check on another. The skills and their args:\n${SKILL_LINES}`,
      promptSnippet: "game_do: start a skill (walk_to, travel, explore, gather, harvest, build, craft, fight, loot, stash, empty, organize, migrate, follow, escort, repair, say)",
      promptGuidelines: [
        "You play a game character through game_ tools. Never try to steer it step by step: start a skill with game_do and wait to be told how it went. Don't poll with game_look or game_tasks while a task runs; the game tells you.",
        "game_look shows everything the character's senses reach, all round at once; ids in it are what skills take as targets. It never needs to turn round to find things.",
      ],
      parameters: { type: "object", properties: { skill: { type: "string", enum: Object.keys(SKILLS) }, args: { type: "object", description: "the skill's parameters (game_skills lists them)" }, resume: { type: "string", description: "a task id: take that blocked, cancelled or put-aside task up again where it was, in place of skill and args" }, replace: { type: "boolean", description: "stop the task running now for this one, even if it only just started" }, todo: { type: "string", description: "the agenda item this is for (an id): marked done when the task ends done" }, claim: { type: "string", description: "working with a tribe: the job this is, said in the tribe's chat (\"on it: clear the raptors\"); refused if another already has it" }, join: { type: "boolean", description: "help with a job another has claimed, without claiming it" } }, additionalProperties: false },
      async execute(_id, p) {
        const rt = need().rt;
        // A claim for what is already running (it was started a moment before the job was named): the claim goes on it.
        const running = rt.current;
        if (typeof p.claim === "string" && p.claim.trim() && running && running.by === "director" && !running.claim && (!p.skill || p.skill === running.skill)) {
          const taken = rt.claim(running, p.claim.trim());
          if (taken) throw new Error(`${taken.by} has "${p.claim.trim()}" (claimed ${taken.ago} s ago): take another job, or pass join: true to help with it`);
          return { ...text(`claimed "${p.claim.trim()}" for ${running.skill} ${running.id}, which is running; the tribe is told.`, { task: running.id }), terminate: true };
        }
        if (!p.resume && !p.skill) throw new Error("give a skill (with its args) or resume: a task id");
        // Two body skills started in one breath: the second would only cancel the first. Wait for the first's word.
        const cur = rt.current;
        const body = p.skill ? SKILLS[String(p.skill)]?.body : true;
        if (body && !p.replace && cur && cur.by === "director" && rt.belief.now - cur.started < 5000) {
          throw new Error(`${cur.skill} ${cur.id} was started a moment ago and is running; wait for its result, or pass replace: true to stop it for this`);
        }
        // The tribe: first who can, does. A job another has is refused, unless joining it to help.
        const job = typeof p.claim === "string" && p.claim.trim() ? p.claim.trim() : null;
        if (job && !p.join) {
          const taken = rt.claims().find((c) => c.job.toLowerCase() === job.toLowerCase());
          if (taken) throw new Error(`${taken.by} has "${taken.job}" (claimed ${Math.round((rt.belief.now - taken.t) / 1000)} s ago): take another job, or pass join: true to help with it`);
        }
        const t = p.resume ? rt.retake(String(p.resume)) : rt.start(String(p.skill), (p.args ?? {}) as Record<string, unknown>);
        if (job && !p.join && t.status === "running") rt.claim(t, job);
        if (typeof p.todo === "string" && t.status === "running") forTodo.set(t.id, p.todo);
        if (t.status !== "running") return text(`${t.skill} ${t.status}: ${t.result?.summary ?? ""}`, { task: t.id });
        return { ...text(`started ${t.skill} as ${t.id}. It runs on its own; you will get a message when it is over or something needs you.`, { task: t.id }), terminate: true };
      },
    },
    {
      name: "game_tasks", label: "Tasks",
      description: "The character's tasks: running, put aside, and the last ones finished, with progress and results.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      async execute() {
        const rt = need().rt;
        const busy = rt.current?.by === "director";
        return { ...text(json(rt.tasks.slice(-10).map((t) => ({ task: t.id, skill: t.skill, args: t.args, status: t.status, by: t.by, progress: t.progress, result: t.result?.summary })))), ...(busy ? { terminate: true } : {}) };
      },
    },
    {
      name: "game_stop", label: "Stop",
      description: "Cancel a task (the one using the body if no id is given).",
      parameters: { type: "object", properties: { task: { type: "string" } }, additionalProperties: false },
      async execute(_id, p) {
        const t = need().rt.cancel(typeof p.task === "string" ? p.task : undefined);
        return text(t ? `cancelled ${t.id} (${t.skill})` : "nothing to cancel");
      },
    },
    {
      name: "game_say", label: "Say",
      description: "Say a line in the game's chat, as the character.",
      parameters: { type: "object", properties: { text: { type: "string" }, channel: { type: "string", enum: ["local", "global", "group"], description: "local (near players hear it; the answer to speech), global, or group (the tribe)" } }, required: ["text"], additionalProperties: false },
      async execute(_id, p) {
        const rt = need().rt;
        rt.start("say", { text: String(p.text), channel: p.channel ?? "local" });
        lastSaid = rt.belief.now;
        return text(`said: ${String(p.text)}`);
      },
    },
    {
      name: "game_blueprints", label: "Blueprints",
      description: "Building: with no name, the guide to designing a base (how layouts are written, costs, what to do when a build stops) and the library of blueprints; with a name, that blueprint's layout, to build as it is or change and pass to game_do build as layout.",
      parameters: { type: "object", properties: { name: { type: "string", description: "a blueprint in the library" } }, additionalProperties: false },
      async execute(_id, p) {
        // The library, and the layouts captured from bases this session.
        const library = { ...BLUEPRINTS, ...(mind?.rt.belief.layouts ?? {}) };
        if (typeof p.name === "string") {
          const l = library[p.name];
          if (!l) throw new Error(`no blueprint ${p.name}${nearest(p.name, Object.keys(library))}; the library has ${Object.keys(library).join(", ")}`);
          const c = compile(l);
          const { name: _n, about: _a, ...shape } = l;
          return text(`${p.name}: ${l.about ?? ""}\n${Object.entries(c.counts).map(([f, n]) => `${n} ${f}`).join(", ")}\n${JSON.stringify(shape)}`);
        }
        const lib = Object.entries(library).map(([name, l]) => {
          const c = compile(l);
          const storeys = Math.max(1, ...(l.rooms ?? []).map((r) => (r.level ?? 0) + (r.height ?? 1)));
          return `- ${name} (${c.bounds[2] - c.bounds[0] + 1} by ${c.bounds[3] - c.bounds[1] + 1}${storeys > 1 ? `, ${storeys} storeys` : ""}, ${c.pieces.length} pieces): ${l.about ?? ""}`;
        });
        return text(`${BUILDER}\nThe library:\n${lib.join("\n")}`);
      },
    },
    {
      name: "game_agenda", label: "Agenda",
      description: "Your own agenda, kept between sessions: things to do by priority (1 first), chores that come round again, and notes worth remembering (where things are, who asked what). list: the agenda and the latest notes. add: a to-do (text, priority, every_s for a chore). done / drop / update: an item by id. note: remember something (text, tags). recall: notes about something (query).",
      parameters: { type: "object", properties: { op: { type: "string", enum: ["list", "add", "done", "drop", "update", "note", "recall"] }, id: { type: "string" }, text: { type: "string" }, priority: { type: "number", description: "1 (first) to 5" }, every_s: { type: "number", description: "a chore: due again this many seconds after it is done" }, note: { type: "string" }, tags: { type: "array", items: { type: "string" } }, query: { type: "string" } }, required: ["op"], additionalProperties: false },
      async execute(_id, p) {
        const a = need().agenda, now = Date.now();
        const said = (r: string) => (save(), text(r));
        switch (p.op) {
          case "add": {
            if (typeof p.text !== "string") throw new Error("add takes text");
            const t = a.add(p.text, { priority: Number(p.priority ?? 3), ...(typeof p.every_s === "number" ? { every_s: p.every_s } : {}), now });
            return said(`added ${t.id}`);
          }
          case "done":
            return said(`${a.done(String(p.id), now, typeof p.note === "string" ? p.note : undefined).id} done`);
          case "drop":
            a.get(String(p.id)).status = "dropped";
            return said(`${p.id} dropped`);
          case "update": {
            const t = a.get(String(p.id));
            if (typeof p.text === "string") t.text = p.text;
            if (typeof p.priority === "number") t.priority = Math.min(5, Math.max(1, Math.round(p.priority)));
            if (typeof p.every_s === "number") t.every_s = p.every_s;
            if (typeof p.note === "string") t.note = p.note;
            return said(`${t.id} updated`);
          }
          case "note": {
            if (typeof p.text !== "string") throw new Error("note takes text");
            return said(`noted ${a.remember(p.text, Array.isArray(p.tags) ? (p.tags as string[]) : [], now).id}`);
          }
          case "recall":
            return text(a.recall(String(p.query ?? "")).map((n) => `${n.id}: ${n.text}${n.tags.length ? ` [${n.tags.join(", ")}]` : ""}`).join("\n") || "nothing noted about that");
          default:
            return text(`${a.said(now, 12)}\n\nNotes:\n${a.notes.slice(-8).map((n) => `${n.id}: ${n.text}`).join("\n") || "none"}`);
        }
      },
    },
    {
      name: "game_goal", label: "Goal",
      description: "Mark a goal (the brief lists them, from your instructions) as met or dropped, with a short note; or add one.",
      parameters: { type: "object", properties: { goal: { type: "string", description: "a goal id from the brief" }, status: { type: "string", enum: ["done", "dropped", "active"] }, note: { type: "string" }, add: { type: "string", description: "a new goal, in place of goal" } }, additionalProperties: false },
      async execute(_id, p) {
        if (typeof p.add === "string") {
          goals.push({ id: `g${goals.length + 1}`, text: p.add, status: "active", at: mind?.rt.belief.now ?? 0 });
          return text(`added g${goals.length}`);
        }
        const g = goals.find((x) => x.id === p.goal);
        if (!g) throw new Error(`no goal ${String(p.goal)}: ${goals.map((x) => x.id).join(", ") || "none yet"}`);
        g.status = (p.status as Goal["status"]) ?? "done";
        if (typeof p.note === "string") g.note = p.note;
        return text(`${g.id} is ${g.status}`);
      },
    },
  ];
  for (const t of tools) pi.registerTool(t);

  pi.registerCommand("grunt", {
    description: "grunt: play a game as a player (status, connect <url> <name>, disconnect, brief, trace, protocol)",
    handler: async (args, ctx) => {
      const [sub = "status", ...rest] = args.trim().split(/\s+/).filter(Boolean);
      if (sub === "protocol") return ctx.ui.notify(`grunt protocol ${GRUNT_VERSION} (draft): ${SPEC}`, "info");
      if (sub === "connect") {
        const [url, name, ...more] = rest;
        if (!url || !name) return ctx.ui.notify("usage: /grunt connect <ws://…> <name> [owner…] [persona=<name>]", "warning");
        const persona = more.find((w) => w.startsWith("persona="))?.slice(8);
        const owners = more.filter((w) => !w.startsWith("persona="));
        try {
          const m = await connect(url, name, owners, persona);
          return ctx.ui.notify(`connected to ${url} as ${m.rt.name}; trace ${m.tracePath}`, "info");
        } catch (err) {
          return ctx.ui.notify(`could not connect: ${err instanceof Error ? err.message : String(err)}`, "error");
        }
      }
      if (sub === "disconnect") {
        disconnect();
        return ctx.ui.notify("disconnected", "info");
      }
      if (sub === "trace") {
        if (!mind) return ctx.ui.notify("not connected", "warning");
        const n = Number(rest[0] ?? 15);
        const lines = mind.rt.trace.records.filter((r) => r.kind !== "observation").slice(-n).map((r) => `${(r.t / 1000).toFixed(1)}s ${r.kind} ${JSON.stringify({ ...r, at: undefined, t: undefined, kind: undefined }).slice(0, 160)}`);
        return ctx.ui.notify(`${mind.tracePath}\n${lines.join("\n")}`, "info");
      }
      if (sub === "brief") {
        const s = situation();
        return ctx.ui.notify(s ? brief(s).text || "no brief now: nothing but the frame (goal, body, task) applies" : "not connected", "info");
      }
      if (sub === "status") {
        if (!mind) return ctx.ui.notify(`grunt ${GRUNT_PACKAGE_VERSION}, protocol ${GRUNT_VERSION} (draft). Not connected: /grunt connect <url> <name>.`, "info");
        const s = mind.rt.summary();
        return ctx.ui.notify(`grunt ${GRUNT_PACKAGE_VERSION}: ${mind.rt.name} on ${mind.url}, ${s.doing ? `doing ${(s.doing as { skill: string }).skill}` : "idle"}; ${json({ pos: s.pos, vitals: s.vitals })}`, "info");
      }
      ctx.ui.notify(`grunt: unknown subcommand "${sub}". Try /grunt status, connect, disconnect, trace or protocol.`, "warning");
    },
  });

  // While a character is connected the conversation is its Director, not a coding assistant.
  pi.on("before_agent_start", (event) => {
    // Every instruction given in the conversation is a goal the brief keeps in view until it is marked met.
    if (event.messageType === "user" && event.prompt && !event.prompt.startsWith("/")) {
      goals.push({ id: `g${goals.length + 1}`, text: event.prompt.slice(0, 400), status: "active", at: mind?.rt.belief.now ?? 0 });
    }
    if (!mind) return;
    event.systemPromptOptions.customPrompt = DIRECTOR;
  });

  // An idle mind with a goal still open: nothing runs, no turn is under way, and nothing will come to wake it (it chose
  // to wait, or forgot). Told so after a while, a few times at most, until it does something.
  let thinking = false, idleSince = Date.now(), nudges = 0;
  pi.on("agent_start", () => {
    thinking = true;
  });
  pi.on("agent_end", () => {
    thinking = false;
    idleSince = Date.now();
  });
  let lastDue = "";
  const idler = setInterval(() => {
    const open = goals.filter((g) => g.status === "active");
    if (!mind || thinking || mind.rt.current || Date.now() - idleSince < IDLE_MS) return;
    // Nothing asked of it: the agenda's due items, first things first, now and then while it stays idle.
    if (!open.length) {
      const due = mind.agenda.due(Date.now());
      const key = due.map((t) => t.id).join(",");
      if (!due.length || (key === lastDue && Date.now() - idleSince < AUTONOMY_MS)) return;
      lastDue = key;
      idleSince = Date.now();
      const kitShort = missing(mind.rt.belief);
      const lines = due.slice(0, 4).map((t) => `${t.id} (${t.priority}): ${t.text}${t.key === "loadout" && kitShort.length ? ` [missing: ${kitShort.join(", ")}]` : t.key === "loadout" ? " [complete: mark it done]" : ""}`);
      wake({ kind: "need", t: mind.rt.belief.now, text: `nothing is asked of you. Due on your agenda, first things first:\n${lines.join("\n")}\nStart the first that needs doing (game_do with "todo": its id, and it is marked done when the task is), or mark it done or put it off with game_agenda. Stay available: an owner's word comes first.`, data: { idle: true, due: due.map((t) => t.id) } });
      return;
    }
    if (nudges >= IDLE_NUDGES) return;
    nudges++;
    idleSince = Date.now();
    const v = mind.rt.belief.self?.vitals ?? {};
    const vitals = Object.entries(v).filter(([k]) => k === "health" || k === "stamina").map(([k, [n, max]]) => `${k} ${Math.round((n / max) * 100)}%`).join(", ");
    wake({ kind: "need", t: mind.rt.belief.now, text: `nothing is running and ${open.map((g) => `goal ${g.id} is still open`).join(", ")}; the character is idle${vitals ? ` (${vitals})` : ""}. Decide what to do now, or say with game_goal why it waits.`, data: { idle: true, nudge: nudges } });
  }, 2000);
  (idler as { unref?: () => void }).unref?.();

  pi.on("tool_result", (event) => {
    if (!event.toolName.startsWith("game_")) return;
    // Only starting something ends an idle stretch; saying why it waits does not.
    if (event.toolName === "game_do" && !event.isError) nudges = 0;
    if (event.isError) lastError = { tool: event.toolName, args: event.input, message: event.content.map((c) => c.text ?? "").join(" ").slice(0, 300) };
    else lastError = undefined;
  });

  pi.on("session_shutdown", () => {
    clearInterval(idler);
    disconnect();
    if (flusher) clearInterval(flusher);
    flusher = null;
  });
}
