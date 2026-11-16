// A model-only WebGL shell. Geometry, palette and pose sampling come from the native game format.
import { Camera } from "../core/render/camera.ts";
import { MODEL_STRIDE, modelDistance, modelMesh, type ModelPose } from "../core/pages/model.ts";
import { MATERIAL_CUTOUT, MATERIAL_TWO_SIDED, type Pack } from "../../shared/pack/pack.ts";
import type { ModelBounds, ModelDocument } from "../../shared/pages/model.ts";

const VERTEX = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPosition;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec2 aUv;
layout(location=3) in vec3 aColor;
layout(location=4) in vec4 aJoints;
layout(location=5) in vec4 aWeights;
layout(location=6) in vec4 aTangent;
uniform mat4 uView;
uniform vec3 uCamera;
uniform bool uSkinned;
uniform vec4 uRot[64];
uniform vec3 uJoint[64];
uniform vec3 uRest[64];
out vec3 vPosition;
out vec3 vNormal;
out vec4 vTangent;
out vec3 vColor;
out vec2 vUv;
vec3 rotate(vec4 q,vec3 v){return v+2.0*cross(q.xyz,cross(q.xyz,v)+q.w*v);}
void main(){
 vec3 p=aPosition,n=aNormal,t=aTangent.xyz;
 if(uSkinned){p=vec3(0);n=vec3(0);t=vec3(0);for(int k=0;k<4;k++){int b=int(aJoints[k]);float w=aWeights[k];p+=(rotate(uRot[b],aPosition-uRest[b])+uJoint[b])*w;n+=rotate(uRot[b],aNormal)*w;t+=rotate(uRot[b],aTangent.xyz)*w;}}
 vPosition=p;vNormal=n;vTangent=vec4(t,aTangent.w);vColor=aColor;vUv=aUv;
 gl_Position=uView*vec4(p-uCamera,1.0);
}`;
const FRAGMENT = `#version 300 es
precision highp float;
in vec3 vPosition;in vec3 vNormal;in vec4 vTangent;in vec3 vColor;in vec2 vUv;
uniform vec3 uCamera;uniform vec3 uLight;
uniform sampler2D uBase;uniform sampler2D uNormal;uniform sampler2D uMro;uniform sampler2D uMask;uniform sampler2D uMask2;
uniform bool uTextured;uniform bool uHasBase;uniform bool uHasNormal;uniform bool uHasMro;uniform bool uHasMask;uniform bool uHasMask2;uniform bool uCutout;
uniform vec3 uTint;uniform vec3 uColors[6];uniform float uGrey;uniform float uCutoff;
out vec4 color;
vec3 linear(vec3 c){return mix(c/12.92,pow((c+0.055)/1.055,vec3(2.4)),step(vec3(0.04045),c));}
void main(){
 vec3 n=length(vNormal)>0.1?normalize(vNormal):normalize(cross(dFdx(vPosition),dFdy(vPosition)));
 if(!gl_FrontFacing)n=-n;
 vec3 base=linear(vColor);float roughness=0.85;float metal=0.0;float ao=1.0;
 if(uTextured){
  vec4 tex=uHasBase?texture(uBase,vUv):vec4(1);
  if(uCutout&&tex.a<uCutoff)discard;
  base=linear(tex.rgb)*uTint;
  vec3 w=uHasMask?texture(uMask,vUv).rgb:vec3(0),w2=uHasMask2?texture(uMask2,vUv).rgb:vec3(0);
  float total=dot(w+w2,vec3(1));
  vec3 dye=(uColors[0]*w.r+uColors[1]*w.g+uColors[2]*w.b+uColors[3]*w2.r+uColors[4]*w2.g+uColors[5]*w2.b)/max(uGrey,0.01);
  base*=vec3(max(0.0,1.0-total))+dye;
  if(uHasMro){vec3 m=texture(uMro,vUv).rgb;ao=m.r;roughness=m.g;metal=m.b;}
  if(uHasNormal&&length(vTangent.xyz)>0.1){vec3 t=normalize(vTangent.xyz-n*dot(vTangent.xyz,n)),b=cross(n,t)*vTangent.w;vec3 mapped=texture(uNormal,vUv).xyz*2.0-1.0;n=normalize(mat3(t,b,n)*mapped);}
 }
 vec3 view=normalize(uCamera-vPosition),halfway=normalize(view+uLight);
 float key=max(dot(n,uLight),0.0),rim=pow(1.0-max(dot(n,view),0.0),3.0);
 float exponent=mix(100.0,7.0,roughness);float spec=pow(max(dot(n,halfway),0.0),exponent)*(1.0-roughness*0.7);
 vec3 ambient=mix(vec3(0.16,0.19,0.22),vec3(0.45,0.50,0.55),n.y*0.5+0.5);
 vec3 light=base*(ambient*ao+key*vec3(0.94,0.90,0.82))*(1.0-metal*0.25)+mix(vec3(0.07),base,metal)*spec+base*rim*0.12;
 light=light/(light+vec3(0.45));
 color=vec4(pow(max(light,vec3(0)),vec3(1.0/2.2)),1);
}`;
interface Draw { vao: WebGLVertexArrayObject; vertex: WebGLBuffer; index: WebGLBuffer; sections: number[]; skinned: boolean }
export class ModelGl {
  readonly camera = new Camera();
  readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly loc = new Map<string, WebGLUniformLocation | null>();
  private readonly draws: Draw[] = [];
  private readonly textures = new Map<number, WebGLTexture>();
  private readonly blank: WebGLTexture;
  private dead = false;
  readonly canvas: HTMLCanvasElement;
  readonly pack: Pack;
  readonly doc: ModelDocument;
  constructor(canvas: HTMLCanvasElement, pack: Pack, doc: ModelDocument) {
    this.canvas = canvas; this.pack = pack; this.doc = doc;
    const gl = canvas.getContext("webgl2", { alpha: true, antialias: true, powerPreference: "low-power", preserveDrawingBuffer: false });
    if (!gl) throw new Error("3D preview needs WebGL 2. The image gallery is still available.");
    this.gl = gl;
    const shader = (kind: number, source: string) => { const s = gl.createShader(kind)!; gl.shaderSource(s, source); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { const text = gl.getShaderInfoLog(s); gl.deleteShader(s); throw new Error(text ?? "Model shader failed"); } return s; };
    const vertex = shader(gl.VERTEX_SHADER, VERTEX), fragment = shader(gl.FRAGMENT_SHADER, FRAGMENT);
    this.program = gl.createProgram()!; gl.attachShader(this.program, vertex); gl.attachShader(this.program, fragment); gl.linkProgram(this.program); gl.deleteShader(vertex); gl.deleteShader(fragment);
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(this.program) ?? "Model renderer failed");
    gl.useProgram(this.program);
    this.blank = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, this.blank); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    for (const mesh of pack.header.meshes) {
      const m = modelMesh(pack, mesh, doc.colors), vao = gl.createVertexArray()!, vertex = gl.createBuffer()!, index = gl.createBuffer()!;
      gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, vertex); gl.bufferData(gl.ARRAY_BUFFER, m.vertices, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.indices, gl.STATIC_DRAW);
      for (const [a, size, offset] of [[0, 3, 0], [1, 3, 3], [2, 2, 6], [3, 3, 8], [4, 4, 11], [5, 4, 15], [6, 4, 19]]) { gl.enableVertexAttribArray(a!); gl.vertexAttribPointer(a!, size!, gl.FLOAT, false, MODEL_STRIDE * 4, offset! * 4); }
      this.draws.push({ vao, vertex, index, sections: m.sections, skinned: m.skinned });
    }
    const colors = doc.colors.flatMap((ink) => [0, 1, 2].map((k) => { const c = pack.palette[ink * 4 + k]! / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }));
    gl.uniform3fv(this.uniform("uColors[0]"), colors);
    ["Base", "Normal", "Mro", "Mask", "Mask2"].forEach((name, k) => gl.uniform1i(this.uniform(`u${name}`), k));
    gl.enable(gl.DEPTH_TEST); gl.clearColor(0, 0, 0, 0);
  }
  private uniform(name: string): WebGLUniformLocation | null {
    if (!this.loc.has(name)) this.loc.set(name, this.gl.getUniformLocation(this.program, name));
    return this.loc.get(name)!;
  }
  texture(slot: number, bitmap: ImageBitmap): void {
    if (this.dead) { bitmap.close(); return; }
    const gl = this.gl, texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
    gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    this.textures.set(slot, texture); bitmap.close();
  }
  draw(pose: ModelPose, bounds: ModelBounds, yaw: number, pitch: number, zoom: number): void {
    if (this.dead) return;
    const gl = this.gl, c = this.camera, width = Math.max(1, Math.round(this.canvas.clientWidth * Math.min(devicePixelRatio, 1.5))), height = Math.max(1, Math.round(this.canvas.clientHeight * Math.min(devicePixelRatio, 1.5)));
    if (this.canvas.width !== width || this.canvas.height !== height) { this.canvas.width = width; this.canvas.height = height; }
    gl.viewport(0, 0, width, height); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); gl.useProgram(this.program);
    c.aspect = width / height; c.fovY = 0.72;
    const distance = modelDistance(bounds, yaw, pitch, c.aspect, c.fovY) * zoom;
    c.x = bounds.center[0] + Math.sin(yaw) * Math.cos(pitch) * distance; c.y = bounds.center[1] + Math.sin(pitch) * distance; c.z = bounds.center[2] + Math.cos(yaw) * Math.cos(pitch) * distance;
    c.yaw = yaw + Math.PI; c.pitch = -pitch; c.near = Math.max(0.005, distance - bounds.radius * 2); c.far = distance + bounds.radius * 3; c.update();
    gl.uniformMatrix4fv(this.uniform("uView"), false, c.viewProj); gl.uniform3f(this.uniform("uCamera"), c.x, c.y, c.z);
    const sun = [Math.sin(yaw) * 0.55 - Math.cos(yaw) * 0.4, 0.75, Math.cos(yaw) * 0.55 + Math.sin(yaw) * 0.4], length = Math.hypot(...sun);
    gl.uniform3fv(this.uniform("uLight"), sun.map((n) => n / length));
    if (pose.rig) { gl.uniform4fv(this.uniform("uRot[0]"), pose.rig.solved.rot); gl.uniform3fv(this.uniform("uJoint[0]"), pose.rig.solved.pos); gl.uniform3fv(this.uniform("uRest[0]"), pose.rig.rest); }
    for (const draw of this.draws) {
      gl.bindVertexArray(draw.vao); gl.uniform1i(this.uniform("uSkinned"), draw.skinned && !!pose.rig ? 1 : 0);
      for (let at = 0; at < draw.sections.length; at += 3) {
        const material = this.pack.header.materials?.[draw.sections[at]!];
        gl.uniform1i(this.uniform("uTextured"), material ? 1 : 0);
        if (material) {
          const slots = [material.base, material.normal, material.mro, material.mask, material.mask2];
          ["Base", "Normal", "Mro", "Mask", "Mask2"].forEach((name, k) => { gl.activeTexture(gl.TEXTURE0 + k); gl.bindTexture(gl.TEXTURE_2D, this.textures.get(slots[k]!) ?? this.blank); gl.uniform1i(this.uniform(`uHas${name}`), this.textures.has(slots[k]!) ? 1 : 0); });
          gl.uniform3fv(this.uniform("uTint"), material.tint); gl.uniform1f(this.uniform("uGrey"), material.grey); gl.uniform1f(this.uniform("uCutoff"), material.cutoff);
          gl.uniform1i(this.uniform("uCutout"), material.flags & MATERIAL_CUTOUT ? 1 : 0);
          if (material.flags & MATERIAL_TWO_SIDED) gl.disable(gl.CULL_FACE); else gl.enable(gl.CULL_FACE);
        } else gl.disable(gl.CULL_FACE);
        gl.drawElements(gl.TRIANGLES, draw.sections[at + 2]!, gl.UNSIGNED_INT, draw.sections[at + 1]! * 4);
      }
    }
  }
  dispose(): void {
    this.dead = true;
    for (const d of this.draws) { this.gl.deleteBuffer(d.vertex); this.gl.deleteBuffer(d.index); this.gl.deleteVertexArray(d.vao); }
    for (const t of this.textures.values()) this.gl.deleteTexture(t);
    this.gl.deleteTexture(this.blank); this.gl.deleteProgram(this.program);
  }
}
