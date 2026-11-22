import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type {
  AnimationConfig,
  ClickedPixelInfo,
  FlowerConfig,
  FlowerCurtainConfig,
  MoonStyle,
  PersonalizationData,
  PixelSizeMode,
  ProcessedAtlasResult,
  SelectedFlowerDetail,
  StarDistributionMode,
  ThemeConfig,
  UploadedPhoto,
  WrapRibbonConfig,
} from '../types/bouquet';
import { buildBouquetProps, type BouquetPropsBuild } from '../utils/bouquetProps';
import { createDefaultEntranceConfig } from '../utils/defaultBouquetConfig';
import { createFlowerCurtainSystem, type FlowerCurtainSystem } from '../utils/flowerCurtain';
import {
  buildLilyAssembly,
  createBeveledTileGeometry,
  createPhotoTileMaterial,
  type LilyAssembly,
  type PetalTileInstanceMeta,
} from '../utils/lilyGeometry';

export interface EntranceStateSnapshot {
  isPlaying: boolean;
  progress: number;
  stage: 1 | 2 | 3 | 4 | 5 | 6;
}

export interface VideoRecordingOptions {
  mode: 'intro' | 'loop';
  personalization: PersonalizationData;
  onProgress: (percent: number) => void;
  onComplete: (blob: Blob, filename: string, mimeType: string) => void;
  onError: (message: string) => void;
}

export interface CurtainStateSnapshot {
  active: boolean;
  progress: number;
  phase: 'idle' | 'surge' | 'poise' | 'parting' | 'done';
}

export interface BouquetViewportHandle {
  resetView: () => void;
  focusFlower: (flowerIndex: number) => void;
  replayBloom: () => void;
  replayEntrance: () => void;
  skipEntrance: () => void;
  playFlowerCurtain: (options?: {
    overrideConfig?: FlowerCurtainConfig;
    assembleAfter?: boolean;
  }) => void;
  captureSnapshot: (personalization: PersonalizationData) => string | null;
  startVideoRecording: (options: VideoRecordingOptions) => boolean;
  stopVideoRecording: () => void;
  getCapabilities: () => { maxTextureSize: number; maxAnisotropy: number };
}

interface BouquetViewportProps {
  flowers: FlowerConfig[];
  photos: UploadedPhoto[];
  atlas: ProcessedAtlasResult | null;
  wrapConfig: WrapRibbonConfig;
  animationConfig: AnimationConfig;
  curtainConfig?: FlowerCurtainConfig;
  themeConfig?: ThemeConfig;
  ribbonText: string;
  recipientName: string;
  lockedSkyOnly?: boolean;
  autoPlayEntrance?: boolean;
  autoRotateOverride?: boolean;
  pausedOverride?: boolean;
  showStarsOverride?: boolean;
  showMoonOverride?: boolean;
  showPetalsOverride?: boolean;
  onClickPixel: (info: ClickedPixelInfo) => void;
  onHoverPixel?: (info: ClickedPixelInfo | null) => void;
  onClickGiftTag?: () => void;
  onHoverGiftTag?: (hovered: boolean) => void;
  onSelectFlower: (detail: SelectedFlowerDetail | null) => void;
  onBloomProgress?: (percent: number) => void;
  onEntranceStateChange?: (state: EntranceStateSnapshot) => void;
  onCurtainStateChange?: (state: CurtainStateSnapshot) => void;
  onZoomChange?: (zoomPercent: number) => void;
  onTotalTilesChange?: (totalTiles: number) => void;
  onFirstInteract?: () => void;
}

const _vec3A = new THREE.Vector3();
const _worldPos = new THREE.Vector3();
const _dummyObj = new THREE.Object3D();

const MAX_FALLING_PETALS = 80;
const MAX_STARS = 1800;
const MAX_SCATTERED_STARS = 480;
const SHOOTING_STAR_COUNT = 3;

const DEFAULT_CAMERA_POS = new THREE.Vector3(0.0, 2.15, 7.65);
const DEFAULT_TARGET = new THREE.Vector3(0.0, 1.22, 0.0);

function getResponsiveDefaultCameraPos(aspect: number): THREE.Vector3 {
  if (aspect >= 0.78) return DEFAULT_CAMERA_POS.clone();
  const pullBack = Math.min(3.1, (0.78 - Math.max(0.4, aspect)) * 8.4);
  return new THREE.Vector3(0.0, 2.02, 7.65 + pullBack);
}

function easeOutCubic(t: number): number {
  const c = THREE.MathUtils.clamp(t, 0, 1);
  return 1 - Math.pow(1 - c, 3);
}

function easeInOutCubic(t: number): number {
  const c = THREE.MathUtils.clamp(t, 0, 1);
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
}

function easeOutBackSoft(t: number): number {
  const c = THREE.MathUtils.clamp(t, 0, 1);
  const c1 = 0.85;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(c - 1, 3) + c1 * Math.pow(c - 1, 2);
}

function moonStyleToIndex(style: MoonStyle | undefined): number {
  if (style === 'crescent') return 1;
  if (style === 'soft-blush') return 2;
  return 0;
}

function populateStarBuffers(
  positions: Float32Array,
  colors: Float32Array,
  scales: Float32Array,
  phases: Float32Array,
  twinkleMasks: Float32Array,
  distribution: StarDistributionMode,
  primaryHex: string,
) {
  const baseCol = new THREE.Color(primaryHex || '#ffffff');
  const palette = [
    baseCol.clone(),
    baseCol.clone().lerp(new THREE.Color('#f8fafc'), 0.45),
    baseCol.clone().lerp(new THREE.Color('#fbcfe8'), 0.45),
    baseCol.clone().lerp(new THREE.Color('#f9a8d4'), 0.55),
    baseCol.clone().lerp(new THREE.Color('#ede9fe'), 0.5),
  ];

  // Deterministic pseudo-random so existing stars stay visually stable while extras layer smoothly
  const rand = (seed: number) => {
    const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
    return x - Math.floor(x);
  };

  for (let i = 0; i < MAX_STARS; i++) {
    const u1 = rand(i * 3 + 1);
    const u2 = rand(i * 3 + 2);
    const u3 = rand(i * 3 + 3);

    if (distribution === 'sky-dome') {
      const r = 17 + u1 * 24;
      const theta = u2 * Math.PI * 2;
      const phi = Math.acos(THREE.MathUtils.clamp(0.15 + u3 * 0.85, 0.05, 1));
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.cos(phi) - 0.8;
      positions[i * 3 + 2] = -Math.abs(r * Math.sin(phi) * Math.sin(theta)) - 3.5;
    } else if (distribution === 'clustered') {
      const clusterAngle = ((i % 7) / 7) * Math.PI * 2 + u1 * 0.48;
      const clusterElevation = -0.35 + ((i % 5) / 4) * 1.1 + (u2 - 0.5) * 0.35;
      const r = 16 + u3 * 25;
      positions[i * 3] = Math.cos(clusterAngle) * Math.cos(clusterElevation) * r;
      positions[i * 3 + 1] = Math.sin(clusterElevation) * r + 2.4;
      positions[i * 3 + 2] = Math.sin(clusterAngle) * Math.cos(clusterElevation) * r;
    } else {
      const r = 15.5 + u1 * 26.5;
      const theta = u2 * Math.PI * 2;
      const phi = Math.acos(2 * u3 - 1);
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.cos(phi) + 2.2;
      positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }

    const paletteRoll = (i * 7) % 12;
    const col =
      paletteRoll < 7
        ? palette[paletteRoll % 2]
        : paletteRoll < 10
          ? palette[2 + (paletteRoll % 2)]
          : palette[4];
    colors[i * 3] = col.r;
    colors[i * 3 + 1] = col.g;
    colors[i * 3 + 2] = col.b;

    const isBrightStar = i % 7 === 0;
    scales[i] = isBrightStar ? 1.12 + rand(i + 911) * 0.45 : 0.46 + rand(i + 377) * 0.54;
    phases[i] = rand(i + 557) * Math.PI * 2;
    twinkleMasks[i] = i % 3 === 0 ? 0.65 + rand(i + 713) * 0.35 : 0.05 + rand(i + 229) * 0.14;
  }
}

function populateScatteredStarBuffers(
  positions: Float32Array,
  colors: Float32Array,
  scales: Float32Array,
  seeds: Float32Array,
  primaryHex: string,
) {
  const baseCol = new THREE.Color(primaryHex || '#ffffff');
  const tints = [
    new THREE.Color('#ffffff').lerp(baseCol, 0.35),
    new THREE.Color('#fbcfe8').lerp(baseCol, 0.25),
    new THREE.Color('#fef3c7').lerp(baseCol, 0.2),
    new THREE.Color('#f9a8d4').lerp(baseCol, 0.3),
    new THREE.Color('#ede9fe').lerp(baseCol, 0.25),
  ];

  const rand = (seed: number) => {
    const x = Math.sin(seed * 91.345 + 17.13) * 29432.654;
    return x - Math.floor(x);
  };

  for (let i = 0; i < MAX_SCATTERED_STARS; i++) {
    const r1 = rand(i * 5 + 1);
    const r2 = rand(i * 5 + 2);
    const r3 = rand(i * 5 + 3);
    const r4 = rand(i * 5 + 4);
    const r5 = rand(i * 5 + 5);

    let x = (r1 - 0.5) * 18.0;
    const y = -4.2 + r2 * 12.2;
    let z = -10.5 + r3 * 13.8;

    // Keep foreground clear of direct center camera lens while framing bouquet edges richly
    if (z > 1.2 && Math.hypot(x, y - 1.35) < 2.2) {
      x += x >= 0 ? 2.2 : -2.2;
      z -= 2.4;
    }

    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;

    const col = tints[i % tints.length];
    colors[i * 3] = col.r;
    colors[i * 3 + 1] = col.g;
    colors[i * 3 + 2] = col.b;

    scales[i] = i % 5 === 0 ? 1.35 + r4 * 0.75 : 0.6 + r4 * 0.7;
    seeds[i] = r5 * 10.0;
  }
}

function pickSupportedVideoMimeType(): { mimeType: string; extension: 'mp4' | 'webm' } {
  if (typeof MediaRecorder === 'undefined') {
    return { mimeType: '', extension: 'webm' };
  }
  const candidates: Array<{ mime: string; ext: 'mp4' | 'webm' }> = [
    { mime: 'video/mp4;codecs=avc1.42E01E', ext: 'mp4' },
    { mime: 'video/mp4', ext: 'mp4' },
    { mime: 'video/webm;codecs=vp9', ext: 'webm' },
    { mime: 'video/webm;codecs=vp8', ext: 'webm' },
    { mime: 'video/webm', ext: 'webm' },
  ];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c.mime)) {
      return { mimeType: c.mime, extension: c.ext };
    }
  }
  return { mimeType: '', extension: 'webm' };
}

