// ============================================================
// 3D SURFACE RENDERER (WebGL2, no dependencies)
// Meshes a dense cols × rows height grid into a lit surface with a
// wire overlay, a bounding box with grid walls, and an optional trace
// (the price path). Axis labels are drawn by the caller on a 2D overlay
// using `project`, so text stays crisp in every theme.
//
// World space: x = time (−1 … 1), z = rows (row 0 at +1, nearest the
// default camera), y = height (0 … 1; signed surfaces sit on y = 0.5).
// ============================================================

export type Vec3 = [number, number, number];
export type RGB = [number, number, number];

export interface SurfaceMesh {
  cols: number;
  rows: number;
  /** First column to mesh (earlier columns hold no data yet). */
  firstCol: number;
  /** Height per vertex in world units, col-major (cols × rows). */
  heights: Float32Array;
  /** RGB (0‒1) per vertex, col-major. */
  colors: Float32Array;
  /** Fractional row per column for the trace, NaN to break it. */
  path: Float32Array | null;
  /** y of the zero plane (0 for unsigned surfaces, 0.5 for signed). */
  baseY: number;
}

export interface Camera {
  yaw: number; // radians around the vertical axis; 0 looks along −z
  pitch: number; // radians above the horizon
  distance: number;
}

export interface SceneStyle {
  line: RGB; // box and wall grid lines
  lineAlpha: number;
  wire: RGB; // wire overlay on the surface
  wireAlpha: number;
  trace: RGB;
  zeroPlane: RGB;
}

export interface AxisTicks {
  x: number[]; // world x positions
  z: number[]; // world z positions
  y: number[]; // world y positions
}

const TARGET: Vec3 = [0, 0.38, 0];
const FOV = (34 * Math.PI) / 180;

// ─── Matrix helpers (column-major) ───────────────────────────────
type Mat4 = Float32Array;

function perspective(fovy: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovy / 2);
  const nf = 1 / (near - far);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) * nf;
  m[11] = -1;
  m[14] = 2 * far * near * nf;
  return m;
}

