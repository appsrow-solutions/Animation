varying float vZPos;
varying float vRecess;
varying float vFold;
varying float vBendRound;
varying vec2 vUv;

uniform sampler2D u_texture;
uniform sampler2D u_overlay;
uniform float u_hasTexture;
uniform float u_hasOverlay;
uniform float u_imageAspect;
uniform float u_cardAspect;
uniform float u_fitContain;
uniform float u_videoZoom;
uniform float u_heightBoost;
uniform vec3 u_color;
uniform vec3 u_bgColor;
uniform float u_alphaFadeNear;
uniform float u_alphaFadeFar;
uniform float u_fogNear;
uniform float u_fogFar;
uniform float u_opacity;

vec2 coverUv(vec2 uv, float imageAspect, float cardAspect) {
  float ratio = imageAspect / max(cardAspect, 0.0001);
  vec2 scale = vec2(1.0);

  if (ratio > 1.0) {
    scale.x = 1.0 / ratio;
  } else {
    scale.y = ratio;
  }

  return (uv - 0.5) * scale + 0.5;
}

// object-fit: contain — full source visible, letterboxed if needed
vec2 containUv(vec2 uv, float imageAspect, float cardAspect) {
  float ratio = imageAspect / max(cardAspect, 0.0001);
  vec2 scale = vec2(1.0);

  if (ratio > 1.0) {
    scale.y = ratio;
  } else {
    scale.x = 1.0 / max(ratio, 0.0001);
  }

  return (uv - 0.5) * scale + 0.5;
}

// Wide enough to kill staircasing at rest, capped so the extreme
// foreshortening at the crest of the drum can't smear the edge into
// a broad translucent band
float edgeFeather(float sdf) {
  return clamp(fwidth(sdf) * 2.25, 0.0015, 0.005);
}

// Soft top-corner mask only while the card is wrapping the cylinder.
float topCornerRoundMask(vec2 uv, float radiusUv) {
  float r = clamp(radiusUv, 0.0, 0.22);
  if (r < 0.001) return 1.0;

  vec2 p = uv - 0.5;
  float rTop = p.y > 0.0 ? r : 0.0;
  vec2 q = abs(p) - vec2(0.5) + rTop;
  float sdf = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - rTop;

  float aa = edgeFeather(sdf);
  return 1.0 - smoothstep(-aa, aa, sdf);
}

// Subtle always-on rounded corners for all cards
float roundedRectMask(vec2 uv, float radiusUv) {
  float r = clamp(radiusUv, 0.0, 0.2);
  if (r < 0.001) return 1.0;
  vec2 p = uv - 0.5;
  vec2 b = vec2(0.5 - r);
  vec2 q = abs(p) - b;
  float sdf = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;

  float aa = edgeFeather(sdf);
  return 1.0 - smoothstep(-aa, aa, sdf);
}

void main() {
  vec3 col = u_color;

  if (u_hasTexture > 0.5) {
    // u_fitContain: 0 = cover (may crop), 1 = contain (letterbox), 2 = stretch fill
    if (u_fitContain > 1.5) {
      vec2 uv = vUv;
      float boost = max(u_heightBoost, 0.0001);
      uv.x = (uv.x - 0.5) / boost + 0.5;
      uv = (uv - 0.5) / max(u_videoZoom, 0.0001) + 0.5;
      if (uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0) {
        col = texture2D(u_texture, uv).rgb;
      } else {
        col = vec3(0.0);
      }
    } else if (u_fitContain > 0.5) {
      vec2 uv = containUv(vUv, u_imageAspect, u_cardAspect);
      uv = (uv - 0.5) / max(u_videoZoom, 0.0001) + 0.5;
      if (uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0) {
        col = texture2D(u_texture, uv).rgb;
      } else {
        col = u_bgColor;
      }
    } else {
      vec2 uv = coverUv(vUv, u_imageAspect, u_cardAspect);
      uv = (uv - 0.5) / max(u_videoZoom, 0.0001) + 0.5;
      col = texture2D(u_texture, uv).rgb;
    }
  }

  if (u_hasOverlay > 0.5) {
    vec4 overlay = texture2D(u_overlay, vUv);
    col = mix(col, overlay.rgb, overlay.a);
  }

  col += vZPos * 2.2 * (1.0 - vRecess);

  float foldLight = smoothstep(0.05, 1.0, vFold) * (1.0 - vRecess * 0.5);
  col = mix(col, u_bgColor, foldLight * 0.22);

  col *= 1.0 - vRecess * 0.12;
  col = mix(col, u_bgColor, vRecess * 0.35);

  float depth = gl_FragCoord.z / gl_FragCoord.w;

  float alphaFade = smoothstep(u_alphaFadeFar, u_alphaFadeNear, depth);
  float fogFactor = smoothstep(u_fogNear, u_fogFar, depth);
  fogFactor *= mix(1.0, 0.1, u_hasTexture);

  col = mix(col, u_bgColor, fogFactor);

  float foldAlpha = 1.0 - foldLight * 0.12;
  float stackFade = smoothstep(0.2, 0.78, vRecess);
  float alpha = min(alphaFade * u_opacity * foldAlpha * (1.0 - stackFade), 1.0);

  alpha *= roundedRectMask(vUv, 0.022);
  alpha *= topCornerRoundMask(vUv, vBendRound);

  if (alpha < 0.002) discard;

  gl_FragColor = vec4(col, alpha);
}
