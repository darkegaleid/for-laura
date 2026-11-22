import * as THREE from 'three';
import type { FlowerConfig, WrapRibbonConfig } from '../types/bouquet';

export interface StemItem {
  group: THREE.Group;
  entryOffset: THREE.Vector3;
  entryTilt: THREE.Euler;
  delayFactor: number;
}

export interface LeafItem {
  mesh: THREE.Mesh;
  targetPos: THREE.Vector3;
  targetRot: THREE.Euler;
  targetScale: number;
  radialDir: THREE.Vector3;
  delayFactor: number;
}

export interface BouquetPropsBuild {
  group: THREE.Group;
  stemItems: StemItem[];
  leafItems: LeafItem[];
  fillerMesh: THREE.InstancedMesh;
  outerWrap: THREE.Mesh;
  innerWrap: THREE.Mesh;
  waistSash: THREE.Mesh;
  bowGroup: THREE.Group;
  bowAnchorPos: THREE.Vector3;
  bowTargetScale: number;
  bowKnot: THREE.Mesh;
  knotWrap: THREE.Mesh;
  leftLoop: THREE.Mesh | null;
  rightLoop: THREE.Mesh | null;
  leftTail: THREE.Mesh | null;
  rightTail: THREE.Mesh | null;
  tagPivot: THREE.Group | null;
  tagHitTargets: THREE.Object3D[];
  tagBasePos: THREE.Vector3;
  tagBaseRot: THREE.Euler;
  tagSwingIntensity: number;
  dispose: () => void;
}

const OUTER_WRAP_SPEC = {
  rBottom: 0.28,
  rTop: 1.88,
  yBottom: -2.05,
  yTop: 1.24,
  pleatCount: 18,
  pleatAmp: 0.075,
};

const INNER_WRAP_SPEC = {
  rBottom: 0.25,
  rTop: 1.76,
  yBottom: -1.94,
  yTop: 1.42,
  pleatCount: 14,
  pleatAmp: 0.075,
};

function getWrapOuterEnvelopeRadius(y: number): number {
  const tO = THREE.MathUtils.clamp(
    (y - OUTER_WRAP_SPEC.yBottom) / (OUTER_WRAP_SPEC.yTop - OUTER_WRAP_SPEC.yBottom),
    0,
    1,
  );
  const dipO = Math.exp(-Math.pow((tO - 0.42) / 0.16, 2)) * 0.24;
  const baseO =
    THREE.MathUtils.lerp(OUTER_WRAP_SPEC.rBottom, OUTER_WRAP_SPEC.rTop, Math.pow(tO, 1.15)) *
    (1 - dipO);
  const pleatO = OUTER_WRAP_SPEC.pleatAmp * Math.pow(tO, 1.45);

  const tI = THREE.MathUtils.clamp(
    (y - INNER_WRAP_SPEC.yBottom) / (INNER_WRAP_SPEC.yTop - INNER_WRAP_SPEC.yBottom),
    0,
    1,
  );
  const dipI = Math.exp(-Math.pow((tI - 0.42) / 0.16, 2)) * 0.24;
  const baseI =
    THREE.MathUtils.lerp(INNER_WRAP_SPEC.rBottom, INNER_WRAP_SPEC.rTop, Math.pow(tI, 1.15)) *
    (1 - dipI);
  const pleatI = INNER_WRAP_SPEC.pleatAmp * Math.pow(tI, 1.45);

  return Math.max(baseO + pleatO, baseI + pleatI);
}

function createPixelGridMaterialTexture(
  palette: string[],
  cols: number,
  rows: number,
  maxAnisotropy: number,
): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const ctx = c.getContext('2d')!;

  const cellW = c.width / cols;
  const cellH = c.height / rows;

  ctx.fillStyle = '#140818';
  ctx.fillRect(0, 0, c.width, c.height);

  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols; col++) {
      const idx = Math.abs(Math.floor(Math.sin(r * 19.3 + col * 37.7) * 100)) % palette.length;
      ctx.fillStyle = palette[idx];
      ctx.fillRect(col * cellW + 0.8, r * cellH + 0.8, cellW - 1.6, cellH - 1.6);
    }
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = Math.min(8, maxAnisotropy);
  tex.needsUpdate = true;
  return tex;
}

function createSatinRibbonTexture(
  ribbonHex: string,
  maxAnisotropy: number,
): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const ctx = c.getContext('2d')!;

  const baseCol = new THREE.Color(ribbonHex || '#f48fb1');
  const shadowCol = baseCol.clone().multiplyScalar(0.84).getStyle();
  const midCol = baseCol.getStyle();
  const highlightCol = baseCol.clone().lerp(new THREE.Color('#ffffff'), 0.24).getStyle();

  const grad = ctx.createLinearGradient(0, 0, c.width, 0);
  grad.addColorStop(0, shadowCol);
  grad.addColorStop(0.18, midCol);
  grad.addColorStop(0.5, highlightCol);
  grad.addColorStop(0.82, midCol);
  grad.addColorStop(1, shadowCol);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, c.width, c.height);

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 1;
  for (let y = 0; y < c.height; y += 6) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(c.width, y);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(90, 20, 50, 0.06)';
  for (let x = 0; x < c.width; x += 8) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, c.height);
    ctx.stroke();
  }

  ctx.fillStyle = 'rgba(255, 245, 250, 0.22)';
  ctx.fillRect(8, 0, 4, c.height);
  ctx.fillRect(c.width - 12, 0, 4, c.height);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = Math.min(8, maxAnisotropy);
  tex.needsUpdate = true;
  return tex;
}

function createRibbonTextTexture(
  text: string,
  ribbonHex: string,
  maxAnisotropy: number,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 192;
  const ctx = canvas.getContext('2d')!;

  const baseCol = new THREE.Color(ribbonHex || '#f48fb1');
  const darkCol = baseCol.clone().multiplyScalar(0.8).getStyle();
  const midCol = baseCol.getStyle();
  const lightCol = baseCol.clone().lerp(new THREE.Color('#ffffff'), 0.26).getStyle();

  const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  grad.addColorStop(0, darkCol);
  grad.addColorStop(0.25, midCol);
  grad.addColorStop(0.5, lightCol);
  grad.addColorStop(0.75, midCol);
  grad.addColorStop(1, darkCol);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.lineWidth = 1;
  for (let y = 0; y < canvas.height; y += 6) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }

  const displayText = text.trim() || 'Every pixel of this flower reminds me of you.';
  ctx.fillStyle = '#fffafb';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  let fontSize = 34;
  ctx.font = `italic 600 ${fontSize}px "Cormorant Garamond", Georgia, serif`;
  while (ctx.measureText(displayText).width > canvas.width - 140 && fontSize > 18) {
    fontSize -= 2;
    ctx.font = `italic 600 ${fontSize}px "Cormorant Garamond", Georgia, serif`;
  }

  ctx.shadowColor = 'rgba(90, 15, 45, 0.45)';
  ctx.shadowBlur = 6;
  ctx.fillText(displayText, canvas.width / 2, canvas.height / 2 + 1);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, maxAnisotropy);
  tex.needsUpdate = true;
  return tex;
}

