import * as THREE from "three";
import Lenis from "lenis";
import fragment from "./shader/fragment.glsl?raw";
import vertex from "./shader/vertex.glsl?raw";
import FluidSimulation from "./fluid/FluidSimulation.js";
import projects from "./data/projects.json";

const GAP_X = 120;
const GAP_Y = 220;
const GAP_Y_MOBILE = 120;
const COLS_DESKTOP = 2;
const COLS_MOBILE = 1;
const MOBILE_BREAKPOINT = 1024;
const SEG = 36;
const SEG_MOBILE = 24;
const WORLD_PER_PIXEL = 4.2;
const PIXEL_RATIO_CAP = 1;
const RECESS_DEPTH = 2400;
const RECESS_DOWN_RATIO = 0.94;
const RECESS_DOWN_RATIO_MOBILE = 0.52;
const STACK_ROWS = 0.55;
const CAMERA_Z = 3000;
const FOLD_DEPTH = 820;
const FOLD_DEPTH_REF_HEIGHT = 820;
const FOLD_DEPTH_MOBILE_CAP = 480;
// Far planes pushed out so recessed/downward cards stay visible in the tunnel
const ALPHA_FADE_NEAR = CAMERA_Z * 0.82;
const ALPHA_FADE_FAR = CAMERA_Z * 2.45;
const FOG_NEAR = CAMERA_Z * 0.95;
const FOG_FAR = CAMERA_Z * 2.15;
const CARD_SCALE = 0.81;
const CARD_SCALE_MOBILE = 0.88;
const CARD_ASPECT = 1.58;
// Extra height only (width stays from CARD_SCALE)
const CARD_HEIGHT_BOOST = 1.21;
// Mild mask radius while wrapping (geometry is the real cylinder)
const CORNER_RADIUS_UV = 0.08;
const TOP_ROLL_STRENGTH = 1.0;
const VIDEO_ZOOM = 1.0;
// Decode only near-viewport cards. Files stay in memory (blob) so pause
// never re-downloads — VideoTexture keeps the last frame while paused.
const VIDEO_CULL_INTERVAL_MS = 100;
const MAX_PLAYING_DESKTOP = 6;
const MAX_PLAYING_MOBILE = 3;
const VIDEO_LOAD_CONCURRENCY = 2;
const VIDEO_VIEW_MARGIN = 1.35;
// Only fetch/decodes the first rows before unlock — rest load in background
const VIDEO_INITIAL_ROWS = 2;
const VIDEO_PREFETCH_MARGIN = 2.8;
const VIDEO_PREFETCH_INTERVAL_MS = 350;
const VIDEO_IDLE_PREFETCH_MS = 450;

// Webflow button-icon variant: arrow-up-right (↗)
const ARROW_GLYPH = "↗";

const CARD_OPACITY = 2.8;
const BG_COLOR = 0xf0f0ee;
// Keep fallback exactly equal to page background (no different card tint)
const CARD_FALLBACK_COLOR = BG_COLOR;
// Higher under the heading — slider + cylinder travel together
const START_Y_OFFSET = -40;
const SCROLL_END_PADDING_PX = 0;
// Keep last card a little above the viewport bottom at scroll end
const SCROLL_END_BOTTOM_CLEARANCE = 0.045;


