// The datamusak logo: 3D bubble-grotesk letters raymarched in a WebGL2 fragment shader.
// Early-MTV × 90s demoscene: plasma faces, chrome sheen, checkerboard sides, fat black flange,
// hard hue-cycling drop shadows, copper bars, star streaks, zigzags, and a rare VHS glitch.
// 45 frames at 15 fps = a seamless 3 s loop. Letters are built from strokes, not a font.

const FRAMES = 45;
const FPS = 15;
const GLITCH_FRAMES = [11, 12, 29, 41];
const STROKE = 0.2;
const GAP = 0.36;

// ---- letter skeletons (units: cap height 1.4, origin bottom-left) ----------
function arc(cx, cy, rx, ry, a0, a1, n) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
    pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return pts.slice(1).map((p, i) => [...pts[i], ...p]);
}
const LETTERS = {
  D: [1.0, [[0.2, 0.2, 0.2, 1.2], [0.2, 1.2, 0.5, 1.2], [0.2, 0.2, 0.5, 0.2], ...arc(0.5, 0.7, 0.3, 0.5, -90, 90, 8)]],
  A: [1.0, [[0.2, 0.2, 0.5, 1.2], [0.5, 1.2, 0.8, 0.2], [0.33, 0.55, 0.67, 0.55]]],
  T: [1.0, [[0.2, 1.2, 0.8, 1.2], [0.5, 1.2, 0.5, 0.2]]],
  M: [1.0, [[0.2, 0.2, 0.2, 1.2], [0.2, 1.2, 0.5, 0.62], [0.5, 0.62, 0.8, 1.2], [0.8, 1.2, 0.8, 0.2]]],
  U: [0.95, [[0.2, 1.2, 0.2, 0.6], [0.75, 1.2, 0.75, 0.6], ...arc(0.475, 0.6, 0.275, 0.4, 180, 360, 8)]],
  S: [0.92, [...arc(0.46, 0.95, 0.26, 0.25, 15, 270, 10), ...arc(0.46, 0.45, 0.26, 0.25, 90, -165, 10)]],
  K: [0.95, [[0.2, 0.2, 0.2, 1.2], [0.24, 0.62, 0.75, 1.2], [0.42, 0.78, 0.77, 0.2]]],
  I: [0.4, [[0.2, 0.2, 0.2, 1.2]]],
};

const MAX_L = 12;
const MAX_SEG = 72;

