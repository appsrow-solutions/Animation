varying float vZPos;
varying float vRecess;
varying float vFold;
varying float vBendRound;
varying float vClothWarp;
varying vec2 vUv;

uniform float u_time;
uniform float u_zScale;

void main() {
  vUv = uv;
  vec3 pos = position;
  float clothDepth = pos.z / max(u_zScale, 1.0);

  vRecess = 0.0;
  vFold = 0.0;
  vBendRound = 0.0;
  vZPos = clothDepth;
  vClothWarp = clothDepth * 3.0 + sin((uv.x + uv.y) * 8.0 + u_time * 0.75) * 0.015;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
