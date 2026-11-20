// The character's own agenda: what it means to do (from its owners, or its own idea), in order of priority, the
// chores that come round again (looking after the base, keeping a loadout, scouting), and notes of what is worth
// remembering (where things are, who asked what, what was learned). It outlives a session: the extension keeps it in a
// file per character. Times are wall-clock milliseconds, since a game's clock starts again with each session.

export interface Todo {
  id: string;
  text: string;
  /** 1 (first) to 5 (when there is nothing else). */
  priority: number;
  status: "open" | "done" | "dropped";
  /** A chore: due again this many seconds after it was last done. */
  every_s?: number;
  last?: number;
  note?: string;
  /** Whose idea: an owner's, the character's own, or a standing order (the defaults every character has). */
  from: "owner" | "self" | "standing";
  key?: string;
  at: number;
}

export interface Note {
  id: string;
  text: string;
  tags: string[];
  at: number;
}

/** What every character does when nobody needs anything of it, in order: a loadout to work with, the base kept up, a
 * little progress, the land about known. Staying available (near an owner, answering) is above all of them, always. */
export const STANDING: Omit<Todo, "id" | "status" | "at" | "from">[] = [
  { key: "loadout", text: "keep a basic loadout: a pick, a hatchet, a bow and 20 arrows (game_do kit makes what is missing)", priority: 2, every_s: 900 },
  { key: "upkeep", text: "look after the base (game_do upkeep: repairs damage, empties the harvesters into the stores, stashes a heavy bag)", priority: 2, every_s: 600 },
  { key: "progress", text: "make progress: gather toward the next thing worth building or crafting, and build it", priority: 3, every_s: 1200 },
  { key: "scout", text: "scout the land about the base and note what is where (game_agenda note)", priority: 4, every_s: 1800 },
];

const STOP = new Set(["the", "and", "for", "where", "what", "who", "which", "with", "that", "this", "there", "are", "was", "about", "from", "have", "has", "our", "its"]);

export class Agenda {
  todos: Todo[] = [];
  notes: Note[] = [];
  private n = 0;

  static from(json: unknown): Agenda {
    const a = new Agenda();
    const j = (json ?? {}) as { todos?: Todo[]; notes?: Note[]; n?: number };
    a.todos = Array.isArray(j.todos) ? j.todos : [];
    a.notes = Array.isArray(j.notes) ? j.notes : [];
    a.n = typeof j.n === "number" ? j.n : a.todos.length + a.notes.length;
    return a;
  }

  toJSON(): object {
    return { todos: this.todos, notes: this.notes, n: this.n };
  }

  /** The standing orders, if the agenda has none yet. */
  standing(now: number): void {
    for (const s of STANDING) {
      const had = this.todos.find((t) => t.key === s.key);
      // Kept from an earlier session: its wording and timing as the standing orders say now, its history as it was.
      if (had) Object.assign(had, { text: s.text, every_s: s.every_s });
      else this.todos.push({ ...s, id: `t${++this.n}`, status: "open", from: "standing", at: now, last: 0 });
    }
  }

  add(text: string, o: { priority?: number; every_s?: number; from?: Todo["from"]; now: number }): Todo {
    const t: Todo = { id: `t${++this.n}`, text, priority: Math.min(5, Math.max(1, Math.round(o.priority ?? 3))), status: "open", from: o.from ?? "self", at: o.now, ...(o.every_s ? { every_s: o.every_s, last: 0 } : {}) };
    this.todos.push(t);
    return t;
  }

  get(id: string): Todo {
    const t = this.todos.find((x) => x.id === id);
    if (!t) throw new Error(`no ${id} on the agenda: ${this.todos.filter((x) => x.status === "open").map((x) => x.id).join(", ") || "it is empty"}`);
    return t;
  }

  /** Done: a chore comes round again in its time; anything else is closed. */
  done(id: string, now: number, note?: string): Todo {
    const t = this.get(id);
    if (t.every_s) t.last = now;
    else t.status = "done";
    if (note) t.note = note;
    return t;
  }

  /** What is due now, first things first: open items, and chores whose time has come round. */
  due(now: number): Todo[] {
    return this.todos
      .filter((t) => t.status === "open" && (!t.every_s || now - (t.last ?? 0) >= t.every_s * 1000))
      .sort((a, b) => a.priority - b.priority || (a.last ?? a.at) - (b.last ?? b.at));
  }

  remember(text: string, tags: string[], now: number): Note {
    const n: Note = { id: `n${++this.n}`, text, tags, at: now };
    this.notes.push(n);
    if (this.notes.length > 300) this.notes.shift();
    return n;
  }

  /** Notes about something: the words of the query in their text or tags, the most matching and latest first. */
  recall(query: string, max = 8): Note[] {
    const words = query.toLowerCase().split(/\W+/).filter((w) => w.length > 2 && !STOP.has(w));
    const score = (n: Note) => words.filter((w) => n.text.toLowerCase().includes(w) || n.tags.some((t) => t.toLowerCase().includes(w))).length;
    return this.notes.map((n) => ({ n, s: score(n) })).filter((x) => x.s > 0 || !words.length).sort((a, b) => b.s - a.s || b.n.at - a.n.at).slice(0, max).map((x) => x.n);
  }

  /** The agenda as the Director reads it. */
  said(now: number, max = 8): string {
    const due = new Set(this.due(now).map((t) => t.id));
    const open = this.todos.filter((t) => t.status === "open").sort((a, b) => Number(due.has(b.id)) - Number(due.has(a.id)) || a.priority - b.priority);
    const line = (t: Todo) => `${t.id} (${t.priority}${t.every_s ? `, every ${Math.round(t.every_s / 60)} min` : ""}${due.has(t.id) ? ", due" : ""}): ${t.text}${t.note ? ` [${t.note}]` : ""}`;
    return open.slice(0, max).map(line).join("\n") || "nothing";
  }
}