const FRAG = `#version 300 es
precision highp float;
uniform vec2 uRes, uView; uniform float uT, uD, uPx; uniform int uN, uFrame, uGlitch;
uniform vec4 uSeg[${MAX_SEG}]; uniform ivec2 uRange[${MAX_L}];
uniform mat3 uInv[${MAX_L}]; uniform vec3 uPos[${MAX_L}];
uniform float uScale[${MAX_L}], uCos[${MAX_L}], uRad[${MAX_L}], uTilt[${MAX_L}];
out vec4 o;
const float TAU = 6.2831853;
const vec3 RB[8] = vec3[8](vec3(1.,.259,.259), vec3(.855,.02,.639), vec3(.502,.063,.937), vec3(.145,.361,.98),
                           vec3(0.,.741,.741), vec3(.145,.98,.361), vec3(.498,.937,.063), vec3(.855,.639,.02));
float hash(float n) { return fract(sin(n * 127.1) * 43758.5453); }
vec3 hsv(float h) { return clamp(abs(mod(h * 6. + vec3(0., 4., 2.), 6.) - 3.) - 1., 0., 1.); }

float d2(int i, vec2 q) {
  float d = 1e9; ivec2 r = uRange[i];
  for (int k = r.x; k < r.x + r.y; k++) {
    vec4 s = uSeg[k]; vec2 pa = q - s.xy, ba = s.zw - s.xy;
    d = min(d, length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0., 1.)));
  }
  return d - ${STROKE.toFixed(2)};
}
// distance + material (1 body, 2 flange) for one letter
vec2 letter(int i, vec3 p) {
  vec3 q = uInv[i] * (p - uPos[i]) / uScale[i];
  float dl = d2(i, q.xy);
  vec2 w = vec2(dl + .06, abs(q.z) - .2 + .06);
  float body = min(max(w.x, w.y), 0.) + length(max(w, 0.)) - .06;
  float fl = max(dl - .09, abs(q.z) - .012);
  return vec2(min(body, fl) * uScale[i], body < fl ? 1. : 2.);
}
int cand[3]; int nc;
vec3 hitInfo; // x: letter, y: material
float map(vec3 p) {
  float d = 1e9;
  for (int c = 0; c < nc; c++) {
    vec2 r = letter(cand[c], p);
    if (r.x < d) { d = r.x; hitInfo = vec3(float(cand[c]), r.y, 0.); }
  }
  return d;
}
vec3 normalAt(vec3 p) {
  const vec2 e = vec2(1., -1.) * .0015;
  return normalize(e.xyy * map(p + e.xyy) + e.yyx * map(p + e.yyx) + e.yxy * map(p + e.yxy) + e.xxx * map(p + e.xxx));
}

vec4 background(vec2 w) {
  vec4 c = vec4(0.);
  float H = uView.y * 2.;
  for (int k = 0; k < 3; k++) { // copper bars
    float yc = .32 * H * sin(TAU * uT + float(k) * TAU / 3.);
    float pr = max(0., 1. - abs(w.y - yc) / .17);
    vec3 col = RB[(k * 3 + int(uT * 8.)) % 8] * (.55 + .45 * pr) + pow(pr, 6.) * .5;
    float a = .85 * pr;
    c = vec4(col * a + c.rgb * (1. - a), a + c.a * (1. - a));
  }
  for (int i = 0; i < 36; i++) { // star streaks, 1x/2x/3x parallax
    float fi = float(i), sp = float(1 + i % 3);
    float y = (hash(fi) * 2. - 1.) * uView.y, len = .25 + .5 * hash(fi + 7.);
    float span = uView.x * 2. + 1.6;
    float hx = uView.x + .8 - fract(hash(fi + 3.) + sp * uT) * span;
    float u = (w.x - hx) / len;
    if (abs(w.y - y) < uPx * .9 && u > 0. && u < 1.) { float a = .8 * (1. - u); c = vec4(vec3(a) + c.rgb * (1. - a), a + c.a * (1. - a)); }
  }
  for (int z = 0; z < 2; z++) { // MTV zigzags
    float dir = z == 0 ? 1. : -1.;
    float y0 = (z == 0 ? 1. : -1.) * (uView.y - .2);
    float u = (w.x + dir * uT * 1.1) / 1.1;
    float yw = y0 + .12 * (4. * abs(fract(u) - .5) - 1.);
    if (abs(w.y - yw) / sqrt(1. + .19) < .045) { vec3 col = z == 0 ? vec3(1., .902, .102) : vec3(.102, .949, 1.); c = vec4(col, 1.); }
  }
  return c;
}

vec4 scene(vec2 px) {
  vec2 w = (px / uRes * 2. - 1.) * uView; // world point on the z = 0 plane
  vec3 ro = vec3(0., 0., uD), rd = normalize(vec3(w, -uD));
  float t0 = 1e9, t1 = 0.; nc = 0;
  for (int i = 0; i < uN && i < ${MAX_L}; i++) {
    vec3 oc = ro - uPos[i]; float R = uRad[i] * uScale[i];
    float b = dot(oc, rd), h = b * b - dot(oc, oc) + R * R;
    if (h > 0. && nc < 3) { h = sqrt(h); cand[nc++] = i; t0 = min(t0, -b - h); t1 = max(t1, -b + h); }
  }
  if (nc > 0) {
    float t = max(t0, 0.);
    for (int s = 0; s < 96; s++) {
      vec3 p = ro + rd * t; float d = map(p);
      if (d < .0012) {
        vec3 n = normalAt(p); float d0 = map(p); int i = int(hitInfo.x); float j = float(i);
        if (hitInfo.y > 1.5) return vec4(vec3(.0196), 1.);
        vec3 q = uInv[i] * (p - uPos[i]) / uScale[i], nl = uInv[i] * n, base;
        if (abs(nl.z) > .6) { // faces: acid plasma + chrome stripes
          float v = sin(4. * q.x + TAU * uT) + sin(5. * q.y - TAU * 2. * uT) + sin(3. * (q.x + q.y) + TAU * uT + j);
          base = clamp(vec3(.6, .5, .5) + .5 * cos(TAU * (v * .18 + uT + .08 * j + vec3(0., .25, .6))), 0., 1.);
          if (q.y > 0.) base = mix(base, vec3(1.), .25 * (.5 + .5 * sin(30. * q.y)));
        } else { // sides: checkerboard, 12 checks per unit
          float ck = mod(floor(q.z * 12.) + floor((q.x + q.y) * 12.), 2.);
          base = ck > .5 ? vec3(.949) : vec3(.059);
        }
        vec3 L = normalize(vec3(-.45, .6, .66)), V = -rd, Hh = normalize(L + V);
        vec3 col = base * (.55 + .6 * max(dot(n, L), 0.)) + pow(max(dot(n, Hh), 0.), 24.);
        return vec4(min(col, 1.), 1.);
      }
      t += d; if (t > t1) break;
    }
  }
  // flat, hard drop shadows of the outlined letters
  for (int i = 0; i < uN && i < ${MAX_L}; i++) {
    if (abs(uCos[i]) < .04) continue;
    // the outlined letter as seen flat on screen (foreshortened by the flip), offset +0.20, −0.17
    vec2 dw = w - vec2(.2, -.17) - uPos[i].xy, u = vec2(cos(uTilt[i]), sin(uTilt[i]));
    vec2 s = vec2(dot(dw, u) / uCos[i], dot(dw, vec2(-u.y, u.x)));
    if (d2(i, s / uScale[i]) - .09 < 0.) return vec4(hsv(2. * uT + .13 * float(i)), 1.);
  }
  return background(w);
}

void main() {
  vec2 px = gl_FragCoord.xy;
  float sc = uRes.x / 800.;
  if (uGlitch == 1) {
    float band = floor(px.y / (14. * sc)), f = float(uFrame);
    if (hash(band + f * 13.) < .3) px.x += (hash(band * 3.1 + f) - .5) * 60. * sc;
    float sh = (6. + 6. * hash(f)) * sc;
    vec4 a = scene(px + vec2(sh, 0.)), b = scene(px), c = scene(px - vec2(sh, 0.));
    o = vec4(a.r * a.a, b.g * b.a, c.b * c.a, max(a.a, max(b.a, c.a)));
    return;
  }
  vec4 c = scene(px);
  o = vec4(c.rgb * c.a, c.a);
}`;

