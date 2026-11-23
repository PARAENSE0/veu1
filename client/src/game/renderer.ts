/**
 * Renderizador WebGL2 próprio.
 *
 * - Um único programa de iluminação por fragmento: até 16 luzes pontuais,
 *   6 lanternas (spot), neblina exponencial, granulação e modo de visão da entidade.
 * - Todas as texturas em um TEXTURE_2D_ARRAY (mundo estático em 1 chamada de desenho).
 * - Objetos dinâmicos usam um cubo unitário com matriz de modelo.
 * - Sistema de partículas por pontos (poeira marinha, faíscas).
 */
import { LAYER_COUNT, LAYER_EMIT, buildTextureLayers } from './textures';
import { lookAt, mat4, multiply, perspective, transformPoint, type Mat4 } from './math';

export const MAX_PL = 16;
export const MAX_SL = 6;

const VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNor;
layout(location=2) in vec2 aUv;
layout(location=3) in float aLayer;
uniform mat4 uVP;
uniform mat4 uModel;
uniform float uLayer;
uniform vec2 uUvScale;
out vec3 vPos;
out vec3 vNor;
out vec2 vUv;
flat out int vLayer;
void main() {
  vec4 wp = uModel * vec4(aPos, 1.0);
  vPos = wp.xyz;
  vNor = mat3(uModel) * aNor;
  vUv = aUv * uUvScale;
  vLayer = int(uLayer >= 0.0 ? uLayer : aLayer);
  gl_Position = uVP * wp;
}`;

const FS = `#version 300 es
precision highp float;
precision highp sampler2DArray;
in vec3 vPos;
in vec3 vNor;
in vec2 vUv;
flat in int vLayer;
uniform sampler2DArray uTex;
uniform vec3 uCam;
uniform vec3 uAmbient;
uniform vec3 uFog;
uniform float uFogDensity;
uniform int uNPL;
uniform vec4 uPLp[${MAX_PL}];
uniform vec4 uPLc[${MAX_PL}];
uniform int uNSL;
uniform vec4 uSLp[${MAX_SL}];
uniform vec4 uSLd[${MAX_SL}];
uniform vec4 uSLc[${MAX_SL}];
uniform vec4 uTint;
uniform vec3 uEmit;
uniform float uLayerEmit[${LAYER_COUNT}];
uniform float uTime;
uniform float uGrain;
uniform int uVision;
uniform float uUnlit;
out vec4 oColor;

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void main() {
  vec4 tex = texture(uTex, vec3(vUv, float(vLayer)));
  vec3 base = tex.rgb * uTint.rgb;
  vec3 n = normalize(vNor);
  if (!gl_FrontFacing) n = -n;
  vec3 light = uAmbient * (0.75 + 0.25 * n.y);
  for (int i = 0; i < ${MAX_PL}; i++) {
    if (i >= uNPL) break;
    vec3 L = uPLp[i].xyz - vPos;
    float d = length(L);
    float r = uPLp[i].w;
    if (d < r) {
      float att = 1.0 - d / r;
      att *= att;
      float nd = max(dot(n, L / max(d, 0.001)), 0.0) * 0.85 + 0.15;
      light += uPLc[i].rgb * att * nd;
    }
  }
  for (int i = 0; i < ${MAX_SL}; i++) {
    if (i >= uNSL) break;
    vec3 L = uSLp[i].xyz - vPos;
    float d = length(L);
    float range = uSLc[i].w;
    if (d < range) {
      vec3 ld = L / max(d, 0.001);
      float c = dot(-ld, uSLd[i].xyz);
      float cone = smoothstep(uSLd[i].w, uSLd[i].w + 0.12, c);
      float att = 1.0 - d / range;
      att *= att;
      float nd = max(dot(n, ld), 0.0) * 0.8 + 0.2;
      light += uSLc[i].rgb * cone * att * nd;
    }
  }
  vec3 col = mix(base * light, base, uUnlit);
  float emitL = uLayerEmit[vLayer];
  col += tex.rgb * uTint.rgb * emitL + uEmit;
  float dist = length(vPos - uCam);
  float fd = dist * uFogDensity;
  float f = 1.0 - exp(-fd * fd);
  col = mix(col, uFog, clamp(f, 0.0, 1.0));
  if (uVision == 1) {
    float lum = dot(col, vec3(0.3, 0.59, 0.11));
    col = mix(col, vec3(lum * 0.55, lum * 0.7, lum * 1.05), 0.75) + uEmit * 0.6;
  }
  col += (hash(gl_FragCoord.xy + fract(uTime) * 91.0) - 0.5) * uGrain;
  oColor = vec4(col, uTint.a * tex.a);
}`;

const PVS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec4 aCol;
layout(location=2) in float aSize;
uniform mat4 uVP;
uniform float uPx;
out vec4 vCol;
void main() {
  gl_Position = uVP * vec4(aPos, 1.0);
  gl_PointSize = clamp(aSize * uPx / max(gl_Position.w, 0.1), 1.0, 64.0);
  vCol = aCol;
}`;
const PFS = `#version 300 es
precision mediump float;
in vec4 vCol;
uniform vec3 uFog;
out vec4 oColor;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float a = 1.0 - smoothstep(0.2, 0.5, length(c));
  oColor = vec4(vCol.rgb, vCol.a * a);
}`;

