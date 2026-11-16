// Whether this device's compared lookups filter, which the shadow lookup (shadowtext.ts) takes as given or does for
// itself. The game asks its own context at start and after a lost context, as the device probe asks (D271): a 16-bit
// depth array of 4 by 4, its left half drawn at 0.25 and its right left at 0.75, read compared with 0.5 halfway between
// a texel of each half and a quarter of the way. It is one draw, one lookup and four pixels read back, in targets of its
// own, and the context is left as it was found.

import { FULL_SCREEN, GL, compareKind, compile, framebuffer, saveState, texture2d, type Gl2 } from "../probegl.ts";

const WRITE = [`#version 300 es
${FULL_SCREEN}
void main() { gl_Position = vec4(corner(), -0.5, 1.0); }`, `#version 300 es
precision highp float;
void main() { if (gl_FragCoord.x > 2.0) discard; }`] as const;

const READ = [`#version 300 es
${FULL_SCREEN}
void main() { gl_Position = vec4(corner(), 0.0, 1.0); }`, `#version 300 es
precision highp float;
precision highp sampler2DArrayShadow;
uniform sampler2DArrayShadow uMap;
out vec4 o;
void main() {
  float x = gl_FragCoord.x < 1.0 ? 0.5 : gl_FragCoord.x < 2.0 ? 0.4375 : gl_FragCoord.x < 3.0 ? 0.125 : 0.875;
  o = vec4(texture(uMap, vec4(x, 0.5, 0.0, 0.5)), 0.0, 0.0, 1.0);
}`] as const;

/** "filtered", "hard", or why neither: what a compared lookup in a 16-bit depth array gives on this device. */
export function comparedLookup(gl: Gl2): string {
  const restore = saveState(gl);
  const map = gl.createTexture(), out = gl.createTexture(), vao = gl.createVertexArray();
  const made: { obj: unknown; kind: "framebuffer" | "program" }[] = [];
  try {
    gl.activeTexture(GL.TEXTURE0 + 9);
    gl.bindTexture(GL.TEXTURE_2D_ARRAY, map);
    gl.texStorage3D(GL.TEXTURE_2D_ARRAY, 1, GL.DEPTH_COMPONENT16, 4, 4, 1);
    const params = [GL.TEXTURE_MIN_FILTER, GL.LINEAR, GL.TEXTURE_MAG_FILTER, GL.LINEAR, GL.TEXTURE_WRAP_S, GL.CLAMP_TO_EDGE, GL.TEXTURE_WRAP_T, GL.CLAMP_TO_EDGE, GL.TEXTURE_COMPARE_MODE, GL.COMPARE_REF_TO_TEXTURE, GL.TEXTURE_COMPARE_FUNC, GL.LEQUAL];
    for (let k = 0; k < params.length; k += 2) gl.texParameteri(GL.TEXTURE_2D_ARRAY, params[k]!, params[k + 1]!);
    gl.activeTexture(GL.TEXTURE0 + 10);
    texture2d(gl, GL.RGBA8, 4, 1, GL.NEAREST, 1, () => out);
    const keep = <T>(obj: T, kind: "framebuffer" | "program"): T => (made.push({ obj, kind }), obj);
    const depth = keep(framebuffer(gl, (f) => gl.framebufferTextureLayer(f, GL.DEPTH_ATTACHMENT, map, 0, 0), "a 16-bit depth array"), "framebuffer");
    const target = keep(framebuffer(gl, (f) => gl.framebufferTexture2D(f, GL.COLOR_ATTACHMENT0, GL.TEXTURE_2D, out, 0), "a 4x1 RGBA8 texture"), "framebuffer");
    const write = keep(compile(gl, ...WRITE), "program"), read = keep(compile(gl, ...READ), "program");
    gl.bindVertexArray(vao);
    gl.bindFramebuffer(GL.FRAMEBUFFER, depth);
    gl.viewport(0, 0, 4, 4);
    for (const cap of [GL.SCISSOR_TEST, GL.BLEND, GL.CULL_FACE, GL.POLYGON_OFFSET_FILL]) gl.disable(cap);
    gl.enable(GL.DEPTH_TEST);
    gl.depthFunc(GL.LESS);
    gl.depthMask(true);
    gl.depthRange(0, 1);
    gl.clearDepth(0.75);
    gl.clear(GL.DEPTH_BUFFER_BIT);
    gl.useProgram(write);
    gl.drawArrays(GL.TRIANGLES, 0, 3);
    gl.bindFramebuffer(GL.FRAMEBUFFER, target);
    gl.viewport(0, 0, 4, 1);
    gl.disable(GL.DEPTH_TEST);
    gl.colorMask(true, true, true, true);
    gl.useProgram(read);
    gl.uniform1i(gl.getUniformLocation(read, "uMap"), 9);
    gl.drawArrays(GL.TRIANGLES, 0, 3);
    const px = new Uint8Array(16);
    gl.readPixels(0, 0, 4, 1, GL.RGBA, GL.UNSIGNED_BYTE, px);
    // The texel centres either side read 0 and 255 whatever the filter: if not, the map did not render.
    if (px[8]! > 2 || px[12]! < 253) return `did not render (read ${px[8]} and ${px[12]} at texel centres)`;
    return compareKind(px[0]!, px[4]!);
  } catch (e) {
    return `failed: ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    restore();
    for (const { obj, kind } of made) {
      if (kind === "framebuffer") gl.deleteFramebuffer(obj);
      else gl.deleteProgram(obj);
    }
    gl.deleteTexture(map);
    gl.deleteTexture(out);
    gl.deleteVertexArray(vao);
  }
}
