// The textures the card makes (engine.ts), as a file of their own that the page fetches while the world loads: the
// engine and the jobs it runs, the walls' weathering first. Tests and tools import it up front.
import type { QueryGl } from "../passes.ts";
import { Texgen } from "./engine.ts";
import { weatherJobs } from "./weather.ts";

export const texgen = (gl: QueryGl): Texgen => new Texgen(weatherJobs(), gl);