function createGiftTagTexture(
  recipientName: string,
  tagText: string,
  tagColor: string,
  tagTextColor: string,
  tagBrightness: number,
  maxAnisotropy: number,
): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 320;
  const ctx = c.getContext('2d')!;

  const baseColor = new THREE.Color(tagColor || '#D8C6BD');
  const clampedBrightness = THREE.MathUtils.clamp(tagBrightness ?? 0.82, 0.45, 1.05);
  baseColor.multiplyScalar(clampedBrightness);

  const paperTop = baseColor.clone().multiplyScalar(1.03).getStyle();
  const paperBottom = baseColor.clone().multiplyScalar(0.92).getStyle();
  const bgGrad = ctx.createLinearGradient(0, 0, 0, c.height);
  bgGrad.addColorStop(0, paperTop);
  bgGrad.addColorStop(1, paperBottom);
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, c.width, c.height);

  // Fine matte cardstock paper grain (softened so dark ink text stays crisp)
  ctx.strokeStyle = 'rgba(70, 38, 52, 0.05)';
  ctx.lineWidth = 1;
  for (let x = 0; x < c.width; x += 8) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, c.height);
    ctx.stroke();
  }
  for (let y = 0; y < c.height; y += 8) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(c.width, y);
    ctx.stroke();
  }

  // Muted dusty rose border frame
  ctx.strokeStyle = 'rgba(110, 44, 68, 0.36)';
  ctx.lineWidth = 4;
  ctx.strokeRect(14, 14, c.width - 28, c.height - 28);

  // Brass/muted eyelet near top edge
  ctx.fillStyle = '#78350f';
  ctx.beginPath();
  ctx.arc(c.width / 2, 34, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#181014';
  ctx.beginPath();
  ctx.arc(c.width / 2, 34, 5.5, 0, Math.PI * 2);
  ctx.fill();

  const textCol = tagTextColor || '#111111';
  ctx.fillStyle = textCol;
  ctx.textAlign = 'center';

  const customLine = tagText.trim();
  const fallbackName = recipientName.trim() ? recipientName.trim() : 'You';

  if (customLine) {
    const words = customLine.split(/\s+/);
    let line1 = customLine;
    let line2 = '';
    if (words.length >= 2 && customLine.length > 9) {
      const mid = Math.ceil(words.length / 2);
      line1 = words.slice(0, mid).join(' ');
      line2 = words.slice(mid).join(' ');
    }

    let fontSize = line2 ? 42 : 46;
    ctx.font = `italic 700 ${fontSize}px "Cormorant Garamond", Georgia, serif`;
    while (
      (ctx.measureText(line1).width > c.width - 48 ||
        (line2 && ctx.measureText(line2).width > c.width - 48)) &&
      fontSize > 22
    ) {
      fontSize -= 2;
      ctx.font = `italic 700 ${fontSize}px "Cormorant Garamond", Georgia, serif`;
    }

    if (line2) {
      ctx.fillText(line1, c.width / 2, 148);
      ctx.fillText(line1, c.width / 2, 148);
      ctx.fillText(line2, c.width / 2, 206);
      ctx.fillText(line2, c.width / 2, 206);
    } else {
      ctx.fillText(line1, c.width / 2, 174);
      ctx.fillText(line1, c.width / 2, 174);
    }

    ctx.fillStyle = '#881337';
    ctx.font = '700 32px Georgia, serif';
    ctx.fillText('♥', c.width / 2, 256);
  } else {
    ctx.font = 'italic 700 50px "Cormorant Garamond", Georgia, serif';
    ctx.fillText('For', c.width / 2, 138);
    ctx.fillText('For', c.width / 2, 138);

    let nameSize = 46;
    ctx.font = `italic 700 ${nameSize}px "Cormorant Garamond", Georgia, serif`;
    while (ctx.measureText(`${fallbackName} ♥`).width > c.width - 48 && nameSize > 22) {
      nameSize -= 2;
      ctx.font = `italic 700 ${nameSize}px "Cormorant Garamond", Georgia, serif`;
    }
    ctx.fillText(fallbackName, c.width / 2 - 14, 204);
    ctx.fillText(fallbackName, c.width / 2 - 14, 204);

    ctx.fillStyle = '#881337';
    ctx.font = '700 36px Georgia, serif';
    ctx.fillText(
      '♥',
      c.width / 2 + Math.min(58, ctx.measureText(fallbackName).width * 0.55 + 16),
      206,
    );
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, maxAnisotropy);
  tex.needsUpdate = true;
  return tex;
}

/**
 * Builds a thick extruded cardstock gift tag with softly rounded corners & physical bevels,
 * normalizing cap UVs to [0,1] so the texture fits crisply on both faces while the extruded
 * side walls render in solid matching matte cardstock.
 */
function createBeveledCardstockTagGeometry(
  width: number,
  height: number,
  thickness: number,
): THREE.BufferGeometry {
  const hw = width * 0.5;
  const hh = height * 0.5;
  const radius = Math.min(width, height) * 0.14;
  const bevel = Math.min(thickness * 0.22, 0.01);
  const depth = Math.max(0.008, thickness - bevel * 2);

  const shape = new THREE.Shape();
  shape.moveTo(-hw + radius, -hh);
  shape.lineTo(hw - radius, -hh);
  shape.quadraticCurveTo(hw, -hh, hw, -hh + radius);
  shape.lineTo(hw, hh - radius);
  shape.quadraticCurveTo(hw, hh, hw - radius, hh);
  shape.lineTo(-hw + radius, hh);
  shape.quadraticCurveTo(-hw, hh, -hw, hh - radius);
  shape.lineTo(-hw, -hh + radius);
  shape.quadraticCurveTo(-hw, -hh, -hw + radius, -hh);

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelSegments: 2,
    steps: 1,
    bevelSize: bevel,
    bevelThickness: bevel,
    curveSegments: 8,
  });

  geo.center();

  const posAttr = geo.attributes.position;
  const uvAttr = geo.attributes.uv;
  const totalWidth = width + bevel * 2;
  const totalHeight = height + bevel * 2;

  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i);
    const y = posAttr.getY(i);
    const u = THREE.MathUtils.clamp((x + totalWidth * 0.5) / totalWidth, 0, 1);
    const v = THREE.MathUtils.clamp((y + totalHeight * 0.5) / totalHeight, 0, 1);
    uvAttr.setXY(i, u, v);
  }
  uvAttr.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

