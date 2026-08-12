varying float vZPos;
varying float vRecess;
varying vec2 vUv;

uniform float u_time;
uniform float u_waveX;
uniform float u_waveY;
uniform float u_zScale;
uniform vec2 u_bendPoint;
uniform float u_recessDepth;
uniform float u_recessDownRatio;
uniform float u_stackFadeHeight;
uniform float u_foldDepth;

float quintic(float x) {
  return x * x * x * (x * (x * 6.0 - 15.0) + 10.0);
}

void main() {
  vUv = uv;
  vec3 pos = position;

float ripple = sin(pos.y * u_waveY + u_time * 2.0) * 0.032
            + sin(pos.x * u_waveX - u_time * 1.5) * 0.022;

  vec3 worldPos = vec3(modelMatrix * vec4(pos, 1.0));

  float foldEnd = u_bendPoint.y;
  float foldBand = quintic(smoothstep(u_bendPoint.x, foldEnd, worldPos.y));
  float aboveLine = max(worldPos.y - foldEnd, 0.0);

  float recessT = quintic(smoothstep(0.0, u_stackFadeHeight, aboveLine));

  pos.z -= foldBand * u_foldDepth * (1.0 - recessT * 0.35);
  pos.y -= aboveLine * u_recessDownRatio;
  pos.z -= recessT * u_recessDepth;
  pos.z += ripple * u_zScale * 1.4 * (1.0 - recessT);

  vRecess = recessT;
  vZPos = ripple;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
