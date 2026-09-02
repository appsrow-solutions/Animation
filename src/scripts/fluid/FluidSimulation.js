import * as THREE from "three";
import fluidVertex from "../shader/fluid/fluidVertex.glsl";
import fluidAdvect from "../shader/fluid/fluidAdvect.glsl";
import fluidSplat from "../shader/fluid/fluidSplat.glsl";
import fluidDyeAdvect from "../shader/fluid/fluidDyeAdvect.glsl";
import fluidDisplay from "../shader/fluid/fluidDisplay.glsl";

const SIM_RES = 256;
const MOUSE_RADIUS = 0.1;
const PRESSURE_MOVE = 0.94;
const PRESSURE_COAST = 0.97;
const PRESSURE_IDLE = 0.88;
const FORCE_SCALE = 38.0;
const DYE_MOVE = 0.93;
const DYE_COAST = 0.92;
const DYE_IDLE = 0.8;
const TRAVEL_SCALE = 3.8;
const SPLAT_RADIUS = 0.0022;
const FADE_SPEED = 0.93;

export default class FluidSimulation {
  constructor(renderer, domElement, bgColorHex = 0xf0f0ee) {
    this.renderer = renderer;
    this.domElement = domElement;
    this.bgColor = new THREE.Color(bgColorHex);
    this.inkColor = new THREE.Vector3(
      this.bgColor.r + 0.03,
      this.bgColor.g + 0.03,
      this.bgColor.b + 0.025
    );

    this.velRead = this.createTarget();
    this.velWrite = this.createTarget();
    this.dyeRead = this.createTarget();
    this.dyeWrite = this.createTarget();

    this.mouse = new THREE.Vector2(0.5, 0.5);
    this.prevMouse = new THREE.Vector2(0.5, 0.5);
    this.coastTail = new THREE.Vector2(0.5, 0.5);
    this.mouseVelocity = new THREE.Vector2();
    this.force = new THREE.Vector2();
    this.waveMomentum = new THREE.Vector2();
    this.coastEnergy = 0;
    this.cellSize = new THREE.Vector2(1 / SIM_RES, 1 / SIM_RES);
    this.fluidVisible = false;
    this.hadPointerMove = false;
    this.visibility = 0;

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.simScene = new THREE.Scene();
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.simScene.add(this.quad);

    const base = { glslVersion: THREE.GLSL1 };

    this.advectMaterial = new THREE.ShaderMaterial({
      ...base,
      vertexShader: fluidVertex,
      fragmentShader: fluidAdvect,
      uniforms: {
        uTexture: { value: null },
        uCellSize: { value: this.cellSize },
        uForce: { value: this.force },
        uMouse: { value: this.mouse },
        uPrevMouse: { value: this.prevMouse },
        uMouseVelocity: { value: this.mouseVelocity },
        uMouseRadius: { value: MOUSE_RADIUS },
        uPressure: { value: PRESSURE_MOVE },
        uApplyForce: { value: 1.0 },
      },
    });

    this.splatMaterial = new THREE.ShaderMaterial({
      ...base,
      vertexShader: fluidVertex,
      fragmentShader: fluidSplat,
      uniforms: {
        uTarget: { value: null },
        uPoint: { value: new THREE.Vector2() },
        uColor: { value: this.inkColor },
        uRadius: { value: SPLAT_RADIUS },
      },
    });

    this.dyeAdvectMaterial = new THREE.ShaderMaterial({
      ...base,
      vertexShader: fluidVertex,
      fragmentShader: fluidDyeAdvect,
      uniforms: {
        uVelocity: { value: null },
        uSource: { value: null },
        uCellSize: { value: this.cellSize },
        uDissipation: { value: DYE_MOVE },
        uTravelScale: { value: TRAVEL_SCALE },
      },
    });

    this.displayMaterial = new THREE.ShaderMaterial({
      ...base,
      vertexShader: fluidVertex,
      fragmentShader: fluidDisplay,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NormalBlending,
      uniforms: {
        uDye: { value: null },
        uVelocity: { value: null },
        uBgColor: { value: this.bgColor },
        uVisibility: { value: 0 },
      },
    });

    this.overlayScene = new THREE.Scene();
    this.overlayQuad = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      this.displayMaterial
    );
    this.overlayScene.add(this.overlayQuad);

    [this.velRead, this.velWrite, this.dyeRead, this.dyeWrite].forEach((target) => {
      this.clearTarget(target);
    });

