varying vec2 vUv;

uniform sampler2D uTarget;
uniform vec2 uPoint;
uniform vec3 uColor;
uniform float uRadius;

void main() {
  vec3 base = max(texture2D(uTarget, vUv).rgb, vec3(0.0));
  float dist = length(vUv - uPoint);
  float mask = exp(-dist * dist / uRadius);
  gl_FragColor = vec4(mix(base, uColor, mask * 0.16), 1.0);
}
