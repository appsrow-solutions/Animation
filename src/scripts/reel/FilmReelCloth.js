import * as THREE from "three";

const CLOTH_COLOR = "#0c0c0c";
const CLOTH_COLOR_DEEP = "#050505";
const SPROCKET = "#ffffff";

// Default grid — overridden per device via clothCols/clothRows from app.js
const COLS = 32;
const ROWS = 60;
const ROLL_ROW_SHARE = 0.58;
const DAMPING = 0.99;
const CONSTRAINT_ITERATIONS = 5;
const SUBSTEPS = 1;
const POKE_FALLOFF = 1.25;
const BEND_STIFFNESS = 0.48;
const SETTLE_STEPS = 30;
const SCROLL_SMOOTH = 0.14;
// ~10fps paint — enough motion without constant full-atlas GPU uploads
const VIDEO_PAINT_MS = 100;
const VIDEO_PAINT_MAX = 2;
const IDLE_COOLDOWN_FRAMES = 18;
const REEL_MEDIA_ASPECT_CORRECTION = 1.18;

const DEMO_PANEL_W = 3.84;
const DEMO_HANG_H = 2.7;
const DEMO_ROLL_R = 0.155;
const DEMO_POKE_R = 0.55;
const DEMO_POKE_S = 0.72;
const DEMO_MAX_Z = 0.16;
const DEMO_GRAVITY = 0.12;
const DEMO_WIND = 0.011;
const DEMO_ROLL_SHRINK = 0.012;
const SCROLL_END_CLEARANCE = 0.22;

/**
 * Camera-film cloth (CPU sim, matching the HTML reel demo).
 */
export default class FilmReelCloth {
  constructor(options = {}) {
    this.zOffset = options.zOffset ?? 0;
    this.scroll = 0;
    this.scrollTarget = 0;
    this.maxScroll = 1;
    this.poking = false;
    this.pokeLocal = new THREE.Vector3();
    this.slots = [];
    this.media = [];
    this._lastVideoPaint = 0;
    this._normalFrame = 0;

    this.mesh = new THREE.Mesh();
    this.mesh.renderOrder = 1;
    this.mesh.frustumCulled = false;
    this.mesh.position.z = this.zOffset;

    this.configure(options);
  }

  get object() {
    return this.mesh;
  }

  configure(options = {}) {
    const {
      width = 2000,
      hangHeight = 1600,
      rollRadius = null,
      gridCols = 2,
      cardW = 800,
      cardH = 500,
      gapX = 80,
      gapY = 160,
      pad = 120,
      cardDrop = 200,
      cardCount = 0,
      zOffset = this.zOffset,
      texW = null,
      maxAnisotropy = 4,
      mediaHeightBoost = 1,
      clothCols = COLS,
      clothRows = ROWS,
      constraintIterations = CONSTRAINT_ITERATIONS,
      videoPaintMax = VIDEO_PAINT_MAX,
    } = options;

    this.zOffset = zOffset;
    this.requestedTexW = texW;
    this.maxAnisotropy = maxAnisotropy;
    this.mediaHeightBoost = Math.max(1, mediaHeightBoost);
    this.clothCols = clothCols;
    this.clothRows = clothRows;
    this.constraintIterations = constraintIterations;
    this.videoPaintMax = videoPaintMax;
    this.gridCols = Math.max(1, gridCols);
    this.cardW = cardW;
    this.cardH = cardH;
    this.gapX = gapX;
    this.gapY = gapY;
    this.pad = pad;
    this.cardDrop = cardDrop;
    this.cardCount = Math.max(0, cardCount);
    this.gridRows = Math.ceil(this.cardCount / this.gridCols) || 1;

    this.panelW = Math.max(
      width,
      this.gridCols * cardW + (this.gridCols - 1) * gapX + pad * 2
    );
    this.hangH = Math.max(hangHeight, cardH * 2 + gapY + cardDrop * 0.5);
    this.rollRadius = rollRadius ?? this.hangH * 0.028;
    this.rollArc = Math.PI * 1.55;
    this.arcLen = this.rollRadius * this.rollArc;
    this.meshH = this.hangH + this.arcLen;

    this.seamY = this.hangH * 0.5;
    this.meshBottom = -this.hangH * 0.5;
    this.meshTop = this.seamY + this.arcLen;

    this.cardsH =
      this.gridRows * this.cardH + Math.max(0, this.gridRows - 1) * this.gapY;
    this.rollMargin = this.arcLen + 0.1 * (this.hangH / DEMO_HANG_H);
    this.bottomBreath = this.cardH * 0.02;
    this.contentH =
      this.rollMargin + this.cardDrop + this.cardsH + this.bottomBreath;
    const lastSlotBottom =
      this.rollMargin + this.cardDrop + this.cardsH;
    const endClearance = this.bottomBreath + this.cardH * SCROLL_END_CLEARANCE;
    this.maxScroll = Math.max(0, lastSlotBottom - this.hangH + endClearance);

    const sx = this.panelW / DEMO_PANEL_W;
    const sy = this.hangH / DEMO_HANG_H;
    this.maxZ = DEMO_MAX_Z * sy;
    this.pokeRadius = DEMO_POKE_R * sx;
    this.pokeStrength = DEMO_POKE_S * sy;
    this.gravityY = -DEMO_GRAVITY * sy;
    this.windAmount = DEMO_WIND * sy;
    this.rollShrink = DEMO_ROLL_SHRINK * (this.rollRadius / DEMO_ROLL_R);
    this._lastVideoPaint = 0;
    this._normalFrame = 0;
    this._idleCooldown = IDLE_COOLDOWN_FRAMES;
    this._lastScroll = 0;

    this.buildSlots();
    this.ensureMediaArray();
    this.rebuildMesh();
  }

