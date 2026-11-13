// Shading constants shared by every renderer, so the WebGL2 shell and the
// software rasterizer draw the same picture.
//
// The look is the graybox one: flat-shaded faces, palette colours, and a
// world-space checker (1 m squares inside 8 m squares) that gives scale and
// makes motion readable on otherwise plain surfaces.

export const AMBIENT = 0.55;
export const DIFFUSE = 0.45;
/** Brightness of the darker 1 m squares. */
export const CHECK_FINE = 0.88;
/** Brightness of the darker 8 m squares. */
export const CHECK_COARSE = 0.93;
export const CHECK_COARSE_SIZE = 8;
/** The checker is sampled this far behind the surface so faces on whole-metre planes do not flicker. */
export const CHECK_INSET = 0.01;
/** Distances over which the 1 m and 8 m checkers fade out, so far ground does not shimmer. */
export const CHECK_FINE_FADE = 90;
export const CHECK_COARSE_FADE = 900;
