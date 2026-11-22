import type * as THREE from 'three';

export type PixelSizeMode = 'small' | 'medium' | 'large';

export type LilyColorKind = 'pink' | 'white' | 'red' | 'lavender' | 'peach';

export type WrapThemeId = 'frosted-pink' | 'obsidian-plum' | 'champagne-ivory' | 'midnight-violet';

export type MoonStyle = 'full' | 'crescent' | 'soft-blush';

export type StarDistributionMode = 'spherical' | 'sky-dome' | 'clustered';

export type ThemePresetId =
  | 'romantic-pink'
  | 'white-lily'
  | 'purple-dream'
  | 'midnight-blue'
  | 'red-rose';

export interface UploadedPhoto {
  id: string;
  name: string;
  caption?: string;
  /** Intact, full-resolution, uncropped URL */
  originalUrl: string;
  /** Preview URL for admin gallery cards */
  previewUrl: string;
  width: number;
  height: number;
  fileSize?: number;
  isStarter?: boolean;
  /** 'all' or specific flower IDs this photo should appear on */
  assignedFlowerIds?: string[] | 'all';
}

export interface TileSlotMeta {
  slotIndex: number;
  photoId: string;
  photoName: string;
  uvRect: [number, number, number, number];
}

export interface ProcessedAtlasResult {
  atlasTexture: THREE.CanvasTexture;
  slots: TileSlotMeta[];
  sourcePhotoCount: number;
  isStarterSet: boolean;
}

export interface FlowerConfig {
  id: string;
  label: string;
  colorKind: LilyColorKind;
  isBud: boolean;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: number;
  bloomDelay: number;
  bloomIntensity?: number;
  swayIntensity?: number;
}

export interface WrapRibbonConfig {
  wrapTheme: WrapThemeId;
  wrapColor: string;
  wrapInnerColor: string;
  wrapOpacity: number;
  ribbonColor: string;
  bowScale: number;
  ribbonPositionX: number;
  ribbonPositionY: number;
  ribbonPositionZ: number;
  ribbonForwardOffset: number;
  ribbonLoopSize: number;
  ribbonTailLength: number;
  ribbonThickness: number;
  ribbonRoughness: number;
  ribbonSheen: number;
  showGiftTag: boolean;
  tagWidth: number;
  tagHeight: number;
  tagThickness: number;
  tagColor: string;
  tagTextColor: string;
  tagBrightness: number;
  tagRoughness: number;
  tagPositionX: number;
  tagPositionY: number;
  tagPositionZ: number;
  tagRotationZ: number;
  tagSwingIntensity: number;
  tagText: string;
  tagMessage?: string;
}

export interface PersonalizationData {
  recipientName: string;
  senderName: string;
  romanticMessage: string;
  specialDate: string;
  ribbonText: string;
  terminalTitle: string;
  loveLines: string[];
  footerBadge: string;
  cardBgOpacity?: number;
  cardBorderColor?: string;
  cardTextColor?: string;
  cardTextSize?: 'sm' | 'md' | 'lg';
}

export interface ThemeConfig {
  preset: ThemePresetId;
  backgroundColor: string;
  lightingIntensity: number;
}

export interface SharingConfig {
  slug: string;
  isPublished: boolean;
  expiresAt: string;
}

export interface AnimationConfig {
  pixelSize: PixelSizeMode;
  photoVividness: number;
  autoRotate: boolean;
  rotationSpeed: number;
  bloomSpeed: number;
  fallingPetalsCount: number;
  showOrbitRing: boolean;
  showStars: boolean;
  starDensity: number;
  starSize: number;
  starTwinkleIntensity: number;
  starBrightness: number;
  starAnimationSpeed: number;
  starColor: string;
  starDistribution: StarDistributionMode;
  showScatteredStars?: boolean;
  scatteredStarsDensity?: number;
  showMoon: boolean;
  moonSize: number;
  moonPositionX: number;
  moonPositionY: number;
  moonGlowIntensity: number;
  moonOpacity: number;
  moonStyle: MoonStyle;
  moonColor: string;
  moonBrightness: number;
  moonShowTexture: boolean;
  entranceEnabled: boolean;
  entranceDuration: number;
  stemStageWeight: number;
  flowerStageWeight: number;
  wrapStageWeight: number;
  ribbonStageWeight: number;
  cameraEntranceIntensity: number;
  allowSkipIntro: boolean;
}

export interface MusicConfig {
  mode: 'builtin' | 'uploaded';
  builtinTrackIndex: number;
  uploadedAudioUrl: string;
  uploadedAudioName: string;
  defaultVolume: number;
  autoPlayOnInteract: boolean;
}