  buildSlots() {
    this.slots = [];
    for (let i = 0; i < this.cardCount; i++) {
      const col = i % this.gridCols;
      const row = Math.floor(i / this.gridCols);
      this.slots.push({
        x: this.pad + col * (this.cardW + this.gapX),
        y: this.rollMargin + this.cardDrop + row * (this.cardH + this.gapY),
        w: this.cardW,
        h: this.cardH,
      });
    }
  }

  ensureMediaArray() {
    const next = [];
    for (let i = 0; i < this.cardCount; i++) {
      next.push(this.media[i] || { type: "none", source: null, dirty: true });
    }
    this.media = next;
  }

  rebuild(options = {}) {
    this.configure({ ...options, zOffset: options.zOffset ?? this.zOffset });
  }

  rebuildMesh() {
    const prevMat = this.mesh.material;
    const prevGeo = this.mesh.geometry;

    this.buildParticles();
    this.buildConstraints();
    this.buildGeometry();
    this.buildTexture();
    this.paintAllSlots();

    const material = new THREE.MeshBasicMaterial({
      map: this.texture,
      side: THREE.DoubleSide,
    });

    this.mesh.geometry = this.geometry;
    this.mesh.material = material;
    this.mesh.position.z = this.zOffset;

    if (prevGeo) prevGeo.dispose();
    if (prevMat) {
      if (prevMat.map && prevMat.map !== this.texture) prevMat.map.dispose();
      prevMat.dispose();
    }

    this.lockRoll();
    for (let i = 0; i < SETTLE_STEPS; i++) {
      this.lockRoll();
      this.integrate(1 / 90, i / 90);
      this.satisfy();
    }
    this.lockRoll();
    this.syncUV();
    this.writeGeom();
  }

  restYForRow(y) {
    const t = y / this.clothRows;
    const hangShare = 1 - ROLL_ROW_SHARE;
    if (t <= hangShare) {
      const u = hangShare > 0 ? t / hangShare : 1;
      return this.meshBottom + u * this.hangH;
    }
    const u = (t - hangShare) / Math.max(ROLL_ROW_SHARE, 1e-6);
    return this.seamY + u * this.arcLen;
  }

  buildParticles() {
    this.particles = [];
    for (let y = 0; y <= this.clothRows; y++) {
      const row = [];
      const restY = this.restYForRow(y);
      for (let x = 0; x <= this.clothCols; x++) {
        const restX = (x / this.clothCols - 0.5) * this.panelW;
        const pos = new THREE.Vector3(restX, restY, 0);
        row.push({
          pos: pos.clone(),
          prev: pos.clone(),
          pinned: false,
          restX,
          restY,
        });
      }
      this.particles.push(row);
    }
  }

