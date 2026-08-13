import * as THREE from "three";
import Lenis from "lenis";
import fragment from "./shader/fragment.glsl?raw";
import vertex from "./shader/vertex.glsl?raw";
import FilmReelCloth from "./reel/FilmReelCloth.js";
import projects from "./data/projects.json";

const GAP_X = 120;
const GAP_Y = 170;
const GAP_Y_MOBILE = 95;
const COLS_DESKTOP = 2;
const COLS_MOBILE = 1;
const MOBILE_BREAKPOINT = 1024;
const PHONE_BREAKPOINT = 768;
const SEG = 36;
const SEG_MOBILE = 20;
const WORLD_PER_PIXEL = 4.2;
const SCROLL_IDLE_MS = 180;
const PIXEL_RATIO_CAP = 1.75;
const PIXEL_RATIO_CAP_MOBILE = 1.5;
const PIXEL_RATIO_CAP_PHONE = 1.5;
const REEL_PAD_X_DESKTOP = 140;
const REEL_PAD_X_TABLET = 56;
const REEL_PAD_X_PHONE = 22;
const RECESS_DEPTH = 2400;
const RECESS_DOWN_RATIO = 0.94;
const RECESS_DOWN_RATIO_MOBILE = 0.52;
const STACK_ROWS = 0.55;
const CAMERA_Z = 3000;
const FOLD_DEPTH = 820;
const FOLD_DEPTH_REF_HEIGHT = 820;
const FOLD_DEPTH_MOBILE_CAP = 480;
const ALPHA_FADE_NEAR = CAMERA_Z * 0.82;
const ALPHA_FADE_FAR = CAMERA_Z * 2.45;
const FOG_NEAR = CAMERA_Z * 0.95;
const FOG_FAR = CAMERA_Z * 2.15;
const CARD_SCALE = 0.81;
const CARD_SCALE_MOBILE = 0.92;
const CARD_ASPECT = 1.58;
const CARD_HEIGHT_BOOST = 1.21;
const CORNER_RADIUS_UV = 0.08;
const TOP_ROLL_STRENGTH = 1.0;
const VIDEO_ZOOM = 1.0;
const VIDEO_CULL_INTERVAL_MS = 32;
const VIDEO_VIEW_MARGIN = 1.1;
const VIDEO_LOAD_CONCURRENCY = 4;
const REEL_ROLL_RADIUS = 0.11;

// Webflow button-icon variant: arrow-up-right (↗)
const ARROW_GLYPH = "↗";

const CARD_OPACITY = 1.0;
const BG_COLOR = 0xf0f0ee;
const CARD_FALLBACK_COLOR = BG_COLOR;
const START_Y_OFFSET = -40;
// Lift the film reel under the heading (world units) — modest, not too high
const REEL_VIEW_LIFT = 115;
const SCROLL_END_BOTTOM_CLEARANCE = 0.1;
const SCROLL_END_PAD_PX = 100;