function lookAt(eye: Vec3, center: Vec3, up: Vec3): Mat4 {
  let zx = eye[0] - center[0], zy = eye[1] - center[1], zz = eye[2] - center[2];
  let len = Math.hypot(zx, zy, zz) || 1;
  zx /= len; zy /= len; zz /= len;
  let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
  len = Math.hypot(xx, xy, xz) || 1;
  xx /= len; xy /= len; xz /= len;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  const m = new Float32Array(16);
  m[0] = xx; m[1] = yx; m[2] = zx;
  m[4] = xy; m[5] = yy; m[6] = zy;
  m[8] = xz; m[9] = yz; m[10] = zz;
  m[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
  m[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
  m[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
  m[15] = 1;
  return m;
}

function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

export function eyePosition(camera: Camera): Vec3 {
  const cp = Math.cos(camera.pitch);
  return [
    TARGET[0] + camera.distance * cp * Math.sin(camera.yaw),
    TARGET[1] + camera.distance * Math.sin(camera.pitch),
    TARGET[2] + camera.distance * cp * Math.cos(camera.yaw),
  ];
}

export function colX(col: number, cols: number): number {
  return cols > 1 ? -1 + (2 * col) / (cols - 1) : 0;
}

export function rowZ(row: number, rows: number): number {
  return rows > 1 ? 1 - (2 * row) / (rows - 1) : 0;
}

// ─── Shaders ─────────────────────────────────────────────────────
const SURFACE_VS = `#version 300 es
in vec3 aPos;
in vec3 aNormal;
in vec3 aColor;
uniform mat4 uMVP;
out vec3 vNormal;
out vec3 vColor;
out float vY;
void main() {
  vNormal = aNormal;
  vColor = aColor;
  vY = aPos.y;
  gl_Position = uMVP * vec4(aPos, 1.0);
}`;

const SURFACE_FS = `#version 300 es
precision highp float;
in vec3 vNormal;
in vec3 vColor;
in float vY;
uniform vec3 uLight;
uniform vec3 uEye;
out vec4 outColor;
void main() {
  vec3 n = normalize(vNormal);
  // Light both faces so the underside of a signed surface isn't black.
  float diffuse = abs(dot(n, normalize(uLight)));
  float rim = pow(1.0 - abs(n.y), 2.0) * 0.12;
  vec3 color = vColor * (0.58 + 0.5 * diffuse) + rim;
  outColor = vec4(color, 1.0);
}`;

const LINE_VS = `#version 300 es
in vec3 aPos;
uniform mat4 uMVP;
void main() { gl_Position = uMVP * vec4(aPos, 1.0); }`;

const LINE_FS = `#version 300 es
precision highp float;
uniform vec4 uColor;
out vec4 outColor;
void main() { outColor = uColor; }`;

function compile(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const program = gl.createProgram()!;
  for (const [type, source] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? "shader");
    gl.attachShader(program, shader);
  }
  // Fixed locations so the wire overlay can draw from the surface's VAO.
  gl.bindAttribLocation(program, 0, "aPos");
  gl.bindAttribLocation(program, 1, "aNormal");
  gl.bindAttribLocation(program, 2, "aColor");
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? "link");
  return program;
}

// ─── Renderer ────────────────────────────────────────────────────
export class SurfaceRenderer {
  private gl: WebGL2RenderingContext;
  private surfaceProgram: WebGLProgram;
  private lineProgram: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private posBuffer: WebGLBuffer;
  private normalBuffer: WebGLBuffer;
  private colorBuffer: WebGLBuffer;
  private triBuffer: WebGLBuffer;
  private wireBuffer: WebGLBuffer;
  private lineVao: WebGLVertexArrayObject;
  private lineBuffer: WebGLBuffer;
  private triCount = 0;
  private wireCount = 0;
  private mesh: SurfaceMesh | null = null;
  private widened = false;
  private positions = new Float32Array(0);
  private mvp: Mat4 = new Float32Array(16);
  private viewport = { width: 1, height: 1 };
  private projected: Float32Array | null = null;

  static supported(canvas: HTMLCanvasElement): boolean {
    try {
      return !!canvas.getContext("webgl2");
    } catch {
      return false;
    }
  }

  constructor(private readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", { antialias: true, alpha: true, premultipliedAlpha: true });
    if (!gl) throw new Error("WebGL2 is not available");
    this.gl = gl;
    this.surfaceProgram = compile(gl, SURFACE_VS, SURFACE_FS);
    this.lineProgram = compile(gl, LINE_VS, LINE_FS);

    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    this.posBuffer = this.attribute(this.surfaceProgram, "aPos");
    this.normalBuffer = this.attribute(this.surfaceProgram, "aNormal");
    this.colorBuffer = this.attribute(this.surfaceProgram, "aColor");
    this.triBuffer = gl.createBuffer()!;
    this.wireBuffer = gl.createBuffer()!;
    gl.bindVertexArray(null);

    this.lineVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.lineVao);
    this.lineBuffer = this.attribute(this.lineProgram, "aPos");
    gl.bindVertexArray(null);
  }

  private attribute(program: WebGLProgram, name: string): WebGLBuffer {
    const gl = this.gl;
    const buffer = gl.createBuffer()!;
    const location = gl.getAttribLocation(program, name);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, 3, gl.FLOAT, false, 0, 0);
    return buffer;
  }

  dispose(): void {
    const gl = this.gl;
    for (const b of [this.posBuffer, this.normalBuffer, this.colorBuffer, this.triBuffer, this.wireBuffer, this.lineBuffer]) gl.deleteBuffer(b);
    gl.deleteVertexArray(this.vao);
    gl.deleteVertexArray(this.lineVao);
    gl.deleteProgram(this.surfaceProgram);
    gl.deleteProgram(this.lineProgram);
  }

  /** Upload a new height grid. Rows < 2 are widened into a ribbon. */
  setMesh(input: SurfaceMesh | null): void {
    this.projected = null;
    if (!input || input.cols - input.firstCol < 2) {
      this.mesh = input;
      this.triCount = 0;
      this.wireCount = 0;
      return;
    }
    this.widened = input.rows < 2;
    const mesh = this.widened ? widen(input) : input;
    this.mesh = mesh;
    const { cols, rows, firstCol, heights, colors } = mesh;
    const gl = this.gl;
    const n = cols * rows;
    const positions = new Float32Array(n * 3);
    const normals = new Float32Array(n * 3);
    for (let c = 0; c < cols; c++) {
      const x = colX(c, cols);
      for (let r = 0; r < rows; r++) {
        const i = (c * rows + r) * 3;
        positions[i] = x;
        positions[i + 1] = heights[c * rows + r];
        positions[i + 2] = rowZ(r, rows);
      }
    }
    // Central-difference normals.
    for (let c = firstCol; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        const h = (cc: number, rr: number) => heights[Math.min(cols - 1, Math.max(firstCol, cc)) * rows + Math.min(rows - 1, Math.max(0, rr))];
        const dx = (h(c + 1, r) - h(c - 1, r)) / (2 * (2 / Math.max(1, cols - 1)));
        const dz = (h(c, r + 1) - h(c, r - 1)) / (2 * (-2 / Math.max(1, rows - 1)));
        const len = Math.hypot(dx, 1, dz) || 1;
        const i = (c * rows + r) * 3;
        normals[i] = -dx / len;
        normals[i + 1] = 1 / len;
        normals[i + 2] = -dz / len;
      }
    }
    this.positions = positions;

    const tris = new Uint32Array((cols - 1 - firstCol) * (rows - 1) * 6);
    let t = 0;
    for (let c = firstCol; c < cols - 1; c++) {
      for (let r = 0; r < rows - 1; r++) {
        const a = c * rows + r, b = (c + 1) * rows + r, d = c * rows + r + 1, e = (c + 1) * rows + r + 1;
        tris[t++] = a; tris[t++] = b; tris[t++] = d;
        tris[t++] = b; tris[t++] = e; tris[t++] = d;
      }
    }
    // Wire overlay: about 28 lines each way.
    const colStep = Math.max(1, Math.round((cols - firstCol) / 28));
    const rowStep = Math.max(1, Math.round(rows / 22));
    const wire: number[] = [];
    for (let c = firstCol; c < cols; c += colStep) for (let r = 0; r < rows - 1; r++) wire.push(c * rows + r, c * rows + r + 1);
    for (let r = 0; r < rows; r += rowStep) for (let c = firstCol; c < cols - 1; c++) wire.push(c * rows + r, (c + 1) * rows + r);

    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.normalBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, normals, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, colors, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.triBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, tris, gl.DYNAMIC_DRAW);
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.wireBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, Uint32Array.from(wire), gl.DYNAMIC_DRAW);
    this.triCount = tris.length;
    this.wireCount = wire.length;
  }

  /** Height of the surface at a fractional row of a column (for the trace). */
  private heightAt(col: number, row: number): number {
    const mesh = this.mesh!;
    const r0 = Math.max(0, Math.min(mesh.rows - 1, Math.floor(row)));
    const r1 = Math.min(mesh.rows - 1, r0 + 1);
    const f = Math.max(0, Math.min(1, row - r0));
    return mesh.heights[col * mesh.rows + r0] * (1 - f) + mesh.heights[col * mesh.rows + r1] * f;
  }

  render(width: number, height: number, dpr: number, camera: Camera, style: SceneStyle, ticks: AxisTicks): void {
    const gl = this.gl;
    const pw = Math.max(1, Math.round(width * dpr));
    const ph = Math.max(1, Math.round(height * dpr));
    if (this.canvas.width !== pw || this.canvas.height !== ph) {
      this.canvas.width = pw;
      this.canvas.height = ph;
    }
    this.viewport = { width, height };
    const eye = eyePosition(camera);
    const projection = perspective(FOV, width / Math.max(1, height), 0.05, 50);
    this.mvp = multiply(projection, lookAt(eye, TARGET, [0, 1, 0]));
    this.projected = null;

    gl.viewport(0, 0, pw, ph);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // Walls and floor grid behind the surface.
    this.drawLines(this.boxLines(eye, ticks), style.line, style.lineAlpha);

    const mesh = this.mesh;
    if (mesh && this.triCount) {
      gl.useProgram(this.surfaceProgram);
      gl.uniformMatrix4fv(gl.getUniformLocation(this.surfaceProgram, "uMVP"), false, this.mvp);
      gl.uniform3f(gl.getUniformLocation(this.surfaceProgram, "uLight"), eye[0] * 0.4 + 0.6, 1.4, eye[2] * 0.4 + 0.8);
      gl.uniform3f(gl.getUniformLocation(this.surfaceProgram, "uEye"), eye[0], eye[1], eye[2]);
      gl.bindVertexArray(this.vao);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.triBuffer);
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(1, 1);
      gl.drawElements(gl.TRIANGLES, this.triCount, gl.UNSIGNED_INT, 0);
      gl.disable(gl.POLYGON_OFFSET_FILL);

      gl.useProgram(this.lineProgram);
      gl.uniformMatrix4fv(gl.getUniformLocation(this.lineProgram, "uMVP"), false, this.mvp);
      gl.uniform4f(gl.getUniformLocation(this.lineProgram, "uColor"), style.wire[0], style.wire[1], style.wire[2], style.wireAlpha);
      // The wire overlay reuses the surface positions (location 0).
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.wireBuffer);
      gl.drawElements(gl.LINES, this.wireCount, gl.UNSIGNED_INT, 0);
      gl.bindVertexArray(null);

      if (mesh.baseY > 0) {
        // Translucent zero plane for signed surfaces.
        const y = mesh.baseY;
        const plane = [-1, y, -1, 1, y, -1, 1, y, -1, 1, y, 1, 1, y, 1, -1, y, 1, -1, y, 1, -1, y, -1];
        this.drawLines(plane, style.zeroPlane, 0.55);
      }

      if (mesh.path) {
        const trace: number[] = [];
        let previous: Vec3 | null = null;
        for (let c = mesh.firstCol; c < mesh.cols; c++) {
          const row = mesh.path[c];
          if (!Number.isFinite(row) || row < 0 || row > mesh.rows - 1) {
            previous = null;
            continue;
          }
          const point: Vec3 = [colX(c, mesh.cols), this.heightAt(c, row) + 0.012, rowZ(row, mesh.rows)];
          if (previous) trace.push(...previous, ...point);
          previous = point;
        }
        // Once through the depth buffer, once faintly on top so it never vanishes.
        this.drawLines(trace, style.trace, 0.95);
        gl.disable(gl.DEPTH_TEST);
        this.drawLines(trace, style.trace, 0.28);
        // And its shadow on the floor, which reads as a price line in top view.
        const floor = trace.map((v, i) => (i % 3 === 1 ? 0.001 : v));
        this.drawLines(floor, style.trace, 0.35);
        gl.enable(gl.DEPTH_TEST);
      }
    }
  }

  private drawLines(points: number[], color: RGB, alpha: number): void {
    if (!points.length) return;
    const gl = this.gl;
    gl.useProgram(this.lineProgram);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.lineProgram, "uMVP"), false, this.mvp);
    gl.uniform4f(gl.getUniformLocation(this.lineProgram, "uColor"), color[0], color[1], color[2], alpha);
    gl.bindVertexArray(this.lineVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(points), gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.LINES, 0, points.length / 3);
    gl.bindVertexArray(null);
  }

  /** The two walls facing away from the camera, the floor, and their tick grids. */
  private boxLines(eye: Vec3, ticks: AxisTicks): number[] {
    const { backX, backZ } = backWalls(eye);
    const out: number[] = [];
    const seg = (a: Vec3, b: Vec3) => out.push(...a, ...b);
    // Floor outline and grid.
    seg([-1, 0, -1], [1, 0, -1]); seg([1, 0, -1], [1, 0, 1]); seg([1, 0, 1], [-1, 0, 1]); seg([-1, 0, 1], [-1, 0, -1]);
    for (const x of ticks.x) seg([x, 0, -1], [x, 0, 1]);
    for (const z of ticks.z) seg([-1, 0, z], [1, 0, z]);
    // Back wall along x (at z = backZ) and side wall along z (at x = backX).
    seg([-1, 1, backZ], [1, 1, backZ]); seg([backX, 1, -1], [backX, 1, 1]);
    seg([-1, 0, backZ], [-1, 1, backZ]); seg([1, 0, backZ], [1, 1, backZ]); seg([backX, 0, -backZ], [backX, 1, -backZ]);
    for (const y of ticks.y) {
      seg([-1, y, backZ], [1, y, backZ]);
      seg([backX, y, -1], [backX, y, 1]);
    }
    for (const x of ticks.x) seg([x, 0, backZ], [x, 1, backZ]);
    for (const z of ticks.z) seg([backX, 0, z], [backX, 1, z]);
    return out;
  }

  /** World → CSS pixels (and clip-space w; behind the camera when w ≤ 0). */
  project(p: Vec3): { x: number; y: number; w: number } {
    const m = this.mvp;
    const cx = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
    const cy = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
    const cw = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
    const w = cw || 1e-6;
    return {
      x: ((cx / w + 1) / 2) * this.viewport.width,
      y: ((1 - cy / w) / 2) * this.viewport.height,
      w: cw,
    };
  }

  /** Nearest meshed vertex to a CSS-pixel point, within `radius`. */
  pick(px: number, py: number, radius = 18): { col: number; row: number } | null {
    const mesh = this.mesh;
    if (!mesh || !this.triCount) return null;
    const { cols, rows, firstCol } = mesh;
    if (!this.projected) {
      const out = new Float32Array(cols * rows * 3);
      for (let i = firstCol * rows; i < cols * rows; i++) {
        const s = this.project([this.positions[i * 3], this.positions[i * 3 + 1], this.positions[i * 3 + 2]]);
        out[i * 3] = s.x;
        out[i * 3 + 1] = s.y;
        out[i * 3 + 2] = s.w;
      }
      this.projected = out;
    }
    let best = -1;
    let bestScore = Infinity;
    const p = this.projected;
    for (let i = firstCol * rows; i < cols * rows; i++) {
      const dx = p[i * 3] - px;
      const dy = p[i * 3 + 1] - py;
      const d = dx * dx + dy * dy;
      if (d > radius * radius || p[i * 3 + 2] <= 0) continue;
      // Prefer vertices nearer the camera when several overlap on screen.
      const score = d + p[i * 3 + 2] * 4;
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best < 0) return null;
    const col = Math.floor(best / rows);
    const row = best % rows;
    // Map back from a widened ribbon to the caller's single row.
    return { col, row: this.widened ? 0 : row };
  }

  get meshRows(): number {
    return this.mesh?.rows ?? 0;
  }
}