    this.bindEvents();
  }

  createTarget() {
    return new THREE.WebGLRenderTarget(SIM_RES, SIM_RES, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType,
      depthBuffer: false,
      stencilBuffer: false,
    });
  }

  clearTarget(target) {
    this.renderer.setRenderTarget(target);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear();
    this.renderer.setRenderTarget(null);
  }

  clearAllTargets() {
    [this.velRead, this.velWrite, this.dyeRead, this.dyeWrite].forEach((target) => {
      this.clearTarget(target);
    });
  }

  resetSim() {
    this.coastEnergy = 0;
    this.mouseVelocity.set(0, 0);
    this.force.set(0, 0);
    this.clearAllTargets();
  }

  bindEvents() {
    const updateMouse = (clientX, clientY) => {
      this.hadPointerMove = true;
      const rect = this.domElement.getBoundingClientRect();
      this.prevMouse.copy(this.mouse);
      this.mouse.set(
        (clientX - rect.left) / rect.width,
        1.0 - (clientY - rect.top) / rect.height
      );
      this.mouseVelocity.subVectors(this.mouse, this.prevMouse);
      const speed = this.mouseVelocity.length();

      if (speed > 0.0008) {
        this.waveMomentum.copy(this.mouseVelocity).normalize();
        this.coastEnergy = Math.min(this.coastEnergy + speed * 18.0, 1.6);
      }

      this.force
        .copy(this.mouseVelocity)
        .multiplyScalar(FORCE_SCALE * Math.min(speed * 80.0, 2.0));
    };

    this.handlePointerMove = (event) => {
      updateMouse(event.clientX, event.clientY);
    };
    this.handlePointerDown = (event) => {
      updateMouse(event.clientX, event.clientY);
    };
    this.handlePointerLeave = () => {
      this.hadPointerMove = false;
    };
    this.domElement.addEventListener("pointermove", this.handlePointerMove);
    this.domElement.addEventListener("pointerdown", this.handlePointerDown);
    this.domElement.addEventListener("pointerleave", this.handlePointerLeave);
  }

  blit(material, target) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.simScene, this.camera);
    this.renderer.setRenderTarget(null);
  }

  swapVelocity() {
    const temp = this.velRead;
    this.velRead = this.velWrite;
    this.velWrite = temp;
  }

  swapDye() {
    const temp = this.dyeRead;
    this.dyeRead = this.dyeWrite;
    this.dyeWrite = temp;
  }

  splatDye() {
    this.splatMaterial.uniforms.uTarget.value = this.dyeRead.texture;
    this.splatMaterial.uniforms.uPoint.value.copy(this.mouse);
    this.blit(this.splatMaterial, this.dyeWrite);
    this.swapDye();
  }

  advectDye() {
    this.dyeAdvectMaterial.uniforms.uVelocity.value = this.velRead.texture;
    this.dyeAdvectMaterial.uniforms.uSource.value = this.dyeRead.texture;
    this.blit(this.dyeAdvectMaterial, this.dyeWrite);
    this.swapDye();
  }

  update() {
    const speed = this.mouseVelocity.length();
    const mouseMoved = this.mouse.distanceToSquared(this.prevMouse) > 1e-10;
    const active = this.hadPointerMove;
    const moving = active && speed > 0.001;

    if (active) {
      this.visibility = 1.0;
    } else {
      this.visibility *= FADE_SPEED;
    }

    if (this.visibility < 0.01) {
      this.fluidVisible = false;
      this.visibility = 0;
      this.resetSim();
      this.hadPointerMove = false;
      return;
    }

    this.fluidVisible = true;

    if (moving) {
      this.advectMaterial.uniforms.uPressure.value = PRESSURE_MOVE;
      this.dyeAdvectMaterial.uniforms.uDissipation.value = DYE_MOVE;
      this.advectMaterial.uniforms.uMouse.value.copy(this.mouse);
      this.advectMaterial.uniforms.uPrevMouse.value.copy(this.prevMouse);
      this.advectMaterial.uniforms.uMouseVelocity.value.copy(this.mouseVelocity);
      this.advectMaterial.uniforms.uForce.value.copy(this.force);
    } else {
      this.advectMaterial.uniforms.uPressure.value = PRESSURE_IDLE;
      this.dyeAdvectMaterial.uniforms.uDissipation.value = DYE_IDLE;
      this.force.set(0, 0);
      this.advectMaterial.uniforms.uForce.value.set(0, 0);
      this.advectMaterial.uniforms.uMouse.value.copy(this.mouse);
      this.advectMaterial.uniforms.uPrevMouse.value.copy(this.mouse);
      this.advectMaterial.uniforms.uMouseVelocity.value.set(0, 0);
    }

    this.advectMaterial.uniforms.uTexture.value = this.velRead.texture;
    this.advectMaterial.uniforms.uApplyForce.value = moving && mouseMoved ? 1.0 : 0.0;
    this.blit(this.advectMaterial, this.velWrite);
    this.swapVelocity();

    if (moving) {
      this.splatDye();
    }

    this.advectDye();
    if (!active) {
      this.advectDye();
    }

    if (active && moving) {
      this.mouseVelocity.multiplyScalar(0.82);
      this.force.multiplyScalar(0.82);
    } else {
      this.mouseVelocity.set(0, 0);
      this.force.set(0, 0);
    }

    this.hadPointerMove = false;
    this.displayMaterial.uniforms.uVisibility.value = this.visibility;
  }

  renderOverlay() {
    if (!this.fluidVisible) return;
    this.displayMaterial.uniforms.uVisibility.value = this.visibility;
    this.displayMaterial.uniforms.uDye.value = this.dyeRead.texture;
    this.displayMaterial.uniforms.uVelocity.value = this.velRead.texture;
    this.renderer.autoClear = false;
    this.renderer.render(this.overlayScene, this.camera);
    this.renderer.autoClear = true;
  }

  destroy() {
    if (this.handlePointerMove) {
      this.domElement.removeEventListener("pointermove", this.handlePointerMove);
    }
    if (this.handlePointerDown) {
      this.domElement.removeEventListener("pointerdown", this.handlePointerDown);
    }
    if (this.handlePointerLeave) {
      this.domElement.removeEventListener("pointerleave", this.handlePointerLeave);
    }
    [this.velRead, this.velWrite, this.dyeRead, this.dyeWrite].forEach((target) =>
      target.dispose()
    );
    this.advectMaterial.dispose();
    this.splatMaterial.dispose();
    this.dyeAdvectMaterial.dispose();
    this.displayMaterial.dispose();
    this.quad.geometry.dispose();
    this.overlayQuad.geometry.dispose();
  }
}