  buildConstraints() {
    this.constraints = [];
    this.bends = [];
    const addC = (a, b) =>
      this.constraints.push({ a, b, rest: a.pos.distanceTo(b.pos) });
    const addB = (a, b) =>
      this.bends.push({ a, b, rest: a.pos.distanceTo(b.pos) });

    for (let y = 0; y <= this.clothRows; y++) {
      for (let x = 0; x <= this.clothCols; x++) {
        const p = this.particles[y][x];
        if (x < this.clothCols) addC(p, this.particles[y][x + 1]);
        if (y < this.clothRows) addC(p, this.particles[y + 1][x]);
        if (x < this.clothCols && y < this.clothRows) {
          addC(p, this.particles[y + 1][x + 1]);
          addC(this.particles[y][x + 1], this.particles[y + 1][x]);
        }
        if (x < this.clothCols - 1) addB(p, this.particles[y][x + 2]);
        if (y < this.clothRows - 1) addB(p, this.particles[y + 2][x]);
      }
    }
  }

  idx(x, y) {
    return y * (this.clothCols + 1) + x;
  }

  buildGeometry() {
    const positions = new Float32Array(
      (this.clothCols + 1) * (this.clothRows + 1) * 3
    );
    const uvs = new Float32Array(
      (this.clothCols + 1) * (this.clothRows + 1) * 2
    );
    const indices = [];

    for (let y = 0; y <= this.clothRows; y++) {
      for (let x = 0; x <= this.clothCols; x++) {
        const i = this.idx(x, y);
        uvs[i * 2] = x / this.clothCols;
        uvs[i * 2 + 1] =
          (this.particles[y][x].restY - this.meshBottom) /
          (this.meshTop - this.meshBottom);
      }
    }

    for (let y = 0; y < this.clothRows; y++) {
      for (let x = 0; x < this.clothCols; x++) {
        const a = this.idx(x, y);
        const b = this.idx(x + 1, y);
        const c = this.idx(x, y + 1);
        const d = this.idx(x + 1, y + 1);
        indices.push(a, c, b, b, c, d);
      }
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(positions, 3)
    );
    this.geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    this.geometry.setIndex(indices);
  }

  roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w * 0.5, h * 0.5);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  slotPx(i) {
    const s = this.slots[i];
    if (!s) return null;
    return {
      x: (s.x / this.panelW) * this.texW,
      y: (s.y / this.contentH) * this.texH,
      w: (s.w / this.panelW) * this.texW,
      h: (s.h / this.contentH) * this.texH,
    };
  }

  buildTexture() {
    this.texW = this.requestedTexW ?? 1280;
    this.texH = Math.min(
      4096,
      Math.round(this.texW * (this.contentH / this.panelW))
    );
    this.canvas = document.createElement("canvas");
    this.canvas.width = this.texW;
    this.canvas.height = this.texH;
    this.ctx = this.canvas.getContext("2d", { alpha: false });
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = "high";
    this.paintFilmBase();

    if (this.texture) this.texture.dispose();
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.generateMipmaps = false;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.anisotropy = this.maxAnisotropy;
    this.texture.needsUpdate = true;
  }

  paintFilmBase() {
    const ctx = this.ctx;
    const g = ctx.createLinearGradient(0, 0, this.texW, 0);
    g.addColorStop(0, CLOTH_COLOR_DEEP);
    g.addColorStop(0.08, CLOTH_COLOR);
    g.addColorStop(0.92, CLOTH_COLOR);
    g.addColorStop(1, CLOTH_COLOR_DEEP);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.texW, this.texH);

    const strip = (this.pad / this.panelW) * this.texW * 0.55;
    const holeW = strip * 0.28;
    const holeH = holeW * 1.15;
    const gap = holeH * 1.15;
    const inset =
      (strip - holeW) * 0.5 +
      ((this.pad / this.panelW) * this.texW - strip) * 0.15;

    ctx.fillStyle = SPROCKET;
    for (let y = inset; y < this.texH - holeH; y += holeH + gap) {
      this.roundRect(ctx, inset, y, holeW, holeH, holeW * 0.22);
      ctx.fill();
      this.roundRect(
        ctx,
        this.texW - inset - holeW,
        y,
        holeW,
        holeH,
        holeW * 0.22
      );
      ctx.fill();
    }
  }

  drawFallback(_i, s) {
    const ctx = this.ctx;
    ctx.save();
    this.roundRect(ctx, s.x, s.y, s.w, s.h, 4);
    ctx.fillStyle = "#101010";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  drawCover(source, s) {
    const ctx = this.ctx;
    const sw = source.videoWidth || source.naturalWidth || source.width || 1;
    const sh = source.videoHeight || source.naturalHeight || source.height || 1;
    const corr = REEL_MEDIA_ASPECT_CORRECTION;
    const ir = (sw / sh) * corr;
    const sr = s.w / s.h;
    let sx;
    let sy;
    let cw;
    let ch;
    if (ir > sr) {
      ch = sh;
      cw = (ch * sr) / corr;
      sx = (sw - cw) * 0.5;
      sy = 0;
    } else {
      cw = sw;
      ch = (cw / sr) * corr;
      sx = 0;
      sy = (sh - ch) * 0.5;
    }

    ctx.save();
    this.roundRect(ctx, s.x, s.y, s.w, s.h, 4);
    ctx.clip();
    ctx.drawImage(source, sx, sy, cw, ch, s.x, s.y, s.w, s.h);
    ctx.restore();

    ctx.save();
    this.roundRect(ctx, s.x, s.y, s.w, s.h, 4);
    ctx.strokeStyle = "rgba(255,255,255,0.16)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  paintSlotChrome(i, s) {
    const ctx = this.ctx;
    const m = Math.min(s.w, s.h);
    const xPad = m * 0.035;
    const topPad = m * 0.03;
    const bottomPad = m * 0.03;
    ctx.save();
    ctx.fillStyle = "#ffffff";
    ctx.font = `600 ${Math.round(m * 0.038)}px Arial, sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(
      String(i + 1).padStart(2, "0"),
      s.x + xPad,
      s.y + topPad
    );

    ctx.font = `500 ${Math.round(m * 0.065)}px Arial, "Segoe UI Symbol", sans-serif`;
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillText("↗", s.x + s.w - xPad, s.y + s.h - bottomPad);
    ctx.restore();
  }

  paintSlot(i, { chrome = true } = {}) {
    const s = this.slotPx(i);
    if (!s) return;
    const entry = this.media[i];
    const ctx = this.ctx;

    ctx.fillStyle = CLOTH_COLOR;
    ctx.fillRect(s.x - 1, s.y - 1, s.w + 2, s.h + 2);

    if (!entry || entry.type === "none" || !entry.source) {
      this.drawFallback(i, s);
      return;
    }

    try {
      if (entry.type === "video") {
        if (entry.source.readyState >= 2) {
          this.drawCover(entry.source, s);
          if (chrome) this.paintSlotChrome(i, s);
        } else {
          this.drawFallback(i, s);
        }
      } else {
        this.drawCover(entry.source, s);
        if (chrome) this.paintSlotChrome(i, s);
      }
    } catch {
      this.drawFallback(i, s);
    }
  }

  paintAllSlots() {
    for (let i = 0; i < this.cardCount; i++) this.paintSlot(i);
    if (this.texture) this.texture.needsUpdate = true;
  }

  setSlotImage(i, image) {
    if (i < 0 || i >= this.cardCount) return;
    this.media[i] = { type: "image", source: image, dirty: true };
    this.paintSlot(i);
    this.texture.needsUpdate = true;
  }

  setSlotVideo(i, video) {
    if (i < 0 || i >= this.cardCount) return;
    this.media[i] = { type: "video", source: video, dirty: true };
    this.paintSlot(i);
    this.texture.needsUpdate = true;
  }

  updateVideoFrames(indexes) {
    if (!indexes || indexes.size === 0) return;
    const now = performance.now();
    if (now - this._lastVideoPaint < VIDEO_PAINT_MS) return;
    this._lastVideoPaint = now;

    const { top, bottom } = this.getVisibleDepthRange();
    const center = (top + bottom) * 0.5;
    const ranked = [];
    for (const i of indexes) {
      const entry = this.media[i];
      if (!entry || entry.type !== "video" || !entry.source) continue;
      if (entry.source.readyState < 2) continue;
      const s = this.slots[i];
      if (!s) continue;
      ranked.push({ i, dist: Math.abs(s.y + s.h * 0.5 - center) });
    }
    ranked.sort((a, b) => a.dist - b.dist);

    let dirty = false;
    for (let n = 0; n < Math.min(this.videoPaintMax, ranked.length); n++) {
      this.paintSlot(ranked[n].i, { chrome: true });
      dirty = true;
    }
    if (dirty && this.texture) this.texture.needsUpdate = true;
  }

  paintAllReadyVideos() {
    let dirty = false;
    for (let i = 0; i < this.cardCount; i++) {
      const entry = this.media[i];
      if (!entry || entry.type !== "video" || !entry.source) continue;
      if (entry.source.readyState < 2) continue;
      this.paintSlot(i, { chrome: true });
      dirty = true;
    }
    if (dirty && this.texture) this.texture.needsUpdate = true;
  }

  syncUV() {
    const uvAttr = this.geometry.attributes.uv;
    for (let y = 0; y <= this.clothRows; y++) {
      for (let x = 0; x <= this.clothCols; x++) {
        const p = this.particles[y][x];
        const along = p.restY - this.meshBottom;
        const belowSeam = this.hangH - along;
        const depth = this.rollMargin + this.scroll + belowSeam;
        const v = 1 - depth / this.contentH;
        uvAttr.setXY(this.idx(x, y), x / this.clothCols, v);
      }
    }
    uvAttr.needsUpdate = true;
  }

  lockRoll() {
    const R0 = this.rollRadius;
    const cy = this.seamY;
    const cz = R0;
    const seamBand = ((this.meshTop - this.meshBottom) / this.clothRows) * 2.5;

    for (let y = 0; y <= this.clothRows; y++) {
      for (let x = 0; x <= this.clothCols; x++) {
        const p = this.particles[y][x];
        const arc = p.restY - this.seamY;
        const isSide = x === 0 || x === this.clothCols;

        if (arc >= 0) {
          const a = Math.min(arc, this.arcLen);
          const t = a / this.arcLen;
          const r = R0 - this.rollShrink * t;
          const angle = a / R0;

          p.pos.x = p.restX;
          p.pos.y = cy + Math.sin(angle) * r;
          p.pos.z = cz - Math.cos(angle) * r;
          p.prev.copy(p.pos);
          p.pinned = true;
        } else if (arc > -seamBand || isSide) {
          p.pos.set(p.restX, p.restY, 0);
          p.prev.copy(p.pos);
          p.pinned = true;
        } else {
          p.pinned = false;
        }
      }
    }
  }

  writeGeom() {
    const attr = this.geometry.attributes.position;
    for (let y = 0; y <= this.clothRows; y++) {
      for (let x = 0; x <= this.clothCols; x++) {
        const p = this.particles[y][x];
        attr.setXYZ(this.idx(x, y), p.pos.x, p.pos.y, p.pos.z);
      }
    }
    attr.needsUpdate = true;
    this._normalFrame = (this._normalFrame + 1) % 3;
    if (this._normalFrame === 0) this.geometry.computeVertexNormals();
  }

  integrate(dt, t) {
    for (let y = 0; y <= this.clothRows; y++) {
      for (let x = 0; x <= this.clothCols; x++) {
        const p = this.particles[y][x];
        if (p.pinned) continue;

        const vx = (p.pos.x - p.prev.x) * DAMPING;
        const vy = (p.pos.y - p.prev.y) * DAMPING;
        const vz = (p.pos.z - p.prev.z) * DAMPING;
        p.prev.copy(p.pos);
        p.pos.x += vx;
        p.pos.y += vy;
        p.pos.z += vz;
        p.pos.y += this.gravityY * dt * dt;

        const hold = this.poking ? 0.09 : 0.16;
        p.pos.x += (p.restX - p.pos.x) * hold;
        p.pos.y += (p.restY - p.pos.y) * hold;

        if (this.poking) {
          const nearSeam = Math.max(
            0,
            1 - (this.seamY - p.restY) / (this.hangH * 0.35)
          );
          const wind =
            (Math.sin(t * 0.5 + x * 0.25 + y * 0.1) * this.windAmount +
              Math.sin(t * 0.3 + y * 0.14) * this.windAmount * 0.5) *
            (1 - nearSeam * 0.85);
          p.pos.z += wind * dt * dt * 24;
        }

        if (this.poking) {
          const d = Math.hypot(
            p.pos.x - this.pokeLocal.x,
            p.pos.y - this.pokeLocal.y
          );
          if (d < this.pokeRadius) {
            const fall = Math.pow(1 - d / this.pokeRadius, POKE_FALLOFF);
            p.pos.z -= fall * this.pokeStrength * Math.min(dt, 1 / 30);
          }
        }

        p.pos.z = Math.max(-this.maxZ, Math.min(this.maxZ, p.pos.z));
      }
    }
  }

  satisfy() {
    for (let i = 0; i < this.constraintIterations; i++) {
      for (const c of this.constraints) {
        const dx = c.b.pos.x - c.a.pos.x;
        const dy = c.b.pos.y - c.a.pos.y;
        const dz = c.b.pos.z - c.a.pos.z;
        const dist = Math.hypot(dx, dy, dz) || 1e-5;
        const f = (dist - c.rest) / dist;
        const ox = dx * 0.5 * f;
        const oy = dy * 0.5 * f;
        const oz = dz * 0.5 * f;
        if (!c.a.pinned) {
          c.a.pos.x += ox;
          c.a.pos.y += oy;
          c.a.pos.z += oz;
        }
        if (!c.b.pinned) {
          c.b.pos.x -= ox;
          c.b.pos.y -= oy;
          c.b.pos.z -= oz;
        }
      }
      for (const c of this.bends) {
        const dx = c.b.pos.x - c.a.pos.x;
        const dy = c.b.pos.y - c.a.pos.y;
        const dz = c.b.pos.z - c.a.pos.z;
        const dist = Math.hypot(dx, dy, dz) || 1e-5;
        const f = ((dist - c.rest) / dist) * BEND_STIFFNESS;
        const ox = dx * 0.5 * f;
        const oy = dy * 0.5 * f;
        const oz = dz * 0.5 * f;
        if (!c.a.pinned) {
          c.a.pos.x += ox;
          c.a.pos.y += oy;
          c.a.pos.z += oz;
        }
        if (!c.b.pinned) {
          c.b.pos.x -= ox;
          c.b.pos.y -= oy;
          c.b.pos.z -= oz;
        }
      }
    }
  }

  setScrollTarget(value) {
    this.scrollTarget = THREE.MathUtils.clamp(value, 0, this.maxScroll);
  }

  setPokeLocal(x, y) {
    this.poking = true;
    this._idleCooldown = IDLE_COOLDOWN_FRAMES;
    this.pokeLocal.set(x, y, 0);
  }

  clearPoke() {
    this.poking = false;
  }

  syncWorldSeam(foldY, parentY) {
    this.mesh.position.y = foldY - parentY - this.seamY;
    this.mesh.position.z = this.zOffset;
  }

  hitIndexFromUv(uv) {
    if (!uv) return -1;
    const depth = (1 - uv.y) * this.contentH;
    const xWorld = uv.x * this.panelW;
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (
        xWorld >= s.x &&
        xWorld <= s.x + s.w &&
        depth >= s.y &&
        depth <= s.y + s.h
      ) {
        return i;
      }
    }
    return -1;
  }

  getVisibleDepthRange() {
    const top = this.rollMargin + this.scroll;
    const bottom = top + this.hangH;
    return { top, bottom };
  }

  isSlotNearView(i, margin = 0.35) {
    const s = this.slots[i];
    if (!s) return false;
    const { top, bottom } = this.getVisibleDepthRange();
    const pad = s.h * margin;
    return s.y + s.h > top - pad && s.y < bottom + pad;
  }

  update(dt, elapsed) {
    const prevScroll = this.scroll;
    this.scroll +=
      (this.scrollTarget - this.scroll) *
      (1 - Math.pow(1 - SCROLL_SMOOTH, dt * 60));
    const scrollMoving = Math.abs(this.scrollTarget - this.scroll) > 0.02;
    if (scrollMoving || this.poking) {
      this._idleCooldown = IDLE_COOLDOWN_FRAMES;
    }

    if (Math.abs(this.scroll - prevScroll) > 1e-4) this.syncUV();

    if (this._idleCooldown <= 0 && !this.poking && !scrollMoving) {
      return;
    }
    if (this._idleCooldown > 0) this._idleCooldown -= 1;

    this.lockRoll();
    for (let s = 0; s < SUBSTEPS; s++) {
      this.integrate(dt / SUBSTEPS, elapsed);
      this.satisfy();
    }
    this.lockRoll();
    this.writeGeom();
  }

  dispose() {
    this.geometry?.dispose();
    this.texture?.dispose();
    this.mesh.material?.dispose?.();
  }
}
