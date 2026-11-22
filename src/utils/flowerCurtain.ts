import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import type { CurtainEasingMode, FlowerCurtainConfig } from '../types/bouquet';

const _dummy = new THREE.Object3D();
const _camForward = new THREE.Vector3();
const _camRight = new THREE.Vector3();
const _camUp = new THREE.Vector3();
const _worldPos = new THREE.Vector3();
const _tmpQuat = new THREE.Quaternion();
const _eulerQuat = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _color = new THREE.Color();

export const MAX_CURTAIN_FLOWERS = 380;
const MAX_CURTAIN_PARTICLES = 260;

interface CurtainFlowerMeta {
  side: -1 | 1;
  u: number;
  v: number;
  layerFrac: number;
  appearStart: number;
  partDelay: number;
  baseScale: number;
  spinSign: number;
  rotPhase: number;
  tiltX: number;
  tiltY: number;
  colorIndex: number;
  brightnessJitter: number;
}

interface CurtainParticleMeta {
  side: -1 | 1;
  u: number;
  v: number;
  layerFrac: number;
  speedMult: number;
  phase: number;
  riseSpeed: number;
}

function createSculptedCurtainBlossomGeometry(isLowDetail: boolean): {
  petalGeo: THREE.BufferGeometry;
  stamenGeo: THREE.BufferGeometry;
} {
  const parts: THREE.BufferGeometry[] = [];
  const segW = isLowDetail ? 2 : 3;
  const segH = isLowDetail ? 3 : 5;

  const makeWhorlPetal = (
    length: number,
    width: number,
    cupAmt: number,
    curlAmt: number,
    azimuth: number,
    tiltX: number,
    zOffset: number,
    throatBoost: number,
  ) => {
    const geo = new THREE.PlaneGeometry(width, length, segW, segH);
    geo.translate(0, length * 0.5, 0);

    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);

    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i);
      const py = pos.getY(i);
      const v = THREE.MathUtils.clamp(py / length, 0, 1);
      const u = px / Math.max(0.001, width * 0.5);

      // Taper base and tip smoothly into a sculptural lily/rose petal silhouette
      const silhouette =
        Math.sin(Math.pow(v, 0.7) * Math.PI) * (0.34 + 0.66 * (1 - Math.pow(v, 2.3))) +
        0.06 * (1 - v);
      const x = px * silhouette;
      const archZ =
        Math.sin(v * Math.PI * 0.85) * cupAmt -
        Math.pow(Math.max(0, v - 0.55) / 0.45, 2.0) * curlAmt -
        u * u * 0.032 * Math.sin(v * Math.PI);

      pos.setXYZ(i, x, py, archZ);

      // Subtle warm glowing throat transitioning to crisp petal albedo
      const throatBlend = THREE.MathUtils.clamp(1 - v * 2.1, 0, 1) * throatBoost;
      colors[i * 3] = THREE.MathUtils.lerp(1.0, 1.08, throatBlend);
      colors[i * 3 + 1] = THREE.MathUtils.lerp(1.0, 0.96, throatBlend);
      colors[i * 3 + 2] = THREE.MathUtils.lerp(1.0, 0.88, throatBlend);
    }

    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.rotateX(tiltX);
    geo.translate(0, 0, zOffset);
    geo.rotateZ(azimuth);
    geo.computeVertexNormals();
    parts.push(geo);
  };

  // Outer 6 broad cupped petals
  for (let i = 0; i < 6; i++) {
    makeWhorlPetal(0.46, 0.34, 0.085, 0.065, (i * Math.PI) / 3, 0.58, 0.0, 0.75);
  }
  // Inner 5 upright ruffled petals
  for (let i = 0; i < 5; i++) {
    makeWhorlPetal(
      0.34,
      0.26,
      0.075,
      0.04,
      (i * Math.PI * 2) / 5 + 0.31,
      0.88,
      0.02,
      0.95,
    );
  }

  const mergedPetals = BufferGeometryUtils.mergeGeometries(parts, false);
  parts.forEach((g) => g.dispose());
  mergedPetals.computeBoundingSphere();

  // Central golden-rose stamen crown
  const stamenParts: THREE.BufferGeometry[] = [];
  const core = new THREE.SphereGeometry(0.052, isLowDetail ? 6 : 10, isLowDetail ? 5 : 8);
  core.translate(0, 0, 0.06);
  stamenParts.push(core);

  const antherCount = isLowDetail ? 4 : 6;
  for (let i = 0; i < antherCount; i++) {
    const a = (i / antherCount) * Math.PI * 2;
    const tip = new THREE.SphereGeometry(0.022, 6, 5);
    tip.translate(Math.cos(a) * 0.085, Math.sin(a) * 0.085, 0.11);
    stamenParts.push(tip);
  }

  const mergedStamens = BufferGeometryUtils.mergeGeometries(stamenParts, false);
  stamenParts.forEach((g) => g.dispose());
  mergedStamens.computeBoundingSphere();

  return { petalGeo: mergedPetals, stamenGeo: mergedStamens };
}

function createCurtainSparkleTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createRadialGradient(32, 32, 1, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.32, 'rgba(251,207,232,0.82)');
  grad.addColorStop(0.68, 'rgba(244,114,182,0.28)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function applyCurtainEasing(t: number, mode: CurtainEasingMode): number {
  const c = THREE.MathUtils.clamp(t, 0, 1);
  if (mode === 'ease-out-cubic') {
    return 1 - Math.pow(1 - c, 3);
  }
  if (mode === 'ease-in-out-sine') {
    return -(Math.cos(Math.PI * c) - 1) / 2;
  }
  // silk-dramatic: gentle start, sweeping fluid mid-open, feathered settle
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
}

function seededRand(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453123;
  return x - Math.floor(x);
}

export interface FlowerCurtainSystem {
  group: THREE.Group;
  update: (
    active: boolean,
    progressNorm: number,
    animClock: number,
    config: FlowerCurtainConfig,
    camera: THREE.PerspectiveCamera,
    reducedMotion: boolean,
  ) => void;
  applyPalette: (config: FlowerCurtainConfig) => void;
  dispose: () => void;
}

export function createFlowerCurtainSystem(
  initialConfig: FlowerCurtainConfig,
  isLowEndDevice: boolean,
): FlowerCurtainSystem {
  const group = new THREE.Group();
  group.visible = false;

  const { petalGeo, stamenGeo } = createSculptedCurtainBlossomGeometry(isLowEndDevice);

  const petalMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.36,
    metalness: 0.04,
    clearcoat: 0.38,
    clearcoatRoughness: 0.28,
    sheen: 0.65,
    sheenRoughness: 0.45,
    sheenColor: new THREE.Color('#fbcfe8'),
    side: THREE.DoubleSide,
  });

  const stamenMat = new THREE.MeshStandardMaterial({
    color: '#fde68a',
    emissive: '#f472b6',
    emissiveIntensity: 0.25,
    roughness: 0.42,
  });

  const flowerMesh = new THREE.InstancedMesh(petalGeo, petalMat, MAX_CURTAIN_FLOWERS);
  flowerMesh.frustumCulled = false;
  flowerMesh.renderOrder = 30;

  const stamenMesh = new THREE.InstancedMesh(stamenGeo, stamenMat, MAX_CURTAIN_FLOWERS);
  stamenMesh.frustumCulled = false;
  stamenMesh.renderOrder = 31;

  group.add(flowerMesh);
  group.add(stamenMesh);

  // Precompute flower layout slots evenly distributed across left/right halves and layers
  const metas: CurtainFlowerMeta[] = [];
  for (let i = 0; i < MAX_CURTAIN_FLOWERS; i++) {
    const r1 = seededRand(i * 7 + 1);
    const r2 = seededRand(i * 7 + 2);
    const r3 = seededRand(i * 7 + 3);
    const r4 = seededRand(i * 7 + 4);
    const r5 = seededRand(i * 7 + 5);
    const r6 = seededRand(i * 7 + 6);

    // Golden-angle / stratified coverage so center is lushly covered without holes
    const side: -1 | 1 = i % 2 === 0 ? -1 : 1;
    // Slight organic interlocking overlap across center seam (u reaches slightly past 0)
    const radialMag = Math.pow(r1, 0.78) * 1.12;
    const seamOverlap = (r2 - 0.35) * 0.12;
    const u = side * radialMag - side * seamOverlap;
    const v = (r3 - 0.5) * 2.18;

    const layerIdx = i % 5;
    const layerFrac = layerIdx / 4;

    metas.push({
      side,
      u,
      v,
      layerFrac,
      appearStart: (1 - Math.min(1, Math.abs(u))) * 0.1 + r4 * 0.12,
      partDelay: Math.min(0.22, Math.abs(u) * 0.14 + r5 * 0.08),
      baseScale: r6,
      spinSign: (i % 3 === 0 ? 1 : -1) * (0.65 + r4 * 0.7),
      rotPhase: r2 * Math.PI * 2,
      tiltX: (r3 - 0.5) * 0.42,
      tiltY: (r5 - 0.5) * 0.45,
      colorIndex: i,
      brightnessJitter: 0.86 + r4 * 0.24,
    });
  }

  // Soft parting stardust & blossom sparkles
  const particlePositions = new Float32Array(MAX_CURTAIN_PARTICLES * 3);
  const particleColors = new Float32Array(MAX_CURTAIN_PARTICLES * 3);
  const particleMetas: CurtainParticleMeta[] = [];
  const sparkleCols = [
    new THREE.Color('#fbcfe8'),
    new THREE.Color('#f472b6'),
    new THREE.Color('#ffffff'),
    new THREE.Color('#fda4af'),
  ];

  for (let i = 0; i < MAX_CURTAIN_PARTICLES; i++) {
    const r1 = seededRand(i * 11 + 101);
    const r2 = seededRand(i * 11 + 102);
    const r3 = seededRand(i * 11 + 103);
    const side: -1 | 1 = i % 2 === 0 ? -1 : 1;
    const c = sparkleCols[i % sparkleCols.length];
    particleColors[i * 3] = c.r;
    particleColors[i * 3 + 1] = c.g;
    particleColors[i * 3 + 2] = c.b;
    particleMetas.push({
      side,
      u: side * r1 * 0.92,
      v: (r2 - 0.5) * 2.05,
      layerFrac: r3,
      speedMult: 0.85 + r1 * 0.65,
      phase: r2 * Math.PI * 2,
      riseSpeed: (r3 - 0.35) * 0.45,
    });
  }

  const particleGeo = new THREE.BufferGeometry();
  const particlePosAttr = new THREE.BufferAttribute(particlePositions, 3);
  particleGeo.setAttribute('position', particlePosAttr);
  particleGeo.setAttribute('color', new THREE.BufferAttribute(particleColors, 3));

  const sparkleTex = createCurtainSparkleTexture();
  const particleMat = new THREE.PointsMaterial({
    size: 0.22,
    map: sparkleTex,
    vertexColors: true,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  const particlePoints = new THREE.Points(particleGeo, particleMat);
  particlePoints.frustumCulled = false;
  particlePoints.renderOrder = 32;
  group.add(particlePoints);

  let lastPaletteSig = '';

  const applyPalette = (config: FlowerCurtainConfig) => {
    const colors =
      config.flowerColors && config.flowerColors.length > 0
        ? config.flowerColors
        : ['#f472b6', '#fbcfe8', '#fb7185', '#ffffff'];
    const sig = colors.join('|');
    if (sig === lastPaletteSig) return;
    lastPaletteSig = sig;

    const parsed = colors.map((hex) => new THREE.Color(hex));
    for (let i = 0; i < MAX_CURTAIN_FLOWERS; i++) {
      const m = metas[i];
      const base = parsed[m.colorIndex % parsed.length];
      _color.copy(base).multiplyScalar(m.brightnessJitter);
      flowerMesh.setColorAt(i, _color);
    }
    if (flowerMesh.instanceColor) {
      flowerMesh.instanceColor.needsUpdate = true;
    }
  };

  applyPalette(initialConfig);

  const update = (
    active: boolean,
    progressNorm: number,
    animClock: number,
    config: FlowerCurtainConfig,
    camera: THREE.PerspectiveCamera,
    reducedMotion: boolean,
  ) => {
    if (!active || !config.enabled || progressNorm >= 0.995) {
      group.visible = false;
      return;
    }

    group.visible = true;
    applyPalette(config);

    // Responsive density cap for low-end/software WebGL while preserving dense curtain structure
    const maxCap = isLowEndDevice ? Math.min(200, MAX_CURTAIN_FLOWERS) : MAX_CURTAIN_FLOWERS;
    const targetCount = Math.max(
      40,
      Math.min(maxCap, Math.round(config.flowerCount || 220)),
    );
    flowerMesh.count = targetCount;
    stamenMesh.count = targetCount;

    camera.updateMatrixWorld();
    _camRight.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    _camUp.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
    _camForward.setFromMatrixColumn(camera.matrixWorld, 2).negate().normalize();

    const halfTanFov = Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
    const aspect = Math.max(0.45, camera.aspect);
    const layerCount = Math.max(2, Math.min(5, Math.round(config.layers || 4)));

    const minSz = Math.max(0.35, config.minFlowerSize ?? 0.78);
    const maxSz = Math.max(minSz, config.maxFlowerSize ?? 1.65);
    const rotMult = config.rotationIntensity ?? 1.0;
    const sepMult = THREE.MathUtils.clamp(config.separationDistance ?? 1.18, 0.65, 1.8);

    // Stage timings (normalized 0..1 across curtain sequence):
    // 0.00 -> 0.35 : Massive surge inward forming dense floral curtain wall
    // 0.35 -> 0.42 : Lush full-curtain poise
    // 0.42 -> 0.96 : Smooth left & right parting revealing the bouquet stage
    const partPhaseStart = reducedMotion ? 0.15 : 0.41;
    const partPhaseSpan = reducedMotion ? 0.8 : 0.55;

    for (let i = 0; i < targetCount; i++) {
      const m = metas[i];
      const quantizedLayer = Math.floor(m.layerFrac * layerCount) / Math.max(1, layerCount - 1);
      // Place curtain planes safely in front of bouquet (bouquet radius ~2.1; camera at ~7.6+)
      const distFromCam = THREE.MathUtils.lerp(2.75, 4.95, quantizedLayer);
      const halfH = distFromCam * halfTanFov;
      const halfW = halfH * aspect;

      // Mobile narrow aspect boost so individual flowers feel proportional across portrait screens
      const responsiveScaleMult = aspect < 0.75 ? 0.78 + aspect * 0.3 : 1.0;
      const flowerScale = THREE.MathUtils.lerp(minSz, maxSz, m.baseScale) * responsiveScaleMult;

      const closedX = m.u * halfW;
      const closedY = m.v * halfH;

      // Surge entrance: flowers sweep in from edges / outer darkness
      const appearT = reducedMotion
        ? THREE.MathUtils.clamp(progressNorm / 0.18, 0, 1)
        : THREE.MathUtils.clamp((progressNorm - m.appearStart) / 0.22, 0, 1);
      const appearEase = 1 - Math.pow(1 - appearT, 3);

      const entryOffsetX = m.side * (halfW * 1.15 + 1.2) * (1 - appearEase);
      const entryOffsetY =
        Math.sin(m.rotPhase) * halfH * 0.48 * (1 - appearEase);
      const entryOffsetZ = (1 - appearEase) * (1.2 - quantizedLayer * 1.4);

      // Parting phase: visible left/right lateral separation
      const rawPartT = THREE.MathUtils.clamp(
        (progressNorm - (partPhaseStart + m.partDelay * 0.38)) / Math.max(0.18, partPhaseSpan - m.partDelay * 0.32),
        0,
        1,
      );
      const partEase = applyCurtainEasing(rawPartT, config.easing ?? 'silk-dramatic');

      const parallaxBoost = 1 + (1 - quantizedLayer) * 0.18;
      const slideDistance = (halfW * 1.42 + flowerScale * 0.95) * sepMult * parallaxBoost;
      const partX = m.side * slideDistance * partEase;
      const partArcY =
        Math.sin(partEase * Math.PI) * 0.18 * (m.v >= 0 ? 1 : -0.65) +
        partEase * m.v * 0.14;

      const finalX = closedX + entryOffsetX + partX;
      const finalY = closedY + entryOffsetY + partArcY;
      const finalDist = distFromCam + entryOffsetZ - partEase * 0.35;

      _worldPos
        .copy(camera.position)
        .addScaledVector(_camForward, finalDist)
        .addScaledVector(_camRight, finalX)
        .addScaledVector(_camUp, finalY);

      // Gentle scale-in on appearance & subtle edge bloom
      const activeScale =
        appearT <= 0.001
          ? 0.0001
          : flowerScale * (0.15 + 0.85 * appearEase) * (1.0 - 0.12 * partEase);

      // Face camera with lively botanical tilt + rotation as curtain parts
      _tmpQuat.copy(camera.quaternion);
      const idleRock = Math.sin(animClock * 1.7 + m.rotPhase) * 0.06;
      _euler.set(
        m.tiltX + idleRock + partEase * 0.25 * m.spinSign * rotMult,
        m.tiltY + partEase * 0.45 * m.side * rotMult,
        m.rotPhase + partEase * 1.15 * m.spinSign * rotMult + (1 - appearEase) * 0.9 * m.side,
      );
      _eulerQuat.setFromEuler(_euler);
      _tmpQuat.multiply(_eulerQuat);

      _dummy.position.copy(_worldPos);
      _dummy.quaternion.copy(_tmpQuat);
      _dummy.scale.setScalar(activeScale);
      _dummy.updateMatrix();

      flowerMesh.setMatrixAt(i, _dummy.matrix);
      stamenMesh.setMatrixAt(i, _dummy.matrix);
    }

    flowerMesh.instanceMatrix.needsUpdate = true;
    stamenMesh.instanceMatrix.needsUpdate = true;

    // Update Curtain Sparkle Particles
    const showParticles = Boolean(config.particleEffects) && !reducedMotion;
    particlePoints.visible = showParticles;
    if (showParticles) {
      const pCount = isLowEndDevice ? 110 : MAX_CURTAIN_PARTICLES;
      particleGeo.setDrawRange(0, pCount);

      const overallAlpha =
        THREE.MathUtils.smoothstep(progressNorm, 0.05, 0.24) *
        (1 - THREE.MathUtils.smoothstep(progressNorm, 0.78, 0.99));
      particleMat.opacity = 0.88 * overallAlpha;

      const partGlobal = THREE.MathUtils.clamp(
        (progressNorm - partPhaseStart) / partPhaseSpan,
        0,
        1,
      );
      const partEaseGlobal = applyCurtainEasing(partGlobal, config.easing ?? 'silk-dramatic');

      for (let i = 0; i < pCount; i++) {
        const pm = particleMetas[i];
        const distFromCam = THREE.MathUtils.lerp(2.6, 4.7, pm.layerFrac);
        const halfH = distFromCam * halfTanFov;
        const halfW = halfH * aspect;

        const swirlX =
          pm.u * halfW +
          pm.side * partEaseGlobal * (halfW * 1.35 * sepMult) * pm.speedMult +
          Math.sin(animClock * 2.2 + pm.phase) * 0.16;
        const swirlY =
          pm.v * halfH +
          partEaseGlobal * pm.riseSpeed +
          Math.cos(animClock * 1.8 + pm.phase) * 0.14;

        _worldPos
          .copy(camera.position)
          .addScaledVector(_camForward, distFromCam)
          .addScaledVector(_camRight, swirlX)
          .addScaledVector(_camUp, swirlY);

        particlePositions[i * 3] = _worldPos.x;
        particlePositions[i * 3 + 1] = _worldPos.y;
        particlePositions[i * 3 + 2] = _worldPos.z;
      }
      particlePosAttr.needsUpdate = true;
    }
  };

  const dispose = () => {
    petalGeo.dispose();
    petalMat.dispose();
    stamenGeo.dispose();
    stamenMat.dispose();
    flowerMesh.dispose();
    stamenMesh.dispose();
    particleGeo.dispose();
    particleMat.dispose();
    sparkleTex.dispose();
  };

  return { group, update, applyPalette, dispose };
}
