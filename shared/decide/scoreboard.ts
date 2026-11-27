// What the lab says of a scorer (tools/decide/score.ts writes it, an admin's page and a weights file's `about` hold it).
// Every number is on scenes held out of training unless its name says otherwise.

export interface Reliability {
  /** The middle of a band of probabilities, how often the thing said then happened, and how many answers fell in it. */
  said: number;
  happened: number;
  answers: number;
}

export interface Score {
  /** Who was scored: "uniform", "today", "rule", or a trained scorer's name. */
  name: string;
  kind: "baseline" | "rule" | "linear" | "hidden";
  /** Decisions and scenes it was scored on. */
  decisions: number;
  scenes: number;
  /** Mean cost above the best candidate's, in ticks, and that as a share of the rule's. */
  regret: number;
  regretRatio: number;
  /** The same share on the worst family of scenes, and where the best candidate and the rule's disagree. */
  worstFamily: number;
  disagreeRatio: number;
  logLoss: number;
  brier: number;
  /** Expected calibration error, and the bands it was read from. */
  ece: number;
  reliability: Reliability[];
  /** The share by which it does worse with the state hidden, the candidates' columns hidden, and the state shuffled. */
  blind: { state: number; columns: number; shuffled: number };
  /** Microseconds for one answer, 99th percentile, on a fast core and a slow one; and its weights' size in bytes. */
  microsFast: number;
  microsSlow: number;
  bytes: number;
  /** Whether it may decide in the game, and each reason it may not. */
  gate: { pass: boolean; why: string[] };
}

export interface PointScores {
  point: string;
  profile: string;
  /** How far the best candidate beats the rule, as a share of the median cost: under 0.05 nothing is trained. */
  headroom: number;
  scores: Score[];
}

export interface Scoreboard {
  /** When it was made (ISO), and the revision of the code. */
  made: string;
  revision: string;
  points: PointScores[];
}

/** What a lab run is doing now, for a page that watches it (.cache/decide/status.json). */
export interface LabStatus {
  step: "generate" | "label" | "fit" | "score" | "idle";
  point: string;
  done: number;
  of: number;
  at: string;
}
