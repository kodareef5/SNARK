// An RGBA8 texture array on a unit that the card draws as core's orders say (client/core/texgen/engine.ts).
import { DRAW_INTS, type Orders } from "../core/texgen/engine.ts";

export type Made = ReturnType<typeof made>;

export function made(gl: WebGL2RenderingContext, unit: number) {
  const A = gl.TEXTURE_2D_ARRAY, fbo = gl.createFramebuffer(), vao = gl.createVertexArray();
  let texture: WebGLTexture | null = null, side = 0;
  return {
    vao,
    get texture(): WebGLTexture | null {
      return texture;
    },
    /** Carries out `o`, each draw with the program `program` gives for its job, or none while one links; true where it drew. */
    draw(o: Orders, program: (job: number) => WebGLProgram | null, anisotropy: (target: number) => void): boolean {
      gl.activeTexture(gl.TEXTURE0 + unit);
      if (o.side !== side) {
        gl.deleteTexture(texture);
        gl.bindTexture(A, (texture = (side = o.side) ? gl.createTexture() : null));
        if (texture) {
          gl.texStorage3D(A, 32 - Math.clz32(side), gl.RGBA8, side, side, o.layers);
          gl.texParameteri(A, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
          anisotropy(A);
        }
        return !(o.fresh = true);
      }
      if (!texture) return false;
      gl.bindTexture(A, texture);
      let k = 0;
      if (o.count > 0) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.bindVertexArray(vao);
        o.begin();
        for (let d = 0, prog: WebGLProgram | null; k < o.count && (prog = program(o.draws[(d = k * DRAW_INTS)]!)); k++) {
          gl.useProgram(prog);
          gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, texture, o.draws[d + 2]!, o.draws[d + 1]!);
          gl.viewport(0, o.draws[d + 3]!, side >> o.draws[d + 2]!, o.draws[d + 4]!);
          gl.uniform4fv(gl.getUniformLocation(prog, "uJob"), o.uniforms, o.draws[d + 5]!, o.draws[d + 6]!);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
        }
        o.end(k);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      }
      if (k === o.count && o.base >= 0) gl.texParameteri(A, gl.TEXTURE_BASE_LEVEL, o.base);
      if (k === o.count && o.mipmap) gl.generateMipmap(A);
      gl.texParameterf(A, gl.TEXTURE_MIN_LOD, o.minLod);
      return o.count > 0;
    },
  };
}
