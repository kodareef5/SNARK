// Shared by every renderer, so the WebGL2 shell and the software rasterizer draw the same picture. The world-space
// checker is 1 m squares inside 8 m squares. It gives scale and makes motion readable on plain surfaces.

export const AMBIENT = 0.55;
export const DIFFUSE = 0.45;
/** Brightness of the darker 1 m and 8 m squares. */
export const CHECK_FINE = 0.88;
export const CHECK_COARSE = 0.93;
export const CHECK_COARSE_SIZE = 8;
/** The checker is sampled this far behind the surface so faces on whole-metre planes do not flicker. */
export const CHECK_INSET = 0.01;
/** Distances over which the 1 m and 8 m checkers fade out, so far ground does not shimmer. */
export const CHECK_FINE_FADE = 90;
export const CHECK_COARSE_FADE = 900;

export const WATER_ALPHA = 0.62;
/** Side of one water surface tile, metres. The mesh "core:water" is one tile. */
export const WATER_TILE = 1024;
/** Metres of view under water, and the brightness of the depths as a share of the surface colour. */
export const UNDERWATER_VIEW = 45;
export const UNDERWATER_DIM = 0.55;
/** Night brightness as a share of daylight. */
export const NIGHT_LIGHT = 0.3;