const VERT = `#version 300 es
in vec2 p; void main() { gl_Position = vec4(p, 0., 1.); }`;

// ---- per-frame letter transforms (CPU side) --------------------------------
const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
function beat(t) {
  const x = (t * 4) % 1;
  const d = Math.min(x, 1 - x);
  return Math.exp(-0.5 * (d / 0.08) ** 2);
}
function rotY(a) {
  const c = Math.cos(a), s = Math.sin(a);
  return [c, 0, s, 0, 1, 0, -s, 0, c];
}
function rotZ(a) {
  const c = Math.cos(a), s = Math.sin(a);
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}
function mul(a, b) {
  const r = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
  return r;
}
const colMajor = (m) => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];

export function layout(text) {
  const chars = [...text.toUpperCase()].filter((c) => LETTERS[c]).slice(0, MAX_L);
  const width = chars.reduce((s, c) => s + LETTERS[c][0], 0) + GAP * (chars.length - 1);
  let x = -width / 2;
  const segs = [];
  const letters = chars.map((c) => {
    const [w, strokes] = LETTERS[c];
    const start = segs.length;
    for (const [ax, ay, bx, by] of strokes) segs.push([ax - w / 2, ay - 0.7, bx - w / 2, by - 0.7]);
    const l = { c, w, cx: x + w / 2, start, count: strokes.length, rad: Math.hypot(w / 2 + 0.32, 0.7 + 0.32) };
    x += w + GAP;
    return l;
  });
  return { letters, segs, width };
}

export function frameUniforms(letters, t) {
  const inv = [], pos = [], scale = [], cos = [], tilts = [];
  letters.forEach((l, j) => {
    const flip = 2 * Math.PI * smooth((((t - 0.045 * j) % 1) + 1) % 1 / 0.3);
    const tilt = 0.18 * Math.sin(2 * Math.PI * t + 0.9 * j);
    const bounce = 0.28 * Math.abs(Math.sin(4 * Math.PI * t - 0.5 * j));
    const s = 1 + 0.1 * beat(t) + 0.04 * Math.sin(2 * Math.PI * 2 * t + j);
    inv.push(...colMajor(mul(rotY(-flip), rotZ(-tilt))));
    pos.push(l.cx, bounce - 0.14, 0);
    scale.push(s);
    cos.push(Math.cos(flip));
    tilts.push(tilt);
  });
  return { inv, pos, scale, cos, tilts };
}