export default class Sketch {
  constructor(options) {
    this.container = options.dom;
    this.scrollSpacer = options.scrollSpacer;
    this.loaderEl = options.loader || null;
    this.loaderBar = options.loaderBar || null;
    this.loaderPct = options.loaderPct || null;
    this.recCursor = options.recCursor || null;
    this.filmScrollbar = document.getElementById("film-scrollbar");
    this.filmScrollbarTrack = document.getElementById("film-scrollbar-track");
    this.filmScrollbarIndicator = document.getElementById(
      "film-scrollbar-indicator"
    );
    this.width = this.container.offsetWidth;
    this.height = this.container.offsetHeight;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(BG_COLOR);

    this.renderer = new THREE.WebGLRenderer({
      antialias: window.innerWidth >= MOBILE_BREAKPOINT,
      powerPreference: "high-performance",
      stencil: false,
      depth: true,
    });
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio || 1, this.getPixelRatioCap())
    );
    this.renderer.setSize(this.width, this.height);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.sortObjects = false;
    this.container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(
      36,
      this.width / this.height,
      1,
      10000
    );
    this.camera.position.set(0, 0, CAMERA_Z);
    this.camera.lookAt(0, 0, 0);

    this.clock = new THREE.Clock();
    this.materials = [];
    this.cards = [];
    this.filmReel = null;
    this.pokePlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    this.pokePoint = new THREE.Vector3();
    this.isPlaying = true;
    this.isReady = false;
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.hoverPointer = new THREE.Vector2();
    this.activeHoverCard = null;
    this.hasHoverPointer = false;
    this.hoverDirty = false;
    this.isHoveringCard = false;
    this.lastScrollAt = 0;
    this.scrolling = false;
    this.assetsTotal = Math.max(
      1,
      projects.filter((project) => project.image).length
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
    this._pendingVideoLoads = [];
    this._activeVideoLoads = 0;
    this.lastVideoCullAt = 0;
    this.renderFrame = this.render.bind(this);
    this._resizeTimer = 0;
    this._lastLayoutWidth = 0;
    this._lastLayoutHeight = 0;
    this._hoverFrame = 0;

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
    this.ensureFilmReel();
    this.updateScrollSpacer();
    this.setupScroll();
    this.setupCardClicks();
    this.setupCardHover();
    this.setupRecCursor();
    this.setupFilmScrollbar();
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

  isMobile() {
    return window.innerWidth < MOBILE_BREAKPOINT;
  }

  isPhone() {
    return window.innerWidth < PHONE_BREAKPOINT;
  }

  isTouchDevice() {
    return (
      window.matchMedia("(pointer: coarse)").matches ||
      "ontouchstart" in window
    );
  }

  getPixelRatioCap() {
    if (this.isPhone()) return PIXEL_RATIO_CAP_PHONE;
    if (this.isMobile()) return PIXEL_RATIO_CAP_MOBILE;
    return PIXEL_RATIO_CAP;
  }

  getReelPadX() {
    if (this.isPhone()) return REEL_PAD_X_PHONE;
    if (this.isMobile()) return REEL_PAD_X_TABLET;
    return REEL_PAD_X_DESKTOP;
  }

  getReelViewLift() {
    if (this.isPhone()) return 0;
    if (this.isMobile()) return -36;
    return REEL_VIEW_LIFT;
  }

  // World-space gap from the top of the screen to the roll (keeps title clear on short phones)
  getPhoneTitleClearance() {
    const px = Math.max(96, Math.min(128, this.height * 0.16));
    return (px / Math.max(this.height, 1)) * this.getVisibleHeight();
  }

  getRollRadius(cardH) {
    const scale = this.isPhone() ? 1.15 : this.isMobile() ? 0.85 : 1;
    return cardH * REEL_ROLL_RADIUS * scale;
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
    const padX = this.getReelPadX() * 2;

    // 1-col phone: 95% width so sprocket edges stay visible
    if (this.cols === 1) {
      const fill = this.isPhone() ? 0.95 : 0.94;
      return Math.max(160, visibleW * fill - padX);
    }

    const widthBias = 0.96;
    return ((visibleW * widthBias - gaps) / this.cols) * this.getCardScale();
  }

  getCardAspect(index) {
    return this.cardAspects[index] || projects[index]?.aspect || CARD_ASPECT;
  }

  getProjectZoom(index) {
    const zoom = Number(projects[index]?.zoom);
    return Number.isFinite(zoom) && zoom > 0 ? zoom : VIDEO_ZOOM;
  }

  applyMediaFitUniforms(material, index, mediaAspect) {
    material.uniforms.u_imageAspect.value = mediaAspect;
    material.uniforms.u_cardAspect.value = mediaAspect;
    material.uniforms.u_videoZoom.value = 1.0;
    material.uniforms.u_heightBoost.value = 1.0;
    material.uniforms.u_fitContain.value = 1.0;
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

  getReelTextureWidth(panelW, cardW) {
    const cardScreenW = (cardW / this.getVisibleWidth()) * this.width;
    const dpr = Math.min(window.devicePixelRatio || 1, this.getPixelRatioCap());
    const slotPx = Math.round(cardScreenW * dpr * 1.12);
    const minTexW = Math.round((panelW / cardW) * slotPx);
    const maxTex = this.isPhone() ? 1024 : this.isMobile() ? 1152 : 1600;
    const minTex = this.isPhone() ? 768 : 768;
    return Math.min(maxTex, Math.max(minTex, minTexW));
  }

  getReelBounds() {
    const cardW = this.cardWidth;
    const cardH = cardW / CARD_ASPECT;
    const gapX = this.getGapX();
    const gapY = this.getGapY();
    const pad = this.getReelPadX();
    const cardDrop = cardH * (this.isPhone() ? 0.04 : 0.14);
    let hangHeight = cardDrop + cardH * 2 + gapY + cardH * 0.04;
    if (this.isPhone()) {
      // Tall hang: fill from below the title to past the bottom of the screen
      hangHeight = Math.max(hangHeight, this.getVisibleHeight() * 1.08);
    } else if (this.isMobile()) {
      hangHeight = Math.max(hangHeight, this.getVisibleHeight() * 0.52);
    }
    const width = this.cols * cardW + Math.max(0, this.cols - 1) * gapX + pad * 2;
    const clothHang = Math.max(
      hangHeight,
      cardH * 2 + gapY + cardDrop * 0.5
    );
    const visH = this.getVisibleHeight();
    const foldY =
      (this.foldLine.start + this.foldLine.end) * 0.5 + this.getReelViewLift();
    const meshBottom = foldY - clothHang;
    const visibleBottom = Math.max(meshBottom, -visH * 0.5);
    const visibleHangH = Math.max(clothHang * 0.4, foldY - visibleBottom);

    return {
      width,
      hangHeight,
      visibleHangH,
      rollRadius: this.getRollRadius(cardH),
      texW: this.getReelTextureWidth(width, cardW),
      maxAnisotropy: Math.min(
        4,
        this.renderer.capabilities.getMaxAnisotropy()
      ),
      maxTexH: Math.min(4096, this.renderer.capabilities.maxTextureSize || 4096),
      mediaHeightBoost: 1,
      clothCols: this.isPhone() ? 18 : this.isMobile() ? 22 : 26,
      clothRows: this.isPhone() ? 34 : this.isMobile() ? 40 : 48,
      constraintIterations: this.isPhone() ? 2 : this.isMobile() ? 2 : 3,
      gridCols: this.cols,
      cardW,
      cardH,
      gapX,
      gapY,
      pad,
      cardDrop,
      cardCount: projects.length,
      slotAspects: projects.map((_, i) => this.getCardAspect(i)),
      endPad:
        (SCROLL_END_PAD_PX / Math.max(this.height, 1)) * this.getVisibleHeight(),
      zOffset: 0,
    };
  }

  ensureFilmReel() {
    const bounds = this.getReelBounds();
    if (!this.filmReel) {
      this.filmReel = new FilmReelCloth(bounds);
      this.contentGroup.add(this.filmReel.object);
    } else {
      this.filmReel.rebuild(bounds);
    }
    this.repaintReelMedia();
    this.filmReel.paintAllReadyVideos();
    this.syncFilmReel(0);
  }

  repaintReelMedia() {
    if (!this.filmReel) return;
    for (let i = 0; i < this.cards.length; i++) {
      const card = this.cards[i];
      const material = card.material;
      const videoEntry = this.videoElements.find((e) => e.index === i);
      if (videoEntry?.video) {
        this.filmReel.setSlotVideo(i, videoEntry.video);
      } else if (material?.userData?.sourceImage) {
        this.filmReel.setSlotImage(i, material.userData.sourceImage);
      }
    }
  }

  syncFilmReel(dt = 0) {
    if (!this.filmReel) return;
    const parentY = this.contentGroup.position.y;
    const foldY =
      (this.foldLine.start + this.foldLine.end) * 0.5 + this.getReelViewLift();
    this.filmReel.syncWorldSeam(foldY, parentY);
    this.filmReel.setScrollTarget(this.currentScrollY);
    if (dt > 0) {
      this.filmReel.update(dt, this.clock.elapsedTime);
      const toPaint = new Set();
      for (const entry of this.videoElements) {
        if (!entry.video || entry.video.readyState < 2) continue;
        if (entry.playing) toPaint.add(entry.index);
      }
      this.filmReel.updateVideoFrames(toPaint);
    }
  }

  getMaxScrollWorld() {
    if (this.filmReel) return this.filmReel.maxScroll;

    const rows = this.getRowCount();
    if (rows <= 1) return 0;

    const lastRow = rows - 1;
    const lastRowY = this.getCardY(lastRow);
    const lastRowH = this.getRowHeight(lastRow);
    const visibleHalf = this.getVisibleHeight() * 0.5;
    const bottomPad = this.getVisibleHeight() * SCROLL_END_BOTTOM_CLEARANCE;
    const targetCenterY = -visibleHalf + bottomPad + lastRowH * 0.5;
    return Math.max(0, targetCenterY - this.baseYOffset - lastRowY);
  }

  getScrollLimitPx() {
    if (this.lenis?.limit != null && Number.isFinite(this.lenis.limit)) {
      return Math.max(0, this.lenis.limit);
    }
    return Math.max(0, this.maxScrollPx);
  }

  getFilmScrollbarRatio() {
    const maxWorld = this.getMaxScrollWorld();
    if (maxWorld <= 0) return 0;
    const reelScroll = this.filmReel?.scrollTarget ?? this.currentScrollY;
    return Math.min(1, Math.max(0, reelScroll / maxWorld));
  }

  updateScrollSpacer() {
    const maxScrollWorld = this.getMaxScrollWorld();
    const maxScrollPx = maxScrollWorld / WORLD_PER_PIXEL;
    this.maxScrollPx = maxScrollPx;
    this.scrollSpacer.style.height = `${Math.ceil(maxScrollPx + window.innerHeight)}px`;
    this.lenis?.resize?.();

    const limitPx = this.getScrollLimitPx();
    const currentPx = this.lenis ? this.lenis.scroll : window.scrollY;
    const clampPx = Math.min(currentPx, limitPx);
    if (currentPx > clampPx) {
      if (this.lenis) {
        this.lenis.scrollTo(clampPx, { immediate: true });
      } else {
        window.scrollTo(0, clampPx);
      }
      this.currentScrollY = clampPx * WORLD_PER_PIXEL;
      this.targetScrollY = this.currentScrollY;
    }

    this.updateFilmScrollbar();
  }

  updateLoaderProgress() {
    const pct = Math.round((this.assetsLoaded / this.assetsTotal) * 100);
    if (this.loaderBar) this.loaderBar.style.width = `${pct}%`;
    if (this.loaderPct) this.loaderPct.textContent = `${pct}%`;
  }

  markAssetLoaded() {
    this.assetsLoaded = Math.min(this.assetsTotal, this.assetsLoaded + 1);
    this.updateLoaderProgress();

    // Wait for every video/image — one-shot load during loader only
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

      // Paint every loaded slot once, then play only nearest cards
      this.lastVideoCullAt = 0;
      this.repaintReelMedia();
      this.filmReel?.paintAllReadyVideos();
      this.updateVideoPlayback(performance.now());
      this.updateFilmScrollbar();
    });
  }

  updateContentOffset() {
    if (this.cols === 1) {
      // Film reel is positioned by fold + view lift — keep group origin neutral
      // so the title area stays clear of the black strip.
      this.baseYOffset = this.isPhone() ? 0 : START_Y_OFFSET * 0.35;
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
      const foldRange = Math.max(
        this.isPhone() ? 96 : 140,
        this.cardHeight * (this.isPhone() ? 0.13 : 0.18)
      );
      const foldCenter = this.isPhone()
        ? visibleHalf - this.getPhoneTitleClearance()
        : visibleHalf - visibleH * 0.24;
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
      this.ensureFilmReel();
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
      material.userData.sourceImage = img;
      this.filmReel?.setSlotImage(index, img);
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

  loadCardVideo(url, material) {
    this._pendingVideoLoads.push({ url, material });
    this._drainVideoLoadQueue();
  }

  _drainVideoLoadQueue() {
    while (
      this._activeVideoLoads < VIDEO_LOAD_CONCURRENCY &&
      this._pendingVideoLoads.length > 0
    ) {
      const job = this._pendingVideoLoads.shift();
      this._activeVideoLoads += 1;
      this._startCardVideoLoad(job.url, job.material, () => {
        this._activeVideoLoads -= 1;
        this._drainVideoLoadQueue();
      });
    }
  }

  _startCardVideoLoad(url, material, onJobDone) {
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

    const index = material.userData.projectIndex || 0;
    const entry = {
      video,
      material,
      index,
      playing: false,
      objectUrl: null,
    };
    this.videoElements.push(entry);

    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      onJobDone();
      this.markAssetLoaded();
    };

    const onReady = () => {
      if (material.userData.mediaReady) return;
      if (video.readyState < 2) return;
      material.userData.mediaReady = true;

      const vw = video.videoWidth || 1;
      const vh = video.videoHeight || 1;
      const aspect = vw / vh;

      const texture = new THREE.VideoTexture(video);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = false;

      const overlay = this.createOverlayTexture(index, aspect);
      material.userData.overlayTexture?.dispose?.();

      material.uniforms.u_texture.value = texture;
      material.uniforms.u_hasTexture.value = 1.0;
      material.uniforms.u_overlay.value = overlay;
      material.uniforms.u_hasOverlay.value = 1.0;
      material.userData.cardTexture = texture;
      material.userData.overlayTexture = overlay;

      this.filmReel?.setSlotVideo(index, video);
      this.applyMediaAspect(index, aspect, material);

      // Seek one frame so the paused card isn't blank, then let cull decide play
      try {
        video.currentTime = Math.min(0.05, (video.duration || 1) * 0.01);
      } catch {
        /* ignore seek errors before metadata */
      }

      settle();

      this.filmReel?.paintSlot?.(index);
      if (this.isReady) {
        this.lastVideoCullAt = 0;
        this.updateVideoPlayback(performance.now());
      }
    };

    video.addEventListener("canplaythrough", onReady, { once: true });
    video.addEventListener(
      "loadeddata",
      () => {
        window.setTimeout(onReady, 400);
      },
      { once: true }
    );
    video.addEventListener("error", (error) => {
      console.warn(`Failed to load project video: ${url}`, error);
      settle();
    });

    fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.blob();
      })
      .then((blob) => {
        entry.objectUrl = URL.createObjectURL(blob);
        video.src = entry.objectUrl;
        video.load();
      })
      .catch((error) => {
        console.warn(`Blob fetch failed, falling back to URL: ${url}`, error);
        video.src = url;
        video.load();
      });
  }

  // Play hang-area slots; pause once a card starts entering the top roll.
  updateVideoPlayback(now = performance.now(), force = false) {
    if (!force && now - this.lastVideoCullAt < VIDEO_CULL_INTERVAL_MS) return;
    this.lastVideoCullAt = now;
    if (!this.videoElements.length) return;

    const viewMargin = VIDEO_VIEW_MARGIN;
    const playing = new Set();

    for (const entry of this.videoElements) {
      if (!entry.video || entry.video.readyState < 2) continue;

      const inBand = this.filmReel
        ? this.filmReel.isSlotPlayingView(entry.index, viewMargin)
        : true;

      if (inBand) {
        if (!entry.playing) entry.video.play().catch(() => {});
        entry.playing = true;
        playing.add(entry.index);
      }
    }

    for (const entry of this.videoElements) {
      if (!entry.video || playing.has(entry.index)) continue;
      if (entry.playing) {
        entry.video.pause();
        entry.playing = false;
        this.filmReel?.paintSlot?.(entry.index);
      }
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
      card.renderOrder = index + 1;
      // Media lives on the film reel cloth (roll + poke). Keep mesh for data only.
      card.visible = false;

      card.position.set(colX[col], this.getCardY(row), 0);
      card.userData = {
        title: project.title,
        description: project.description,
        link: project.link,
        projectIndex: index,
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
    const widthDelta = Math.abs(newWidth - this.cardWidth);
    const widthThreshold = this.isPhone() ? 0.5 : this.isMobile() ? 1 : 2;
    if (!force && !colsChanged && widthDelta < widthThreshold) return;

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
    this.ensureFilmReel();
    this.updateWaveUniforms();
    this.updateStackUniforms();
    this.updateDepthUniforms();
  }

  setupResize() {
    this.handleResize = () => {
      window.clearTimeout(this._resizeTimer);
      this._resizeTimer = window.setTimeout(() => this.resize(), 100);
    };
    window.addEventListener("resize", this.handleResize);
    window.addEventListener("orientationchange", this.handleResize);
    window.visualViewport?.addEventListener("resize", this.handleResize);
    window.visualViewport?.addEventListener("scroll", this.handleResize);
  }

  setupScroll() {
    const touch = this.isTouchDevice();
    this.lenis = new Lenis({
      duration: touch ? 1.15 : 1.4,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
      syncTouch: touch,
      touchMultiplier: this.isPhone() ? 1.65 : 1.35,
      wheelMultiplier: 0.85,
      autoRaf: false,
    });

    // Locked until loader finishes
    this.lenis.stop();

    this.lenis.on("scroll", ({ scroll }) => {
      if (!this.isReady) return;
      const scrollLimit = this.getScrollLimitPx();
      const scrollY = Math.min(scroll, scrollLimit);
      const maxScrollWorld = this.getMaxScrollWorld();
      // Lenis is the smooth layer — drive WebGL directly
      this.currentScrollY = Math.min(scrollY * WORLD_PER_PIXEL, maxScrollWorld);
      this.targetScrollY = this.currentScrollY;
      this.lastScrollAt = performance.now();
      this.scrolling = true;
      // Re-evaluate playback immediately on scroll — smoothed reel scroll lags on return scroll.
      this.lastVideoCullAt = 0;
      this.updateVideoPlayback(this.lastScrollAt, true);
      // Cards slide under a stationary cursor, so re-test hover
      if (this.hasHoverPointer) this.hoverDirty = true;
    });
  }

  updateFilmScrollbar() {
    if (!this.filmScrollbarIndicator || !this.filmScrollbarTrack) return;
    if (!this.isReady || this.isMobile()) return;

    const ratio = this.getFilmScrollbarRatio();

    const trackH = this.filmScrollbarTrack.clientHeight;
    const indicatorH = this.filmScrollbarIndicator.offsetHeight || 5;
    const maxTravel = Math.max(0, trackH - indicatorH);
    this.filmScrollbarIndicator.style.transform = `translateY(${ratio * maxTravel}px)`;
  }

  setupFilmScrollbar() {
    if (!this.filmScrollbarTrack) return;

    this.handleFilmScrollbarDown = (event) => {
      if (!this.isReady || !this.lenis) return;
      event.preventDefault();

      const scrollFromY = (clientY) => {
        const maxWorld = this.getMaxScrollWorld();
        if (maxWorld <= 0) return;

        const rect = this.filmScrollbarTrack.getBoundingClientRect();
        const indicatorH = this.filmScrollbarIndicator?.offsetHeight || 5;
        const travel = Math.max(1, rect.height - indicatorH);
        const y = Math.min(
          rect.height - indicatorH * 0.5,
          Math.max(indicatorH * 0.5, clientY - rect.top - indicatorH * 0.5)
        );
        const ratio = y / travel;
        this.lenis.scrollTo(ratio * this.getScrollLimitPx());
      };

      scrollFromY(event.clientY);

      const onMove = (moveEvent) => scrollFromY(moveEvent.clientY);
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    };

    this.filmScrollbarTrack.addEventListener(
      "pointerdown",
      this.handleFilmScrollbarDown
    );
  }

  setupCardClicks() {
    this.handleCardClick = (event) => {
      if (!this.isReady || !this.filmReel) return;
      const rect = this.renderer.domElement.getBoundingClientRect();
      this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      this.raycaster.setFromCamera(this.pointer, this.camera);
      const hit = this.raycaster.intersectObject(this.filmReel.object, false)[0];
      if (!hit?.uv) return;
      const index = this.filmReel.hitIndexFromUv(hit.uv);
      const link = index >= 0 ? projects[index]?.link : null;
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
  }

  isPointerOverReel(clientX, clientY) {
    if (!this.isReady || !this.filmReel?.object) return false;

    const rect = this.renderer.domElement.getBoundingClientRect();
    if (
      clientX < rect.left ||
      clientX > rect.right ||
      clientY < rect.top ||
      clientY > rect.bottom
    ) {
      return false;
    }

    this.hoverPointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.hoverPointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.hoverPointer, this.camera);
    return this.raycaster.intersectObject(this.filmReel.object, false).length > 0;
  }

  setRecCursorVisible(show) {
    if (!this.recCursor) return;
    if (show === this._recCursorVisible) return;
    this._recCursorVisible = show;

    this.recCursor.classList.toggle("is-on", show);
    document.documentElement.classList.toggle("has-rec-cursor", show);

    if (!show && this._recCursorRaf) {
      cancelAnimationFrame(this._recCursorRaf);
      this._recCursorRaf = 0;
    }
  }

  setupRecCursor() {
    if (!this.recCursor) return;

    this._recCursorVisible = false;
    this._recCursorX = 0;
    this._recCursorY = 0;
    this._recCursorTX = 0;
    this._recCursorTY = 0;
    this._recCursorRaf = 0;
    this._recCursorPressing = false;

    const tick = () => {
      this._recCursorX += (this._recCursorTX - this._recCursorX) * 0.32;
      this._recCursorY += (this._recCursorTY - this._recCursorY) * 0.32;
      const s = this._recCursorPressing ? 0.94 : 1;
      this.recCursor.style.transform = `translate3d(${this._recCursorX + 14}px, ${this._recCursorY + 14}px, 0) scale(${s})`;
      this._recCursorRaf = requestAnimationFrame(tick);
    };

    this.handleRecCursorMove = (event) => {
      if (event.pointerType === "touch") return;
      if (!document.documentElement.classList.contains("is-ready")) return;

      this._recCursorTX = event.clientX;
      this._recCursorTY = event.clientY;

      const overReel = this.isPointerOverReel(event.clientX, event.clientY);
      // REC badge only on the black film reel — not on heading / page chrome
      this.setRecCursorVisible(overReel);

      if (overReel && !this._recCursorRaf) {
        this._recCursorX = this._recCursorTX;
        this._recCursorY = this._recCursorTY;
        this._recCursorRaf = requestAnimationFrame(tick);
      }
    };

    this.handleRecCursorDown = () => {
      if (!this._recCursorVisible) return;
      this._recCursorPressing = true;
      this.recCursor.classList.add("is-press");
    };

    this.handleRecCursorUp = () => {
      this._recCursorPressing = false;
      this.recCursor.classList.remove("is-press");
    };

    this.handleRecCursorLeave = () => {
      this.setRecCursorVisible(false);
      this._recCursorPressing = false;
      this.recCursor.classList.remove("is-press", "is-hot");
      cancelAnimationFrame(this._recCursorRaf);
      this._recCursorRaf = 0;
    };

    window.addEventListener("pointermove", this.handleRecCursorMove, {
      passive: true,
    });
    window.addEventListener("pointerdown", this.handleRecCursorDown);
    window.addEventListener("pointerup", this.handleRecCursorUp);
    document.addEventListener("mouseleave", this.handleRecCursorLeave);
  }

  // Runs every frame so poke stays current before cloth integrate
  updateHover() {
    if (!this.isReady || !this.hasHoverPointer || !this.filmReel) {
      this.filmReel?.clearPoke();
      if (!this.hasHoverPointer) this.setCardHover(false);
      this.hoverDirty = false;
      return;
    }

    this._hoverFrame = (this._hoverFrame + 1) % 2;
    const pokeEveryFrame = this.scrolling || this.filmReel.poking;
    if (!pokeEveryFrame && this._hoverFrame !== 0 && !this.hoverDirty) return;

    this.raycaster.setFromCamera(this.hoverPointer, this.camera);

    // Prefer plane poke like the HTML demo (stable coords, no mesh-hit jitter)
    this.filmReel.object.updateWorldMatrix(true, false);
    const origin = new THREE.Vector3();
    this.filmReel.object.getWorldPosition(origin);
    this.pokePlane.set(new THREE.Vector3(0, 0, 1), -origin.z);

    if (this.raycaster.ray.intersectPlane(this.pokePlane, this.pokePoint)) {
      const local = this.pokePoint.clone();
      this.filmReel.object.worldToLocal(local);
      this.filmReel.setPokeLocal(local.x, local.y);
    } else {
      this.filmReel.clearPoke();
    }

    if (this.hoverDirty) {
      const hit = this.raycaster.intersectObject(this.filmReel.object, false)[0];
      const index = hit?.uv ? this.filmReel.hitIndexFromUv(hit.uv) : -1;
      this.activeHoverCard = index >= 0 ? this.cards[index] : null;
      this.setCardHover(Boolean(index >= 0 && projects[index]?.link));
    }

    this.hoverDirty = false;
  }

  resize() {
    this.width = this.container.offsetWidth;
    this.height = this.container.offsetHeight;
    const nextCols = this.getCols();
    const layoutChanged =
      nextCols !== this.cols ||
      Math.abs(this.width - this._lastLayoutWidth) > 1 ||
      Math.abs(this.height - this._lastLayoutHeight) > 1;
    this._lastLayoutWidth = this.width;
    this._lastLayoutHeight = this.height;

    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio || 1, this.getPixelRatioCap())
    );
    this.renderer.setSize(this.width, this.height);
    this.camera.aspect = this.width / this.height;
    this.camera.fov = 36;
    this.camera.updateProjectionMatrix();
    this.layoutCards(layoutChanged);
    this.updateFoldLine();
    this.updateContentOffset();
    this.ensureFilmReel();
    this.updateScrollSpacer();
    this.updateFilmScrollbar();
  }

  updateUniforms(time, dt) {
    const now = performance.now();
    this.contentGroup.position.y = this.baseYOffset;
    this.scrolling = this.isReady && now - this.lastScrollAt < SCROLL_IDLE_MS;

    // Cards are invisible — reel cloth carries visuals; skip shader uniform churn.
    this.updateHover();
    this.syncFilmReel(dt);
    if (!this.isMobile()) this.updateFilmScrollbar();

    const reelMax = this.filmReel?.maxScroll;
    if (reelMax != null && reelMax !== this._lastReelMaxScroll) {
      this._lastReelMaxScroll = reelMax;
      this.updateScrollSpacer();
    }

    if (!this.isReady) return;
    this.updateVideoPlayback(now);
  }

  render(time = 0) {
    if (!this.isPlaying) return;

    if (this.isReady) {
      this.lenis?.raf(time);
    }
    const dt = Math.min(this.clock.getDelta(), 1 / 30);
    this.updateUniforms(this.clock.elapsedTime, dt);

    requestAnimationFrame(this.renderFrame);
    this.renderer.render(this.scene, this.camera);
  }

  destroy() {
    this.isPlaying = false;
    if (this.handleResize) {
      window.removeEventListener("resize", this.handleResize);
      window.removeEventListener("orientationchange", this.handleResize);
      window.visualViewport?.removeEventListener("resize", this.handleResize);
      window.visualViewport?.removeEventListener("scroll", this.handleResize);
    }
    window.clearTimeout(this._resizeTimer);
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
    if (this.handleRecCursorMove) {
      window.removeEventListener("pointermove", this.handleRecCursorMove);
    }
    if (this.handleRecCursorDown) {
      window.removeEventListener("pointerdown", this.handleRecCursorDown);
    }
    if (this.handleRecCursorUp) {
      window.removeEventListener("pointerup", this.handleRecCursorUp);
    }
    if (this.handleRecCursorLeave) {
      document.removeEventListener("mouseleave", this.handleRecCursorLeave);
    }
    if (this.handleFilmScrollbarDown && this.filmScrollbarTrack) {
      this.filmScrollbarTrack.removeEventListener(
        "pointerdown",
        this.handleFilmScrollbarDown
      );
    }
    this.setRecCursorVisible(false);
    this.videoElements.forEach((entry) => {
      entry.video.pause();
      entry.video.removeAttribute("src");
      entry.video.load();
      if (entry.objectUrl) URL.revokeObjectURL(entry.objectUrl);
    });
    this.videoElements = [];
    this.materials.forEach((material) => {
      material.userData?.cardTexture?.dispose?.();
      material.userData?.overlayTexture?.dispose?.();
      material.dispose();
    });
    this.cards.forEach((card) => card.geometry.dispose());
    this.filmReel?.dispose();
    this.filmReel = null;
    this.placeholderTexture.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}