function createSculptedWaistSashGeometry(
  yCenter: number,
  bandHeight: number,
  clearance: number,
  thickness: number,
): THREE.BufferGeometry {
  const radialSegs = 72;
  const heightSegs = 6;
  const halfH = bandHeight * 0.5;

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const stride = radialSegs + 1;

  const outerOffset = 0;
  for (let iy = 0; iy <= heightSegs; iy++) {
    const v = iy / heightSegs;
    const y = yCenter - halfH + v * bandHeight;
    const envelopeR = getWrapOuterEnvelopeRadius(y);
    const crown = Math.sin(v * Math.PI) * (thickness * 0.35);
    const r = envelopeR + clearance + thickness + crown;

    for (let ir = 0; ir <= radialSegs; ir++) {
      const u = ir / radialSegs;
      const theta = (u - 0.5) * Math.PI * 2;
      positions.push(Math.sin(theta) * r, y, Math.cos(theta) * r);
      uvs.push(u, v);
    }
  }
  for (let iy = 0; iy < heightSegs; iy++) {
    for (let ir = 0; ir < radialSegs; ir++) {
      const a = outerOffset + iy * stride + ir;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      indices.push(a, b, d, a, d, c);
    }
  }

  const innerOffset = positions.length / 3;
  for (let iy = 0; iy <= heightSegs; iy++) {
    const v = iy / heightSegs;
    const y = yCenter - halfH + v * bandHeight;
    const r = getWrapOuterEnvelopeRadius(y) + clearance;

    for (let ir = 0; ir <= radialSegs; ir++) {
      const u = ir / radialSegs;
      const theta = (u - 0.5) * Math.PI * 2;
      positions.push(Math.sin(theta) * r, y, Math.cos(theta) * r);
      uvs.push(u, v);
    }
  }
  for (let iy = 0; iy < heightSegs; iy++) {
    for (let ir = 0; ir < radialSegs; ir++) {
      const a = innerOffset + iy * stride + ir;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      indices.push(a, d, b, a, c, d);
    }
  }

  const topOutStart = outerOffset + heightSegs * stride;
  const topInStart = innerOffset + heightSegs * stride;
  for (let ir = 0; ir < radialSegs; ir++) {
    const oa = topOutStart + ir;
    const ob = oa + 1;
    const ia = topInStart + ir;
    const ib = ia + 1;
    indices.push(oa, ob, ib, oa, ib, ia);
  }

  const botOutStart = outerOffset;
  const botInStart = innerOffset;
  for (let ir = 0; ir < radialSegs; ir++) {
    const oa = botOutStart + ir;
    const ob = oa + 1;
    const ia = botInStart + ir;
    const ib = ia + 1;
    indices.push(oa, ib, ob, oa, ia, ib);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function createVolumetricRibbonGeometry(
  curve: THREE.CatmullRomCurve3,
  initialWidthAxisHint: THREE.Vector3,
  widthAt: (t: number) => number,
  thicknessAt: (t: number) => number,
  twistAt: (t: number) => number,
  segmentsU = 44,
  swallowtailNotch = 0,
): THREE.BufferGeometry {
  const profileCount = 12;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const points: THREE.Vector3[] = [];
  const tangents: THREE.Vector3[] = [];
  for (let i = 0; i <= segmentsU; i++) {
    const t = i / segmentsU;
    points.push(curve.getPointAt(t));
    tangents.push(curve.getTangentAt(t).normalize());
  }

  const widthAxes: THREE.Vector3[] = [];
  const thickAxes: THREE.Vector3[] = [];

  const t0 = tangents[0];
  let w0 = initialWidthAxisHint
    .clone()
    .addScaledVector(t0, -initialWidthAxisHint.dot(t0));
  if (w0.lengthSq() < 1e-5) {
    w0 = new THREE.Vector3(1, 0, 0).cross(t0);
    if (w0.lengthSq() < 1e-5) w0 = new THREE.Vector3(0, 1, 0).cross(t0);
  }
  w0.normalize();
  const th0 = new THREE.Vector3().crossVectors(t0, w0).normalize();
  widthAxes.push(w0);
  thickAxes.push(th0);

  for (let i = 1; i <= segmentsU; i++) {
    const prevT = tangents[i - 1];
    const currT = tangents[i];
    const axis = new THREE.Vector3().crossVectors(prevT, currT);
    const nextW = widthAxes[i - 1].clone();
    if (axis.lengthSq() > 1e-8) {
      axis.normalize();
      const angle = Math.acos(THREE.MathUtils.clamp(prevT.dot(currT), -1, 1));
      nextW.applyAxisAngle(axis, angle);
    }
    nextW.addScaledVector(currT, -nextW.dot(currT)).normalize();
    const nextTh = new THREE.Vector3().crossVectors(currT, nextW).normalize();
    widthAxes.push(nextW);
    thickAxes.push(nextTh);
  }

  const ringCenters: THREE.Vector3[] = [];

  for (let i = 0; i <= segmentsU; i++) {
    const t = i / segmentsU;
    const center = points[i];
    const T = tangents[i];
    const twist = twistAt(t);
    const W = widthAxes[i].clone().applyAxisAngle(T, twist).normalize();
    const TH = thickAxes[i].clone().applyAxisAngle(T, twist).normalize();

    const halfW = widthAt(t) * 0.5;
    const halfTh = thicknessAt(t) * 0.5;

    ringCenters.push(center);

    for (let k = 0; k < profileCount; k++) {
      const phi = (k / profileCount) * Math.PI * 2;
      const cosP = Math.cos(phi);
      const sinP = Math.sin(phi);
      const uCoeff = Math.sign(cosP) * Math.pow(Math.abs(cosP), 0.65);
      const vCoeff = Math.sign(sinP) * Math.pow(Math.abs(sinP), 1.15);

      const p = center
        .clone()
        .addScaledVector(W, uCoeff * halfW)
        .addScaledVector(TH, vCoeff * halfTh);

      if (swallowtailNotch > 0 && t > 0.88) {
        const tipBlend = THREE.MathUtils.smoothstep(t, 0.88, 1.0);
        const centerPull = (1 - Math.abs(uCoeff)) * swallowtailNotch * tipBlend;
        p.addScaledVector(T, -centerPull);
      }

      positions.push(p.x, p.y, p.z);
      uvs.push(k / profileCount, t);
    }
  }

  const getPos = (idx: number) =>
    new THREE.Vector3(positions[idx * 3], positions[idx * 3 + 1], positions[idx * 3 + 2]);

  const pushOrientedTri = (ia: number, ib: number, ic: number, refCenter: THREE.Vector3) => {
    const a = getPos(ia);
    const b = getPos(ib);
    const c = getPos(ic);
    const triNormal = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    const triCenter = a.clone().add(b).add(c).multiplyScalar(1 / 3);
    const outward = triCenter.sub(refCenter);
    if (triNormal.dot(outward) >= 0) {
      indices.push(ia, ib, ic);
    } else {
      indices.push(ia, ic, ib);
    }
  };

  for (let i = 0; i < segmentsU; i++) {
    const r0 = i * profileCount;
    const r1 = (i + 1) * profileCount;
    const midCenter = ringCenters[i].clone().add(ringCenters[i + 1]).multiplyScalar(0.5);

    for (let k = 0; k < profileCount; k++) {
      const kNext = (k + 1) % profileCount;
      const a = r0 + k;
      const b = r1 + k;
      const c = r1 + kNext;
      const d = r0 + kNext;
      pushOrientedTri(a, b, c, midCenter);
      pushOrientedTri(a, c, d, midCenter);
    }
  }

  const startCenterIdx = positions.length / 3;
  const pStart = ringCenters[0];
  positions.push(pStart.x, pStart.y, pStart.z);
  uvs.push(0.5, 0);
  const startRef = pStart.clone().addScaledVector(tangents[0], 0.05);
  for (let k = 0; k < profileCount; k++) {
    const kNext = (k + 1) % profileCount;
    pushOrientedTri(startCenterIdx, kNext, k, startRef);
  }

  const endCenterIdx = positions.length / 3;
  const pEnd = ringCenters[segmentsU];
  const lastRingOffset = segmentsU * profileCount;
  positions.push(pEnd.x, pEnd.y, pEnd.z);
  uvs.push(0.5, 1);
  const endRef = pEnd.clone().addScaledVector(tangents[segmentsU], -0.05);
  for (let k = 0; k < profileCount; k++) {
    const kNext = (k + 1) % profileCount;
    pushOrientedTri(endCenterIdx, lastRingOffset + k, lastRingOffset + kNext, endRef);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

export function buildBouquetProps(
  flowers: FlowerConfig[],
  wrapConfig: WrapRibbonConfig,
  ribbonText: string,
  recipientName: string,
  maxAnisotropy: number,
): BouquetPropsBuild {
  const group = new THREE.Group();
  const disposables: Array<{ dispose: () => void }> = [];

  // 1. Curved Green Stems wrapped in individual animation groups for staged entry
  const stemMat = new THREE.MeshStandardMaterial({
    color: '#3f7a38',
    roughness: 0.56,
    metalness: 0.02,
  });
  disposables.push(stemMat);

  const stemItems: StemItem[] = [];
  const totalStems = Math.max(1, flowers.length);

  flowers.forEach((flower, idx) => {
    const [hx, hy, hz] = flower.position;
    const waistX = hx * 0.14;
    const waistZ = hz * 0.14;
    const bottomX = -hx * 0.14 + Math.sin(idx * 1.3) * 0.05;
    const bottomZ = -hz * 0.14 + Math.cos(idx * 1.3) * 0.05;

    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(bottomX, -2.35, bottomZ),
      new THREE.Vector3(waistX, -0.62, waistZ),
      new THREE.Vector3(hx * 0.56, (hy - 0.12) * 0.48, hz * 0.56),
      new THREE.Vector3(hx, hy - 0.05, hz),
    ]);

    const stemGeo = new THREE.TubeGeometry(curve, 22, 0.044, 8, false);
    disposables.push(stemGeo);
    const stemMesh = new THREE.Mesh(stemGeo, stemMat);
    stemMesh.castShadow = true;

    const stemGroup = new THREE.Group();
    stemGroup.add(stemMesh);
    group.add(stemGroup);

    const radialAngle = idx * 2.39996 + Math.atan2(hz, hx);
    const entryOffset = new THREE.Vector3(
      Math.cos(radialAngle) * 2.15 + hx * 0.35,
      -2.3 - (idx % 3) * 0.45,
      Math.sin(radialAngle) * 2.15 + hz * 0.35,
    );
    const entryTilt = new THREE.Euler(
      Math.sin(radialAngle) * 0.35,
      (idx % 2 === 0 ? 1 : -1) * 0.45,
      Math.cos(radialAngle) * 0.32,
    );

    stemItems.push({
      group: stemGroup,
      entryOffset,
      entryTilt,
      delayFactor: (idx / totalStems) * 0.52,
    });
  });

  // 2. Dense Pixel-Grid Green Lily Leaves
  const leafTex = createPixelGridMaterialTexture(
    ['#4d7c0f', '#65a30d', '#3f6212', '#84cc16', '#365314'],
    22,
    22,
    maxAnisotropy,
  );
  const leafGeo = createLilyLeafGeometry();
  const leafMat = new THREE.MeshPhysicalMaterial({
    map: leafTex,
    color: '#ffffff',
    roughness: 0.35,
    metalness: 0.04,
    clearcoat: 0.35,
    side: THREE.DoubleSide,
  });
  disposables.push(leafTex, leafGeo, leafMat);

  const leafPlacements = [
    { pos: [-0.95, 3.05, -0.18], rot: [0.32, -0.35, 0.45], scale: 1.02 },
    { pos: [-0.15, 3.18, -0.48], rot: [0.2, 0.25, 0.15], scale: 1.12 },
    { pos: [0.95, 2.78, -0.34], rot: [0.35, 0.72, -0.46], scale: 1.06 },
    { pos: [0.42, 3.12, -0.26], rot: [0.26, 0.48, -0.25], scale: 0.98 },
    { pos: [1.46, 2.02, -0.05], rot: [0.54, 1.25, -0.32], scale: 1.12 },
    { pos: [-1.48, 2.08, 0.1], rot: [0.54, -1.15, 0.34], scale: 1.1 },
    { pos: [1.28, 1.55, 0.45], rot: [0.62, 1.05, -0.28], scale: 1.05 },
    { pos: [-1.32, 1.52, 0.48], rot: [0.62, -1.05, 0.28], scale: 1.05 },
    { pos: [0.85, 2.38, -0.92], rot: [-0.42, 2.55, -0.25], scale: 1.04 },
    { pos: [-0.88, 2.38, -0.92], rot: [-0.42, -2.55, 0.25], scale: 1.04 },
    { pos: [0.38, 0.92, 0.88], rot: [0.7, 0.35, -0.2], scale: 1.16 },
    { pos: [-0.44, 0.88, 0.86], rot: [0.68, -0.42, 0.22], scale: 1.14 },
    { pos: [0.95, 1.02, 0.42], rot: [0.64, 1.2, -0.22], scale: 1.12 },
    { pos: [-0.96, 1.02, 0.42], rot: [0.64, -1.2, 0.22], scale: 1.12 },
    { pos: [0.68, 1.08, -0.68], rot: [0.52, 2.25, -0.15], scale: 1.1 },
    { pos: [-0.66, 1.12, -0.66], rot: [0.54, -2.25, 0.18], scale: 1.1 },
    { pos: [0.02, 1.12, 1.02], rot: [0.76, 0.02, 0.04], scale: 1.08 },
    { pos: [0.04, 1.15, -1.02], rot: [0.62, 3.12, -0.02], scale: 1.08 },
    { pos: [0.48, 1.65, 0.22], rot: [0.42, 0.65, -0.18], scale: 0.94 },
    { pos: [-0.52, 1.68, 0.22], rot: [0.42, -0.65, 0.18], scale: 0.94 },
    { pos: [0.18, 2.15, -0.12], rot: [0.3, 0.18, -0.1], scale: 0.96 },
    { pos: [-0.22, 2.18, -0.15], rot: [0.3, -0.2, 0.1], scale: 0.96 },
  ];

  const leafItems: LeafItem[] = [];
  leafPlacements.forEach((lp, idx) => {
    const leaf = new THREE.Mesh(leafGeo, leafMat);
    const targetPos = new THREE.Vector3(lp.pos[0], lp.pos[1], lp.pos[2]);
    const targetRot = new THREE.Euler(lp.rot[0], lp.rot[1], lp.rot[2]);
    leaf.position.copy(targetPos);
    leaf.rotation.copy(targetRot);
    leaf.scale.setScalar(lp.scale);
    group.add(leaf);

    const radialDir = new THREE.Vector3(lp.pos[0], 0.25, lp.pos[2]);
    if (radialDir.lengthSq() < 0.01) radialDir.set(0, 0.3, 1);
    radialDir.normalize();

    leafItems.push({
      mesh: leaf,
      targetPos,
      targetRot,
      targetScale: lp.scale,
      radialDir,
      delayFactor: (idx / leafPlacements.length) * 0.55,
    });
  });

  // 3. Lush Pixelated Baby's Breath & Pink Waxflower Filler Clusters
  const fillerGeo = new THREE.BoxGeometry(0.068, 0.068, 0.068);
  const fillerMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: '#fce7f3',
    emissiveIntensity: 0.24,
    roughness: 0.34,
  });
  const fillerClusters: Array<{ pos: [number, number, number]; color: string; count: number }> = [
    { pos: [0.72, 3.32, -0.12], color: '#fff7fa', count: 24 },
    { pos: [-0.68, 3.25, -0.18], color: '#ffe4e6', count: 22 },
    { pos: [-1.32, 2.52, 0.22], color: '#fbcfe8', count: 20 },
    { pos: [1.38, 2.24, 0.34], color: '#ffe4e6', count: 22 },
    { pos: [-0.18, 1.22, 0.92], color: '#f9a8d4', count: 20 },
    { pos: [0.22, 1.06, 0.88], color: '#fff1f2', count: 20 },
    { pos: [-1.02, 1.32, 0.62], color: '#fbcfe8', count: 18 },
    { pos: [1.02, 1.32, 0.62], color: '#fff7fa', count: 18 },
    { pos: [0.46, 2.08, 0.36], color: '#fff7fa', count: 16 },
    { pos: [-0.52, 2.12, 0.34], color: '#fbcfe8', count: 16 },
    { pos: [0.02, 2.58, 0.12], color: '#ffe4e6', count: 16 },
    { pos: [0.02, 1.42, -0.96], color: '#fbcfe8', count: 18 },
  ];
  const totalFillers = fillerClusters.reduce((acc, c) => acc + c.count, 0);
  const fillerMesh = new THREE.InstancedMesh(fillerGeo, fillerMat, totalFillers);
  const fDummy = new THREE.Object3D();
  let fIdx = 0;
  fillerClusters.forEach((cluster, cIdx) => {
    const col = new THREE.Color(cluster.color);
    for (let k = 0; k < cluster.count; k++) {
      const a = k * 2.399 + cIdx;
      const rad = 0.08 + (k % 5) * 0.068;
      fDummy.position.set(
        cluster.pos[0] + Math.cos(a) * rad,
        cluster.pos[1] + ((k % 4) - 1.5) * 0.09,
        cluster.pos[2] + Math.sin(a) * rad,
      );
      fDummy.rotation.set(a, a * 0.7, 0);
      fDummy.scale.setScalar(0.75 + (k % 3) * 0.25);
      fDummy.updateMatrix();
      fillerMesh.setMatrixAt(fIdx, fDummy.matrix);
      fillerMesh.setColorAt(fIdx, col);
      fIdx++;
    }
  });
  fillerMesh.instanceMatrix.needsUpdate = true;
  if (fillerMesh.instanceColor) fillerMesh.instanceColor.needsUpdate = true;
  fillerMesh.computeBoundingSphere();
  disposables.push(fillerGeo, fillerMat);
  group.add(fillerMesh);

  // 4. Two-Tier Pleated Pixel-Grid Wrapping Paper Cone
  const outerBase = new THREE.Color(wrapConfig.wrapColor || '#fdf2f8');
  const innerBase = new THREE.Color(wrapConfig.wrapInnerColor || '#f9a8d4');
  const outerPalette = [
    outerBase.getStyle(),
    outerBase.clone().lerp(innerBase, 0.28).getStyle(),
    outerBase.clone().lerp(new THREE.Color('#e9d5ff'), 0.35).getStyle(),
    outerBase.clone().lerp(new THREE.Color('#ffffff'), 0.25).getStyle(),
    innerBase.getStyle(),
  ];

  const wrapTex = createPixelGridMaterialTexture(outerPalette, 52, 52, maxAnisotropy);
  const wrapOuterMat = new THREE.MeshPhysicalMaterial({
    map: wrapTex,
    color: outerBase,
    roughness: 0.4,
    metalness: 0.05,
    transparent: wrapConfig.wrapOpacity < 0.99,
    opacity: wrapConfig.wrapOpacity,
    sheen: 0.72,
    sheenColor: innerBase,
    clearcoat: 0.22,
    side: THREE.DoubleSide,
  });
  const wrapInnerMat = new THREE.MeshPhysicalMaterial({
    map: wrapTex,
    color: innerBase,
    roughness: 0.44,
    metalness: 0.03,
    transparent: true,
    opacity: Math.min(0.95, wrapConfig.wrapOpacity + 0.05),
    sheen: 0.55,
    sheenColor: outerBase,
    side: THREE.DoubleSide,
  });
  disposables.push(wrapTex, wrapOuterMat, wrapInnerMat);

  const outerWrapGeo = createPleatedWrapGeometry(
    OUTER_WRAP_SPEC.rBottom,
    OUTER_WRAP_SPEC.rTop,
    OUTER_WRAP_SPEC.yBottom,
    OUTER_WRAP_SPEC.yTop,
    OUTER_WRAP_SPEC.pleatCount,
  );
  const innerWrapGeo = createPleatedWrapGeometry(
    INNER_WRAP_SPEC.rBottom,
    INNER_WRAP_SPEC.rTop,
    INNER_WRAP_SPEC.yBottom,
    INNER_WRAP_SPEC.yTop,
    INNER_WRAP_SPEC.pleatCount,
  );
  disposables.push(outerWrapGeo, innerWrapGeo);

  const outerWrap = new THREE.Mesh(outerWrapGeo, wrapOuterMat);
  outerWrap.castShadow = true;
  outerWrap.receiveShadow = true;
  group.add(outerWrap);

  const innerWrap = new THREE.Mesh(innerWrapGeo, wrapInnerMat);
  innerWrap.rotation.y = Math.PI / 9;
  group.add(innerWrap);

  // 5. Pastel Satin Waist Sash + Prominent 3D Sculpted Bow Loops + Curved Flowing Tails
  const ribbonHex = wrapConfig.ribbonColor || '#f48fb1';
  const ribbonCol = new THREE.Color(ribbonHex);
  const satinSheenColor = ribbonCol.clone().lerp(new THREE.Color('#ffffff'), 0.72);

  const rThickness = THREE.MathUtils.clamp(wrapConfig.ribbonThickness ?? 1.0, 0.45, 2.2);
  const rRoughness = THREE.MathUtils.clamp(wrapConfig.ribbonRoughness ?? 0.26, 0.08, 0.85);
  const rSheen = THREE.MathUtils.clamp(wrapConfig.ribbonSheen ?? 0.95, 0.0, 1.0);

  const ribbonBannerTex = createRibbonTextTexture(ribbonText, ribbonHex, maxAnisotropy);
  const ribbonSatinTex = createSatinRibbonTexture(ribbonHex, maxAnisotropy);

  const ribbonBannerMat = new THREE.MeshPhysicalMaterial({
    map: ribbonBannerTex,
    color: 0xffffff,
    roughness: Math.min(0.88, rRoughness + 0.02),
    metalness: 0.04,
    clearcoat: Math.max(0.08, 0.44 * (1 - rRoughness * 0.5)),
    clearcoatRoughness: 0.24,
    sheen: rSheen * 0.96,
    sheenRoughness: 0.28,
    sheenColor: satinSheenColor,
    envMapIntensity: 1.05,
    side: THREE.FrontSide,
  });

  const ribbonSatinMat = new THREE.MeshPhysicalMaterial({
    map: ribbonSatinTex,
    color: 0xffffff,
    roughness: rRoughness,
    metalness: 0.04,
    clearcoat: Math.max(0.08, 0.48 * (1 - rRoughness * 0.5)),
    clearcoatRoughness: 0.22,
    sheen: rSheen,
    sheenRoughness: 0.25,
    sheenColor: satinSheenColor,
    envMapIntensity: 1.12,
    side: THREE.FrontSide,
  });
  disposables.push(ribbonBannerTex, ribbonSatinTex, ribbonBannerMat, ribbonSatinMat);

  const ribbonPosX = wrapConfig.ribbonPositionX ?? 0;
  const ribbonPosY = wrapConfig.ribbonPositionY ?? -0.66;
  const ribbonPosZ = wrapConfig.ribbonPositionZ ?? 0;
  const ribbonForwardOffset = wrapConfig.ribbonForwardOffset ?? 0.14;
  const bowScale = wrapConfig.bowScale ?? 1.28;
  const loopSize = wrapConfig.ribbonLoopSize ?? 1.18;
  const tailLength = wrapConfig.ribbonTailLength ?? 1.15;

  const sashClearance = 0.024;
  const sashThickness = 0.034 * rThickness;
  const waistSashGeo = createSculptedWaistSashGeometry(ribbonPosY, 0.26, sashClearance, sashThickness);
  disposables.push(waistSashGeo);
  const waistSash = new THREE.Mesh(waistSashGeo, ribbonBannerMat);
  waistSash.castShadow = true;
  waistSash.receiveShadow = true;
  group.add(waistSash);

  const sashOuterRadius = getWrapOuterEnvelopeRadius(ribbonPosY) + sashClearance + sashThickness;
  const bowAnchorZ = sashOuterRadius + ribbonForwardOffset + ribbonPosZ;
  const bowAnchorPos = new THREE.Vector3(ribbonPosX, ribbonPosY, bowAnchorZ);

  const bowGroup = new THREE.Group();
  bowGroup.position.copy(bowAnchorPos);
  if (Math.abs(ribbonPosX) > 0.01) {
    bowGroup.rotation.y = Math.atan2(ribbonPosX, sashOuterRadius) * 0.75;
  }
  bowGroup.scale.setScalar(bowScale);

  const bridgeDepth = Math.max(0.06, ribbonForwardOffset + ribbonPosZ + 0.03);
  const bridgeCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, -bridgeDepth / bowScale),
    new THREE.Vector3(0, 0, -0.02),
    new THREE.Vector3(0, 0, 0.03),
  ]);
  const bridgeGeo = createVolumetricRibbonGeometry(
    bridgeCurve,
    new THREE.Vector3(1, 0, 0),
    () => 0.15,
    () => 0.075 * rThickness,
    () => 0,
    10,
  );
  disposables.push(bridgeGeo);
  const bridgeMesh = new THREE.Mesh(bridgeGeo, ribbonSatinMat);
  bowGroup.add(bridgeMesh);

  const knotGeo = new THREE.SphereGeometry(0.115, 24, 18);
  knotGeo.scale(1.18, 1.02, 0.92 * (0.85 + rThickness * 0.15));
  disposables.push(knotGeo);
  const bowKnot = new THREE.Mesh(knotGeo, ribbonSatinMat);
  bowKnot.position.set(0, 0, 0.02);
  bowKnot.castShadow = true;
  bowGroup.add(bowKnot);

  const knotWrapCurve = new THREE.CatmullRomCurve3(
    [
      new THREE.Vector3(-0.08, 0.055, -0.02),
      new THREE.Vector3(-0.04, 0.068, 0.115),
      new THREE.Vector3(0.04, 0.068, 0.115),
      new THREE.Vector3(0.08, 0.055, -0.02),
      new THREE.Vector3(0.08, -0.055, -0.02),
      new THREE.Vector3(0.04, -0.068, 0.115),
      new THREE.Vector3(-0.04, -0.068, 0.115),
      new THREE.Vector3(-0.08, -0.055, -0.02),
    ],
    true,
  );
  const knotWrapGeo = createVolumetricRibbonGeometry(
    knotWrapCurve,
    new THREE.Vector3(0, 1, 0),
    () => 0.058,
    () => 0.03 * rThickness,
    () => 0,
    24,
  );
  disposables.push(knotWrapGeo);
  const knotWrap = new THREE.Mesh(knotWrapGeo, ribbonSatinMat);
  knotWrap.castShadow = true;
  bowGroup.add(knotWrap);

  let leftLoop: THREE.Mesh | null = null;
  let rightLoop: THREE.Mesh | null = null;
  let leftTail: THREE.Mesh | null = null;
  let rightTail: THREE.Mesh | null = null;

  for (const side of [-1, 1]) {
    const loopCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(side * 0.03, 0.015, 0.0),
      new THREE.Vector3(side * 0.22 * loopSize, 0.18 * loopSize, 0.16),
      new THREE.Vector3(side * 0.54 * loopSize, 0.25 * loopSize, 0.23),
      new THREE.Vector3(side * 0.65 * loopSize, 0.03 * loopSize, 0.15),
      new THREE.Vector3(side * 0.48 * loopSize, -0.15 * loopSize, 0.12),
      new THREE.Vector3(side * 0.19 * loopSize, -0.08 * loopSize, 0.07),
      new THREE.Vector3(side * 0.03, -0.02, 0.0),
    ]);

    const loopGeo = createVolumetricRibbonGeometry(
      loopCurve,
      new THREE.Vector3(0, 0, 1),
      (t) => {
        const swell = Math.sin(t * Math.PI);
        return (0.085 + 0.215 * Math.pow(swell, 0.72)) * Math.min(1.35, 0.75 + 0.25 * loopSize);
      },
      (t) => (0.028 + 0.018 * Math.sin(t * Math.PI)) * rThickness,
      (t) => side * (0.28 * Math.sin(t * Math.PI * 2)),
      44,
    );
    disposables.push(loopGeo);
    const loopMesh = new THREE.Mesh(loopGeo, ribbonSatinMat);
    loopMesh.castShadow = true;
    loopMesh.receiveShadow = true;
    bowGroup.add(loopMesh);
    if (side < 0) leftLoop = loopMesh;
    else rightLoop = loopMesh;

    const tailPointsLocal: THREE.Vector3[] = [];
    const tailSamples = [
      { dx: side * 0.045, dy: -0.03, dz: 0.02 },
      { dx: side * 0.16, dy: -0.28 * tailLength, dz: 0.08 },
      { dx: side * 0.29, dy: -0.62 * tailLength, dz: 0.02 },
      { dx: side * 0.37, dy: -0.96 * tailLength, dz: -0.05 },
      { dx: side * 0.45, dy: -1.28 * tailLength, dz: 0.03 },
      { dx: side * 0.54, dy: -1.52 * tailLength, dz: 0.11 },
    ];

    for (const pt of tailSamples) {
      const worldY = ribbonPosY + pt.dy * bowScale;
      const worldX = ribbonPosX + pt.dx * bowScale;
      const envR = getWrapOuterEnvelopeRadius(worldY) + 0.085;
      const minWorldZ = Math.sqrt(Math.max(0, envR * envR - worldX * worldX * 0.65));
      const minLocalZ = (minWorldZ - bowAnchorZ) / bowScale;
      tailPointsLocal.push(new THREE.Vector3(pt.dx, pt.dy, Math.max(pt.dz, minLocalZ)));
    }

    const tailCurve = new THREE.CatmullRomCurve3(tailPointsLocal);
    const tailGeo = createVolumetricRibbonGeometry(
      tailCurve,
      new THREE.Vector3(1, 0, 0),
      (t) => 0.11 + 0.115 * Math.pow(t, 0.8),
      (t) => (0.03 - 0.008 * t) * rThickness,
      (t) => side * (0.18 * Math.sin(t * Math.PI * 1.35)),
      38,
      0.095,
    );
    disposables.push(tailGeo);
    const tailMesh = new THREE.Mesh(tailGeo, ribbonSatinMat);
    tailMesh.castShadow = true;
    tailMesh.receiveShadow = true;
    bowGroup.add(tailMesh);
    if (side < 0) leftTail = tailMesh;
    else rightTail = tailMesh;
  }

  // 6. Thicker, Muted & Natural Matte Cardstock Gift Tag (THREE.ExtrudeGeometry w/ subtle bevels)
  let tagTex: THREE.CanvasTexture | null = null;
  let tagPivot: THREE.Group | null = null;
  const tagHitTargets: THREE.Object3D[] = [];
  const tagBasePos = new THREE.Vector3(
    wrapConfig.tagPositionX ?? 0.15,
    wrapConfig.tagPositionY ?? -0.05,
    wrapConfig.tagPositionZ ?? 0.12,
  );
  const tagBaseRot = new THREE.Euler(0.08, -0.14, wrapConfig.tagRotationZ ?? 0.09);
  const tagSwingIntensity = THREE.MathUtils.clamp(wrapConfig.tagSwingIntensity ?? 0.65, 0, 1.5);

  if (wrapConfig.showGiftTag) {
    const tagW = THREE.MathUtils.clamp(wrapConfig.tagWidth ?? 0.34, 0.2, 0.65);
    const tagH = THREE.MathUtils.clamp(wrapConfig.tagHeight ?? 0.42, 0.24, 0.78);
    const tagT = THREE.MathUtils.clamp(wrapConfig.tagThickness ?? 0.044, 0.022, 0.11);
    const tagColHex = wrapConfig.tagColor || '#D8C6BD';
    const tagTextColHex = wrapConfig.tagTextColor || '#111111';
    const tagBright = THREE.MathUtils.clamp(wrapConfig.tagBrightness ?? 0.82, 0.45, 1.05);
    const tagRough = THREE.MathUtils.clamp(wrapConfig.tagRoughness ?? 0.86, 0.45, 0.98);
    const tagCustomText = wrapConfig.tagText ?? '';

    tagTex = createGiftTagTexture(
      recipientName,
      tagCustomText,
      tagColHex,
      tagTextColHex,
      tagBright,
      maxAnisotropy,
    );

    const tagCapMat = new THREE.MeshStandardMaterial({
      map: tagTex,
      color: 0xffffff,
      roughness: tagRough,
      metalness: 0.01,
      envMapIntensity: 0.28,
    });
    const edgeColor = new THREE.Color(tagColHex).multiplyScalar(tagBright * 0.82);
    const tagEdgeMat = new THREE.MeshStandardMaterial({
      color: edgeColor,
      roughness: Math.min(0.98, tagRough + 0.05),
      metalness: 0.01,
      envMapIntensity: 0.22,
    });

    const cordMat = new THREE.MeshStandardMaterial({
      color: '#a16207',
      roughness: 0.72,
      metalness: 0.15,
      envMapIntensity: 0.35,
    });

    const tagGeo = createBeveledCardstockTagGeometry(tagW, tagH, tagT);
    const cordGeo = new THREE.CylinderGeometry(0.0065, 0.0065, 0.22, 8);
    disposables.push(tagCapMat, tagEdgeMat, cordMat, tagGeo, cordGeo);

    tagPivot = new THREE.Group();
    tagPivot.position.copy(tagBasePos);
    tagPivot.rotation.copy(tagBaseRot);

    const cord = new THREE.Mesh(cordGeo, cordMat);
    cord.position.y = -0.11;
    cord.castShadow = true;
    cord.userData.isGiftTag = true;
    tagPivot.add(cord);

    const tagCard = new THREE.Mesh(tagGeo, [tagCapMat, tagEdgeMat]);
    tagCard.position.y = -0.2 - tagH * 0.46;
    tagCard.castShadow = true;
    tagCard.receiveShadow = true;
    tagCard.userData.isGiftTag = true;
    tagPivot.add(tagCard);

    tagHitTargets.push(tagCard, cord);
    bowGroup.add(tagPivot);
  }

  group.add(bowGroup);

  const dispose = () => {
    tagTex?.dispose();
    disposables.forEach((d) => d.dispose());
  };

  return {
    group,
    stemItems,
    leafItems,
    fillerMesh,
    outerWrap,
    innerWrap,
    waistSash,
    bowGroup,
    bowAnchorPos,
    bowTargetScale: bowScale,
    bowKnot,
    knotWrap,
    leftLoop,
    rightLoop,
    leftTail,
    rightTail,
    tagPivot,
    tagHitTargets,
    tagBasePos,
    tagBaseRot,
    tagSwingIntensity,
    dispose,
  };
}

