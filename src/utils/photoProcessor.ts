import * as THREE from 'three';
import type { ProcessedAtlasResult, TileSlotMeta, UploadedPhoto } from '../types/bouquet';

export interface LoadedImageSource {
  photo: UploadedPhoto;
  sourceDrawable: HTMLImageElement | HTMLCanvasElement;
}

const ATLAS_GRID = 16; // 16 x 16 = 256 atlas tile slots
const TOTAL_ATLAS_SLOTS = ATLAS_GRID * ATLAS_GRID;

export function createStarterPhotoSources(): LoadedImageSource[] {
  const presets: Array<{
    name: string;
    w: number;
    h: number;
    bgA: string;
    bgB: string;
    skin: string;
    hair: string;
    accent: string;
    pose: number;
  }> = [
    { name: 'Golden Hour Portrait', w: 900, h: 1125, bgA: '#3b1526', bgB: '#e11d48', skin: '#f2c1a4', hair: '#23141b', accent: '#fda4af', pose: 0 },
    { name: 'Rose Garden Smile', w: 1200, h: 900, bgA: '#1d1024', bgB: '#db2777', skin: '#e8b498', hair: '#311a1e', accent: '#fbcfe8', pose: 1 },
    { name: 'Evening Candlelight', w: 1000, h: 1000, bgA: '#180d14', bgB: '#be185d', skin: '#f6ceb6', hair: '#1c1218', accent: '#fde68a', pose: 2 },
    { name: 'Velvet Twilight', w: 900, h: 1200, bgA: '#1f1035', bgB: '#9333ea', skin: '#dca587', hair: '#150e1c', accent: '#f5d0fe', pose: 3 },
    { name: 'Blush Silk Memory', w: 1200, h: 850, bgA: '#381326', bgB: '#f43f5e', skin: '#f3c5ab', hair: '#4a2520', accent: '#ffe4e6', pose: 4 },
    { name: 'Morning Window Light', w: 960, h: 1140, bgA: '#28182e', bgB: '#f472b6', skin: '#f8d5c2', hair: '#2a1c21', accent: '#fef3c7', pose: 5 },
    { name: 'Crimson Velvet Gaze', w: 1024, h: 1024, bgA: '#240b14', bgB: '#9f1239', skin: '#e3ac8e', hair: '#190f13', accent: '#fda4af', pose: 0 },
    { name: 'Starlight Keepsake', w: 1150, h: 900, bgA: '#110b22', bgB: '#7e22ce', skin: '#f0bfa2', hair: '#201326', accent: '#e9d5ff', pose: 1 },
    { name: 'Ivory Lace Portrait', w: 900, h: 1125, bgA: '#2f1924', bgB: '#ec4899', skin: '#f9d7c6', hair: '#3b2422', accent: '#fff1f2', pose: 2 },
    { name: 'Warm Sunset Silhouette', w: 1200, h: 920, bgA: '#2b0f1b', bgB: '#fb7185', skin: '#d89b7c', hair: '#160d12', accent: '#fed7aa', pose: 3 },
    { name: 'Amethyst Dream', w: 1000, h: 1000, bgA: '#1a0f2b', bgB: '#a855f7', skin: '#edc0a7', hair: '#241428', accent: '#fbcfe8', pose: 4 },
    { name: 'First Dance Glow', w: 920, h: 1150, bgA: '#33121e', bgB: '#f43f5e', skin: '#f4c7ae', hair: '#29171a', accent: '#fef08a', pose: 5 },
  ];

  return presets.map((preset, idx) => {
    const canvas = document.createElement('canvas');
    canvas.width = preset.w;
    canvas.height = preset.h;
    const ctx = canvas.getContext('2d')!;

    const bgGrad = ctx.createLinearGradient(0, 0, preset.w, preset.h);
    bgGrad.addColorStop(0, preset.bgA);
    bgGrad.addColorStop(0.65, preset.bgB);
    bgGrad.addColorStop(1, '#120814');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, preset.w, preset.h);

    for (let b = 0; b < 18; b++) {
      const seed = (idx * 31 + b * 17) % 97;
      const bx = (seed * 83) % preset.w;
      const by = (seed * 127) % preset.h;
      const br = 40 + (seed % 90);
      const orb = ctx.createRadialGradient(bx, by, 4, bx, by, br);
      orb.addColorStop(0, preset.accent + '66');
      orb.addColorStop(0.5, preset.accent + '22');
      orb.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = orb;
      ctx.beginPath();
      ctx.arc(bx, by, br, 0, Math.PI * 2);
      ctx.fill();
    }

    const cx = preset.w * (0.48 + ((preset.pose % 3) - 1) * 0.06);
    const cy = preset.h * 0.42;
    const unit = Math.min(preset.w, preset.h);

    const halo = ctx.createRadialGradient(cx, cy, unit * 0.05, cx, cy, unit * 0.42);
    halo.addColorStop(0, preset.accent + '88');
    halo.addColorStop(0.5, preset.bgB + '33');
    halo.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(cx, cy, unit * 0.42, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = preset.hair;
    ctx.beginPath();
    ctx.ellipse(cx, cy + unit * 0.03, unit * 0.21, unit * 0.27, 0, 0, Math.PI * 2);
    ctx.fill();

    const dressGrad = ctx.createLinearGradient(cx - unit * 0.25, cy + unit * 0.2, cx + unit * 0.25, preset.h);
    dressGrad.addColorStop(0, preset.accent);
    dressGrad.addColorStop(1, preset.bgA);
    ctx.fillStyle = dressGrad;
    ctx.beginPath();
    ctx.ellipse(cx, preset.h * 0.94, unit * 0.34, preset.h * 0.28, 0, Math.PI, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = preset.skin;
    ctx.fillRect(cx - unit * 0.05, cy + unit * 0.13, unit * 0.1, unit * 0.15);

    const faceGrad = ctx.createRadialGradient(cx - unit * 0.03, cy - unit * 0.03, unit * 0.02, cx, cy, unit * 0.19);
    faceGrad.addColorStop(0, '#fff2eb');
    faceGrad.addColorStop(0.45, preset.skin);
    faceGrad.addColorStop(1, '#b87b63');
    ctx.fillStyle = faceGrad;
    ctx.beginPath();
    ctx.ellipse(cx, cy, unit * 0.145, unit * 0.185, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(244, 114, 182, 0.25)';
    ctx.beginPath();
    ctx.ellipse(cx - unit * 0.065, cy + unit * 0.03, unit * 0.035, unit * 0.02, 0, 0, Math.PI * 2);
    ctx.ellipse(cx + unit * 0.065, cy + unit * 0.03, unit * 0.035, unit * 0.02, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#2a161b';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(cx - unit * 0.05, cy - unit * 0.015, unit * 0.022, Math.PI * 1.12, Math.PI * 1.88);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx + unit * 0.05, cy - unit * 0.015, unit * 0.022, Math.PI * 1.12, Math.PI * 1.88);
    ctx.stroke();

    ctx.fillStyle = '#be185d';
    ctx.beginPath();
    ctx.ellipse(cx, cy + unit * 0.075, unit * 0.03, unit * 0.012, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = preset.hair;
    ctx.beginPath();
    ctx.arc(cx, cy - unit * 0.068, unit * 0.16, Math.PI * 0.96, Math.PI * 2.04);
    ctx.fill();

    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    for (let s = 0; s < 16; s++) {
      const sx = ((s * 173 + idx * 59) % (preset.w - 40)) + 20;
      const sy = ((s * 211 + idx * 83) % (preset.h - 40)) + 20;
      ctx.fillRect(sx, sy, 4, 4);
    }

    const originalUrl = canvas.toDataURL('image/jpeg', 0.92);
    return {
      photo: {
        id: `starter-${idx}`,
        name: preset.name,
        originalUrl,
        previewUrl: originalUrl,
        width: preset.w,
        height: preset.h,
        isStarter: true,
        assignedFlowerIds: 'all',
      },
      sourceDrawable: canvas,
    };
  });
}

/**
 * Loads an intact server-stored UploadedPhoto into a drawable image for GPU mosaic sampling.
 */
export async function loadImageSourceFromPhoto(
  photo: UploadedPhoto,
): Promise<LoadedImageSource | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      resolve({
        photo: {
          ...photo,
          width: img.naturalWidth || photo.width,
          height: img.naturalHeight || photo.height,
        },
        sourceDrawable: img,
      });
    };
    img.onerror = () => resolve(null);
    img.src = photo.originalUrl;
  });
}

