varying vec2 vUv;

uniform sampler2D uVelocity;
uniform sampler2D uSource;
uniform vec2 uCellSize;
uniform float uDissipation;
uniform float uTravelScale;

void main() {
  vec2 velocity = texture2D(uVelocity, vUv).xy;
  vec3 dye = max(texture2D(uSource, vUv - velocity * uCellSize * uTravelScale).rgb, vec3(0.0));
  gl_FragColor = vec4(dye * uDissipation, 1.0);
}
