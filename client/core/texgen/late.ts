// The textures the card makes (engine.ts), as a file of their own that the page fetches while the world loads: the
// engine and the jobs it runs, the walls' weathering and then the materials' slots. Tests and tools import it up front.
import type { QueryGl } from "../passes.ts";
import { Texgen, type Job } from "./engine.ts";
import { materialJob } from "./materials.ts";
import { weatherJobs } from "./weather.ts";

/** The jobs, in the order their layers lie in the array (layers.ts). */
export const texgenJobs = (): Job[] => [...weatherJobs(), materialJob()];
export const texgen = (gl: QueryGl): Texgen => new Texgen(texgenJobs(), gl);