/**
 * Reads natural dimensions of a File before uploading its intact binary to the backend.
 */
export async function readImageFileDimensions(
  file: File,
): Promise<{ width: number; height: number }> {
  const url = URL.createObjectURL(file);
  try {
    const dims = await new Promise<{ width: number; height: number }>((resolve, reject) => {
      const img = new Image();
      img.onload = () =>
        resolve({
          width: img.naturalWidth || img.width || 1024,
          height: img.naturalHeight || img.height || 1024,
        });
      img.onerror = () => reject(new Error(`Invalid image file: ${file.name}`));
      img.src = url;
    });
    return dims;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export interface PreparedUploadImage {
  buffer: ArrayBuffer;
  width: number;
  height: number;
  type: string;
  name: string;
}

/**
 * Prepares an image for upload by checking dimensions and file size.
 * If file size exceeds 2.5MB or max dimension exceeds 2048, it scales and compresses
 * using canvas to guarantee smooth upload without hitting Vercel serverless 4.5MB payload limit.
 */
export async function prepareImageForUpload(
  file: File,
  maxDimension = 2048,
  maxSizeBytes = 2.5 * 1024 * 1024,
): Promise<PreparedUploadImage> {
  const url = URL.createObjectURL(file);
  try {
    const { img, width, height } = await new Promise<{
      img: HTMLImageElement;
      width: number;
      height: number;
    }>((resolve, reject) => {
      const el = new Image();
      el.onload = () =>
        resolve({
          img: el,
          width: el.naturalWidth || el.width || 1024,
          height: el.naturalHeight || el.height || 1024,
        });
      el.onerror = () => reject(new Error(`Invalid image file: ${file.name}`));
      el.src = url;
    });

    const isLargeSize = file.size > maxSizeBytes;
    const isLargeDim = Math.max(width, height) > maxDimension;

    if (!isLargeSize && !isLargeDim) {
      const buffer = await file.arrayBuffer();
      return {
        buffer,
        width,
        height,
        type: file.type || 'image/jpeg',
        name: file.name,
      };
    }

    let targetWidth = width;
    let targetHeight = height;
    if (isLargeDim) {
      const ratio = Math.min(maxDimension / width, maxDimension / height);
      targetWidth = Math.max(1, Math.round(width * ratio));
      targetHeight = Math.max(1, Math.round(height * ratio));
    }

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      const buffer = await file.arrayBuffer();
      return { buffer, width, height, type: file.type || 'image/jpeg', name: file.name };
    }

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.88),
    );

    if (!blob) {
      const buffer = await file.arrayBuffer();
      return { buffer, width, height, type: file.type || 'image/jpeg', name: file.name };
    }

    const buffer = await blob.arrayBuffer();
    const cleanName = file.name.replace(/\.[^/.]+$/, '') + '.jpg';
    return {
      buffer,
      width: targetWidth,
      height: targetHeight,
      type: 'image/jpeg',
      name: cleanName,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function buildPhotoTileAtlas(
  sources: LoadedImageSource[],
  maxTextureSize = 2048,
  maxAnisotropy = 4,
): ProcessedAtlasResult {
  const safeSources = sources.length > 0 ? sources : createStarterPhotoSources();
  const isStarterSet = safeSources.every((s) => s.photo.isStarter);

  const atlasSize = maxTextureSize >= 2048 ? 2048 : 1024;
  const slotSize = atlasSize / ATLAS_GRID;
  const gutter = 2;

  const atlasCanvas = document.createElement('canvas');
  atlasCanvas.width = atlasSize;
  atlasCanvas.height = atlasSize;
  const ctx = atlasCanvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const photoCount = safeSources.length;
  const cropsPerPhoto = Math.max(4, Math.ceil(TOTAL_ATLAS_SLOTS / photoCount));

  interface AtlasSampleJob {
    source: LoadedImageSource;
    sx: number;
    sy: number;
    sw: number;
    sh: number;
  }

  const jobs: AtlasSampleJob[] = [];

  for (let pIdx = 0; pIdx < photoCount; pIdx++) {
    const src = safeSources[pIdx];
    const w = src.photo.width;
    const h = src.photo.height;
    const minDim = Math.min(w, h);

    jobs.push({
      source: src,
      sx: (w - minDim) * 0.5,
      sy: (h - minDim) * 0.5,
      sw: minDim,
      sh: minDim,
    });

    const gridDim = Math.max(2, Math.ceil(Math.sqrt(cropsPerPhoto)));
    for (let gy = 0; gy < gridDim; gy++) {
      for (let gx = 0; gx < gridDim; gx++) {
        const cx = ((gx + 0.5) / gridDim) * w;
        const cy = ((gy + 0.5) / gridDim) * h;
        const span = Math.min(minDim * 0.78, Math.max(minDim * 0.28, minDim / gridDim));
        const sx = Math.max(0, Math.min(w - span, cx - span * 0.5));
        const sy = Math.max(0, Math.min(h - span, cy - span * 0.5));
        jobs.push({ source: src, sx, sy, sw: span, sh: span });
      }
    }
  }

  const interleaved: AtlasSampleJob[] = [];
  const buckets = new Map<string, AtlasSampleJob[]>();
  for (const job of jobs) {
    const list = buckets.get(job.source.photo.id) ?? [];
    list.push(job);
    buckets.set(job.source.photo.id, list);
  }
  const bucketArrays = Array.from(buckets.values());
  let round = 0;
  while (interleaved.length < TOTAL_ATLAS_SLOTS) {
    let added = false;
    for (const arr of bucketArrays) {
      if (arr.length > 0) {
        interleaved.push(arr[round % arr.length]);
        added = true;
        if (interleaved.length >= TOTAL_ATLAS_SLOTS) break;
      }
    }
    if (!added) break;
    round++;
  }

  const slots: TileSlotMeta[] = [];

  for (let i = 0; i < TOTAL_ATLAS_SLOTS; i++) {
    const job = interleaved[i % interleaved.length];
    const col = i % ATLAS_GRID;
    const row = Math.floor(i / ATLAS_GRID);

    const dx = col * slotSize;
    const dy = row * slotSize;

    ctx.drawImage(
      job.source.sourceDrawable,
      job.sx,
      job.sy,
      job.sw,
      job.sh,
      dx,
      dy,
      slotSize,
      slotSize,
    );
    ctx.drawImage(
      job.source.sourceDrawable,
      job.sx,
      job.sy,
      job.sw,
      job.sh,
      dx + gutter,
      dy + gutter,
      slotSize - gutter * 2,
      slotSize - gutter * 2,
    );

    const u0 = (dx + gutter) / atlasSize;
    const v0 = 1.0 - (dy + slotSize - gutter) / atlasSize;
    const uSize = (slotSize - gutter * 2) / atlasSize;
    const vSize = (slotSize - gutter * 2) / atlasSize;

    slots.push({
      slotIndex: i,
      photoId: job.source.photo.id,
      photoName: job.source.photo.name,
      uvRect: [u0, v0, uSize, vSize],
    });
  }

  const atlasTexture = new THREE.CanvasTexture(atlasCanvas);
  atlasTexture.colorSpace = THREE.SRGBColorSpace;
  atlasTexture.anisotropy = Math.min(8, maxAnisotropy);
  atlasTexture.minFilter = THREE.LinearMipmapLinearFilter;
  atlasTexture.magFilter = THREE.LinearFilter;
  atlasTexture.wrapS = THREE.ClampToEdgeWrapping;
  atlasTexture.wrapT = THREE.ClampToEdgeWrapping;
  atlasTexture.needsUpdate = true;

  return {
    atlasTexture,
    slots,
    sourcePhotoCount: photoCount,
    isStarterSet,
  };
}