export interface Mesh {
  vao: WebGLVertexArrayObject;
  count: number;
  buf: WebGLBuffer;
}

export interface PointLight {
  x: number;
  y: number;
  z: number;
  r: number;
  g: number;
  b: number;
  radius: number;
}
export interface SpotLight {
  x: number;
  y: number;
  z: number;
  dx: number;
  dy: number;
  dz: number;
  cos: number;
  r: number;
  g: number;
  b: number;
  range: number;
}

export interface DrawOpts {
  layer: number;
  tint?: [number, number, number];
  alpha?: number;
  emit?: [number, number, number];
  uv?: [number, number];
  unlit?: number;
}

export interface Quality {
  scale: number;
  lights: number;
  spots: number;
  particles: number;
  texSize: number;
  grain: number;
}

/** Construtor de geometria intercalada (pos3 nor3 uv2 layer1). */
export class Geom {
  data: number[] = [];
  vert(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number, l: number) {
    this.data.push(x, y, z, nx, ny, nz, u, v, l);
  }
  /** Quad definido por 4 cantos (sentido anti-horário visto de frente). */
  quad(p: number[][], n: number[], uvs: number[][], l: number) {
    const idx = [0, 1, 2, 0, 2, 3];
    for (const i of idx) this.vert(p[i][0], p[i][1], p[i][2], n[0], n[1], n[2], uvs[i][0], uvs[i][1], l);
  }
  /** Caixa alinhada aos eixos. uvScale: repetições por metro. */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, l: number, uvs = 0.5) {
    const sx = (x1 - x0) * uvs, sy = (y1 - y0) * uvs, sz = (z1 - z0) * uvs;
    // +X
    this.quad([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [1, 0, 0], [[0, sy], [sz, sy], [sz, 0], [0, 0]], l);
    // -X
    this.quad([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0], [[0, sy], [sz, sy], [sz, 0], [0, 0]], l);
    // +Z
    this.quad([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1], [[0, sy], [sx, sy], [sx, 0], [0, 0]], l);
    // -Z
    this.quad([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [0, 0, -1], [[0, sy], [sx, sy], [sx, 0], [0, 0]], l);
    // +Y
    this.quad([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [0, 1, 0], [[0, sz], [sx, sz], [sx, 0], [0, 0]], l);
    // -Y
    this.quad([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0], [[0, 0], [sx, 0], [sx, sz], [0, sz]], l);
  }
}

export class Renderer {
  readonly gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private pprog: WebGLProgram;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private pu: Record<string, WebGLUniformLocation | null> = {};
  private tex: WebGLTexture | null = null;
  cube!: Mesh;
  private pointBuf: WebGLBuffer;
  private pointVao: WebGLVertexArrayObject;
  private pointData = new Float32Array(0);
  readonly view = mat4();
  readonly proj = mat4();
  readonly vp = mat4();
  readonly model = mat4();
  cam = { x: 0, y: 0, z: 0 };
  width = 1;
  height = 1;
  quality: Quality;
  private plData = new Float32Array(MAX_PL * 4);
  private pcData = new Float32Array(MAX_PL * 4);
  private slp = new Float32Array(MAX_SL * 4);
  private sld = new Float32Array(MAX_SL * 4);
  private slc = new Float32Array(MAX_SL * 4);
  drawCalls = 0;

  constructor(
    readonly canvas: HTMLCanvasElement,
    quality: Quality,
  ) {
    const gl = canvas.getContext('webgl2', { antialias: quality.scale >= 1, powerPreference: 'high-performance', alpha: false });
    if (!gl) throw new Error('WebGL2 não está disponível neste navegador/dispositivo.');
    this.gl = gl;
    this.quality = quality;
    this.prog = this.program(VS, FS);
    this.pprog = this.program(PVS, PFS);
    for (const n of ['uVP', 'uModel', 'uLayer', 'uUvScale', 'uTex', 'uCam', 'uAmbient', 'uFog', 'uFogDensity', 'uNPL', 'uPLp', 'uPLc', 'uNSL', 'uSLp', 'uSLd', 'uSLc', 'uTint', 'uEmit', 'uLayerEmit', 'uTime', 'uGrain', 'uVision', 'uUnlit'])
      this.u[n] = gl.getUniformLocation(this.prog, n);
    for (const n of ['uVP', 'uPx', 'uFog']) this.pu[n] = gl.getUniformLocation(this.pprog, n);
    const g = new Geom();
    g.box(-0.5, -0.5, -0.5, 0.5, 0.5, 0.5, 0, 1);
    this.cube = this.upload(g);
    this.pointBuf = gl.createBuffer()!;
    this.pointVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.pointVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pointBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 32, 28);
    gl.bindVertexArray(null);
    this.setTextureSize(quality.texSize);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
  }

  private program(vs: string, fs: string): WebGLProgram {
    const gl = this.gl;
    const mk = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('Erro de shader: ' + gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, mk(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Erro ao ligar shader: ' + gl.getProgramInfoLog(p));
    return p;
  }

  setTextureSize(size: number) {
    const gl = this.gl;
    if (this.tex) gl.deleteTexture(this.tex);
    const layers = buildTextureLayers(size);
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA8, size, size, layers.length, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    layers.forEach((img, i) => gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, size, size, 1, gl.RGBA, gl.UNSIGNED_BYTE, img.data));
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
    const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    if (aniso && size >= 256) gl.texParameterf(gl.TEXTURE_2D_ARRAY, aniso.TEXTURE_MAX_ANISOTROPY_EXT, size >= 512 ? 8 : 4);
    this.tex = tex;
  }

  upload(g: Geom): Mesh {
    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    const buf = gl.createBuffer()!;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(g.data), gl.STATIC_DRAW);
    const stride = 9 * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, 24);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, 32);
    gl.bindVertexArray(null);
    return { vao, buf, count: g.data.length / 9 };
  }

  deleteMesh(m: Mesh) {
    this.gl.deleteBuffer(m.buf);
    this.gl.deleteVertexArray(m.vao);
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(this.canvas.clientWidth * dpr * this.quality.scale));
    const h = Math.max(1, Math.floor(this.canvas.clientHeight * dpr * this.quality.scale));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.width = w;
    this.height = h;
  }

  begin(cam: { x: number; y: number; z: number; yaw: number; pitch: number; fov: number }, env: { ambient: number[]; fog: number[]; fogDensity: number; vision: number; time: number }) {
    const gl = this.gl;
    this.resize();
    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(env.fog[0], env.fog[1], env.fog[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    this.cam = { x: cam.x, y: cam.y, z: cam.z };
    const cp = Math.cos(cam.pitch);
    const fx = -Math.sin(cam.yaw) * cp;
    const fy = Math.sin(cam.pitch);
    const fz = -Math.cos(cam.yaw) * cp;
    lookAt(this.view, cam.x, cam.y, cam.z, cam.x + fx, cam.y + fy, cam.z + fz);
    perspective(this.proj, (cam.fov * Math.PI) / 180, this.width / this.height, 0.05, 120);
    multiply(this.vp, this.proj, this.view);
    gl.useProgram(this.prog);
    gl.uniformMatrix4fv(this.u.uVP, false, this.vp);
    gl.uniform3f(this.u.uCam, cam.x, cam.y, cam.z);
    gl.uniform3fv(this.u.uAmbient, env.ambient);
    gl.uniform3fv(this.u.uFog, env.fog);
    gl.uniform1f(this.u.uFogDensity, env.fogDensity);
    gl.uniform1f(this.u.uTime, env.time);
    gl.uniform1f(this.u.uGrain, this.quality.grain);
    gl.uniform1i(this.u.uVision, env.vision);
    gl.uniform1fv(this.u.uLayerEmit, LAYER_EMIT);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.tex);
    gl.uniform1i(this.u.uTex, 0);
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    this.drawCalls = 0;
  }

  setLights(pl: PointLight[], sl: SpotLight[]) {
    const gl = this.gl;
    const np = Math.min(pl.length, MAX_PL, this.quality.lights);
    for (let i = 0; i < np; i++) {
      const l = pl[i];
      this.plData.set([l.x, l.y, l.z, l.radius], i * 4);
      this.pcData.set([l.r, l.g, l.b, 0], i * 4);
    }
    const ns = Math.min(sl.length, MAX_SL, this.quality.spots);
    for (let i = 0; i < ns; i++) {
      const s = sl[i];
      this.slp.set([s.x, s.y, s.z, 0], i * 4);
      this.sld.set([s.dx, s.dy, s.dz, s.cos], i * 4);
      this.slc.set([s.r, s.g, s.b, s.range], i * 4);
    }
    gl.uniform1i(this.u.uNPL, np);
    gl.uniform4fv(this.u.uPLp, this.plData);
    gl.uniform4fv(this.u.uPLc, this.pcData);
    gl.uniform1i(this.u.uNSL, ns);
    gl.uniform4fv(this.u.uSLp, this.slp);
    gl.uniform4fv(this.u.uSLd, this.sld);
    gl.uniform4fv(this.u.uSLc, this.slc);
  }

  /** Inicia a passagem de objetos translúcidos (sem escrita de profundidade). */
  transparent(on: boolean) {
    const gl = this.gl;
    if (on) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
    } else {
      gl.disable(gl.BLEND);
      gl.depthMask(true);
    }
  }
  additive(on: boolean) {
    const gl = this.gl;
    if (on) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      gl.depthMask(false);
    } else {
      gl.disable(gl.BLEND);
      gl.depthMask(true);
    }
  }
  clearDepth() {
    this.gl.clear(this.gl.DEPTH_BUFFER_BIT);
  }
  depthTest(on: boolean) {
    if (on) this.gl.enable(this.gl.DEPTH_TEST);
    else this.gl.disable(this.gl.DEPTH_TEST);
  }

  draw(mesh: Mesh, model: Mat4, o: DrawOpts) {
    const gl = this.gl;
    gl.uniformMatrix4fv(this.u.uModel, false, model);
    gl.uniform1f(this.u.uLayer, o.layer);
    const t = o.tint ?? [1, 1, 1];
    gl.uniform4f(this.u.uTint, t[0], t[1], t[2], o.alpha ?? 1);
    const e = o.emit ?? [0, 0, 0];
    gl.uniform3f(this.u.uEmit, e[0], e[1], e[2]);
    const uv = o.uv ?? [1, 1];
    gl.uniform2f(this.u.uUvScale, uv[0], uv[1]);
    gl.uniform1f(this.u.uUnlit, o.unlit ?? 0);
    gl.bindVertexArray(mesh.vao);
    gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
    this.drawCalls++;
  }

  /** Desenha o mundo estático (camadas por vértice). */
  drawStatic(mesh: Mesh, model: Mat4) {
    this.draw(mesh, model, { layer: -1 });
  }

  /** Desenha partículas. data: [x,y,z,r,g,b,a,size] por ponto. */
  drawPoints(data: Float32Array, count: number, fog: number[], additive = true) {
    if (!count) return;
    const gl = this.gl;
    gl.useProgram(this.pprog);
    gl.uniformMatrix4fv(this.pu.uVP, false, this.vp);
    gl.uniform1f(this.pu.uPx, this.height * 0.6);
    gl.uniform3fv(this.pu.uFog, fog);
    gl.bindVertexArray(this.pointVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pointBuf);
    if (this.pointData.length < data.length) this.pointData = new Float32Array(data.length);
    gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, count * 8), gl.DYNAMIC_DRAW);
    this.additive(additive);
    gl.drawArrays(gl.POINTS, 0, count);
    this.additive(false);
    gl.useProgram(this.prog);
    this.drawCalls++;
  }

  /** Projeta um ponto do mundo na tela (CSS px). Retorna null se atrás da câmera. */
  project(x: number, y: number, z: number): { x: number; y: number; depth: number } | null {
    const [cx, cy, , cw] = transformPoint(this.vp, x, y, z);
    if (cw <= 0.05) return null;
    const nx = cx / cw;
    const ny = cy / cw;
    return { x: ((nx + 1) / 2) * this.canvas.clientWidth, y: ((1 - ny) / 2) * this.canvas.clientHeight, depth: cw };
  }

  dispose() {
    const ext = this.gl.getExtension('WEBGL_lose_context');
    ext?.loseContext();
  }
}
