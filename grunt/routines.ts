// Routines: little choreographies of emotes, looks, steps and words, as data. The idle (grunt/idle.ts) plays one now and
// then as a persona would; the Director plays any by name (game_do perform). A step names an emote by name or by tag
// (the first the game has of it), so a routine works in any game that has something of the kind.

export type Step =
  /** An emote: by name, or the game's first with this tag; a loop for `seconds`. */
  | { emote: string; seconds?: number }
  /** Turn to face the one the routine is for (the target), or a bearing off it. */
  | { look: "target" | "away" | "about" }
  /** Walk toward the target until `to` metres off, slowly (a stalk) or not. */
  | { approach: number; slow?: boolean }
  /** Back off from the target to `to` metres. */
  | { retreat: number }
  | { crouch: boolean }
  | { say: string }
  | { wait: number };

export interface Routine {
  name: string;
  about: string;
  /** Who it is for: someone (a target), or nobody. */
  needs: "target" | "none";
  tags: string[];
  steps: Step[];
}

export const ROUTINES: Routine[] = [
  {
    name: "spooky_stalk", about: "crouch, creep up on someone, stare, roar, then laugh", needs: "target", tags: ["scary"],
    steps: [{ look: "target" }, { crouch: true }, { approach: 7, slow: true }, { crouch: false }, { emote: "stare", seconds: 3 }, { emote: "roar" }, { emote: "laugh" }],
  },
  {
    name: "greeting", about: "turn, wave, walk up, offer a handshake", needs: "target", tags: ["friendly", "greeting"],
    steps: [{ look: "target" }, { emote: "wave" }, { approach: 2.5 }, { emote: "handshake" }],
  },
  {
    name: "showoff_set", about: "three dances back to back, a flex to finish", needs: "none", tags: ["fun", "showoff"],
    steps: [{ emote: "robot", seconds: 4 }, { emote: "running_man", seconds: 4 }, { emote: "disco", seconds: 4 }, { emote: "flex" }],
  },
  {
    name: "victory_lap", about: "a fist pump, a jump and a little dance", needs: "none", tags: ["victory"],
    steps: [{ emote: "fist_pump" }, { emote: "victory_jump" }, { emote: "side_shuffle", seconds: 3 }],
  },
  {
    name: "wait_bored", about: "check the time, sigh into a stretch, sit down", needs: "none", tags: ["idle", "rest"],
    steps: [{ emote: "check_wrist" }, { emote: "yawn" }, { emote: "stretch" }, { emote: "sit", seconds: 20 }],
  },
  {
    name: "workout", about: "jumping jacks, push-ups, a flex", needs: "none", tags: ["exercise", "showoff"],
    steps: [{ emote: "jumping_jacks", seconds: 6 }, { emote: "pushups", seconds: 6 }, { emote: "flex" }],
  },
  {
    name: "zombie_walk", about: "a zombie's sway toward someone, a scratch, then a laugh", needs: "target", tags: ["scary", "silly"],
    steps: [{ look: "target" }, { emote: "zombie", seconds: 3 }, { approach: 5, slow: true }, { emote: "claw" }, { emote: "laugh" }],
  },
  {
    name: "cold_shoulder", about: "cross arms, look away, shake the head", needs: "target", tags: ["rude", "grumpy"],
    steps: [{ look: "target" }, { emote: "cross_arms", seconds: 3 }, { look: "away" }, { emote: "head_shake" }],
  },
  {
    name: "shy_retreat", about: "a small nod, back away, cower if they come on", needs: "target", tags: ["shy"],
    steps: [{ look: "target" }, { emote: "nod" }, { retreat: 8 }, { emote: "cower", seconds: 3 }],
  },
  {
    name: "campfire", about: "sit cross-legged facing the target (a fire, a friend), and talk", needs: "target", tags: ["rest", "social"],
    steps: [{ look: "target" }, { emote: "sit_cross", seconds: 30 }],
  },
];

export const ROUTINE: ReadonlyMap<string, Routine> = new Map(ROUTINES.map((r) => [r.name, r]));