/** The walls on the far side of the box from the camera. */
export function backWalls(eye: Vec3): { backX: number; backZ: number } {
  return { backX: eye[0] >= 0 ? -1 : 1, backZ: eye[2] >= 0 ? -1 : 1 };
}

/** A single row becomes two identical rows so it meshes as a ribbon. */
function widen(mesh: SurfaceMesh): SurfaceMesh {
  const { cols } = mesh;
  const heights = new Float32Array(cols * 2);
  const colors = new Float32Array(cols * 2 * 3);
  for (let c = 0; c < cols; c++) {
    heights[c * 2] = heights[c * 2 + 1] = mesh.heights[c];
    for (let k = 0; k < 3; k++) colors[c * 6 + k] = colors[c * 6 + 3 + k] = mesh.colors[c * 3 + k];
  }
  return { ...mesh, rows: 2, heights, colors, path: null };
}

// ─── Colour ──────────────────────────────────────────────────────
export function hexToRgb(color: string, fallback: RGB = [0.5, 0.5, 0.5]): RGB {
  const hex = color.trim();
  if (/^#[0-9a-f]{6}$/i.test(hex)) {
    return [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255];
  }
  const m = hex.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const [r, g, b] = m[1].split(",").map((v) => parseFloat(v));
    if ([r, g, b].every(Number.isFinite)) return [r / 255, g / 255, b / 255];
  }
  return fallback;
}

export function mix(a: RGB, b: RGB, t: number): RGB {
  const k = Math.max(0, Math.min(1, t));
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

/** Piecewise-linear ramp through evenly spaced stops. */
export function ramp(stops: RGB[], t: number): RGB {
  const k = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(k));
  return mix(stops[i], stops[i + 1], k - i);
}

/** Deep blue → teal → yellow → orange: reads as "heat" on dark and light themes. */
export const HEAT_STOPS: RGB[] = [
  [0.13, 0.16, 0.36],
  [0.16, 0.36, 0.72],
  [0.13, 0.68, 0.78],
  [0.48, 0.86, 0.55],
  [0.97, 0.88, 0.36],
  [1.0, 0.55, 0.24],
];