export type PinWrongAnimStyle = 'wiggle-bloom' | 'bounce-blush' | 'spin-shy' | 'peek-petal';

export type CurtainEasingMode = 'ease-out-cubic' | 'ease-in-out-sine' | 'silk-dramatic';

export interface LockScreenUiConfig {
  heading: string;
  description: string;
  backgroundColor: string;
  accentColor: string;
  inputBorderColor: string;
  textColor: string;
  secondaryTextColor: string;
  fontFamily: 'editorial' | 'mono' | 'modern';
  inputSize: 'sm' | 'md' | 'lg';
  inputSpacing: 'tight' | 'normal' | 'wide';
  showMoon: boolean;
  showStars: boolean;
  petalDensity: number;
  showFloralDecor: boolean;
  animationIntensity: number;
  autoSubmit: boolean;
  showUnlockButton: boolean;
  maskInput: boolean;
}

export interface PinFailureAnimConfig {
  message: string;
  customMessages: string[];
  style: PinWrongAnimStyle;
  shakeIntensity: number;
  showTeasingFlower: boolean;
  teasingFlowerSize: number;
  durationMs: number;
  playSound: boolean;
  showParticles: boolean;
}

export interface FlowerCurtainConfig {
  enabled: boolean;
  density: 'light' | 'medium' | 'lush' | 'extravagant';
  flowerCount: number;
  flowerColors: string[];
  minFlowerSize: number;
  maxFlowerSize: number;
  layers: number;
  openingSpeed: number;
  separationDistance: number;
  rotationIntensity: number;
  durationSec: number;
  easing: CurtainEasingMode;
  particleEffects: boolean;
  assembleBouquetAfter: boolean;
}

export interface EntranceSecurityConfig {
  pinEnabled: boolean;
  hasPinConfigured?: boolean;
  maxAttempts: number;
  lockoutMinutes: number;
  sessionDurationMinutes: number;
  fakeFailure: {
    enabled: boolean;
    count: number;
    oncePerVisitorPerBouquet: boolean;
    anim: PinFailureAnimConfig;
  };
  wrongPinAnim: PinFailureAnimConfig;
  lockScreen: LockScreenUiConfig;
  curtain: FlowerCurtainConfig;
}

export interface BouquetSiteConfig {
  version: number;
  updatedAt: string;
  photos: UploadedPhoto[];
  flowers: FlowerConfig[];
  wrap: WrapRibbonConfig;
  text: PersonalizationData;
  animation: AnimationConfig;
  music: MusicConfig;
  theme?: ThemeConfig;
  sharing?: SharingConfig;
  entrance?: EntranceSecurityConfig;
}

export interface BackupEntry {
  id: string;
  createdAt: string;
  note: string;
  config: BouquetSiteConfig;
}

export interface AdminAuthStatus {
  needsSetup: boolean;
  envManaged: boolean;
  authenticated: boolean;
}

export interface AdminBouquetSummary {
  slug: string;
  recipientName: string;
  flowerCount: number;
  photoCount: number;
  pinEnabled: boolean;
  hasPublishedPin: boolean;
  hasDraftPin: boolean;
  isDefault: boolean;
  updatedAt: string;
}

export interface AdminPinStatus {
  hasDraftPin: boolean;
  hasPublishedPin: boolean;
  pinDraftPendingPublish: boolean;
  envPinFallbackActive: boolean;
  fakeFailureVisitorCount: number;
}

export interface PublicEntranceStateResponse {
  slug: string;
  exists: boolean;
  pinRequired: boolean;
  hasPinConfigured: boolean;
  alreadyUnlocked: boolean;
  lockScreen: LockScreenUiConfig;
  curtain: FlowerCurtainConfig;
  skyPreview: {
    backgroundColor: string;
    showStars: boolean;
    showScatteredStars: boolean;
    starColor: string;
    starDensity: number;
    showMoon: boolean;
    moonStyle: MoonStyle;
    moonColor: string;
    moonSize: number;
    moonPositionX: number;
    moonPositionY: number;
    moonGlowIntensity: number;
  };
}

export interface ClickedPixelInfo {
  photoId: string;
  flowerIndex: number;
  flowerId: string;
  flowerLabel: string;
  colorKind: LilyColorKind;
  pixelNumber: number;
  petalNumber: number;
}

export interface SelectedFlowerDetail {
  flowerIndex: number;
  label: string;
  colorKind: LilyColorKind;
  tileCount: number;
}

