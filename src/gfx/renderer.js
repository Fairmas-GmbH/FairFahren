import { VERTEX_SHADER, FRAGMENT_SHADER } from './shaders.js';
import { FLOATS_PER_VERTEX } from './meshBuilder.js';
import { identity } from '../core/math.js';

const UNIFORMS = ['uProj', 'uView', 'uModel', 'uEye', 'uSunDir', 'uFogColor', 'uFogDensity', 'uTime'];

/** Thin WebGL2 wrapper: one program, static or refillable meshes, one draw call per mesh. */
export class Renderer {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', { antialias: true });
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    this.gl = gl;
    this.canvas = canvas;
    this.program = createProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER);
    this.u = Object.fromEntries(UNIFORMS.map((name) => [name, gl.getUniformLocation(this.program, name)]));
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  /** Uploads a MeshBuilder to the GPU. Returns a handle for draw(). */
  upload(builder, mesh = null) {
    // Pass the mesh from an earlier upload to refill its buffers (per-frame geometry, no leak).
    const gl = this.gl, usage = mesh ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW;
    const m = mesh ?? { vao: gl.createVertexArray(), vbo: gl.createBuffer(), ibo: gl.createBuffer() };
    gl.bindVertexArray(m.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, m.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(builder.vertices), usage);
    const stride = FLOATS_PER_VERTEX * 4;
    if (!mesh) {
      [3, 3, 3, 1].reduce((offset, size, loc) => {
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset * 4);
        return offset + size;
      }, 0);
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(builder.indices), usage);
    gl.bindVertexArray(null);
    m.count = builder.indices.length;
    return m;
  }

  /** Matches the drawing buffer to the CSS size. Returns the aspect ratio. */
  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(this.canvas.clientWidth * dpr), h = Math.round(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.gl.viewport(0, 0, w, h);
    return w / Math.max(h, 1);
  }

  /** view = { proj, view, eye }, env = { sunDir, fogColor, fogDensity, time } */
  beginFrame(view, env) {
    const gl = this.gl, u = this.u;
    gl.clearColor(...env.fogColor, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.uniformMatrix4fv(u.uProj, false, view.proj);
    gl.uniformMatrix4fv(u.uView, false, view.view);
    gl.uniform3fv(u.uEye, view.eye);
    gl.uniform3fv(u.uSunDir, env.sunDir);
    gl.uniform3fv(u.uFogColor, env.fogColor);
    gl.uniform1f(u.uFogDensity, env.fogDensity);
    gl.uniform1f(u.uTime, env.time);
  }

  draw(mesh, model = identity(), transparent = false) {
    const gl = this.gl;
    if (transparent) {
      gl.enable(gl.BLEND);
      gl.depthMask(false);
    }
    gl.uniformMatrix4fv(this.u.uModel, false, model);
    gl.bindVertexArray(mesh.vao);
    gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_INT, 0);
    if (transparent) {
      gl.disable(gl.BLEND);
      gl.depthMask(true);
    }
  }
}

function createProgram(gl, vsSource, fsSource) {
  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vsSource));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fsSource));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}
