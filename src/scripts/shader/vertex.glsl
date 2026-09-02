varying float vZPos;
varying float vRecess;
varying float vFold;
varying float vBendRound;
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

uniform float u_foldWaveAmp;
uniform float u_foldWaveFreq;
uniform float u_foldWaveSpeed;
uniform float u_foldBobAmp;
uniform float u_foldBobSpeed;

uniform float u_archAmount;
uniform float u_cornerRadius;
uniform float u_topRollStrength;
uniform float u_stackBias;

float quintic(float x) {
  return x * x * x * (x * (x * 6.0 - 15.0) + 10.0);
}

void main() {
  vUv = uv;
  vec3 pos = position;

  // Water ripple — kept for idle feel, fully muted once wrapping
  float ripple = sin(pos.y * u_waveY + u_time * 2.0) * 0.024
               + sin(pos.x * u_waveX - u_time * 1.5) * 0.016;

  vec3 worldPos = vec3(modelMatrix * vec4(pos, 1.0));

  // Stable cylinder — no timed edgeWave on the fold line
  float foldStart = u_bendPoint.x;
  float foldEnd = u_bendPoint.y;
  float R = max((foldEnd - foldStart) * 0.92, u_foldDepth * 0.38);

  float dy = worldPos.y - foldStart;
  float foldBand = 0.0;
  float recessT = 0.0;

  float maxTheta = 1.35;

  if (dy > 0.0) {
    float theta = dy / R;
    float wrapTheta = min(theta, maxTheta);
    float s = sin(wrapTheta);
    float c = cos(wrapTheta);
    float overshoot = max(dy - R * maxTheta, 0.0);

    // Cap progress 0→1 — past the stack window, pose freezes (no endless slide)
    float tLin = clamp(overshoot / max(u_stackFadeHeight, 1.0), 0.0, 1.0);
    recessT = quintic(tLin);

    float lipY = foldStart + R * s;
    float lipZ = -R * (1.0 - c);

    // Dive down, then curve upward into the vanishing stack
    float dive = sin(recessT * 3.14159265);
    float rise = recessT * recessT;
    float downDist = u_foldDepth * 0.7 * u_recessDownRatio;
    float upDist = u_foldDepth * 1.05;

    float yTarget = lipY - dive * downDist + rise * upDist;
    float zTarget = lipZ - recessT * u_recessDepth;

    pos.y += yTarget - worldPos.y;
    pos.z += zTarget;

    foldBand = smoothstep(0.0, maxTheta, wrapTheta);
    foldBand = foldBand * foldBand * (3.0 - 2.0 * foldBand);
  }

  float archZ = sin(clamp(recessT, 0.0, 1.0) * 3.14159265) * u_archAmount;
  pos.z += archZ * recessT;

  pos.z -= u_stackBias * (0.15 + recessT * 0.85);

  float rippleMask = (1.0 - foldBand) * (1.0 - recessT);
  rippleMask *= rippleMask;
  pos.z += ripple * u_zScale * rippleMask;

  vRecess = recessT;
  vFold = foldBand;
  vBendRound = u_cornerRadius * foldBand * (1.0 - recessT) * 0.55;
  vZPos = ripple * rippleMask;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