function createLilyLeafGeometry(): THREE.BufferGeometry {
  const segU = 6;
  const segV = 16;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let iv = 0; iv <= segV; iv++) {
    const v = iv / segV;
    const width = 0.24 * Math.sin(Math.pow(v, 0.68) * Math.PI) * (1 - Math.pow(v, 3) * 0.5);
    const archY = v * 1.25 - Math.pow(v, 2.3) * 0.36;
    const archZ = Math.pow(v, 1.5) * 0.4;

    for (let iu = 0; iu <= segU; iu++) {
      const u = (iu / segU) * 2 - 1;
      const x = u * width;
      const crease = -0.032 * (1 - Math.abs(u)) * Math.sin(v * Math.PI);
      positions.push(x, archY, archZ + crease);
      uvs.push(iu / segU, v);
    }
  }

  const rowStride = segU + 1;
  for (let iv = 0; iv < segV; iv++) {
    for (let iu = 0; iu < segU; iu++) {
      const a = iv * rowStride + iu;
      const b = a + 1;
      const c = a + rowStride;
      const d = c + 1;
      indices.push(a, b, d, a, d, c);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function createPleatedWrapGeometry(
  rBottom: number,
  rTop: number,
  yBottom: number,
  yTop: number,
  pleatCount: number,
): THREE.BufferGeometry {
  const radialSegs = 64;
  const heightSegs = 20;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let iy = 0; iy <= heightSegs; iy++) {
    const t = iy / heightSegs;
    const y = THREE.MathUtils.lerp(yBottom, yTop, t);
    const waistDip = Math.exp(-Math.pow((t - 0.42) / 0.16, 2)) * 0.24;
    const baseR = THREE.MathUtils.lerp(rBottom, rTop, Math.pow(t, 1.15)) * (1 - waistDip);

    for (let ir = 0; ir <= radialSegs; ir++) {
      const u = ir / radialSegs;
      const theta = u * Math.PI * 2;
      const pleatAmp = 0.075 * Math.pow(t, 1.45);
      const r = baseR + Math.sin(theta * pleatCount) * pleatAmp;
      const backLift = (-Math.cos(theta) * 0.5 + 0.5) * 0.52 * Math.pow(t, 2.0);
      positions.push(Math.sin(theta) * r, y + backLift, Math.cos(theta) * r);
      uvs.push(u * 2, t * 2);
    }
  }

  const stride = radialSegs + 1;
  for (let iy = 0; iy < heightSegs; iy++) {
    for (let ir = 0; ir < radialSegs; ir++) {
      const a = iy * stride + ir;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      indices.push(a, b, d, a, d, c);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}
