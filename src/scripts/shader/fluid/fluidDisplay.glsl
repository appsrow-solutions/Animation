varying vec2 vUv;

uniform sampler2D uDye;
uniform sampler2D uVelocity;
uniform vec3 uBgColor;
uniform float uVisibility;

void main() {
  vec2 vel = texture2D(uVelocity, vUv).xy;
  float speed = length(vel);
  vec2 dir = speed > 0.0001 ? vel / speed : vec2(1.0, 0.0);
  vec2 perp = vec2(-dir.y, dir.x);

  float wave = sin(dot(vUv, perp) * 52.0 + speed * 65.0) * 0.5 + 0.5;
  float wave2 = sin(dot(vUv, dir) * 38.0 - speed * 50.0 + vUv.y * 14.0) * 0.5 + 0.5;
  float roll = sin(vUv.x * 28.0 + speed * 35.0) * 0.5 + 0.5;
  float ripple = mix(mix(wave, wave2, 0.5), roll, 0.25);

  vec2 driftUv = vUv - vel * 0.04;
  float density = length(texture2D(uDye, driftUv).rgb);
  float soft = smoothstep(0.002, 0.034, density) * mix(0.5, 1.0, ripple) * uVisibility;
  if (soft < 0.01) discard;

  vec3 highlight = uBgColor + vec3(0.035, 0.035, 0.03);
  vec3 shade = uBgColor - vec3(0.018, 0.018, 0.016);
  vec3 color = mix(shade, highlight, soft);
  float alpha = soft * 0.09;

  gl_FragColor = vec4(color, alpha);
}
