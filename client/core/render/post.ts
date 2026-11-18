// What a frame's finishing pass is told. On a tier with a light target (Tier.post) the scene is drawn as light, exposed
// but not toned, into a multisampled float target of the shell's, which is resolved and finished in one pass: bloom,
// the tone curve, the grade, a slight sharpen and dither. Any other tier, or a device with no such target, draws as
// medium always has, each shader toning its own light onto the canvas.

/**
 * The light target's formats, best first: RGBA16F, then R11F_G11F_B10F, each where EXT_color_buffer_float makes it
 * drawable and the device can multisample it. A device with neither draws as medium does.
 */
export const LIGHT_FORMATS: readonly number[] = [0x881a, 0x8c3a];
/** The samples the light target is drawn with, as the canvas's own antialiasing is, or as many as the device has under that. */
export const LIGHT_SAMPLES = 4;
