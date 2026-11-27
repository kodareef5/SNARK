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
  /** The share's 95% interval, by bootstrap over scenes. */
  interval: [number, number];
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
  /** The same as medians. */
  medianFast: number;
  medianSlow: number;
  bytes: number;
  /** Whether it may decide in the game, and each reason it may not. */
  gate: { pass: boolean; why: string[] };
}

/** Whole episodes on held-out scenes, one policy deciding from start to finish. */
export interface EpisodeScore {
  /** "today", "rule", or a trained scorer's name. */
  name: string;
  scenes: number;
  /** Episodes that reached the goal inside the horizon. */
  arrived: number;
  /** Means over the episodes: ticks (to arrival, or the horizon), the share of health lost, ticks stuck or pinned, path searches and the cells they expanded, and the cost (setups.ts). */
  ticks: number;
  healthLost: number;
  stuckTicks: number;
  searches: number;
  cells: number;
  cost: number;
  /** The 99th percentile of the tick's `decide` part, in microseconds. */
  decideMicros: number;
  /** By family of scene: episodes, those that arrived, and mean ticks. */
  families?: Record<string, { scenes: number; arrived: number; ticks: number }>;
  /**
   * Each layout, those with no way to their goal too (not played, so not in the counts above): the metres of the way
   * (NaN for none), whether it arrived, its ticks and health lost, and how many of the decider's answers were acted on.
   */
  layouts?: { family: string; seed: number; route: number; arrived: boolean; ticks: number; healthLost: number; acted: number }[];
}

export interface PointScores {
  point: string;
  profile: string;
  /** The headline: each policy over whole episodes on unseen layouts. A scorer that wins single decisions and loses these fails. */
  episodes: EpisodeScore[];
  /** The same policies on fresh scenes of every family, held out or not, for a look at each family. */
  fresh?: EpisodeScore[];
  /** Stored decisions made again from their passes with `combine`, and those that gave the pick stored; under the rule alone too. */
  agreement?: { checked: number; agreed: number; ruleChecked: number; ruleAgreed: number };
  /** How far the best candidate beats the rule at one decision, as a share of the median cost. Gains compound over an episode, so a small one is no reason not to train. */
  headroom: number;
  scores: Score[];
}

export interface Scoreboard {
  /** When it was made (ISO), and the revision of the code. */
  made: string;
  revision: string;
  /** What a reader must know of where the numbers came from. */
  notes?: string[];
  points: PointScores[];
}

/** What a lab run is doing now, for a page that watches it (.cache/decide/status.json). */
export interface LabStatus {
  step: "generate" | "label" | "fit" | "score" | "episodes" | "idle";
  point: string;
  done: number;
  of: number;
  at: string;
}