// Mount the logo on a canvas. Returns null if WebGL2 isn't available (keep the fallback image).
export function mountLogo(canvas, { text = 'DATAMUSAK', still = false, frame: fixedFrame, margin = 0.8 } = {}) {
  const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, alpha: true, antialias: false, preserveDrawingBuffer: fixedFrame !== undefined });
  if (!gl) return null;
  // On software rasterizers (no GPU) the raymarcher would hog the CPU: use the static image.
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : '';
  if (fixedFrame === undefined && /swiftshader|llvmpipe|software|basic render/i.test(renderer)) return null;
  const prog = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, VERT], [gl.FRAGMENT_SHADER, FRAG]]) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.warn('logo shader:', gl.getShaderInfoLog(sh));
      return null;
    }
    gl.attachShader(prog, sh);
  }
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const U = (n) => gl.getUniformLocation(prog, n);

  const { letters, segs, width } = layout(text);
  gl.uniform1i(U('uN'), letters.length);
  gl.uniform4fv(U('uSeg'), new Float32Array(segs.flat()));
  gl.uniform2iv(U('uRange'), new Int32Array(letters.flatMap((l) => [l.start, l.count])));
  gl.uniform1fv(U('uRad'), new Float32Array(letters.map((l) => l.rad)));

  let frame = fixedFrame ?? 0;
  // render scale: 2 = 2×2 supersampling; dropped automatically on slow GPUs
  let quality = 2;
  let probes = 0;
  let slow = 0;
  let glitchUntil = -1;
  let timer = 0;
  let visible = true;

  function size() {
    const r = canvas.getBoundingClientRect();
    // 2×2 supersampling relative to the CSS size, capped at the design size × 2
    const w = Math.min(800 * quality, Math.max(64, Math.round(r.width * quality)));
    const h = Math.max(32, Math.round((w * (r.height || 1)) / (r.width || 1)));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    const aspect = w / h;
    let vw = width / 2 + margin;
    let vh = vw / aspect;
    if (vh < 1.3) {
      vh = 1.3;
      vw = vh * aspect;
    }
    gl.uniform2f(U('uRes'), w, h);
    gl.uniform2f(U('uView'), vw, vh);
    gl.uniform1f(U('uD'), 12);
    gl.uniform1f(U('uPx'), (vw * 2) / w * 2);
  }

  function draw() {
    const t = frame / FRAMES;
    const u = frameUniforms(letters, t);
    gl.uniform1f(U('uT'), t);
    gl.uniform1i(U('uFrame'), frame);
    gl.uniform1i(U('uGlitch'), GLITCH_FRAMES.includes(frame) || frame === glitchUntil ? 1 : 0);
    gl.uniformMatrix3fv(U('uInv'), false, new Float32Array(u.inv));
    gl.uniform3fv(U('uPos'), new Float32Array(u.pos));
    gl.uniform1fv(U('uScale'), new Float32Array(u.scale));
    gl.uniform1fv(U('uCos'), new Float32Array(u.cos));
    gl.uniform1fv(U('uTilt'), new Float32Array(u.tilts));
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function tick() {
    timer = setTimeout(tick, 1000 / FPS);
    if (!visible || document.hidden) return;
    frame = (frame + 1) % FRAMES;
    if (probes < 8) {
      // measure a few frames end-to-end; if the GPU can't keep 15 fps, render fewer pixels
      const t0 = performance.now();
      draw();
      gl.finish();
      probes++;
      if (performance.now() - t0 > 40 && ++slow >= 2 && quality > 0.5) {
        quality = quality > 1 ? 1 : 0.5;
        slow = 0;
        probes = 0;
        size();
      }
      return;
    }
    draw();
  }

  size();
  draw();
  const ro = new ResizeObserver(() => {
    size();
    draw();
  });
  ro.observe(canvas);
  const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
  io.observe(canvas);
  if (!still && fixedFrame === undefined) timer = setTimeout(tick, 1000 / FPS);

  return {
    // A short burst of VHS glitch (on interaction).
    glitch() {
      glitchUntil = (frame + 1) % FRAMES;
      if (still) {
        const keep = frame;
        frame = glitchUntil;
        draw();
        frame = keep;
        setTimeout(draw, 140);
      }
    },
    draw(f) {
      frame = f;
      draw();
    },
    destroy() {
      clearTimeout(timer);
      ro.disconnect();
      io.disconnect();
    },
  };
}
