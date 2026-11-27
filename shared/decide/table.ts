// A question as a table: a few numbers of state, then K candidates of the same width, with a bias and a mask for each.
// Its answer is a probability for each candidate. A table is made once and refilled. Nothing here knows what a column
// means: a profile (profile.ts) names them.

export class Table {
  /** Candidates filled, of `most`. */
  k = 0;
  readonly most: number;
  readonly stateWidth: number;
  readonly width: number;
  readonly state: Float32Array;
  /** Candidate `i` is the `width` numbers from `i * width`. */
  readonly rows: Float32Array;
  /** Added to a candidate's score after the scorer: what its author wants of it, whatever the weights say. */
  readonly bias: Float32Array;
  /** 1 where a candidate may not be chosen. */
  readonly mask: Uint8Array;
  /** Each candidate's score, before the bias. */
  readonly score: Float32Array;
  /** Each candidate's probability. */
  readonly out: Float32Array;

  constructor(most: number, stateWidth: number, width: number) {
    this.most = most;
    this.stateWidth = stateWidth;
    this.width = width;
    this.state = new Float32Array(stateWidth);
    this.rows = new Float32Array(most * width);
    this.bias = new Float32Array(most);
    this.mask = new Uint8Array(most);
    this.score = new Float32Array(most);
    this.out = new Float32Array(most);
  }

  /** Empties it for a question of `k` candidates. */
  clear(k: number): void {
    if (k > this.most) throw new Error(`a table of ${this.most} candidates was asked to hold ${k}`);
    this.k = k;
    this.state.fill(0);
    this.rows.fill(0, 0, k * this.width);
    this.bias.fill(0, 0, k);
    this.mask.fill(0, 0, k);
    this.score.fill(0, 0, k);
    this.out.fill(0, 0, k);
  }
}

/** A table sized for a profile, holding at most `most` candidates. */
export function tableFor(p: { state: readonly string[]; columns: readonly string[] }, most: number): Table {
  return new Table(most, p.state.length, p.columns.length);
}
