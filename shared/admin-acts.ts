// What a world's admin pages ask of who is signed in and of what admins did (shared/acts.ts), and how the answers come.
import type { Act } from "./acts.ts";

/** GET <world>/admin/me.json: the viewer, their rank (shared/ranks.ts), and the cluster's world id, 0 outside a cluster. */
export interface AdminMe {
  name: string;
  /** The survivor's 17-digit ID, or "" for a shared password. */
  id: string;
  rank: number;
  world: number;
}

/**
 * GET <world>/admin/acts.json?after=<seq>: the kept acts above `after`, oldest first, at most ACTS_PAGE of them. With
 * &open=1 the open commands come too, in the same order of sequence numbers.
 */
export interface ActsAnswer {
  acts: Act[];
}

/** The most acts one answer holds: an answer with fewer is the last there is for now. */
export const ACTS_PAGE = 200;
/** The latest acts a world keeps to answer with. */
export const ACTS_KEPT = 2000;