function createMoonSurfaceTexture(): THREE.CanvasTexture {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  const half = size / 2;

  const baseGrad = ctx.createRadialGradient(
    half * 0.88,
    half * 0.84,
    size * 0.06,
    half,
    half,
    half,
  );
  baseGrad.addColorStop(0, '#ffffff');
  baseGrad.addColorStop(0.55, '#f6f3fa');
  baseGrad.addColorStop(0.84, '#e6e0f0');
  baseGrad.addColorStop(1, '#cfc6df');
  ctx.fillStyle = baseGrad;
  ctx.fillRect(0, 0, size, size);

  const maria: Array<[number, number, number, string]> = [
    [0.34, 0.38, 0.2, 'rgba(182, 173, 204, 0.28)'],
    [0.54, 0.3, 0.16, 'rgba(176, 166, 198, 0.24)'],
    [0.64, 0.52, 0.18, 'rgba(186, 176, 208, 0.25)'],
    [0.42, 0.66, 0.17, 'rgba(190, 178, 210, 0.22)'],
    [0.27, 0.56, 0.12, 'rgba(180, 170, 200, 0.2)'],
    [0.52, 0.48, 0.13, 'rgba(202, 192, 220, 0.18)'],
  ];
  for (const [mx, my, mr, col] of maria) {
    const cx = mx * size;
    const cy = my * size;
    const rad = mr * size;
    const g = ctx.createRadialGradient(cx, cy, rad * 0.1, cx, cy, rad);
    g.addColorStop(0, col);
    g.addColorStop(0.65, col);
    g.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.fill();
  }

  const craters: Array<[number, number, number]> = [
    [0.38, 0.44, 0.042],
    [0.62, 0.36, 0.036],
    [0.58, 0.65, 0.048],
    [0.33, 0.62, 0.03],
    [0.48, 0.27, 0.028],
    [0.7, 0.56, 0.026],
    [0.44, 0.55, 0.024],
    [0.29, 0.34, 0.025],
  ];
  for (const [cxN, cyN, rN] of craters) {
    const cx = cxN * size;
    const cy = cyN * size;
    const r = rN * size;
    const g = ctx.createRadialGradient(cx - r * 0.2, cy - r * 0.2, r * 0.15, cx, cy, r);
    g.addColorStop(0, 'rgba(170, 160, 194, 0.22)');
    g.addColorStop(0.75, 'rgba(195, 186, 214, 0.14)');
    g.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(cx + r * 0.08, cy + r * 0.08, r * 0.78, -0.3, Math.PI * 0.85);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function createMoonHaloTexture(): THREE.CanvasTexture {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  const half = size / 2;

  const grad = ctx.createRadialGradient(half, half, size * 0.05, half, half, half);
  grad.addColorStop(0, 'rgba(255, 252, 255, 0.76)');
  grad.addColorStop(0.24, 'rgba(253, 232, 246, 0.36)');
  grad.addColorStop(0.5, 'rgba(244, 168, 212, 0.15)');
  grad.addColorStop(0.76, 'rgba(196, 181, 253, 0.05)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)');

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function createSoftGlowSpriteTexture(innerColor: string, outerColor: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createRadialGradient(32, 32, 1, 32, 32, 30);
  grad.addColorStop(0, innerColor);
  grad.addColorStop(0.35, outerColor);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createCrossStarSpriteTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  const cx = 64;
  const cy = 64;

  const halo = ctx.createRadialGradient(cx, cy, 2, cx, cy, 52);
  halo.addColorStop(0, 'rgba(255, 255, 255, 1)');
  halo.addColorStop(0.2, 'rgba(244, 114, 182, 0.75)');
  halo.addColorStop(0.55, 'rgba(217, 70, 239, 0.15)');
  halo.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, 128, 128);

  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(cx, 6);
  ctx.quadraticCurveTo(cx + 4, cy - 4, 122, cy);
  ctx.quadraticCurveTo(cx + 4, cy + 4, cx, 122);
  ctx.quadraticCurveTo(cx - 4, cy + 4, 6, cy);
  ctx.quadraticCurveTo(cx - 4, cy - 4, cx, 6);
  ctx.fill();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createPixelFallingPetalTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  const palette = ['#f472b6', '#fb7185', '#fbcfe8', '#ec4899'];
  ctx.fillStyle = '#2b091c';
  ctx.fillRect(0, 0, 128, 128);
  const cell = 16;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      ctx.fillStyle = palette[(x * 3 + y * 5) % palette.length];
      ctx.fillRect(x * cell + 1, y * cell + 1, cell - 2, cell - 2);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createContactShadowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createRadialGradient(128, 128, 12, 128, 128, 124);
  grad.addColorStop(0, 'rgba(244, 114, 182, 0.22)');
  grad.addColorStop(0.5, 'rgba(131, 24, 67, 0.14)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createFallingPetalGeometry(): THREE.BufferGeometry {
  const geo = new THREE.PlaneGeometry(0.16, 0.24, 3, 4);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const normY = (y + 0.12) / 0.24;
    const widthScale = Math.sin(normY * Math.PI);
    pos.setX(i, x * (0.35 + 0.65 * widthScale));
    pos.setZ(i, Math.sin(normY * Math.PI) * 0.036 - x * x * 1.3);
  }
  geo.computeVertexNormals();
  return geo;
}

export const BouquetViewport = forwardRef<BouquetViewportHandle, BouquetViewportProps>(
  function BouquetViewport(
    {
      flowers,
      photos,
      atlas,
      wrapConfig,
      animationConfig,
      curtainConfig,
      themeConfig,
      ribbonText,
      recipientName,
      lockedSkyOnly = false,
      autoPlayEntrance = true,
      autoRotateOverride,
      pausedOverride = false,
      showStarsOverride,
      showMoonOverride,
      showPetalsOverride,
      onClickPixel,
      onHoverPixel,
      onClickGiftTag,
      onHoverGiftTag,
      onSelectFlower,
      onBloomProgress,
      onEntranceStateChange,
      onCurtainStateChange,
      onZoomChange,
      onTotalTilesChange,
      onFirstInteract,
    },
    ref,
  ) {
    const mountRef = useRef<HTMLDivElement | null>(null);

    const callbacksRef = useRef({
      onClickPixel,
      onHoverPixel,
      onClickGiftTag,
      onHoverGiftTag,
      onSelectFlower,
      onBloomProgress,
      onEntranceStateChange,
      onCurtainStateChange,
      onZoomChange,
      onTotalTilesChange,
      onFirstInteract,
    });
    callbacksRef.current = {
      onClickPixel,
      onHoverPixel,
      onClickGiftTag,
      onHoverGiftTag,
      onSelectFlower,
      onBloomProgress,
      onEntranceStateChange,
      onCurtainStateChange,
      onZoomChange,
      onTotalTilesChange,
      onFirstInteract,
    };

    const effectiveAutoRotate =
      autoRotateOverride !== undefined ? autoRotateOverride : animationConfig.autoRotate;
    const effectiveShowStars =
      showStarsOverride !== undefined ? showStarsOverride : (animationConfig.showStars ?? true);
    const effectiveShowMoon =
      showMoonOverride !== undefined ? showMoonOverride : (animationConfig.showMoon ?? true);
    const effectiveShowPetals = showPetalsOverride !== undefined ? showPetalsOverride : true;
    const resolvedCurtainConfig = curtainConfig ?? createDefaultEntranceConfig().curtain;

    const stateRef = useRef({
      flowers,
      photos,
      wrapConfig,
      animationConfig,
      curtainConfig: resolvedCurtainConfig,
      themeConfig,
      lockedSkyOnly,
      effectiveAutoRotate,
      pausedOverride,
      effectiveShowStars,
      effectiveShowMoon,
      effectiveShowPetals,
      ribbonText,
      recipientName,
      autoPlayEntrance,
    });
    stateRef.current = {
      flowers,
      photos,
      wrapConfig,
      animationConfig,
      curtainConfig: resolvedCurtainConfig,
      themeConfig,
      lockedSkyOnly,
      effectiveAutoRotate,
      pausedOverride,
      effectiveShowStars,
      effectiveShowMoon,
      effectiveShowPetals,
      ribbonText,
      recipientName,
      autoPlayEntrance,
    };

    const engineRef = useRef<{
      renderer: THREE.WebGLRenderer;
      scene: THREE.Scene;
      camera: THREE.PerspectiveCamera;
      controls: OrbitControls;
      hemiLight: THREE.HemisphereLight;
      keyLight: THREE.DirectionalLight;
      rimLight: THREE.DirectionalLight;
      fillLight: THREE.DirectionalLight;
      coreGlowLight: THREE.PointLight;
      bouquetRoot: THREE.Group;
      flowersGroup: THREE.Group;
      propsContainer: THREE.Group;
      orbitRing: THREE.Points;
      ringMat: THREE.PointsMaterial;
      starField: THREE.Points;
      starGeo: THREE.BufferGeometry;
      starPosAttr: THREE.BufferAttribute;
      starColAttr: THREE.BufferAttribute;
      starScaleAttr: THREE.BufferAttribute;
      starPhaseAttr: THREE.BufferAttribute;
      starTwinkleAttr: THREE.BufferAttribute;
      starUniforms: {
        uTime: { value: number };
        uPixelRatio: { value: number };
        uStarSize: { value: number };
        uTwinkleIntensity: { value: number };
        uBrightness: { value: number };
        uAnimSpeed: { value: number };
      };
      lastStarSig: string;
      crossSparkles: THREE.Points;
      sparkleMat: THREE.PointsMaterial;
      scatteredStars: THREE.Points;
      scatteredGeo: THREE.BufferGeometry;
      scatteredPosAttr: THREE.BufferAttribute;
      scatteredColAttr: THREE.BufferAttribute;
      scatteredScaleAttr: THREE.BufferAttribute;
      scatteredSeedAttr: THREE.BufferAttribute;
      scatteredUniforms: {
        uTime: { value: number };
        uPixelRatio: { value: number };
        uBrightness: { value: number };
        uAnimSpeed: { value: number };
      };
      shootingGroup: THREE.Group;
      shootingStars: Array<{
        line: THREE.Mesh;
        mat: THREE.MeshBasicMaterial;
        phaseOffset: number;
        cycleDuration: number;
      }>;
      moonGroup: THREE.Group;
      moonHaloSprite: THREE.Sprite;
      moonHaloMat: THREE.SpriteMaterial;
      moonUniforms: {
        uTime: { value: number };
        uOpacity: { value: number };
        uGlowIntensity: { value: number };
        uStyle: { value: number };
        uColor: { value: THREE.Color };
        uBrightness: { value: number };
        uShowTexture: { value: number };
      };
      fallingPetalsMesh: THREE.InstancedMesh;
      assemblies: LilyAssembly[];
      centerSortedOrder: number[];
      tileGeo: THREE.BufferGeometry;
      tileMat: THREE.MeshPhysicalMaterial | null;
      propsBuild: BouquetPropsBuild | null;
      uniforms: {
        uTime: { value: number };
        uZoomReveal: { value: number };
        uPhotoVividness: { value: number };
        uHoveredPixelId: { value: number };
      };
      entranceElapsed: number;
      entrancePlaying: boolean;
      entranceCameraActive: boolean;
      curtainSystem: FlowerCurtainSystem;
      curtainActive: boolean;
      curtainElapsed: number;
      curtainOverrideConfig: FlowerCurtainConfig | null;
      curtainAssembleTriggered: boolean;
      curtainAssembleAfter: boolean;
      curtainLastPhase: 'idle' | 'surge' | 'poise' | 'parting' | 'done';
      prefersReducedMotion: boolean;
      camTransitionActive: boolean;
      camTargetPos: THREE.Vector3;
      camTargetLook: THREE.Vector3;
      maxTextureSize: number;
      maxAnisotropy: number;
      isHoveringGiftTag: boolean;
      tagHoverScale: number;
      recording: {
        active: boolean;
        elapsed: number;
        duration: number;
        lastReportedPct: number;
        recorder: MediaRecorder;
        stream: MediaStream;
        recCanvas: HTMLCanvasElement;
        recCtx: CanvasRenderingContext2D;
        personalization: PersonalizationData;
        onProgress: (pct: number) => void;
      } | null;
      startEntrance: () => void;
      finishEntrance: () => void;
      startFlowerCurtain: (options?: {
        overrideConfig?: FlowerCurtainConfig;
        assembleAfter?: boolean;
      }) => void;
      startRecording: (options: VideoRecordingOptions) => boolean;
      stopRecording: () => void;
      rebuildBouquet: (
        nextAtlas: ProcessedAtlasResult,
        nextFlowers: FlowerConfig[],
        nextPhotos: UploadedPhoto[],
        nextSize: PixelSizeMode,
      ) => void;
      rebuildProps: (
        nextFlowers: FlowerConfig[],
        nextWrap: WrapRibbonConfig,
        nextRibbonText: string,
        nextRecipientName: string,
      ) => void;
    } | null>(null);

    useImperativeHandle(ref, () => ({
      resetView: () => {
        const eng = engineRef.current;
        if (!eng) return;
        eng.entranceCameraActive = false;
        eng.camTargetPos.copy(getResponsiveDefaultCameraPos(eng.camera.aspect));
        eng.camTargetLook.copy(DEFAULT_TARGET);
        eng.camTransitionActive = true;
        callbacksRef.current.onSelectFlower(null);
      },
      focusFlower: (flowerIndex: number) => {
        const eng = engineRef.current;
        if (!eng) return;
        if (eng.entrancePlaying) eng.finishEntrance();
        const assembly = eng.assemblies[flowerIndex];
        if (!assembly) return;

        assembly.headGroup.updateWorldMatrix(true, false);
        _worldPos.set(0, 0.35, 0).applyMatrix4(assembly.headGroup.matrixWorld);

        _vec3A.copy(_worldPos).sub(DEFAULT_TARGET);
        if (_vec3A.lengthSq() < 0.05) {
          _vec3A.set(0, 0.35, 1);
        }
        _vec3A.y += 0.45;
        _vec3A.normalize();

        eng.camTargetLook.copy(_worldPos);
        eng.camTargetPos.copy(_worldPos).addScaledVector(_vec3A, 2.35);
        eng.camTransitionActive = true;

        callbacksRef.current.onSelectFlower({
          flowerIndex: assembly.flowerIndex,
          label: assembly.config.label,
          colorKind: assembly.config.colorKind,
          tileCount: assembly.totalTiles,
        });
      },
      replayBloom: () => {
        engineRef.current?.startEntrance();
      },
      replayEntrance: () => {
        engineRef.current?.startEntrance();
      },
      skipEntrance: () => {
        engineRef.current?.finishEntrance();
      },
      playFlowerCurtain: (options) => {
        engineRef.current?.startFlowerCurtain(options);
      },
      captureSnapshot: (personalization: PersonalizationData) => {
        const eng = engineRef.current;
        if (!eng) return null;
        eng.renderer.render(eng.scene, eng.camera);

        const webglCanvas = eng.renderer.domElement;
        const outCanvas = document.createElement('canvas');
        outCanvas.width = webglCanvas.width;
        outCanvas.height = webglCanvas.height;
        const ctx = outCanvas.getContext('2d');
        if (!ctx) return null;

        ctx.drawImage(webglCanvas, 0, 0);

        const pad = Math.round(outCanvas.width * 0.03);
        const grad = ctx.createLinearGradient(0, outCanvas.height - 150, 0, outCanvas.height);
        grad.addColorStop(0, 'rgba(0, 0, 0, 0)');
        grad.addColorStop(1, 'rgba(0, 0, 0, 0.88)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, outCanvas.height - 150, outCanvas.width, 150);

        const scale = Math.max(1, outCanvas.width / 1280);
        ctx.fillStyle = '#fff5f8';
        ctx.font = `italic 600 ${Math.round(28 * scale)}px "Cormorant Garamond", Georgia, serif`;
        ctx.textAlign = 'left';
        const line =
          personalization.ribbonText.trim() || 'Every pixel of this flower reminds me of you.';
        ctx.fillText(`“${line}”`, pad, outCanvas.height - Math.round(48 * scale));

        const metaParts: string[] = [];
        if (personalization.recipientName.trim()) {
          metaParts.push(`For ${personalization.recipientName.trim()}`);
        }
        if (personalization.senderName.trim()) {
          metaParts.push(`From ${personalization.senderName.trim()}`);
        }
        if (personalization.specialDate.trim()) {
          metaParts.push(personalization.specialDate.trim());
        }
        if (metaParts.length > 0) {
          ctx.fillStyle = 'rgba(244, 114, 182, 0.92)';
          ctx.font = `500 ${Math.round(14 * scale)}px "JetBrains Mono", monospace`;
          ctx.fillText(metaParts.join(' · '), pad, outCanvas.height - Math.round(22 * scale));
        }

        return outCanvas.toDataURL('image/png');
      },
      startVideoRecording: (options: VideoRecordingOptions) => {
        const eng = engineRef.current;
        if (!eng) {
          options.onError('3D scene is not ready yet');
          return false;
        }
        return eng.startRecording(options);
      },
      stopVideoRecording: () => {
        engineRef.current?.stopRecording();
      },
      getCapabilities: () => {
        const eng = engineRef.current;
        return {
          maxTextureSize: eng?.maxTextureSize ?? 2048,
          maxAnisotropy: eng?.maxAnisotropy ?? 4,
        };
      },
    }));

    useEffect(() => {
      const container = mountRef.current;
      if (!container) return;

      const prefersReducedMotion =
        typeof window !== 'undefined' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      const isSoftwareGl = (() => {
        const gl = document.createElement('canvas').getContext('webgl2');
        if (!gl) return true;
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
        const gpu = String(gl.getParameter(param));
        gl.getExtension('WEBGL_lose_context')?.loseContext();
        return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
      })();

      const renderer = new THREE.WebGLRenderer({
        antialias: !isSoftwareGl,
        powerPreference: 'high-performance',
      });
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.15;
      renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
      renderer.shadowMap.enabled = !isSoftwareGl;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.setSize(
        container.clientWidth || window.innerWidth,
        container.clientHeight || window.innerHeight,
      );
      renderer.domElement.style.display = 'block';
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';
      renderer.domElement.style.touchAction = 'none';
      container.appendChild(renderer.domElement);

      const maxTextureSize = renderer.capabilities.maxTextureSize || 2048;
      const maxAnisotropy = renderer.capabilities.getMaxAnisotropy() || 4;

      const initTheme = stateRef.current.themeConfig;
      const bgColHex = initTheme?.backgroundColor || '#000000';
      const lightMult = initTheme?.lightingIntensity ?? 1.0;

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(bgColHex);
      scene.fog = new THREE.FogExp2(bgColHex, 0.02);

      const pmremGenerator = new THREE.PMREMGenerator(renderer);
      const envTex = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
      scene.environment = envTex;
      scene.environmentIntensity = 0.78 * lightMult;
      pmremGenerator.dispose();

      const width = container.clientWidth || window.innerWidth;
      const height = container.clientHeight || window.innerHeight;
      const initialAspect = width / Math.max(1, height);
      const camera = new THREE.PerspectiveCamera(42, initialAspect, 0.1, 120);
      camera.position.copy(getResponsiveDefaultCameraPos(initialAspect));

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.target.copy(DEFAULT_TARGET);
      controls.enableDamping = !isSoftwareGl;
      controls.dampingFactor = 0.06;
      controls.minDistance = 1.55;
      controls.maxDistance = 13.5;
      controls.maxPolarAngle = Math.PI * 0.68;
      controls.minPolarAngle = 0.16;
      controls.enablePan = true;
      controls.rotateSpeed = 0.75;
      controls.zoomSpeed = 0.9;

      // Studio 3-Point Lighting Rig
      const hemiLight = new THREE.HemisphereLight(0xf5d0fe, 0x1a081c, 0.98 * lightMult);
      scene.add(hemiLight);

      const keyLight = new THREE.DirectionalLight(0xfff1f2, 2.5 * lightMult);
      keyLight.position.set(4.5, 7.5, 5.5);
      keyLight.castShadow = !isSoftwareGl;
      keyLight.shadow.mapSize.set(1024, 1024);
      keyLight.shadow.camera.left = -4.5;
      keyLight.shadow.camera.right = 4.5;
      keyLight.shadow.camera.top = 5.6;
      keyLight.shadow.camera.bottom = -3.6;
      keyLight.shadow.bias = -0.0005;
      keyLight.shadow.normalBias = 0.02;
      scene.add(keyLight);

      const rimLight = new THREE.DirectionalLight(0xf472b6, 1.68 * lightMult);
      rimLight.position.set(-5.0, 4.2, -4.8);
      scene.add(rimLight);

      const fillLight = new THREE.DirectionalLight(0xc084fc, 0.82 * lightMult);
      fillLight.position.set(-4.5, 1.5, 4.2);
      scene.add(fillLight);

      const coreGlowLight = new THREE.PointLight(0xf9a8d4, 1.9 * lightMult, 9.5, 1.65);
      coreGlowLight.position.set(0, 1.9, 0.9);
      scene.add(coreGlowLight);

      const bouquetRoot = new THREE.Group();
      scene.add(bouquetRoot);

      const flowersGroup = new THREE.Group();
      bouquetRoot.add(flowersGroup);

      const propsContainer = new THREE.Group();
      bouquetRoot.add(propsContainer);

      const contactTex = createContactShadowTexture();
      const contactGeo = new THREE.PlaneGeometry(4.8, 4.8);
      contactGeo.rotateX(-Math.PI / 2);
      const contactMat = new THREE.MeshBasicMaterial({
        map: contactTex,
        transparent: true,
        depthWrite: false,
        opacity: 0.72,
      });
      const contactMesh = new THREE.Mesh(contactGeo, contactMat);
      contactMesh.position.y = -2.35;
      scene.add(contactMesh);

      const initialProps = buildBouquetProps(
        stateRef.current.flowers,
        stateRef.current.wrapConfig,
        stateRef.current.ribbonText,
        stateRef.current.recipientName,
        maxAnisotropy,
      );
      propsContainer.add(initialProps.group);

      // Tilted Luminous Pink Sparkling Orbital Ring
      const ringCount = 170;
      const ringPositions = new Float32Array(ringCount * 3);
      const ringColors = new Float32Array(ringCount * 3);
      const ringColA = new THREE.Color('#fbcfe8');
      const ringColB = new THREE.Color('#f472b6');
      for (let i = 0; i < ringCount; i++) {
        const theta = (i / ringCount) * Math.PI * 2;
        const rx = 2.48 + Math.sin(theta * 3) * 0.06;
        const rz = 1.9 + Math.cos(theta * 2) * 0.05;
        ringPositions[i * 3] = Math.cos(theta) * rx;
        ringPositions[i * 3 + 1] = Math.sin(theta) * 0.26;
        ringPositions[i * 3 + 2] = Math.sin(theta) * rz;

        const c = i % 3 === 0 ? ringColA : ringColB;
        ringColors[i * 3] = c.r;
        ringColors[i * 3 + 1] = c.g;
        ringColors[i * 3 + 2] = c.b;
      }
      const ringGeo = new THREE.BufferGeometry();
      ringGeo.setAttribute('position', new THREE.BufferAttribute(ringPositions, 3));
      ringGeo.setAttribute('color', new THREE.BufferAttribute(ringColors, 3));
      const starSpriteTex = createSoftGlowSpriteTexture(
        'rgba(255,255,255,1)',
        'rgba(244,114,182,0.45)',
      );
      const ringMat = new THREE.PointsMaterial({
        size: 0.145,
        map: starSpriteTex,
        vertexColors: true,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const orbitRing = new THREE.Points(ringGeo, ringMat);
      orbitRing.position.set(0, 0.56, 0);
      orbitRing.rotation.set(0.18, 0.2, -0.14);
      orbitRing.visible = stateRef.current.animationConfig.showOrbitRing;
      bouquetRoot.add(orbitRing);

      // Rich Night Sky Starfield (keeps original stars + adds many more up to MAX_STARS)
      const initAnim = stateRef.current.animationConfig;
      const starPositions = new Float32Array(MAX_STARS * 3);
      const starColors = new Float32Array(MAX_STARS * 3);
      const starScales = new Float32Array(MAX_STARS);
      const starPhases = new Float32Array(MAX_STARS);
      const starTwinkleMasks = new Float32Array(MAX_STARS);
      populateStarBuffers(
        starPositions,
        starColors,
        starScales,
        starPhases,
        starTwinkleMasks,
        initAnim.starDistribution ?? 'spherical',
        initAnim.starColor || '#ffffff',
      );

      const starPosAttr = new THREE.BufferAttribute(starPositions, 3);
      const starColAttr = new THREE.BufferAttribute(starColors, 3);
      const starScaleAttr = new THREE.BufferAttribute(starScales, 1);
      const starPhaseAttr = new THREE.BufferAttribute(starPhases, 1);
      const starTwinkleAttr = new THREE.BufferAttribute(starTwinkleMasks, 1);

      const starGeo = new THREE.BufferGeometry();
      starGeo.setAttribute('position', starPosAttr);
      starGeo.setAttribute('aColor', starColAttr);
      starGeo.setAttribute('aScale', starScaleAttr);
      starGeo.setAttribute('aPhase', starPhaseAttr);
      starGeo.setAttribute('aTwinkleMask', starTwinkleAttr);
      starGeo.setDrawRange(
        0,
        Math.max(60, Math.min(MAX_STARS, initAnim.starDensity ?? 760)),
      );

      const starUniforms = {
        uTime: { value: 0 },
        uPixelRatio: { value: renderer.getPixelRatio() },
        uStarSize: { value: initAnim.starSize ?? 1.0 },
        uTwinkleIntensity: { value: initAnim.starTwinkleIntensity ?? 0.48 },
        uBrightness: { value: initAnim.starBrightness ?? 0.9 },
        uAnimSpeed: { value: initAnim.starAnimationSpeed ?? 0.85 },
      };

      const starMat = new THREE.ShaderMaterial({
        uniforms: starUniforms,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
        vertexShader: `
          attribute vec3 aColor;
          attribute float aScale;
          attribute float aPhase;
          attribute float aTwinkleMask;
          uniform float uTime;
          uniform float uPixelRatio;
          uniform float uStarSize;
          uniform float uTwinkleIntensity;
          uniform float uBrightness;
          uniform float uAnimSpeed;
          varying vec3 vColor;
          varying float vAlpha;

          void main() {
            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            float wave = 0.5 + 0.5 * sin(uTime * max(0.0, uAnimSpeed) * (1.1 + aTwinkleMask * 1.45) + aPhase);
            float twinkleDip = uTwinkleIntensity * aTwinkleMask * 0.58 * wave;
            float twinkle = clamp(1.0 - twinkleDip, 0.2, 1.15);

            vColor = aColor;
            vAlpha = clamp(uBrightness * twinkle * (0.68 + 0.32 * aScale), 0.0, 1.45);

            float sizeScale = aScale * uStarSize * uPixelRatio * (56.0 / max(1.0, -mvPosition.z));
            gl_PointSize = clamp(sizeScale, 1.35, 13.0 * uPixelRatio);
            gl_Position = projectionMatrix * mvPosition;
          }
        `,
        fragmentShader: `
          varying vec3 vColor;
          varying float vAlpha;

          void main() {
            vec2 p = gl_PointCoord - vec2(0.5);
            float d = length(p) * 2.0;
            if (d > 1.0) discard;

            float halo = exp(-d * d * 4.6);
            float core = smoothstep(0.36, 0.0, d) * 0.72;
            float alpha = clamp((halo * 0.75 + core) * vAlpha, 0.0, 1.0);
            if (alpha < 0.008) discard;

            vec3 finalCol = mix(vColor, vec3(1.0), core * 0.55);
            gl_FragColor = vec4(finalCol, alpha);
          }
        `,
      });
      const starField = new THREE.Points(starGeo, starMat);
      starField.visible = stateRef.current.effectiveShowStars;
      scene.add(starField);

      // Subtle Distant 4-Point Cross-Star Highlights
      const sparkleCount = 28;
      const sparklePositions = new Float32Array(sparkleCount * 3);
      for (let i = 0; i < sparkleCount; i++) {
        const r = 10.5 + Math.random() * 11.0;
        const theta = Math.random() * Math.PI * 2;
        sparklePositions[i * 3] = Math.cos(theta) * r;
        sparklePositions[i * 3 + 1] = -0.5 + Math.random() * 7.6;
        sparklePositions[i * 3 + 2] = Math.sin(theta) * r - 4.0;
      }
      const sparkleGeo = new THREE.BufferGeometry();
      sparkleGeo.setAttribute('position', new THREE.BufferAttribute(sparklePositions, 3));
      const crossStarTex = createCrossStarSpriteTexture();
      const sparkleMat = new THREE.PointsMaterial({
        size: 0.36,
        map: crossStarTex,
        color: new THREE.Color(initAnim.starColor || '#ffffff').lerp(
          new THREE.Color('#ffd7ee'),
          0.55,
        ),
        transparent: true,
        opacity: 0.52 * (initAnim.starBrightness ?? 0.9),
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
      });
      const crossSparkles = new THREE.Points(sparkleGeo, sparkleMat);
      crossSparkles.visible = stateRef.current.effectiveShowStars;
      scene.add(crossSparkles);

      // Scattered & Cascading Starlight Sparkles ("Bintang Bertaburan")
      const scatteredPos = new Float32Array(MAX_SCATTERED_STARS * 3);
      const scatteredCol = new Float32Array(MAX_SCATTERED_STARS * 3);
      const scatteredScale = new Float32Array(MAX_SCATTERED_STARS);
      const scatteredSeed = new Float32Array(MAX_SCATTERED_STARS);
      populateScatteredStarBuffers(
        scatteredPos,
        scatteredCol,
        scatteredScale,
        scatteredSeed,
        initAnim.starColor || '#ffffff',
      );
      const scatteredPosAttr = new THREE.BufferAttribute(scatteredPos, 3);
      const scatteredColAttr = new THREE.BufferAttribute(scatteredCol, 3);
      const scatteredScaleAttr = new THREE.BufferAttribute(scatteredScale, 1);
      const scatteredSeedAttr = new THREE.BufferAttribute(scatteredSeed, 1);

      const scatteredGeo = new THREE.BufferGeometry();
      scatteredGeo.setAttribute('position', scatteredPosAttr);
      scatteredGeo.setAttribute('aColor', scatteredColAttr);
      scatteredGeo.setAttribute('aScale', scatteredScaleAttr);
      scatteredGeo.setAttribute('aSeed', scatteredSeedAttr);
      scatteredGeo.setDrawRange(
        0,
        Math.max(40, Math.min(MAX_SCATTERED_STARS, initAnim.scatteredStarsDensity ?? 320)),
      );

      const scatteredUniforms = {
        uTime: { value: 0 },
        uPixelRatio: { value: renderer.getPixelRatio() },
        uBrightness: { value: initAnim.starBrightness ?? 0.9 },
        uAnimSpeed: { value: initAnim.starAnimationSpeed ?? 0.85 },
      };

      const scatteredMat = new THREE.ShaderMaterial({
        uniforms: scatteredUniforms,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
        vertexShader: `
          attribute vec3 aColor;
          attribute float aScale;
          attribute float aSeed;
          uniform float uTime;
          uniform float uPixelRatio;
          uniform float uBrightness;
          uniform float uAnimSpeed;
          varying vec3 vColor;
          varying float vSparkle;
          varying float vRot;

          void main() {
            float t = uTime * max(0.1, uAnimSpeed);
            vec3 pos = position;

            // Gentle downward & diagonal sprinkling cascade wrapped seamlessly across [-4.2 .. 8.0]
            float ySpan = 12.2;
            float fallOffset = t * (0.22 + fract(aSeed * 0.73) * 0.24);
            pos.y = mod(pos.y - fallOffset + 4.2, ySpan) - 4.2;
            pos.x += sin(t * 0.55 + aSeed * 3.1) * 0.35 + fract(aSeed * 1.9) * 0.15;
            pos.z += cos(t * 0.45 + aSeed * 2.4) * 0.22;

            // Smooth fade at top & bottom boundaries so wraps never pop
            float edgeFade = smoothstep(-4.2, -2.5, pos.y) * (1.0 - smoothstep(6.2, 8.0, pos.y));

            // Twinkle burst wave
            float burst = 0.32 + 0.68 * pow(0.5 + 0.5 * sin(t * (1.6 + fract(aSeed * 2.7) * 1.8) + aSeed * 6.2831), 3.0);

            vColor = aColor;
            vSparkle = clamp(burst * edgeFade * uBrightness, 0.0, 1.5);
            vRot = aSeed * 3.14 + t * 0.35;

            vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
            float pSize = aScale * uPixelRatio * (0.7 + 0.6 * burst) * (62.0 / max(1.2, -mvPosition.z));
            gl_PointSize = clamp(pSize, 2.0, 26.0 * uPixelRatio);
            gl_Position = projectionMatrix * mvPosition;
          }
        `,
        fragmentShader: `
          varying vec3 vColor;
          varying float vSparkle;
          varying float vRot;

          void main() {
            vec2 p = gl_PointCoord - vec2(0.5);
            float c = cos(vRot);
            float s = sin(vRot);
            vec2 rp = vec2(p.x * c - p.y * s, p.x * s + p.y * c) * 2.0;

            float d = length(rp);
            if (d > 1.0) discard;

            // 4-point diffraction star spikes + glowing core + soft halo
            float spikeH = exp(-abs(rp.y) * 11.0) * exp(-abs(rp.x) * 2.4);
            float spikeV = exp(-abs(rp.x) * 11.0) * exp(-abs(rp.y) * 2.4);
            float spikes = (spikeH + spikeV) * 0.85;
            float core = exp(-d * d * 12.0) * 0.95;
            float halo = exp(-d * d * 3.5) * 0.32;

            float alpha = clamp((spikes + core + halo) * vSparkle, 0.0, 1.0);
            if (alpha < 0.01) discard;

            vec3 finalCol = mix(vColor, vec3(1.0), clamp(core + spikes * 0.45, 0.0, 1.0));
            gl_FragColor = vec4(finalCol, alpha);
          }
        `,
      });
      const scatteredStars = new THREE.Points(scatteredGeo, scatteredMat);
      scatteredStars.frustumCulled = false;
      scatteredStars.visible =
        stateRef.current.effectiveShowStars && (initAnim.showScatteredStars ?? true);
      scene.add(scatteredStars);

      // Occasional Shooting Star Streaks across upper starry sky
      const shootingGroup = new THREE.Group();
      const shootingGeo = new THREE.PlaneGeometry(1.9, 0.032);
      const shootingStars: Array<{
        line: THREE.Mesh;
        mat: THREE.MeshBasicMaterial;
        phaseOffset: number;
        cycleDuration: number;
      }> = [];
      for (let i = 0; i < SHOOTING_STAR_COUNT; i++) {
        const sMat = new THREE.MeshBasicMaterial({
          color: i === 1 ? 0xfbcfe8 : 0xffffff,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
          fog: false,
        });
        const streak = new THREE.Mesh(shootingGeo, sMat);
        streak.rotation.z = -0.58 - i * 0.08;
        streak.position.set(0, 4.5, -13.5 - i * 1.2);
        shootingGroup.add(streak);
        shootingStars.push({
          line: streak,
          mat: sMat,
          phaseOffset: i * 2.6,
          cycleDuration: 6.5 + i * 2.1,
        });
      }
      shootingGroup.visible =
        stateRef.current.effectiveShowStars && (initAnim.showScatteredStars ?? true);
      scene.add(shootingGroup);

      // Dreamy Soft-Glowing Moon & Halo in the Night Sky
      const moonSurfaceTex = createMoonSurfaceTexture();
      const moonHaloTex = createMoonHaloTexture();

      const moonGroup = new THREE.Group();
      moonGroup.position.set(
        initAnim.moonPositionX ?? -2.5,
        initAnim.moonPositionY ?? 5.1,
        -12.0,
      );
      moonGroup.scale.setScalar(initAnim.moonSize ?? 1.18);
      moonGroup.visible = stateRef.current.effectiveShowMoon;
      scene.add(moonGroup);

      const moonHaloMat = new THREE.SpriteMaterial({
        map: moonHaloTex,
        color: new THREE.Color(initAnim.moonColor || '#f7f2fa'),
        transparent: true,
        opacity:
          (initAnim.moonGlowIntensity ?? 0.78) * (initAnim.moonOpacity ?? 0.94) * 0.72,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
      });
      const moonHaloSprite = new THREE.Sprite(moonHaloMat);
      moonHaloSprite.scale.set(4.5, 4.5, 1);
      moonHaloSprite.position.z = -0.18;
      moonGroup.add(moonHaloSprite);

      const moonUniforms = {
        uMap: { value: moonSurfaceTex },
        uTime: { value: 0 },
        uOpacity: { value: initAnim.moonOpacity ?? 0.94 },
        uGlowIntensity: { value: initAnim.moonGlowIntensity ?? 0.78 },
        uStyle: { value: moonStyleToIndex(initAnim.moonStyle) },
        uColor: { value: new THREE.Color(initAnim.moonColor || '#f7f2fa') },
        uBrightness: { value: initAnim.moonBrightness ?? 0.96 },
        uShowTexture: { value: initAnim.moonShowTexture !== false ? 1.0 : 0.0 },
      };

      const moonGeo = new THREE.PlaneGeometry(1.9, 1.9);
      const moonMat = new THREE.ShaderMaterial({
        uniforms: moonUniforms,
        transparent: true,
        depthWrite: false,
        fog: false,
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform sampler2D uMap;
          uniform float uTime;
          uniform float uOpacity;
          uniform float uGlowIntensity;
          uniform float uStyle;
          uniform vec3 uColor;
          uniform float uBrightness;
          uniform float uShowTexture;
          varying vec2 vUv;

          void main() {
            vec2 p = (vUv - 0.5) * 2.0;
            float r = length(p);
            if (r > 0.99) discard;

            float limbSoft = 1.0 - smoothstep(0.90, 0.975, r);
            float nz = sqrt(max(0.0, 1.0 - min(1.0, r * r)));
            vec2 sphereUv = clamp(0.5 + p * (0.45 / (0.64 + 0.36 * nz)), 0.02, 0.98);
            vec3 texCol = texture2D(uMap, sphereUv).rgb;
            vec3 smoothBase = vec3(0.96, 0.94, 0.98) * (0.9 + 0.1 * nz);
            vec3 surfCol = mix(smoothBase, texCol, uShowTexture);

            float shade = mix(0.84, 1.06, clamp(0.65 + p.x * 0.18 - p.y * 0.14 + nz * 0.25, 0.0, 1.2));
            vec3 col = surfCol * shade * uColor * uBrightness;

            float rimGlow = pow(clamp(1.0 - nz, 0.0, 1.0), 2.1);
            vec3 rimColor = uStyle > 1.5
              ? vec3(1.0, 0.78, 0.89)
              : uColor * vec3(0.98, 0.95, 1.0);
            col += rimColor * rimGlow * (0.18 + 0.22 * uGlowIntensity);

            if (uStyle > 1.5) {
              col = mix(col, col * vec3(1.04, 0.87, 0.94) + vec3(0.06, 0.01, 0.04), 0.55);
            }

            float phaseMask = 1.0;
            if (uStyle > 0.5 && uStyle < 1.5) {
              float shadowCircle = length(p - vec2(-0.34, 0.22));
              float litArc = smoothstep(0.66, 0.92, shadowCircle);
              phaseMask = mix(0.055, 1.0, litArc);
              col = mix(col * vec3(0.68, 0.65, 0.82), col, litArc);
            }

            float breath = 0.97 + 0.03 * sin(uTime * 0.65);
            float alpha = clamp(limbSoft * phaseMask * uOpacity * breath, 0.0, 1.0);
            if (alpha < 0.004) discard;

            gl_FragColor = vec4(col, alpha);
          }
        `,
      });
      const moonDisc = new THREE.Mesh(moonGeo, moonMat);
      moonGroup.add(moonDisc);

      // Pixelated Falling Pink Petals
      const fallingGeo = createFallingPetalGeometry();
      const fallingTex = createPixelFallingPetalTexture();
      const fallingMat = new THREE.MeshPhysicalMaterial({
        map: fallingTex,
        color: 0xffffff,
        roughness: 0.4,
        metalness: 0.04,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
      });
      const fallingPetalsMesh = new THREE.InstancedMesh(fallingGeo, fallingMat, MAX_FALLING_PETALS);
      fallingPetalsMesh.frustumCulled = false;
      fallingPetalsMesh.visible = stateRef.current.effectiveShowPetals;
      fallingPetalsMesh.count = Math.max(
        0,
        Math.min(MAX_FALLING_PETALS, initAnim.fallingPetalsCount),
      );

      const petalColors = [
        new THREE.Color('#f472b6'),
        new THREE.Color('#fda4af'),
        new THREE.Color('#fbcfe8'),
        new THREE.Color('#ec4899'),
      ];
      const fallingData = Array.from({ length: MAX_FALLING_PETALS }, (_, i) => {
        fallingPetalsMesh.setColorAt(i, petalColors[i % petalColors.length]);
        return {
          x: (Math.random() - 0.5) * 7.2,
          y: -2.0 + Math.random() * 7.0,
          z: (Math.random() - 0.5) * 6.2,
          fallSpeed: 0.25 + Math.random() * 0.34,
          swayPhase: Math.random() * Math.PI * 2,
          swayAmp: 0.28 + Math.random() * 0.45,
          rotSpeedX: (Math.random() - 0.5) * 1.4,
          rotSpeedY: (Math.random() - 0.5) * 1.8,
          scale: 0.72 + Math.random() * 0.75,
        };
      });
      if (fallingPetalsMesh.instanceColor) {
        fallingPetalsMesh.instanceColor.needsUpdate = true;
      }
      scene.add(fallingPetalsMesh);

      const tileGeo = createBeveledTileGeometry();
      const uniforms = {
        uTime: { value: 0 },
        uZoomReveal: { value: 0.14 },
        uPhotoVividness: { value: initAnim.photoVividness },
        uHoveredPixelId: { value: -1 },
      };

      const shouldRunIntro =
        !prefersReducedMotion &&
        stateRef.current.autoPlayEntrance &&
        (initAnim.entranceEnabled ?? true);

      const isLowEndDevice =
        isSoftwareGl ||
        (typeof navigator !== 'undefined' &&
          ((navigator.hardwareConcurrency || 4) <= 2 || window.innerWidth < 640));
      const curtainSystem = createFlowerCurtainSystem(
        stateRef.current.curtainConfig,
        isLowEndDevice,
      );
      scene.add(curtainSystem.group);

      const engine = {
        renderer,
        scene,
        camera,
        controls,
        hemiLight,
        keyLight,
        rimLight,
        fillLight,
        coreGlowLight,
        bouquetRoot,
        flowersGroup,
        propsContainer,
        orbitRing,
        ringMat,
        starField,
        starGeo,
        starPosAttr,
        starColAttr,
        starScaleAttr,
        starPhaseAttr,
        starTwinkleAttr,
        starUniforms,
        lastStarSig: `${initAnim.starDistribution ?? 'spherical'}:${initAnim.starColor || '#ffffff'}`,
        crossSparkles,
        sparkleMat,
        scatteredStars,
        scatteredGeo,
        scatteredPosAttr,
        scatteredColAttr,
        scatteredScaleAttr,
        scatteredSeedAttr,
        scatteredUniforms,
        shootingGroup,
        shootingStars,
        moonGroup,
        moonHaloSprite,
        moonHaloMat,
        moonUniforms,
        fallingPetalsMesh,
        assemblies: [] as LilyAssembly[],
        centerSortedOrder: [] as number[],
        tileGeo,
        tileMat: null as THREE.MeshPhysicalMaterial | null,
        propsBuild: initialProps as BouquetPropsBuild | null,
        uniforms,
        entranceElapsed: shouldRunIntro ? 0 : (initAnim.entranceDuration ?? 9.0),
        entrancePlaying: shouldRunIntro,
        entranceCameraActive: shouldRunIntro,
        curtainSystem,
        curtainActive: false,
        curtainElapsed: 0,
        curtainOverrideConfig: null as FlowerCurtainConfig | null,
        curtainAssembleTriggered: false,
        curtainAssembleAfter: true,
        curtainLastPhase: 'idle' as 'idle' | 'surge' | 'poise' | 'parting' | 'done',
        prefersReducedMotion,
        camTransitionActive: false,
        camTargetPos: getResponsiveDefaultCameraPos(initialAspect),
        camTargetLook: DEFAULT_TARGET.clone(),
        maxTextureSize,
        maxAnisotropy,
        isHoveringGiftTag: false,
        tagHoverScale: 1.0,
        recording: null as {
          active: boolean;
          elapsed: number;
          duration: number;
          lastReportedPct: number;
          recorder: MediaRecorder;
          stream: MediaStream;
          recCanvas: HTMLCanvasElement;
          recCtx: CanvasRenderingContext2D;
          personalization: PersonalizationData;
          onProgress: (pct: number) => void;
        } | null,
        startEntrance: () => {
          const anim = stateRef.current.animationConfig;
          if (engine.prefersReducedMotion) {
            engine.finishEntrance();
            return;
          }
          engine.entranceElapsed = 0;
          engine.entrancePlaying = true;
          engine.entranceCameraActive = true;
          engine.camTransitionActive = false;
          bouquetRoot.rotation.y = 0;
          const camZoomMult = 1 + 0.18 * (anim.cameraEntranceIntensity ?? 0.75);
          const widePos = getResponsiveDefaultCameraPos(camera.aspect).multiplyScalar(camZoomMult);
          camera.position.copy(widePos);
          controls.target.copy(DEFAULT_TARGET);
          controls.update();
          callbacksRef.current.onEntranceStateChange?.({
            isPlaying: true,
            progress: 0,
            stage: 1,
          });
        },
        finishEntrance: () => {
          const totalDur = Math.max(1.5, stateRef.current.animationConfig.entranceDuration ?? 9.0);
          engine.entranceElapsed = totalDur;
          engine.entrancePlaying = false;
          engine.entranceCameraActive = false;
          engine.camTargetPos.copy(getResponsiveDefaultCameraPos(camera.aspect));
          engine.camTargetLook.copy(DEFAULT_TARGET);
          camera.position.copy(engine.camTargetPos);
          controls.target.copy(DEFAULT_TARGET);
          controls.update();
          callbacksRef.current.onBloomProgress?.(100);
          callbacksRef.current.onEntranceStateChange?.({
            isPlaying: false,
            progress: 1,
            stage: 6,
          });
        },
        startFlowerCurtain: (options?: {
          overrideConfig?: FlowerCurtainConfig;
          assembleAfter?: boolean;
        }) => {
          const cfg = options?.overrideConfig ?? stateRef.current.curtainConfig;
          const assembleAfter =
            options?.assembleAfter ??
            (cfg.assembleBouquetAfter && (stateRef.current.animationConfig.entranceEnabled ?? true));

          if (!cfg.enabled) {
            engine.curtainActive = false;
            curtainSystem.group.visible = false;
            callbacksRef.current.onCurtainStateChange?.({
              active: false,
              progress: 1,
              phase: 'done',
            });
            if (assembleAfter) engine.startEntrance();
            else engine.finishEntrance();
            return;
          }

          // Reset bouquet to waiting hidden/stage-0 before curtain parts
          engine.curtainOverrideConfig = cfg;
          engine.curtainAssembleAfter = assembleAfter;
          engine.curtainAssembleTriggered = false;
          engine.curtainElapsed = 0;
          engine.curtainActive = true;
          engine.curtainLastPhase = 'surge';
          engine.entranceElapsed = 0;
          engine.entrancePlaying = false;
          engine.entranceCameraActive = false;
          bouquetRoot.rotation.y = 0;
          const baseCamPos = getResponsiveDefaultCameraPos(camera.aspect);
          const anim = stateRef.current.animationConfig;
          const camZoomMult = assembleAfter ? 1 + 0.18 * (anim.cameraEntranceIntensity ?? 0.75) : 1.0;
          camera.position.copy(baseCamPos.multiplyScalar(camZoomMult));
          controls.target.copy(DEFAULT_TARGET);
          controls.update();
          callbacksRef.current.onCurtainStateChange?.({
            active: true,
            progress: 0,
            phase: 'surge',
          });
        },
        startRecording: (options: VideoRecordingOptions) => {
          if (engine.recording?.active) {
            options.onError('A video recording is already in progress');
            return false;
          }
          if (typeof MediaRecorder === 'undefined') {
            options.onError('Browser does not support video recording');
            return false;
          }

          const srcCanvas = renderer.domElement;
          if (typeof (HTMLCanvasElement.prototype as { captureStream?: unknown }).captureStream !== 'function') {
            options.onError('Canvas video capture is unavailable in this browser');
            return false;
          }

          const maxDim = 1280;
          const srcW = Math.max(2, srcCanvas.width || 1280);
          const srcH = Math.max(2, srcCanvas.height || 720);
          const scale = Math.min(1, maxDim / Math.max(srcW, srcH));
          const recW = Math.max(2, Math.floor((srcW * scale) / 2) * 2);
          const recH = Math.max(2, Math.floor((srcH * scale) / 2) * 2);

          const recCanvas = document.createElement('canvas');
          recCanvas.width = recW;
          recCanvas.height = recH;
          const recCtx = recCanvas.getContext('2d');
          if (!recCtx) {
            options.onError('Could not initialize video frame buffer');
            return false;
          }

          const { mimeType, extension } = pickSupportedVideoMimeType();
          let stream: MediaStream;
          let recorder: MediaRecorder;
          try {
            stream = recCanvas.captureStream(30);
            recorder = mimeType
              ? new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 4_500_000 })
              : new MediaRecorder(stream, { videoBitsPerSecond: 4_500_000 });
          } catch {
            options.onError('Could not start video recorder');
            return false;
          }

          const chunks: BlobPart[] = [];
          recorder.ondataavailable = (ev) => {
            if (ev.data && ev.data.size > 0) chunks.push(ev.data);
          };
          recorder.onstop = () => {
            stream.getTracks().forEach((tr) => tr.stop());
            const finalMime = recorder.mimeType || mimeType || `video/${extension}`;
            const finalExt = finalMime.includes('mp4') ? 'mp4' : 'webm';
            const blob = new Blob(chunks, { type: finalMime });
            engine.recording = null;
            if (blob.size > 0) {
              options.onProgress(100);
              options.onComplete(blob, `pixel-flower-bouquet.${finalExt}`, finalMime);
            } else {
              options.onError('Recorded video was empty');
            }
          };
          recorder.onerror = () => {
            stream.getTracks().forEach((tr) => tr.stop());
            engine.recording = null;
            options.onError('Video recording failed');
          };

          const animCfg = stateRef.current.animationConfig;
          const introDuration = Math.max(2.0, animCfg.entranceDuration ?? 9.0) / Math.max(0.4, animCfg.bloomSpeed || 1);
          const targetDuration = options.mode === 'intro' ? introDuration + 1.6 : 6.0;

          if (options.mode === 'intro') {
            engine.startEntrance();
          } else {
            if (engine.entrancePlaying) engine.finishEntrance();
            engine.camTargetPos.copy(getResponsiveDefaultCameraPos(camera.aspect));
            engine.camTargetLook.copy(DEFAULT_TARGET);
            camera.position.copy(engine.camTargetPos);
            controls.target.copy(DEFAULT_TARGET);
            controls.update();
          }

          engine.recording = {
            active: true,
            elapsed: 0,
            duration: targetDuration,
            lastReportedPct: -1,
            recorder,
            stream,
            recCanvas,
            recCtx,
            personalization: options.personalization,
            onProgress: options.onProgress,
          };

          recorder.start(250);
          options.onProgress(0);
          return true;
        },
        stopRecording: () => {
          const rec = engine.recording;
          if (!rec || !rec.active) return;
          rec.active = false;
          if (rec.recorder.state !== 'inactive') {
            try {
              rec.recorder.stop();
            } catch {
              engine.recording = null;
            }
          }
        },
        rebuildBouquet: (
          nextAtlas: ProcessedAtlasResult,
          nextFlowers: FlowerConfig[],
          nextPhotos: UploadedPhoto[],
          nextSize: PixelSizeMode,
        ) => {
          engine.assemblies.forEach((asm) => {
            asm.petals.forEach((p) => {
              p.mesh.geometry.dispose();
              p.mesh.dispose();
            });
            asm.hitProxy.geometry.dispose();
            (asm.hitProxy.material as THREE.Material).dispose();
            asm.stamenGroup.traverse((obj) => {
              if (obj instanceof THREE.Mesh) {
                obj.geometry.dispose();
                if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
                else obj.material.dispose();
              }
            });
            engine.flowersGroup.remove(asm.group);
          });
          engine.assemblies = [];

          if (engine.tileMat) {
            engine.tileMat.dispose();
          }

          const mat = createPhotoTileMaterial(nextAtlas.atlasTexture, engine.uniforms);
          engine.tileMat = mat;

          let totalCount = 0;
          const nextAssemblies: LilyAssembly[] = [];
          const nextGlobalPixelId = { value: 1 };

          nextFlowers.forEach((flowerCfg, idx) => {
            const asm = buildLilyAssembly(
              flowerCfg,
              idx,
              engine.tileGeo,
              mat,
              nextAtlas.slots,
              nextPhotos,
              nextSize,
              nextGlobalPixelId,
            );
            engine.flowersGroup.add(asm.group);
            nextAssemblies.push(asm);
            totalCount += asm.totalTiles;
          });

          // Precompute center-first ordering dynamically from flower XZ radial distances + height
          const sortedOrder = nextAssemblies
            .map((asm, idx) => ({
              idx,
              dist:
                Math.hypot(asm.config.position[0], asm.config.position[2]) +
                (asm.config.isBud ? 0.85 : 0) +
                (asm.config.bloomDelay ?? 0) * 0.4,
            }))
            .sort((a, b) => a.dist - b.dist)
            .map((x) => x.idx);

          engine.assemblies = nextAssemblies;
          engine.centerSortedOrder = sortedOrder;
          callbacksRef.current.onTotalTilesChange?.(totalCount);

          if (!isSoftwareGl) {
            renderer.compile(scene, camera);
          }
        },
        rebuildProps: (
          nextFlowers: FlowerConfig[],
          nextWrap: WrapRibbonConfig,
          nextRibbonText: string,
          nextRecipientName: string,
        ) => {
          if (engine.propsBuild) {
            engine.propsContainer.remove(engine.propsBuild.group);
            engine.propsBuild.dispose();
          }
          const nextBuild = buildBouquetProps(
            nextFlowers,
            nextWrap,
            nextRibbonText,
            nextRecipientName,
            engine.maxAnisotropy,
          );
          engine.propsContainer.add(nextBuild.group);
          engine.propsBuild = nextBuild;
        },
      };

      if (shouldRunIntro) {
        const camZoomMult = 1 + 0.18 * (initAnim.cameraEntranceIntensity ?? 0.75);
        camera.position.copy(
          getResponsiveDefaultCameraPos(initialAspect).multiplyScalar(camZoomMult),
        );
        controls.target.copy(DEFAULT_TARGET);
        controls.update();
      }

      engineRef.current = engine;

      const onControlsStart = () => {
        engine.camTransitionActive = false;
        engine.entranceCameraActive = false;
        callbacksRef.current.onFirstInteract?.();
      };
      controls.addEventListener('start', onControlsStart);

      const raycaster = new THREE.Raycaster();
      const pointerNdc = new THREE.Vector2();
      let downX = 0;
      let downY = 0;
      let lastHoverCheck = 0;

      const resolveSceneHit = (
        clientX: number,
        clientY: number,
      ):
        | { kind: 'tag' }
        | { kind: 'pixel'; pixel: ClickedPixelInfo }
        | null => {
        if (stateRef.current.lockedSkyOnly || engine.curtainActive) return null;
        const rect = renderer.domElement.getBoundingClientRect();
        pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
        pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(pointerNdc, camera);

        const petalMeshes = engine.assemblies.flatMap((a) => a.petals.map((p) => p.mesh));
        const tagTargets = engine.propsBuild?.tagHitTargets ?? [];
        const candidates: THREE.Object3D[] = [...tagTargets, ...petalMeshes];
        const hits = raycaster.intersectObjects(candidates, false);
        if (hits.length === 0) return null;

        const hit = hits[0];
        if (hit.object.userData.isGiftTag) {
          return { kind: 'tag' };
        }
        if (hit.instanceId === undefined) return null;

        const flowerIdx = hit.object.userData.flowerIndex as number;
        const petalIdx = hit.object.userData.petalIndex as number;
        const tilesMeta = hit.object.userData.tilesMeta as PetalTileInstanceMeta[];
        const meta = tilesMeta?.[hit.instanceId];
        const asm = engine.assemblies[flowerIdx];
        if (!meta || !asm) return null;

        return {
          kind: 'pixel',
          pixel: {
            photoId: meta.slot.photoId,
            flowerIndex: asm.flowerIndex,
            flowerId: asm.config.id,
            flowerLabel: asm.config.label,
            colorKind: asm.config.colorKind,
            pixelNumber: meta.localPixelNumber,
            petalNumber: petalIdx + 1,
          },
        };
      };

      const onPointerMove = (e: PointerEvent) => {
        const nowMs = performance.now();
        if (nowMs - lastHoverCheck < 35) return;
        lastHoverCheck = nowMs;

        const hitResult = resolveSceneHit(e.clientX, e.clientY);
        if (hitResult?.kind === 'tag') {
          engine.uniforms.uHoveredPixelId.value = -1;
          engine.isHoveringGiftTag = true;
          renderer.domElement.style.cursor = 'pointer';
          callbacksRef.current.onHoverPixel?.(null);
          callbacksRef.current.onHoverGiftTag?.(true);
          return;
        }
        if (engine.isHoveringGiftTag) {
          engine.isHoveringGiftTag = false;
          callbacksRef.current.onHoverGiftTag?.(false);
        }

        if (hitResult?.kind === 'pixel') {
          const rect = renderer.domElement.getBoundingClientRect();
          pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
          pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
          raycaster.setFromCamera(pointerNdc, camera);
          const petalMeshes = engine.assemblies.flatMap((a) => a.petals.map((p) => p.mesh));
          const hits = raycaster.intersectObjects(petalMeshes, false);
          const hit = hits[0];
          if (hit && hit.instanceId !== undefined) {
            const tilesMeta = hit.object.userData.tilesMeta as PetalTileInstanceMeta[];
            const meta = tilesMeta?.[hit.instanceId];
            if (meta) {
              engine.uniforms.uHoveredPixelId.value = meta.globalPixelId;
              renderer.domElement.style.cursor = 'pointer';
              callbacksRef.current.onHoverPixel?.(hitResult.pixel);
              return;
            }
          }
        }
        engine.uniforms.uHoveredPixelId.value = -1;
        renderer.domElement.style.cursor = 'grab';
        callbacksRef.current.onHoverPixel?.(null);
      };

      const onPointerDown = (e: PointerEvent) => {
        downX = e.clientX;
        downY = e.clientY;
        callbacksRef.current.onFirstInteract?.();
      };

      const onPointerUp = (e: PointerEvent) => {
        const distMoved = Math.hypot(e.clientX - downX, e.clientY - downY);
        if (distMoved > 6) return;

        const hitResult = resolveSceneHit(e.clientX, e.clientY);
        if (hitResult?.kind === 'tag') {
          callbacksRef.current.onClickGiftTag?.();
        } else if (hitResult?.kind === 'pixel') {
          callbacksRef.current.onClickPixel(hitResult.pixel);
        }
      };

      renderer.domElement.addEventListener('pointermove', onPointerMove);
      renderer.domElement.addEventListener('pointerdown', onPointerDown);
      renderer.domElement.addEventListener('pointerup', onPointerUp);

      const onContextLost = (e: Event) => e.preventDefault();
      renderer.domElement.addEventListener('webglcontextlost', onContextLost);

      const handleResize = () => {
        if (!container) return;
        const w = container.clientWidth || window.innerWidth;
        const h = container.clientHeight || window.innerHeight;
        camera.aspect = w / Math.max(1, h);
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
        const pxRatio = isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2);
        renderer.setPixelRatio(pxRatio);
        starUniforms.uPixelRatio.value = pxRatio;
        scatteredUniforms.uPixelRatio.value = pxRatio;
      };
      const resizeObserver = new ResizeObserver(handleResize);
      resizeObserver.observe(container);
      window.addEventListener('resize', handleResize);

      let frameId = 0;
      let disposed = false;
      let lastTime = performance.now() * 0.001;
      let animClock = 0;
      let lastReportedZoom = -1;
      let lastReportedBloom = -1;
      let lastReportedStage = 0;

      function afterDraw(cb: () => void) {
        const gl = renderer.getContext() as WebGL2RenderingContext;
        const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        gl.flush();
        const poll = () => {
          if (disposed) {
            if (sync) gl.deleteSync(sync);
            return;
          }
          const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
          if (state === gl.UNSIGNALED) {
            frameId = window.setTimeout(poll, 5);
          } else {
            if (sync) gl.deleteSync(sync);
            frameId = window.setTimeout(cb, 80);
          }
        };
        frameId = window.setTimeout(poll, 5);
      }

      const tick = () => {
        if (disposed) return;

        const now = performance.now() * 0.001;
        const rawDelta = Math.min(0.08, Math.max(0.001, now - lastTime));
        lastTime = now;

        const {
          animationConfig: animCfg,
          curtainConfig: propCurtainCfg,
          lockedSkyOnly: isLockedSky,
          effectiveAutoRotate: rotActive,
          pausedOverride: rawPaused,
        } = stateRef.current;

        const isRecording = Boolean(engine.recording?.active);
        const isPaused = isRecording ? false : rawPaused;
        const delta = isPaused ? 0 : rawDelta;
        animClock += delta;

        const activeCurtainCfg = engine.curtainOverrideConfig ?? propCurtainCfg;
        let curtainProgress = 1.0;
        let waitingBehindClosedCurtain = false;

        if (engine.curtainActive) {
          const curtainDur = engine.prefersReducedMotion
            ? 1.1
            : Math.max(1.8, activeCurtainCfg.durationSec || 4.8) /
              Math.max(0.4, activeCurtainCfg.openingSpeed || 1.0);
          if (!isPaused) {
            engine.curtainElapsed += delta;
          }
          curtainProgress = THREE.MathUtils.clamp(engine.curtainElapsed / curtainDur, 0, 1);

          const phase: 'surge' | 'poise' | 'parting' | 'done' =
            curtainProgress < 0.35
              ? 'surge'
              : curtainProgress < 0.42
                ? 'poise'
                : curtainProgress < 0.995
                  ? 'parting'
                  : 'done';

          if (!engine.curtainAssembleTriggered && curtainProgress >= 0.48) {
            engine.curtainAssembleTriggered = true;
            if (engine.curtainAssembleAfter) {
              engine.startEntrance();
            } else {
              engine.finishEntrance();
            }
          }

          waitingBehindClosedCurtain = curtainProgress < 0.48;

          if (phase !== engine.curtainLastPhase) {
            engine.curtainLastPhase = phase;
            callbacksRef.current.onCurtainStateChange?.({
              active: phase !== 'done',
              progress: curtainProgress,
              phase,
            });
          }

          if (curtainProgress >= 0.995) {
            engine.curtainActive = false;
            engine.curtainOverrideConfig = null;
            engine.curtainLastPhase = 'done';
            callbacksRef.current.onCurtainStateChange?.({
              active: false,
              progress: 1,
              phase: 'done',
            });
          }
        }

        const showBouquetContent = !isLockedSky && !waitingBehindClosedCurtain;
        bouquetRoot.visible = showBouquetContent;
        contactMesh.visible = showBouquetContent;

        engine.uniforms.uTime.value = animClock;
        engine.uniforms.uPhotoVividness.value = THREE.MathUtils.damp(
          engine.uniforms.uPhotoVividness.value,
          animCfg.photoVividness,
          8,
          Math.max(0.016, rawDelta),
        );

        // Compute normalized 6-Stage Entrance Timeline
        const totalDuration = Math.max(2.0, animCfg.entranceDuration ?? 9.0);
        if (showBouquetContent && engine.entrancePlaying && !isPaused) {
          engine.entranceElapsed += delta * Math.max(0.4, animCfg.bloomSpeed || 1);
          if (engine.entranceElapsed >= totalDuration) {
            engine.entranceElapsed = totalDuration;
            engine.entrancePlaying = false;
            engine.entranceCameraActive = false;
          }
        }

        const pNorm =
          !animCfg.entranceEnabled || engine.prefersReducedMotion
            ? 1.0
            : THREE.MathUtils.clamp(engine.entranceElapsed / totalDuration, 0, 1);

        // Proportional Stage Weights across [0.11 .. 0.85] with fixed Stage 1 (Sky) & Stage 6 (Settle)
        const wStem = Math.max(0.25, animCfg.stemStageWeight ?? 1.0);
        const wFlower = Math.max(0.25, animCfg.flowerStageWeight ?? 1.0);
        const wWrap = Math.max(0.25, animCfg.wrapStageWeight ?? 1.0);
        const wRibbon = Math.max(0.25, animCfg.ribbonStageWeight ?? 1.0);
        const wSum = wStem + wFlower + wWrap + wRibbon;

        const s1End = 0.11; // 0..1s: Moon + Stars + Sparkles only
        const midSpan = 0.73; // 0.11..0.84: Stems -> Flowers -> Wrap -> Ribbon/Tag
        const s2Start = s1End;
        const s2End = s2Start + (wStem / wSum) * midSpan;
        const s3Start = Math.max(s2Start + 0.04, s2End - 0.04); // slight overlap for organic grace
        const s3End = s2End + (wFlower / wSum) * midSpan;
        const s4Start = Math.max(s3Start + 0.06, s3End - 0.03);
        const s4End = s3End + (wWrap / wSum) * midSpan;
        const s5Start = Math.max(s4Start + 0.04, s4End - 0.02);
        const s5End = Math.min(0.87, s4End + (wRibbon / wSum) * midSpan);
        const s6Start = s5End - 0.03;

        const currentStage: 1 | 2 | 3 | 4 | 5 | 6 =
          pNorm < s2Start
            ? 1
            : pNorm < s3Start
              ? 2
              : pNorm < s4Start
                ? 3
                : pNorm < s5Start
                  ? 4
                  : pNorm < s6Start
                    ? 5
                    : 6;

        const overallPct = Math.min(100, Math.round(pNorm * 100));
        if (overallPct !== lastReportedBloom || currentStage !== lastReportedStage) {
          lastReportedBloom = overallPct;
          lastReportedStage = currentStage;
          callbacksRef.current.onBloomProgress?.(overallPct);
          callbacksRef.current.onEntranceStateChange?.({
            isPlaying: engine.entrancePlaying,
            progress: pNorm,
            stage: currentStage,
          });
        }

        // Apply idle gentle float only as bouquet finishes settling
        const settleFinishT = THREE.MathUtils.smoothstep(pNorm, s6Start, 1.0);
        const idleFloatY = settleFinishT * Math.sin(animClock * 0.9) * 0.035;
        bouquetRoot.position.y = idleFloatY;
        bouquetRoot.scale.setScalar(1.0);

        // Animate Bouquet Props (Stage 2 Stems & Leaves, Stage 3 Fillers, Stage 4 Wraps, Stage 5 Ribbon/Bow/Tag)
        const props = engine.propsBuild;
        if (props) {
          // Stage 2: Stems arrive individually from lower-radial offsets
          const stemGlobal = THREE.MathUtils.clamp(
            (pNorm - s2Start) / Math.max(0.01, s2End - s2Start),
            0,
            1,
          );
          for (let i = 0; i < props.stemItems.length; i++) {
            const item = props.stemItems[i];
            const localT = THREE.MathUtils.clamp((stemGlobal - item.delayFactor * 0.72) / 0.48, 0, 1);
            if (localT <= 0.001) {
              item.group.visible = false;
            } else {
              item.group.visible = true;
              const eased = easeOutCubic(localT);
              item.group.position.copy(item.entryOffset).multiplyScalar(1 - eased);
              item.group.rotation.set(
                item.entryTilt.x * (1 - eased),
                item.entryTilt.y * (1 - eased),
                item.entryTilt.z * (1 - eased),
              );
              const growScale = 0.25 + 0.75 * eased;
              item.group.scale.set(growScale, 0.35 + 0.65 * eased, growScale);
            }
          }

          // Stage 2b: Leaves emerge & unfold outward cleanly
          const leafGlobal = THREE.MathUtils.clamp(
            (pNorm - (s2Start + 0.05)) / Math.max(0.01, s3Start + 0.09 - s2Start),
            0,
            1,
          );
          for (let i = 0; i < props.leafItems.length; i++) {
            const lf = props.leafItems[i];
            const localT = THREE.MathUtils.clamp((leafGlobal - lf.delayFactor * 0.6) / 0.5, 0, 1);
            if (localT <= 0.001) {
              lf.mesh.visible = false;
            } else {
              lf.mesh.visible = true;
              const eased = easeOutBackSoft(localT);
              lf.mesh.position
                .copy(lf.targetPos)
                .addScaledVector(lf.radialDir, -0.45 * (1 - easeOutCubic(localT)));
              const sway = settleFinishT * Math.sin(animClock * 1.1 + i * 0.7) * 0.025;
              lf.mesh.rotation.set(
                lf.targetRot.x + (1 - easeOutCubic(localT)) * 0.32,
                lf.targetRot.y,
                lf.targetRot.z + sway,
              );
              lf.mesh.scale.setScalar(lf.targetScale * Math.max(0.02, eased));
            }
          }

          // Stage 3b: Baby's breath fillers cluster gently with blooms
          const fillerT = THREE.MathUtils.clamp(
            (pNorm - (s3Start + 0.04)) / Math.max(0.01, s3End - s3Start),
            0,
            1,
          );
          if (fillerT <= 0.001) {
            props.fillerMesh.visible = false;
          } else {
            props.fillerMesh.visible = true;
            const easedFiller = easeOutCubic(fillerT);
            props.fillerMesh.scale.setScalar(0.1 + 0.9 * easedFiller);
          }

          // Stage 4: Two-tier Wrapping Paper rises and folds smoothly around stems
          const wrapT = THREE.MathUtils.clamp(
            (pNorm - s4Start) / Math.max(0.01, s4End - s4Start),
            0,
            1,
          );
          if (wrapT <= 0.001) {
            props.outerWrap.visible = false;
            props.innerWrap.visible = false;
          } else {
            props.outerWrap.visible = true;
            props.innerWrap.visible = true;
            const innerT = easeOutCubic(THREE.MathUtils.clamp(wrapT / 0.82, 0, 1));
            const outerT = easeOutCubic(THREE.MathUtils.clamp((wrapT - 0.14) / 0.86, 0, 1));

            props.innerWrap.position.y = -1.65 * (1 - innerT);
            const innerRadiusScale = 0.38 + 0.62 * innerT;
            props.innerWrap.scale.set(innerRadiusScale, 0.45 + 0.55 * innerT, innerRadiusScale);

            props.outerWrap.position.y = -1.85 * (1 - outerT);
            const outerRadiusScale = 0.36 + 0.64 * outerT;
            props.outerWrap.scale.set(outerRadiusScale, 0.42 + 0.58 * outerT, outerRadiusScale);
          }

          // Stage 5: Satin Sash, 3D Bow Loops, Hanging Tails & Beveled Gift Tag
          const ribT = THREE.MathUtils.clamp(
            (pNorm - s5Start) / Math.max(0.01, s5End - s5Start),
            0,
            1,
          );
          if (ribT <= 0.001) {
            props.waistSash.visible = false;
            props.bowGroup.visible = false;
          } else {
            const sashEase = easeOutCubic(THREE.MathUtils.clamp(ribT / 0.45, 0, 1));
            props.waistSash.visible = true;
            const sashXZ = 1.32 - 0.32 * sashEase;
            props.waistSash.scale.set(sashXZ, Math.max(0.05, sashEase), sashXZ);

            const bowShowT = THREE.MathUtils.clamp((ribT - 0.2) / 0.8, 0, 1);
            props.bowGroup.visible = bowShowT > 0.001;
            if (props.bowGroup.visible) {
              const knotEase = easeOutBackSoft(THREE.MathUtils.clamp(bowShowT / 0.4, 0, 1));
              props.bowKnot.scale.setScalar(Math.max(0.05, knotEase));
              props.knotWrap.scale.setScalar(Math.max(0.05, knotEase));

              const loopEase = easeOutBackSoft(THREE.MathUtils.clamp((bowShowT - 0.14) / 0.52, 0, 1));
              if (props.leftLoop) props.leftLoop.scale.setScalar(Math.max(0.01, loopEase));
              if (props.rightLoop) props.rightLoop.scale.setScalar(Math.max(0.01, loopEase));

              const tailEase = easeOutCubic(THREE.MathUtils.clamp((bowShowT - 0.35) / 0.55, 0, 1));
              if (props.leftTail) {
                props.leftTail.visible = tailEase > 0.01;
                props.leftTail.scale.set(0.5 + 0.5 * tailEase, Math.max(0.02, tailEase), 1);
              }
              if (props.rightTail) {
                props.rightTail.visible = tailEase > 0.01;
                props.rightTail.scale.set(0.5 + 0.5 * tailEase, Math.max(0.02, tailEase), 1);
              }

              // Hanging Beveled Cardstock Gift Tag w/ Damped Pendulum Swing
              if (props.tagPivot) {
                const tagDropT = THREE.MathUtils.clamp((ribT - 0.58) / 0.42, 0, 1);
                if (tagDropT <= 0.001) {
                  props.tagPivot.visible = false;
                } else {
                  props.tagPivot.visible = true;
                  const tagScale = easeOutCubic(THREE.MathUtils.clamp(tagDropT / 0.45, 0, 1));
                  engine.tagHoverScale = THREE.MathUtils.damp(
                    engine.tagHoverScale,
                    engine.isHoveringGiftTag ? 1.07 : 1.0,
                    10,
                    Math.max(0.016, rawDelta),
                  );
                  props.tagPivot.scale.setScalar(Math.max(0.05, tagScale * engine.tagHoverScale));

                  // Damped settling swing right when tag lands, tapering smoothly into idle gentle sway
                  const dropAge = Math.max(0, pNorm - (s5Start + 0.58 * (s5End - s5Start)));
                  const settlePendulum =
                    Math.exp(-dropAge * 14.0) *
                    Math.sin(dropAge * 48.0) *
                    0.26 *
                    props.tagSwingIntensity;
                  const idleTagSway =
                    settleFinishT *
                    Math.sin(animClock * 1.15) *
                    0.028 *
                    props.tagSwingIntensity;
                  props.tagPivot.rotation.set(
                    props.tagBaseRot.x,
                    props.tagBaseRot.y,
                    props.tagBaseRot.z + settlePendulum + idleTagSway,
                  );
                }
              }
            }
          }
        }

        // Stage 3: Lilies arrive center-first and bloom petal-by-petal
        const sortedIndices =
          engine.centerSortedOrder.length === engine.assemblies.length
            ? engine.centerSortedOrder
            : engine.assemblies.map((_, idx) => idx);
        const flowerCount = Math.max(1, sortedIndices.length);
        const flowerStageSpan = Math.max(0.05, s3End - s3Start);

        for (let rank = 0; rank < sortedIndices.length; rank++) {
          const idx = sortedIndices[rank];
          const asm = engine.assemblies[idx];
          if (!asm) continue;

          // Center-first staggered entrance
          const startFrac = (rank / flowerCount) * 0.54;
          const flowerStart = s3Start + startFrac * flowerStageSpan;
          const flowerLen = Math.max(0.08, flowerStageSpan * 0.48);
          const arriveT = THREE.MathUtils.clamp((pNorm - flowerStart) / flowerLen, 0, 1);

          if (arriveT <= 0.001) {
            asm.group.visible = false;
            continue;
          }
          asm.group.visible = true;

          const moveEase = easeOutCubic(THREE.MathUtils.clamp(arriveT / 0.62, 0, 1));
          const cfg = asm.config;
          const bloomMult = THREE.MathUtils.clamp(cfg.bloomIntensity ?? 1.0, 0.35, 1.45);
          const swayMult = THREE.MathUtils.clamp(cfg.swayIntensity ?? 1.0, 0.0, 2.0);

          // Arrival glide from above & slightly outward into final exact coordinate
          asm.group.position.set(
            cfg.position[0] * (1.14 - 0.14 * moveEase),
            cfg.position[1] + 0.62 * (1 - moveEase),
            cfg.position[2] * (1.14 - 0.14 * moveEase),
          );
          asm.group.rotation.set(
            cfg.rotation[0] + 0.25 * (1 - moveEase),
            cfg.rotation[1] + (idx % 2 === 0 ? 1 : -1) * 0.42 * (1 - moveEase),
            cfg.rotation[2],
          );
          asm.group.scale.setScalar(cfg.scale * (0.18 + 0.82 * moveEase));

          const sway =
            settleFinishT * Math.sin(animClock * 0.85 + idx * 1.1) * 0.024 * swayMult;
          asm.headGroup.rotation.z = sway;

          const bloomUnfurlT = THREE.MathUtils.clamp((arriveT - 0.18) / 0.82, 0, 1);
          for (let p = 0; p < asm.petals.length; p++) {
            const petal = asm.petals[p];
            const stagger = petal.isInner ? 0.18 : 0.0;
            const pBloom = THREE.MathUtils.clamp(
              (bloomUnfurlT - stagger) / (1 - stagger),
              0,
              1,
            );
            const eased = easeInOutCubic(pBloom);
            const microBreeze =
              settleFinishT * Math.sin(animClock * 1.3 + idx + p * 0.7) * 0.02 * swayMult;
            const openTarget = THREE.MathUtils.lerp(
              petal.closedTiltX,
              petal.baseTiltX,
              bloomMult,
            );
            petal.mesh.rotation.x =
              THREE.MathUtils.lerp(petal.closedTiltX, openTarget, eased) + microBreeze;
          }
        }

        // Stage 6: Orbital pink sparkle ring gathers & locks into slow spin
        const showRingCfg = animCfg.showOrbitRing;
        if (showRingCfg) {
          const ringT = THREE.MathUtils.clamp(
            (pNorm - s6Start) / Math.max(0.01, 1.0 - s6Start),
            0,
            1,
          );
          if (ringT <= 0.005) {
            orbitRing.visible = false;
          } else {
            orbitRing.visible = true;
            const rEase = easeOutCubic(ringT);
            orbitRing.scale.setScalar(0.35 + 0.65 * rEase);
            ringMat.opacity = 0.9 * rEase;
          }
        } else {
          orbitRing.visible = false;
        }
        orbitRing.rotation.y -= delta * 0.42;

        // Smooth Stage 1->6 Camera Glide when intro camera is active
        if (engine.entranceCameraActive && engine.entrancePlaying) {
          const camEase = easeInOutCubic(THREE.MathUtils.clamp(pNorm, 0, 1));
          const camZoomMult = 1 + 0.18 * (animCfg.cameraEntranceIntensity ?? 0.75) * (1 - camEase);
          const desiredPos = getResponsiveDefaultCameraPos(camera.aspect).multiplyScalar(camZoomMult);
          camera.position.lerp(desiredPos, Math.min(1, Math.max(0.08, delta * 5.5)));
          controls.target.lerp(DEFAULT_TARGET, Math.min(1, Math.max(0.08, delta * 5.5)));
        }

        // Smooth 360-degree auto rotation (begins gently as bouquet settles)
        if (rotActive && !engine.camTransitionActive && !isPaused) {
          bouquetRoot.rotation.y += delta * animCfg.rotationSpeed * (0.25 + 0.75 * settleFinishT);
        }

        // Manual focus / reset camera transition
        if (engine.camTransitionActive) {
          const dampDelta = Math.max(0.016, rawDelta);
          camera.position.x = THREE.MathUtils.damp(
            camera.position.x,
            engine.camTargetPos.x,
            5.2,
            dampDelta,
          );
          camera.position.y = THREE.MathUtils.damp(
            camera.position.y,
            engine.camTargetPos.y,
            5.2,
            dampDelta,
          );
          camera.position.z = THREE.MathUtils.damp(
            camera.position.z,
            engine.camTargetPos.z,
            5.2,
            dampDelta,
          );

          controls.target.x = THREE.MathUtils.damp(
            controls.target.x,
            engine.camTargetLook.x,
            5.2,
            dampDelta,
          );
          controls.target.y = THREE.MathUtils.damp(
            controls.target.y,
            engine.camTargetLook.y,
            5.2,
            dampDelta,
          );
          controls.target.z = THREE.MathUtils.damp(
            controls.target.z,
            engine.camTargetLook.z,
            5.2,
            dampDelta,
          );

          if (
            camera.position.distanceTo(engine.camTargetPos) < 0.015 &&
            controls.target.distanceTo(engine.camTargetLook) < 0.015
          ) {
            engine.camTransitionActive = false;
          }
        }

        controls.update();

        // Zoom-adaptive photo pixel reveal
        const camDist = camera.position.distanceTo(controls.target);
        const targetReveal = THREE.MathUtils.clamp(1.0 - (camDist - 2.2) / 4.6, 0.04, 1.0);
        engine.uniforms.uZoomReveal.value = THREE.MathUtils.damp(
          engine.uniforms.uZoomReveal.value,
          targetReveal,
          8,
          Math.max(0.016, rawDelta),
        );

        const zoomPct = Math.round(
          THREE.MathUtils.clamp(((9.6 - camDist) / 7.8) * 100, 10, 200),
        );
        if (Math.abs(zoomPct - lastReportedZoom) >= 3) {
          lastReportedZoom = zoomPct;
          callbacksRef.current.onZoomChange?.(zoomPct);
        }

        // Stars, Scattered Sparkles, Shooting Stars, Moon & Falling Petals (ALWAYS visible from Stage 1 onward!)
        starUniforms.uTime.value = animClock;
        scatteredUniforms.uTime.value = animClock;
        moonUniforms.uTime.value = animClock;
        const skyAnimSpeed = animCfg.starAnimationSpeed ?? 0.85;
        starField.rotation.y += delta * 0.008 * skyAnimSpeed;
        crossSparkles.rotation.y -= delta * 0.006 * skyAnimSpeed;

        if (shootingGroup.visible) {
          for (let i = 0; i < shootingStars.length; i++) {
            const st = shootingStars[i];
            const cyc = (animClock * Math.max(0.25, skyAnimSpeed) + st.phaseOffset) % st.cycleDuration;
            if (cyc < 1.15) {
              const p = cyc / 1.15;
              st.line.visible = true;
              const startX = -7.5 + i * 4.2;
              const startY = 6.2 - i * 0.85;
              st.line.position.x = startX + p * 8.4;
              st.line.position.y = startY - p * 4.8;
              st.mat.opacity = Math.sin(p * Math.PI) * 0.85 * (animCfg.starBrightness ?? 0.9);
            } else {
              st.line.visible = false;
            }
          }
        }

        if (moonGroup.visible) {
          const zDistToMoon = Math.max(8, camera.position.z - moonGroup.position.z);
          const halfSkyHeight = zDistToMoon * Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
          const halfSkyWidth = halfSkyHeight * camera.aspect;
          const mRadius = 0.95 * (animCfg.moonSize ?? 1.18);
          const safeMaxX = Math.max(0.8, halfSkyWidth - mRadius * 1.15);
          const targetMoonX = THREE.MathUtils.clamp(
            animCfg.moonPositionX ?? -2.5,
            -safeMaxX,
            safeMaxX,
          );
          moonGroup.position.x = targetMoonX;
          moonGroup.position.y = animCfg.moonPositionY ?? 5.1;
          moonGroup.lookAt(camera.position);

          const styleHaloFactor = animCfg.moonStyle === 'crescent' ? 0.72 : 1.0;
          const haloPulse = 0.95 + 0.05 * Math.sin(animClock * 0.65);
          moonHaloMat.opacity = THREE.MathUtils.clamp(
            (animCfg.moonGlowIntensity ?? 0.78) *
              (animCfg.moonOpacity ?? 0.94) *
              0.72 *
              styleHaloFactor *
              haloPulse,
            0,
            1,
          );
        }

        if (fallingPetalsMesh.visible) {
          const activePetals = fallingPetalsMesh.count;
          for (let i = 0; i < activePetals; i++) {
            const fp = fallingData[i];
            fp.y -= delta * fp.fallSpeed;
            if (fp.y < -2.4) {
              fp.y = 4.6;
              fp.x = (Math.random() - 0.5) * 7.2;
              fp.z = (Math.random() - 0.5) * 6.2;
            }
            const swayX = Math.sin(animClock * 1.1 + fp.swayPhase) * fp.swayAmp;
            const swayZ = Math.cos(animClock * 0.9 + fp.swayPhase) * fp.swayAmp;

            _dummyObj.position.set(fp.x + swayX, fp.y, fp.z + swayZ);
            _dummyObj.rotation.set(
              animClock * fp.rotSpeedX + fp.swayPhase,
              animClock * fp.rotSpeedY,
              Math.sin(animClock + fp.swayPhase) * 0.6,
            );
            _dummyObj.scale.setScalar(fp.scale);
            _dummyObj.updateMatrix();
            fallingPetalsMesh.setMatrixAt(i, _dummyObj.matrix);
          }
          fallingPetalsMesh.instanceMatrix.needsUpdate = true;
        }

        curtainSystem.update(
          engine.curtainActive,
          curtainProgress,
          animClock,
          activeCurtainCfg,
          camera,
          engine.prefersReducedMotion,
        );

        renderer.render(scene, camera);

        if (engine.recording && engine.recording.active) {
          const rec = engine.recording;
          const ctx2d = rec.recCtx;
          const rw = rec.recCanvas.width;
          const rh = rec.recCanvas.height;
          ctx2d.clearRect(0, 0, rw, rh);
          ctx2d.drawImage(renderer.domElement, 0, 0, rw, rh);

          // Subtle keepsake ribbon watermark at bottom of exported video
          const grad = ctx2d.createLinearGradient(0, rh - 108, 0, rh);
          grad.addColorStop(0, 'rgba(0, 0, 0, 0)');
          grad.addColorStop(1, 'rgba(0, 0, 0, 0.82)');
          ctx2d.fillStyle = grad;
          ctx2d.fillRect(0, rh - 108, rw, 108);

          const vScale = Math.max(0.75, rw / 1280);
          const pad = Math.round(rw * 0.03);
          const captionLine =
            rec.personalization.ribbonText.trim() ||
            'Every pixel of this flower reminds me of you.';
          ctx2d.fillStyle = '#fff5f8';
          ctx2d.font = `italic 600 ${Math.round(24 * vScale)}px "Cormorant Garamond", Georgia, serif`;
          ctx2d.textAlign = 'left';
          ctx2d.fillText(`“${captionLine}”`, pad, rh - Math.round(38 * vScale));

          const metaParts: string[] = [];
          if (rec.personalization.recipientName.trim()) {
            metaParts.push(`For ${rec.personalization.recipientName.trim()}`);
          }
          if (rec.personalization.senderName.trim()) {
            metaParts.push(`From ${rec.personalization.senderName.trim()}`);
          }
          if (metaParts.length > 0) {
            ctx2d.fillStyle = 'rgba(244, 114, 182, 0.92)';
            ctx2d.font = `500 ${Math.round(13 * vScale)}px "JetBrains Mono", monospace`;
            ctx2d.fillText(metaParts.join(' · '), pad, rh - Math.round(16 * vScale));
          }

          rec.elapsed += rawDelta;
          const pct = Math.min(99, Math.round((rec.elapsed / rec.duration) * 100));
          if (pct !== rec.lastReportedPct) {
            rec.lastReportedPct = pct;
            rec.onProgress(pct);
          }
          if (rec.elapsed >= rec.duration) {
            engine.stopRecording();
          }
        }

        if (isSoftwareGl) afterDraw(tick);
        else frameId = requestAnimationFrame(tick);
      };

      if (isSoftwareGl) afterDraw(tick);
      else frameId = requestAnimationFrame(tick);

      return () => {
        disposed = true;
        cancelAnimationFrame(frameId);
        clearTimeout(frameId);
        resizeObserver.disconnect();
        window.removeEventListener('resize', handleResize);
        controls.removeEventListener('start', onControlsStart);
        renderer.domElement.removeEventListener('pointermove', onPointerMove);
        renderer.domElement.removeEventListener('pointerdown', onPointerDown);
        renderer.domElement.removeEventListener('pointerup', onPointerUp);
        renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
        controls.dispose();

        engine.assemblies.forEach((asm) => {
          asm.petals.forEach((p) => {
            p.mesh.geometry.dispose();
            p.mesh.dispose();
          });
          asm.hitProxy.geometry.dispose();
          (asm.hitProxy.material as THREE.Material).dispose();
          asm.stamenGroup.traverse((obj) => {
            if (obj instanceof THREE.Mesh) {
              obj.geometry.dispose();
              if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
              else obj.material.dispose();
            }
          });
        });

        engine.tileGeo.dispose();
        engine.tileMat?.dispose();
        engine.propsBuild?.dispose();
        contactGeo.dispose();
        contactMat.dispose();
        contactTex.dispose();
        ringGeo.dispose();
        ringMat.dispose();
        starGeo.dispose();
        starMat.dispose();
        starSpriteTex.dispose();
        if (engine.recording?.active) {
          engine.recording.active = false;
          engine.recording.stream.getTracks().forEach((tr) => tr.stop());
          if (engine.recording.recorder.state !== 'inactive') {
            try {
              engine.recording.recorder.stop();
            } catch {
              // ignore on unmount
            }
          }
        }
        sparkleGeo.dispose();
        sparkleMat.dispose();
        crossStarTex.dispose();
        scatteredGeo.dispose();
        scatteredMat.dispose();
        shootingGeo.dispose();
        shootingStars.forEach((s) => s.mat.dispose());
        moonGeo.dispose();
        moonMat.dispose();
        moonHaloMat.dispose();
        moonSurfaceTex.dispose();
        moonHaloTex.dispose();
        fallingGeo.dispose();
        fallingMat.dispose();
        fallingTex.dispose();
        fallingPetalsMesh.dispose();
        curtainSystem.dispose();
        envTex.dispose();
        renderer.dispose();

        if (renderer.domElement.parentNode === container) {
          container.removeChild(renderer.domElement);
        }
        engineRef.current = null;
      };
    }, []);

    useEffect(() => {
      const eng = engineRef.current;
      if (!eng || !atlas) return;
      eng.rebuildBouquet(atlas, flowers, photos, animationConfig.pixelSize);
    }, [atlas, flowers, photos, animationConfig.pixelSize]);

    useEffect(() => {
      const eng = engineRef.current;
      if (!eng) return;
      eng.rebuildProps(flowers, wrapConfig, ribbonText, recipientName);
    }, [flowers, wrapConfig, ribbonText, recipientName]);

    useEffect(() => {
      const eng = engineRef.current;
      if (!eng) return;

      // Sync Scene Theme & Lighting
      const bgHex = themeConfig?.backgroundColor || '#000000';
      const lightMult = THREE.MathUtils.clamp(themeConfig?.lightingIntensity ?? 1.0, 0.35, 1.85);
      eng.scene.background = new THREE.Color(bgHex);
      if (eng.scene.fog instanceof THREE.FogExp2) {
        eng.scene.fog.color.set(bgHex);
      }
      eng.scene.environmentIntensity = 0.78 * lightMult;
      eng.hemiLight.intensity = 0.98 * lightMult;
      eng.keyLight.intensity = 2.5 * lightMult;
      eng.rimLight.intensity = 1.68 * lightMult;
      eng.fillLight.intensity = 0.82 * lightMult;
      eng.coreGlowLight.intensity = 1.9 * lightMult;
    }, [themeConfig?.backgroundColor, themeConfig?.lightingIntensity]);

    useEffect(() => {
      const eng = engineRef.current;
      if (!eng) return;

      eng.orbitRing.visible = animationConfig.showOrbitRing;
      eng.fallingPetalsMesh.visible = effectiveShowPetals;
      eng.fallingPetalsMesh.count = Math.max(
        0,
        Math.min(MAX_FALLING_PETALS, animationConfig.fallingPetalsCount),
      );

      // Sync night sky starfield & re-distribute smoothly if distribution/color changed
      const starSig = `${animationConfig.starDistribution ?? 'spherical'}:${animationConfig.starColor || '#ffffff'}`;
      if (starSig !== eng.lastStarSig) {
        eng.lastStarSig = starSig;
        populateStarBuffers(
          eng.starPosAttr.array as Float32Array,
          eng.starColAttr.array as Float32Array,
          eng.starScaleAttr.array as Float32Array,
          eng.starPhaseAttr.array as Float32Array,
          eng.starTwinkleAttr.array as Float32Array,
          animationConfig.starDistribution ?? 'spherical',
          animationConfig.starColor || '#ffffff',
        );
        eng.starPosAttr.needsUpdate = true;
        eng.starColAttr.needsUpdate = true;
        eng.starScaleAttr.needsUpdate = true;
        eng.starPhaseAttr.needsUpdate = true;
        eng.starTwinkleAttr.needsUpdate = true;
        eng.sparkleMat.color
          .set(animationConfig.starColor || '#ffffff')
          .lerp(new THREE.Color('#ffd7ee'), 0.55);

        populateScatteredStarBuffers(
          eng.scatteredPosAttr.array as Float32Array,
          eng.scatteredColAttr.array as Float32Array,
          eng.scatteredScaleAttr.array as Float32Array,
          eng.scatteredSeedAttr.array as Float32Array,
          animationConfig.starColor || '#ffffff',
        );
        eng.scatteredPosAttr.needsUpdate = true;
        eng.scatteredColAttr.needsUpdate = true;
        eng.scatteredScaleAttr.needsUpdate = true;
        eng.scatteredSeedAttr.needsUpdate = true;
      }

      eng.starField.visible = effectiveShowStars;
      eng.crossSparkles.visible = effectiveShowStars;
      const showScattered = effectiveShowStars && (animationConfig.showScatteredStars ?? true);
      eng.scatteredStars.visible = showScattered;
      eng.shootingGroup.visible = showScattered;
      eng.scatteredGeo.setDrawRange(
        0,
        Math.max(40, Math.min(MAX_SCATTERED_STARS, animationConfig.scatteredStarsDensity ?? 320)),
      );
      eng.scatteredUniforms.uBrightness.value = animationConfig.starBrightness ?? 0.9;
      eng.scatteredUniforms.uAnimSpeed.value = animationConfig.starAnimationSpeed ?? 0.85;

      eng.starGeo.setDrawRange(
        0,
        Math.max(60, Math.min(MAX_STARS, animationConfig.starDensity ?? 760)),
      );
      eng.starUniforms.uStarSize.value = animationConfig.starSize ?? 1.0;
      eng.starUniforms.uTwinkleIntensity.value = animationConfig.starTwinkleIntensity ?? 0.48;
      eng.starUniforms.uBrightness.value = animationConfig.starBrightness ?? 0.9;
      eng.starUniforms.uAnimSpeed.value = animationConfig.starAnimationSpeed ?? 0.85;
      eng.sparkleMat.opacity = 0.52 * (animationConfig.starBrightness ?? 0.9);

      // Sync Moon
      eng.moonGroup.visible = effectiveShowMoon;
      eng.moonGroup.scale.setScalar(animationConfig.moonSize ?? 1.18);
      eng.moonGroup.position.x = animationConfig.moonPositionX ?? -2.5;
      eng.moonGroup.position.y = animationConfig.moonPositionY ?? 5.1;
      eng.moonUniforms.uOpacity.value = animationConfig.moonOpacity ?? 0.94;
      eng.moonUniforms.uGlowIntensity.value = animationConfig.moonGlowIntensity ?? 0.78;
      eng.moonUniforms.uStyle.value = moonStyleToIndex(animationConfig.moonStyle);
      eng.moonUniforms.uColor.value.set(animationConfig.moonColor || '#f7f2fa');
      eng.moonHaloMat.color.set(animationConfig.moonColor || '#f7f2fa');
      eng.moonUniforms.uBrightness.value = animationConfig.moonBrightness ?? 0.96;
      eng.moonUniforms.uShowTexture.value = animationConfig.moonShowTexture !== false ? 1.0 : 0.0;
    }, [
      animationConfig.showOrbitRing,
      animationConfig.fallingPetalsCount,
      animationConfig.starDensity,
      animationConfig.starSize,
      animationConfig.starTwinkleIntensity,
      animationConfig.starBrightness,
      animationConfig.starAnimationSpeed,
      animationConfig.starColor,
      animationConfig.starDistribution,
      animationConfig.showScatteredStars,
      animationConfig.scatteredStarsDensity,
      animationConfig.moonSize,
      animationConfig.moonPositionX,
      animationConfig.moonPositionY,
      animationConfig.moonGlowIntensity,
      animationConfig.moonOpacity,
      animationConfig.moonStyle,
      animationConfig.moonColor,
      animationConfig.moonBrightness,
      animationConfig.moonShowTexture,
      effectiveShowStars,
      effectiveShowMoon,
      effectiveShowPetals,
    ]);

    return (
      <div
        ref={mountRef}
        className="w-full h-full cursor-grab active:cursor-grabbing select-none"
        aria-label="Interactive 3D Pixel Flower Bouquet Canvas"
      />
    );
  },
);
