/**
 * The only shader pair in the game. All surface detail (windows, water,
 * asphalt grain, soft shadow) is computed here from world position, so the
 * game ships zero texture bytes.
 */

export const VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec3 aColor;
layout(location = 3) in float aMat;
uniform mat4 uProj, uView, uModel;
uniform float uTime;
out vec3 vPos;
out vec3 vNormal;
out vec3 vColor;
flat out int vMat;
void main() {
  vec4 w = uModel * vec4(aPos, 1.0);
  if (aMat > 7.5) w.xz += sin(uTime * vec2(1.7, 1.3) + w.zx * 0.25) * 0.15; // wind sways the leaves
  vPos = w.xyz;
  vNormal = mat3(uModel) * aNormal;
  vColor = aColor;
  vMat = int(aMat + 0.5);
  gl_Position = uProj * uView * w;
}`;

export const FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec3 vPos;
in vec3 vNormal;
in vec3 vColor;
flat in int vMat;
uniform vec3 uEye, uSunDir, uFogColor;
uniform float uFogDensity, uTime;
out vec4 outColor;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

// Procedural facade. g = (window column width, floor height) in metres.
vec3 facade(vec3 base, vec3 n, vec2 g, bool platte) {
  vec2 p = vec2(dot(vPos.xz, vec2(n.z, -n.x)), vPos.y - 0.15);
  vec2 cell = floor(p / g), f = fract(p / g);
  float r = hash(cell);
  bool shop = !platte && cell.y < 1.0;
  vec2 lo = shop ? vec2(0.08, 0.06) : vec2(0.3, 0.28);
  vec2 hi = shop ? vec2(0.92, 0.75) : vec2(0.7, 0.8);
  float win = step(lo.x, f.x) * step(f.x, hi.x) * step(lo.y, f.y) * step(f.y, hi.y);
  vec3 glass = mix(vec3(0.1, 0.13, 0.17), vec3(0.42, 0.5, 0.58), r * r);
  if (shop) glass = r > 0.65 ? vec3(0.85, 0.72, 0.45) : vec3(0.16, 0.18, 0.2);
  vec3 c = base;
  if (platte && (f.x < 0.03 || f.y < 0.05)) c *= 0.8;         // panel joints
  if (!platte && f.y > 0.86 && f.y < 0.93) c *= 0.88;         // cornice band
  return mix(c, glass, win);
}

void main() {
  vec3 n = normalize(vNormal);
  vec3 c = vColor;
  float alpha = 1.0, spec = 0.0;
  bool wall = abs(n.y) < 0.5;

  if (vMat == 1 && wall) c = facade(c, n, vec2(3.0, 3.6), false);
  else if (vMat == 2 && wall) c = facade(c, n, vec2(3.2, 2.8), true);
  else if (vMat == 3) {
    float w = sin(vPos.x * 0.35 + uTime * 1.3) + sin(vPos.z * 0.6 - uTime * 0.9 + vPos.x * 0.2);
    n = normalize(vec3(w * 0.06, 1.0, w * 0.04));
    spec = 0.6;
  }
  else if (vMat == 4) c *= 0.96 + 0.06 * hash(floor(vPos.xz * 4.0));
  else if (vMat == 5) spec = 0.35;
  else if (vMat == 6) {
    alpha = 0.55 * (1.0 - smoothstep(0.5, 1.0, length(vColor.xy)));
    c = vec3(0.0);
  }
  if (wall && vMat < 3) c *= mix(0.72, 1.0, clamp(vPos.y / 5.0, 0.0, 1.0)); // fake ambient occlusion

  vec3 v = normalize(uEye - vPos);
  float diff = max(dot(n, uSunDir), 0.0);
  vec3 sky = mix(vec3(0.32, 0.3, 0.28), vec3(0.62, 0.7, 0.82), 0.5 + 0.5 * n.y);
  vec3 col = c * (vec3(1.0, 0.95, 0.86) * diff * 0.8 + sky * 0.55);
  col += spec * pow(max(dot(n, normalize(uSunDir + v)), 0.0), 48.0);
  if (vMat == 7) col = c; // glowing: unlit
  float d = length(uEye - vPos) * uFogDensity;
  col = mix(col, uFogColor, 1.0 - exp(-d * d));
  outColor = vec4(col, alpha);
}`;