export default class Sketch {
  constructor(options) {
    this.container = options.dom;
    this.scrollSpacer = options.scrollSpacer;
    this.loaderEl = options.loader || null;
    this.loaderBar = options.loaderBar || null;
    this.loaderPct = options.loaderPct || null;
    this.width = this.container.offsetWidth;
    this.height = this.container.offsetHeight;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(BG_COLOR);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
      stencil: false,
      depth: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, PIXEL_RATIO_CAP));
    this.renderer.setSize(this.width, this.height);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.sortObjects = false;
    this.container.appendChild(this.renderer.domElement);

    this.fluid = new FluidSimulation(this.renderer, this.renderer.domElement, BG_COLOR);

    this.camera = new THREE.PerspectiveCamera(36, this.width / this.height, 1, 10000);
    this.camera.position.set(0, 0, CAMERA_Z);
    this.camera.lookAt(0, 0, 0);

    this.clock = new THREE.Clock();
    this.materials = [];
    this.cards = [];
    this.isPlaying = true;
    this.isReady = false;
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.hoverPointer = new THREE.Vector2();
    this.hasHoverPointer = false;
    this.hoverDirty = false;
    this.isHoveringCard = false;
    this.assetsTotal = Math.max(
      1,
      projects.filter((project, index) => {
        if (!project.image) return false;
        const row = Math.floor(index / this.getCols());
        return row < VIDEO_INITIAL_ROWS;
      }).length
    );
    this.assetsLoaded = 0;

    this.placeholderTexture = new THREE.DataTexture(
      new Uint8Array([228, 228, 226, 255]),
      1,
      1,
      THREE.RGBAFormat
    );
    this.placeholderTexture.colorSpace = THREE.SRGBColorSpace;
    this.placeholderTexture.needsUpdate = true;

    this.textureLoader = new THREE.TextureLoader();
    this.videoElements = [];
    this.videoSources = new Map();
    this.videoLoadQueue = [];
    this.videoLoadActive = 0;
    this.lastVideoCullAt = 0;
    this.lastVideoPrefetchAt = 0;
    this.renderFrame = this.render.bind(this);

    // Hidden pool keeps decoders on the GPU compositor path (smoother VideoTexture)
    this.videoPool = document.createElement("div");
    this.videoPool.setAttribute("aria-hidden", "true");
    this.videoPool.style.cssText =
      "position:fixed;width:0;height:0;overflow:hidden;opacity:0;pointer-events:none;";
    document.body.appendChild(this.videoPool);

    this.targetScrollY = 0;
    this.currentScrollY = 0;
    this.maxScrollPx = 0;
    this.foldLine = { start: 0, end: 0 };
    this.cols = this.getCols();
    this.cardWidth = 1000;
    this.cardHeight = 1000 / CARD_ASPECT;
    this.cardAspects = projects.map((p) => p.aspect || CARD_ASPECT);
    this.baseYOffset = 0;

    this.contentGroup = new THREE.Group();
    this.scene.add(this.contentGroup);

    document.documentElement.classList.add("is-loading");
    document.documentElement.classList.remove("is-ready");

    this.addCards();
    this.updateFoldLine();
    this.updateContentOffset();
    this.updateScrollSpacer();
    this.setupScroll();
    this.setupCardClicks();
    this.setupCardHover();
    this.resize();
    this.render();
    this.setupResize();
    this.updateLoaderProgress();

    // Don't leave users stuck if media stalls
    window.setTimeout(() => {
      if (!this.isReady) this.revealExperience();
    }, 60000);
  }

  getCols() {
    return window.innerWidth < MOBILE_BREAKPOINT ? COLS_MOBILE : COLS_DESKTOP;
  }

  getSegmentCount() {
    return this.cols === 1 ? SEG_MOBILE : SEG;
  }

  getGapX() {
    return this.cols > 1 ? GAP_X : 0;
  }

  getGapY() {
    return this.cols === 1 ? GAP_Y_MOBILE : GAP_Y;
  }

  getCardScale() {
    return this.cols === 1 ? CARD_SCALE_MOBILE : CARD_SCALE;
  }

  getRowCount() {
    return Math.ceil(projects.length / this.cols);
  }

  getVisibleHeight() {
    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    return 2 * Math.tan(vFov * 0.5) * this.camera.position.z;
  }

  getVisibleWidth() {
    return this.getVisibleHeight() * this.camera.aspect;
  }

  getCardWidth() {
    const visibleW = this.getVisibleWidth();
    const gaps = this.getGapX() * Math.max(0, this.cols - 1);
    return ((visibleW * 0.96 - gaps) / this.cols) * this.getCardScale();
  }

  getCardAspect(index) {
    return this.cardAspects[index] || projects[index]?.aspect || CARD_ASPECT;
  }

  getProjectZoom(index) {
    const zoom = Number(projects[index]?.zoom);
    return Number.isFinite(zoom) && zoom > 0 ? zoom : VIDEO_ZOOM;
  }

  // Map media into the taller card geometry without squashing circles.
  applyMediaFitUniforms(material, index, mediaAspect) {
    const zoom = this.getProjectZoom(index);

    material.uniforms.u_imageAspect.value = mediaAspect;
    material.uniforms.u_cardAspect.value = mediaAspect;
    material.uniforms.u_videoZoom.value = zoom;
    // Cards are CARD_HEIGHT_BOOST taller than media aspect — undo that in the shader
    // for zoomed clips so spheres stay round instead of oval.
    material.uniforms.u_heightBoost.value =
      zoom > 1.001 ? CARD_HEIGHT_BOOST : 1.0;
    material.uniforms.u_fitContain.value = 2.0;
  }

  getCardHeight(cardWidth = this.cardWidth) {
    return (cardWidth / CARD_ASPECT) * CARD_HEIGHT_BOOST;
  }

  getCardHeightFor(index, cardWidth = this.cardWidth) {
    return (cardWidth / this.getCardAspect(index)) * CARD_HEIGHT_BOOST;
  }

  getRowHeight(row, cardWidth = this.cardWidth) {
    let maxH = 0;
    for (let col = 0; col < this.cols; col++) {
      const index = row * this.cols + col;
      if (index >= projects.length) break;
      maxH = Math.max(maxH, this.getCardHeightFor(index, cardWidth));
    }
    return maxH;
  }

  refreshReferenceHeight() {
    this.cardHeight = this.getRowHeight(0) || this.getCardHeight();
  }

  getMaxScrollWorld() {
    const rows = this.getRowCount();
    if (rows <= 1) return 0;

    const lastRow = rows - 1;
    const lastRowY = this.getCardY(lastRow);
    const lastRowH = this.getRowHeight(lastRow);

    const visibleHalf = this.getVisibleHeight() * 0.5;
    const bottomPad = this.getVisibleHeight() * SCROLL_END_BOTTOM_CLEARANCE;
    const targetCenterY = -visibleHalf + bottomPad + lastRowH * 0.5;
    const maxScroll = targetCenterY - this.baseYOffset - lastRowY;

    return Math.max(0, maxScroll);
  }

  updateScrollSpacer() {
    const maxScrollWorld = this.getMaxScrollWorld();
    const maxScrollPx = maxScrollWorld / WORLD_PER_PIXEL + SCROLL_END_PADDING_PX;
    this.maxScrollPx = maxScrollPx;
    this.scrollSpacer.style.height = `${maxScrollPx + window.innerHeight}px`;

    const currentPx = this.lenis ? this.lenis.scroll : window.scrollY;
    if (currentPx > maxScrollPx) {
      if (this.lenis) {
        this.lenis.scrollTo(maxScrollPx, { immediate: true });
      } else {
        window.scrollTo(0, maxScrollPx);
      }
      this.currentScrollY = maxScrollWorld;
      this.targetScrollY = maxScrollWorld;
    }
  }

  updateLoaderProgress() {
    const pct = Math.round((this.assetsLoaded / this.assetsTotal) * 100);
    if (this.loaderBar) this.loaderBar.style.width = `${pct}%`;
    if (this.loaderPct) this.loaderPct.textContent = `${pct}%`;
  }

  markAssetLoaded() {
    this.assetsLoaded = Math.min(this.assetsTotal, this.assetsLoaded + 1);
    this.updateLoaderProgress();

    // Reveal only when every media asset is fully ready
    if (!this.isReady && this.assetsLoaded >= this.assetsTotal) {
      this.revealExperience();
    }
  }

  revealExperience() {
    if (this.isReady) return;
    this.isReady = true;

    // Warm first frames before unlock
    requestAnimationFrame(() => {
      document.documentElement.classList.remove("is-loading");
      document.documentElement.classList.add("is-ready");
      if (this.loaderEl) {
        this.loaderEl.classList.add("is-done");
        this.loaderEl.setAttribute("aria-busy", "false");
      }

      if (this.lenis) {
        this.lenis.scrollTo(0, { immediate: true });
        this.lenis.start();
      } else {
        window.scrollTo(0, 0);
      }
      this.targetScrollY = 0;
      this.currentScrollY = 0;

      // Start only the cards near the camera — rest stay loaded & paused in memory
      this.lastVideoCullAt = 0;
      this.updateVideoPlayback(performance.now(), true);
      this.scheduleIdleVideoPrefetch();
    });
  }

  getVideoRow(index) {
    return Math.floor(index / this.cols);
  }

  shouldEagerLoadVideo(index) {
    return this.getVideoRow(index) < VIDEO_INITIAL_ROWS;
  }

  isVideoNearViewport(index) {
    const card = this.cards[index];
    if (!card) return this.shouldEagerLoadVideo(index);

    const visibleHalf = this.getVisibleHeight() * 0.5;
    const offsetY = this.contentGroup.position.y;
    const cardH = this.getCardHeightFor(index);
    const margin = cardH * VIDEO_PREFETCH_MARGIN;
    const worldY = card.position.y + offsetY;
    return worldY > -visibleHalf - margin && worldY < visibleHalf + margin;
  }

  requestVideoEntry(entry) {
    const { source } = entry;
    if (source.ready) {
      this.applyVideoSourceToCard(source, entry);
      return;
    }

    if (!source.waiters.includes(entry)) {
      source.waiters.push(entry);
    }
    this.attachVideoSource(source);
  }

  prefetchVideos(now = performance.now()) {
    if (now - this.lastVideoPrefetchAt < VIDEO_PREFETCH_INTERVAL_MS) return;
    this.lastVideoPrefetchAt = now;

    for (let i = 0; i < this.videoElements.length; i++) {
      const entry = this.videoElements[i];
      if (entry.source.ready || entry.prefetchScheduled) continue;
      if (!this.shouldEagerLoadVideo(entry.index) && !this.isVideoNearViewport(entry.index)) {
        continue;
      }
      entry.prefetchScheduled = true;
      this.requestVideoEntry(entry);
    }
  }

  scheduleIdleVideoPrefetch() {
    const pending = this.videoElements
      .filter((entry) => !entry.source.ready && !entry.prefetchScheduled)
      .sort((a, b) => a.index - b.index);

    pending.forEach((entry, i) => {
      entry.prefetchScheduled = true;
      window.setTimeout(() => {
        if (entry.source.ready) return;
        this.requestVideoEntry(entry);
      }, i * VIDEO_IDLE_PREFETCH_MS);
    });
  }

  updateContentOffset() {
    if (this.cols === 1) {
      const safeMargin = Math.max(180, this.cardHeight * 0.18);
      this.baseYOffset =
        this.foldLine.start - safeMargin - this.cardHeight * 0.5;
    } else {
      this.baseYOffset = START_Y_OFFSET;
    }
  }

  getCardY(row) {
    if (row <= 0) return 0;

    let y = 0;
    for (let r = 0; r < row; r++) {
      const h = this.getRowHeight(r);
      const nextH = this.getRowHeight(r + 1);
      y -= h * 0.5 + this.getGapY() + nextH * 0.5;
    }
    return y;
  }

  updateFoldLine() {
    if (this.cols === 1) {
      // Keep fold lower so scrolled cards don't sit tight under the heading
      const visibleH = this.getVisibleHeight();
      const visibleHalf = visibleH * 0.5;
      const foldRange = Math.max(140, this.cardHeight * 0.18);
      const foldCenter = visibleHalf - visibleH * 0.14;
      this.foldLine.start = foldCenter - foldRange * 0.55;
      this.foldLine.end = foldCenter + foldRange * 0.45;
      return;
    }

    // Unseen-style: cylinder cuts through the upper band of the resting first row
    // so tops roll over the drum instead of sitting as flat sharp bars above it.
    const foldRange = Math.max(220, this.cardHeight * 0.48);
    const cardTop = START_Y_OFFSET + this.cardHeight * 0.5;
    const foldStart = cardTop - this.cardHeight * 0.32;
    this.foldLine.start = foldStart;
    this.foldLine.end = foldStart + foldRange;
  }

  getFoldDepth() {
    const scaled = FOLD_DEPTH * (this.cardHeight / FOLD_DEPTH_REF_HEIGHT);
    if (this.cols === 1) {
      // Cap depth so tall 1-col cards don't elongate while dropping
      return Math.min(FOLD_DEPTH_MOBILE_CAP, scaled * 0.48);
    }
    return scaled;
  }

  getRecessDownRatio() {
    return this.cols === 1 ? RECESS_DOWN_RATIO_MOBILE : RECESS_DOWN_RATIO;
  }

  updateStackUniforms() {
    const stackHeight = (this.cardHeight + this.getGapY()) * STACK_ROWS;
    const foldDepth = this.getFoldDepth();
    const recessDown = this.getRecessDownRatio();
    this.materials.forEach((material) => {
      material.uniforms.u_stackFadeHeight.value = stackHeight;
      material.uniforms.u_recessDownRatio.value = recessDown;
      material.uniforms.u_foldDepth.value = foldDepth;
      material.uniforms.u_archAmount.value = foldDepth * 0.35;
    });
  }

  updateDepthUniforms() {
    this.materials.forEach((material) => {
      material.uniforms.u_alphaFadeNear.value = ALPHA_FADE_NEAR;
      material.uniforms.u_alphaFadeFar.value = ALPHA_FADE_FAR;
      material.uniforms.u_fogNear.value = FOG_NEAR;
      material.uniforms.u_fogFar.value = FOG_FAR;
    });
  }

  updateWaveUniforms() {
    this.materials.forEach((material, index) => {
      const aspect = this.getCardAspect(index);
      const height = this.getCardHeightFor(index);
      material.uniforms.u_waveY.value = 4.8 / height;
      material.uniforms.u_waveX.value = 5.4 / this.cardWidth;
      material.uniforms.u_zScale.value = height / 1.2;
      material.uniforms.u_cardAspect.value = aspect;
      material.uniforms.u_imageAspect.value = aspect;

      // Keep fold wave/bob at zero — timed fold motion shakes the cylinder
      material.uniforms.u_foldWaveAmp.value = 0.0;
      material.uniforms.u_foldWaveFreq.value = 6.0 / this.cardWidth;
      material.uniforms.u_foldBobAmp.value = 0.0;
      material.uniforms.u_cornerRadius.value = CORNER_RADIUS_UV;
      material.uniforms.u_topRollStrength.value =
        this.cols === 1 ? TOP_ROLL_STRENGTH * 0.7 : TOP_ROLL_STRENGTH;
    });
  }

  createMaterial(imageAspect = 1.9) {
    const foldDepth = this.getFoldDepth();
    const stackIndex = this.materials.length;
    const material = new THREE.ShaderMaterial({
      // DoubleSide so wrapped/downward faces stay visible on the cylinder
      side: THREE.DoubleSide,
      transparent: true,
      // false so stacked tunnel cards can show through (depth bias handles fight)
      depthWrite: false,
      depthTest: true,
      polygonOffset: true,
      polygonOffsetFactor: -stackIndex,
      polygonOffsetUnits: -stackIndex,
      uniforms: {
        u_time: { value: 0 },
        u_waveY: { value: 4.8 / this.cardHeight },
        u_waveX: { value: 5.4 / this.cardWidth },
        u_zScale: { value: this.cardHeight / 1.2 },
        u_bendPoint: {
          value: new THREE.Vector2(this.foldLine.start, this.foldLine.end),
        },
        u_foldDepth: { value: foldDepth },
        u_recessDepth: { value: RECESS_DEPTH },
        u_recessDownRatio: { value: RECESS_DOWN_RATIO },
        u_stackFadeHeight: { value: (this.cardHeight + this.getGapY()) * STACK_ROWS },
        u_alphaFadeNear: { value: ALPHA_FADE_NEAR },
        u_alphaFadeFar: { value: ALPHA_FADE_FAR },
        u_fogNear: { value: FOG_NEAR },
        u_fogFar: { value: FOG_FAR },
        u_opacity: { value: CARD_OPACITY },
        u_texture: { value: this.placeholderTexture },
        u_overlay: { value: this.placeholderTexture },
        u_hasTexture: { value: 0.0 },
        u_hasOverlay: { value: 0.0 },
        u_imageAspect: { value: imageAspect },
        u_cardAspect: { value: CARD_ASPECT },
        u_fitContain: { value: 0.0 },
        u_videoZoom: { value: 1.0 },
        u_heightBoost: { value: 1.0 },
        u_color: { value: new THREE.Color(CARD_FALLBACK_COLOR) },
        u_bgColor: { value: new THREE.Color(BG_COLOR) },
        u_noiseAmp: { value: 20.0 },
        u_noiseFreq: { value: 0.02 },
        u_edgeWaveAmp: { value: this.cardHeight * 0.04 },
        u_edgeWaveFreq: { value: 6.0 / this.cardWidth },
        u_edgeWaveSpeed: { value: 1.6 },
        u_edgeMaskHeight: { value: 0.14 },
        u_foldWaveAmp: { value: 0.0 },
        u_foldWaveFreq: { value: 6.0 / this.cardWidth },
        u_foldWaveSpeed: { value: 0.0 },
        u_foldBobAmp: { value: 0.0 },
        u_foldBobSpeed: { value: 0.0 },
        u_archAmount: { value: foldDepth * 0.35 },
        u_cornerRadius: { value: CORNER_RADIUS_UV },
        u_topRollStrength: { value: TOP_ROLL_STRENGTH },
        // Small per-card Z bias stops tunnel z-fighting
        u_stackBias: { value: stackIndex * 4.0 },
      },
      vertexShader: vertex,
      fragmentShader: fragment,
    });
    this.materials.push(material);
    return material;
  }

  applyMediaAspect(index, aspect, material) {
    const next = Math.max(0.5, aspect || CARD_ASPECT);
    const prev = this.cardAspects[index];
    this.cardAspects[index] = next;

    this.applyMediaFitUniforms(material, index, next);

    if (Math.abs(next - prev) > 0.01) {
      this.layoutCards(true);
      this.updateFoldLine();
      this.updateContentOffset();
    }
  }

  loadCardTexture(image, material) {
    const url = this.resolveImageUrl(image);
    const index = material.userData.projectIndex || 0;

    if (this.isVideoFile(url)) {
      this.loadCardVideo(url, material);
      return;
    }

    const img = new Image();
    img.decoding = "async";

    img.onload = () => {
      const aspect =
        (img.naturalWidth || img.width) / (img.naturalHeight || img.height || 1);

      const texture = this.createImageWithArrow(img, index, aspect);
      material.uniforms.u_texture.value = texture;
      material.uniforms.u_hasTexture.value = 1.0;
      material.userData.cardTexture = texture;
      this.applyMediaAspect(index, aspect, material);
      this.markAssetLoaded();
    };

    img.onerror = (error) => {
      console.warn(
        `Failed to load project image: ${url}\n` +
          `Put the file at: assets/projects/${image}`,
        error
      );
      this.markAssetLoaded();
    };

    img.src = url;
  }

  isVideoFile(url) {
    return /\.(mp4|webm|mov)$/i.test(url);
  }

  // One fetch + one decoder per unique file — duplicate cards share the same source
  getVideoSource(url) {
    let source = this.videoSources.get(url);
    if (source) return source;

    source = {
      url,
      blob: null,
      objectUrl: null,
      video: null,
      texture: null,
      aspect: CARD_ASPECT,
      ready: false,
      loading: null,
      waiters: [],
    };
    this.videoSources.set(url, source);
    return source;
  }

  fetchVideoSource(source) {
    if (source.blob) return Promise.resolve(source);
    if (source.loading) return source.loading;

    source.loading = fetch(source.url)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.blob();
      })
      .then((blob) => {
        source.blob = blob;
        source.objectUrl = URL.createObjectURL(blob);
        return source;
      })
      .catch((error) => {
        source.loading = null;
        throw error;
      });

    return source.loading;
  }

  applyVideoSourceToCard(source, entry) {
    const { material, index } = entry;
    if (material.userData.mediaReady) return;

    material.userData.mediaReady = true;

    const overlay = this.createOverlayTexture(index, source.aspect);
    material.userData.overlayTexture?.dispose?.();

    material.uniforms.u_texture.value = source.texture;
    material.uniforms.u_hasTexture.value = 1.0;
    material.uniforms.u_overlay.value = overlay;
    material.uniforms.u_hasOverlay.value = 1.0;
    material.userData.cardTexture = source.texture;
    material.userData.overlayTexture = overlay;
    material.userData.videoSource = source;

    this.applyMediaAspect(index, source.aspect, material);
    if (!this.isReady) {
      this.markAssetLoaded();
    }
  }

  attachVideoSource(source) {
    if (source.ready) return Promise.resolve();
    if (source.attachPromise) return source.attachPromise;

    source.attachPromise = this.fetchVideoSource(source)
      .then(() =>
        this.enqueueVideoLoad(
          () =>
            new Promise((resolve) => {
              if (source.ready) {
                resolve();
                return;
              }

              if (!source.video) {
                const video = document.createElement("video");
                video.loop = true;
                video.muted = true;
                video.playsInline = true;
                video.crossOrigin = "anonymous";
                video.setAttribute("playsinline", "");
                video.setAttribute("webkit-playsinline", "");
                video.preload = "auto";
                if ("disableRemotePlayback" in video) {
                  video.disableRemotePlayback = true;
                }
                this.videoPool.appendChild(video);
                source.video = video;
              }

              const video = source.video;
              const finish = () => {
                if (source.ready) {
                  resolve();
                  return;
                }
                source.ready = true;

                const vw = video.videoWidth || 1;
                const vh = video.videoHeight || 1;
                source.aspect = vw / vh;

                const texture = new THREE.VideoTexture(video);
                texture.colorSpace = THREE.SRGBColorSpace;
                texture.minFilter = THREE.LinearFilter;
                texture.magFilter = THREE.LinearFilter;
                texture.generateMipmaps = false;
                source.texture = texture;

                if (video.readyState >= 2) {
                  try {
                    video.currentTime = Math.min(
                      0.05,
                      (video.duration || 1) * 0.01
                    );
                  } catch {
                    /* ignore seek errors before metadata */
                  }
                }

                const waiters = source.waiters.splice(0);
                for (let i = 0; i < waiters.length; i++) {
                  this.applyVideoSourceToCard(source, waiters[i]);
                }

                if (this.isReady) {
                  this.updateVideoPlayback(performance.now(), true);
                }
                resolve();
              };

              const onError = (error) => {
                console.warn(`Failed to load project video: ${source.url}`, error);
                video.removeEventListener("canplaythrough", finish);
                for (let i = 0; i < source.waiters.length; i++) {
                  this.markAssetLoaded();
                }
                source.waiters = [];
                resolve();
              };

              video.addEventListener("canplaythrough", finish, { once: true });
              video.addEventListener(
                "loadeddata",
                () => {
                  window.setTimeout(finish, 600);
                },
                { once: true }
              );
              video.addEventListener("error", onError, { once: true });

              if (!video.src) {
                video.src = source.objectUrl || source.url;
                video.load();
              }
            })
        )
      )
      .catch((error) => {
        console.warn(
          `Blob fetch failed, falling back to URL: ${source.url}`,
          error
        );
        source.attachPromise = null;
        return this.enqueueVideoLoad(
          () =>
            new Promise((resolve) => {
              if (!source.video) {
                const video = document.createElement("video");
                video.loop = true;
                video.muted = true;
                video.playsInline = true;
                video.crossOrigin = "anonymous";
                video.setAttribute("playsinline", "");
                video.setAttribute("webkit-playsinline", "");
                video.preload = "auto";
                this.videoPool.appendChild(video);
                source.video = video;
              }
              source.video.src = source.url;
              source.video.load();
              resolve();
            })
        );
      });

    return source.attachPromise;
  }

  loadCardVideo(url, material) {
    const index = material.userData.projectIndex || 0;
    const source = this.getVideoSource(url);
    const entry = {
      source,
      material,
      index,
      playing: false,
      prefetchScheduled: false,
    };
    this.videoElements.push(entry);

    if (source.ready) {
      this.applyVideoSourceToCard(source, entry);
      if (this.isReady) this.updateVideoPlayback(performance.now(), true);
      return;
    }

    if (this.shouldEagerLoadVideo(index)) {
      entry.prefetchScheduled = true;
      this.requestVideoEntry(entry);
    }
  }

  // Limit concurrent video.load() calls so every card can decode
  enqueueVideoLoad(run) {
    return new Promise((resolve, reject) => {
      this.videoLoadQueue.push({ run, resolve, reject });
      this.drainVideoLoadQueue();
    });
  }

  drainVideoLoadQueue() {
    while (
      this.videoLoadActive < VIDEO_LOAD_CONCURRENCY &&
      this.videoLoadQueue.length
    ) {
      const job = this.videoLoadQueue.shift();
      this.videoLoadActive += 1;
      Promise.resolve()
        .then(() => job.run())
        .then(job.resolve, job.reject)
        .finally(() => {
          this.videoLoadActive -= 1;
          this.drainVideoLoadQueue();
        });
    }
  }

  // Play nearest sources only — one decoder per file, never reload on scroll
  updateVideoPlayback(now = performance.now(), force = false) {
    if (!force && now - this.lastVideoCullAt < VIDEO_CULL_INTERVAL_MS) return;
    this.lastVideoCullAt = now;
    if (!this.videoElements.length) return;

    const visibleHalf = this.getVisibleHeight() * 0.5;
    const offsetY = this.contentGroup.position.y;
    const maxPlaying =
      this.cols === 1 ? MAX_PLAYING_MOBILE : MAX_PLAYING_DESKTOP;

    const ranked = [];
    for (let i = 0; i < this.videoElements.length; i++) {
      const entry = this.videoElements[i];
      const card = this.cards[entry.index];
      const video = entry.source?.video;
      if (!card || !video) continue;

      const margin = this.getCardHeightFor(entry.index) * VIDEO_VIEW_MARGIN;
      const worldY = card.position.y + offsetY;
      const inBand =
        worldY > -visibleHalf - margin && worldY < visibleHalf + margin;
      ranked.push({ entry, source: entry.source, inBand, dist: Math.abs(worldY) });
    }

    ranked.sort((a, b) => a.dist - b.dist);

    const playingSources = new Set();
    let playingCount = 0;
    for (let i = 0; i < ranked.length; i++) {
      const { source, inBand } = ranked[i];
      if (!inBand || playingCount >= maxPlaying || playingSources.has(source)) {
        continue;
      }
      playingSources.add(source);
      playingCount += 1;
    }

    this.videoSources.forEach((source) => {
      if (!source.video) return;
      const shouldPlay = playingSources.has(source);
      if (shouldPlay && source.video.paused) {
        source.video.play().catch(() => {});
      } else if (!shouldPlay && !source.video.paused) {
        source.video.pause();
      }
    });

    for (let i = 0; i < this.videoElements.length; i++) {
      const entry = this.videoElements[i];
      entry.playing = playingSources.has(entry.source);
    }
  }

  createOverlayTexture(index = 0, aspect = CARD_ASPECT) {
    const width = 512;
    const height = Math.max(1, Math.round(width / aspect));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, width, height);
    this.drawIndexAndArrow(ctx, width, height, index);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }

  createImageWithArrow(image, index = 0, aspect = CARD_ASPECT) {
    const width = 1024;
    const height = Math.max(1, Math.round(width / aspect));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = "#f0f0ee";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(image, 0, 0, width, height);
    this.drawIndexAndArrow(ctx, width, height, index);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    texture.needsUpdate = true;
    return texture;
  }

  drawIndexAndArrow(ctx, width, height, index) {
    const m = Math.min(width, height);
    const pad = m * 0.04;

    ctx.shadowColor = "rgba(0, 0, 0, 0.5)";
    ctx.shadowBlur = m * 0.02;
    ctx.fillStyle = "#ffffff";
    ctx.font = `600 ${Math.round(m * 0.038)}px Arial, sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(String(index + 1).padStart(2, "0"), pad, pad);

    this.drawArrow(ctx, width - pad, height - pad, m * 0.065);

    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
  }

  drawArrow(ctx, right, bottom, glyphHeight) {
    const tilt = 0.18; // radians — slight lean toward the right

    ctx.save();
    ctx.translate(right, bottom);
    ctx.rotate(tilt);
    ctx.fillStyle = "#ffffff";
    ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
    ctx.shadowBlur = glyphHeight * 0.28;
    ctx.shadowOffsetY = glyphHeight * 0.05;
    ctx.font = `500 ${Math.round(glyphHeight)}px Arial, "Segoe UI Symbol", sans-serif`;
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillText(ARROW_GLYPH, 0, 0);
    ctx.restore();
  }

  resolveImageUrl(image) {
    if (image.startsWith("http://") || image.startsWith("https://")) {
      return image;
    }

    if (image.startsWith("assets/") || image.startsWith("./")) {
      return image.startsWith("./") ? image : `/${image}`;
    }

    return `/assets/projects/${image}`;
  }

  getColX() {
    if (this.cols === 1) return [0];

    const step = this.cardWidth + this.getGapX();
    return [-(step) * 0.5, step * 0.5];
  }

  addCards() {
    this.cols = this.getCols();
    this.cardWidth = this.getCardWidth();
    this.refreshReferenceHeight();
    const colX = this.getColX();

    projects.forEach((project, index) => {
      const row = Math.floor(index / this.cols);
      const col = index % this.cols;
      const aspect = this.getCardAspect(index);
      const height = this.getCardHeightFor(index);

      const geometry = new THREE.PlaneGeometry(
        this.cardWidth,
        height,
        this.getSegmentCount(),
        this.getSegmentCount()
      );
      const material = this.createMaterial(aspect);
      material.userData.projectIndex = index;
      this.applyMediaFitUniforms(material, index, aspect);
      const card = new THREE.Mesh(geometry, material);
      // Draw front cards later so transparent stacking stays stable
      card.renderOrder = index;

      card.position.set(colX[col], this.getCardY(row), 0);
      card.userData = {
        title: project.title,
        description: project.description,
        link: project.link,
      };

      this.contentGroup.add(card);
      this.cards.push(card);

      if (project.image) {
        this.loadCardTexture(project.image, material);
      } else {
        // Empty slots stay visible as soft blank cards until media is added
        material.uniforms.u_color.value.set(0xe4e4e2);
      }
    });

    this.refreshReferenceHeight();
    this.updateScrollSpacer();
    this.updateWaveUniforms();
    this.updateStackUniforms();
    this.updateDepthUniforms();
  }

  layoutCards(force = false) {
    const prevCols = this.cols;
    const nextCols = this.getCols();
    this.cols = nextCols;

    const newWidth = this.getCardWidth();
    const colsChanged = nextCols !== prevCols;
    if (!force && !colsChanged && Math.abs(newWidth - this.cardWidth) < 2) return;

    this.cardWidth = newWidth;
    this.refreshReferenceHeight();
    const colX = this.getColX();

    this.cards.forEach((card, i) => {
      const row = Math.floor(i / this.cols);
      const col = i % this.cols;
      const height = this.getCardHeightFor(i);
      const aspect = this.getCardAspect(i);

      card.geometry.dispose();
      card.geometry = new THREE.PlaneGeometry(
        this.cardWidth,
        height,
        this.getSegmentCount(),
        this.getSegmentCount()
      );
      card.scale.set(1, 1, 1);
      card.position.x = colX[col];
      card.position.y = this.getCardY(row);

      const material = card.material;
      if (material?.uniforms) {
        this.applyMediaFitUniforms(material, i, aspect);
      }
    });

    this.updateScrollSpacer();
    this.updateWaveUniforms();
    this.updateStackUniforms();
    this.updateDepthUniforms();
  }

  setupResize() {
    this.handleResize = this.resize.bind(this);
    window.addEventListener("resize", this.handleResize);
  }

  setupScroll() {
    this.lenis = new Lenis({
      duration: 1.4,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
      syncTouch: false,
      touchMultiplier: 1.4,
      wheelMultiplier: 0.85,
      autoRaf: false,
    });

    // Locked until loader finishes
    this.lenis.stop();

    this.lenis.on("scroll", ({ scroll }) => {
      if (!this.isReady) return;
      const scrollY = Math.min(scroll, this.maxScrollPx);
      // Lenis is the smooth layer — drive WebGL directly
      this.currentScrollY = scrollY * WORLD_PER_PIXEL;
      this.targetScrollY = this.currentScrollY;
      // Cards slide under a stationary cursor, so re-test hover
      if (this.hasHoverPointer) this.hoverDirty = true;
    });
  }

  setupCardClicks() {
    this.handleCardClick = (event) => {
      if (!this.isReady) return;
      const rect = this.renderer.domElement.getBoundingClientRect();
      this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      this.raycaster.setFromCamera(this.pointer, this.camera);
      const hits = this.raycaster.intersectObjects(this.cards);
      const link = hits[0]?.object.userData.link;
      if (link) {
        window.open(link, "_blank", "noopener,noreferrer");
      }
    };

    this.renderer.domElement.addEventListener("click", this.handleCardClick);
  }

  setupCardHover() {
    this.handlePointerMove = (event) => {
      if (event.pointerType === "touch") return;
      const rect = this.renderer.domElement.getBoundingClientRect();
      this.hoverPointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      this.hoverPointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      this.hasHoverPointer = true;
      this.hoverDirty = true;
    };

    this.handlePointerLeave = () => {
      this.hasHoverPointer = false;
      this.hoverDirty = false;
      this.setCardHover(false);
    };

    const canvas = this.renderer.domElement;
    canvas.addEventListener("pointermove", this.handlePointerMove);
    canvas.addEventListener("pointerleave", this.handlePointerLeave);
  }

  setCardHover(hovering) {
    if (hovering === this.isHoveringCard) return;
    this.isHoveringCard = hovering;
    this.renderer.domElement.style.cursor = hovering ? "pointer" : "";
  }

  // Runs at most once per frame, after world matrices are current
  updateHover() {
    if (!this.hoverDirty) return;
    this.hoverDirty = false;

    if (!this.isReady || !this.hasHoverPointer) {
      this.setCardHover(false);
      return;
    }

    this.raycaster.setFromCamera(this.hoverPointer, this.camera);
    const hit = this.raycaster.intersectObjects(this.cards, false)[0];
    this.setCardHover(Boolean(hit?.object.userData.link));
  }

  resize() {
    this.width = this.container.offsetWidth;
    this.height = this.container.offsetHeight;
    this.renderer.setSize(this.width, this.height);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.layoutCards();
    this.updateFoldLine();
    this.updateContentOffset();
    this.updateScrollSpacer();
  }

  updateUniforms(time) {
    if (!this.isReady) {
      this.contentGroup.position.y = this.baseYOffset;
      return;
    }

    const now = performance.now();
    this.contentGroup.position.y = this.baseYOffset + this.currentScrollY;

    this.fluid.update();

    const bendX = this.foldLine.start;
    const bendY = this.foldLine.end;

    for (let i = 0; i < this.materials.length; i++) {
      const uniforms = this.materials[i].uniforms;
      uniforms.u_time.value = time;
      uniforms.u_bendPoint.value.x = bendX;
      uniforms.u_bendPoint.value.y = bendY;
    }

    this.updateVideoPlayback(now);
    this.prefetchVideos(now);
  }

  render(time = 0) {
    if (!this.isPlaying) return;

    if (this.isReady) {
      this.lenis?.raf(time);
    }
    this.clock.getDelta();
    this.updateUniforms(this.clock.elapsedTime);

    requestAnimationFrame(this.renderFrame);
    this.renderer.render(this.scene, this.camera);
    this.updateHover();
    if (this.isReady) {
      this.fluid.renderOverlay();
    }
  }

  destroy() {
    this.isPlaying = false;
    if (this.handleResize) window.removeEventListener("resize", this.handleResize);
    this.lenis?.destroy?.();
    this.lenis = null;
    const canvas = this.renderer.domElement;
    if (this.handleCardClick) {
      canvas.removeEventListener("click", this.handleCardClick);
    }
    if (this.handlePointerMove) {
      canvas.removeEventListener("pointermove", this.handlePointerMove);
    }
    if (this.handlePointerLeave) {
      canvas.removeEventListener("pointerleave", this.handlePointerLeave);
    }
    this.fluid?.destroy?.();
    this.videoSources.forEach((source) => {
      source.video?.pause();
      if (source.video) {
        source.video.removeAttribute("src");
        source.video.load();
      }
      source.texture?.dispose();
      if (source.objectUrl) URL.revokeObjectURL(source.objectUrl);
    });
    this.videoSources.clear();
    this.videoElements = [];
    this.videoPool?.remove();
    this.videoPool = null;
    this.materials.forEach((material) => {
      material.userData?.overlayTexture?.dispose?.();
      material.dispose();
    });
    this.cards.forEach((card) => card.geometry.dispose());
    this.placeholderTexture.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}