import * as THREE from 'three';
import type {
  FlowerConfig,
  LilyColorKind,
  PixelSizeMode,
  TileSlotMeta,
  UploadedPhoto,
} from '../types/bouquet';

export interface PetalTileInstanceMeta {
  slot: TileSlotMeta;
  globalPixelId: number;
  localPixelNumber: number;
  uNorm: number;
  vNorm: number;
}

export interface PetalInstancedBuild {
  mesh: THREE.InstancedMesh;
  isInner: boolean;
  baseTiltX: number;
  closedTiltX: number;
  azimuth: number;
  tilesMeta: PetalTileInstanceMeta[];
}

export interface LilyAssembly {
  flowerIndex: number;
  config: FlowerConfig;
  group: THREE.Group;
  headGroup: THREE.Group;
  petals: PetalInstancedBuild[];
  stamenGroup: THREE.Group;
  hitProxy: THREE.Mesh;
  totalTiles: number;
}

export function createBeveledTileGeometry(): THREE.BufferGeometry {
  const hw = 0.465;
  const hh = 0.465;
  const bw = 0.43;
  const bh = 0.43;
  const hz = 0.055;

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];

  const pushTri = (
    a: [number, number, number],
    b: [number, number, number],
    c: [number, number, number],
    uva: [number, number],
    uvb: [number, number],
    uvc: [number, number],
  ) => {
    positions.push(...a, ...b, ...c);
    uvs.push(...uva, ...uvb, ...uvc);

    const abx = b[0] - a[0];
    const aby = b[1] - a[1];
    const abz = b[2] - a[2];
    const acx = c[0] - a[0];
    const acy = c[1] - a[1];
    const acz = c[2] - a[2];
    let nx = aby * acz - abz * acy;
    let ny = abz * acx - abx * acz;
    let nz = abx * acy - aby * acx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
  };

  const fBL: [number, number, number] = [-bw, -bh, hz];
  const fBR: [number, number, number] = [bw, -bh, hz];
  const fTR: [number, number, number] = [bw, bh, hz];
  const fTL: [number, number, number] = [-bw, bh, hz];

  pushTri(fBL, fBR, fTR, [0, 0], [1, 0], [1, 1]);
  pushTri(fBL, fTR, fTL, [0, 0], [1, 1], [0, 1]);

  const mBL: [number, number, number] = [-hw, -hh, 0];
  const mBR: [number, number, number] = [hw, -hh, 0];
  const mTR: [number, number, number] = [hw, hh, 0];
  const mTL: [number, number, number] = [-hw, hh, 0];

  const bBL: [number, number, number] = [-bw, -bh, -hz];
  const bBR: [number, number, number] = [bw, -bh, -hz];
  const bTR: [number, number, number] = [bw, bh, -hz];
  const bTL: [number, number, number] = [-bw, bh, -hz];

  pushTri(bBR, bBL, bTL, [0, 0], [1, 0], [1, 1]);
  pushTri(bBR, bTL, bTR, [0, 0], [1, 1], [0, 1]);

  const pushBevel = (
    p0: [number, number, number],
    p1: [number, number, number],
    p2: [number, number, number],
    p3: [number, number, number],
  ) => {
    pushTri(p0, p1, p2, [0.5, 0.5], [0.5, 0.5], [0.5, 0.5]);
    pushTri(p0, p2, p3, [0.5, 0.5], [0.5, 0.5], [0.5, 0.5]);
  };

  pushBevel(mBL, mBR, fBR, fBL);
  pushBevel(mBR, mTR, fTR, fBR);
  pushBevel(mTR, mTL, fTL, fTR);
  pushBevel(mTL, mBL, fBL, fTL);

  pushBevel(bBL, bBR, mBR, mBL);
  pushBevel(bBR, bTR, mTR, mBR);
  pushBevel(bTR, bTL, mTL, mTR);
  pushBevel(bTL, bBL, mBL, mTL);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.computeBoundingSphere();
  return geo;
}

function evaluateLilyPetalSurface(
  u: number,
  v: number,
  isInner: boolean,
): { pos: THREE.Vector3; normal: THREE.Vector3; tangentU: THREE.Vector3; tangentV: THREE.Vector3 } {
  const length = isInner ? 1.2 : 1.14;
  const maxWidth = isInner ? 0.37 : 0.3;

  const widthFactor =
    Math.sin(Math.pow(v, 0.72) * Math.PI) * (0.26 + 0.74 * (1 - Math.pow(v, 2.6))) +
    0.045 * (1 - v);
  const halfW = maxWidth * widthFactor;

  const x = u * halfW;
  const archZ =
    Math.pow(v, 1.35) * 0.56 + Math.pow(Math.max(0, v - 0.55) / 0.45, 2.0) * 0.25;
  const archY =
    v * length * 0.94 - Math.pow(Math.max(0, v - 0.65) / 0.35, 2.1) * 0.22;

  const cupDepth = (isInner ? 0.085 : 0.065) * Math.sin(v * Math.PI);
  const keelRidge = -0.024 * Math.exp(-u * u * 18) * Math.sin(v * Math.PI);
  const ruffle = 0.015 * Math.sin(v * Math.PI * 5.0) * u * u * Math.sin(v * Math.PI);

  const z = archZ + cupDepth * (1 - u * u) + keelRidge + ruffle;
  const pos = new THREE.Vector3(x, archY, z);

  const eps = 0.015;
  const uNext = Math.min(1, u + eps);
  const vNext = Math.min(1, v + eps);

  const evalPos = (uu: number, vv: number) => {
    const wf =
      Math.sin(Math.pow(vv, 0.72) * Math.PI) * (0.26 + 0.74 * (1 - Math.pow(vv, 2.6))) +
      0.045 * (1 - vv);
    const xx = uu * maxWidth * wf;
    const az =
      Math.pow(vv, 1.35) * 0.56 + Math.pow(Math.max(0, vv - 0.55) / 0.45, 2.0) * 0.25;
    const ay =
      vv * length * 0.94 - Math.pow(Math.max(0, vv - 0.65) / 0.35, 2.1) * 0.22;
    const cd = (isInner ? 0.085 : 0.065) * Math.sin(vv * Math.PI);
    const kr = -0.024 * Math.exp(-uu * uu * 18) * Math.sin(vv * Math.PI);
    const rf = 0.015 * Math.sin(vv * Math.PI * 5.0) * uu * uu * Math.sin(vv * Math.PI);
    return new THREE.Vector3(xx, ay, az + cd * (1 - uu * uu) + kr + rf);
  };

  const pU = evalPos(uNext, v);
  const pV = evalPos(u, vNext);
  const tangentU = pU.sub(pos).normalize();
  const tangentV = pV.sub(pos).normalize();
  const normal = new THREE.Vector3().crossVectors(tangentU, tangentV).normalize();

  return { pos, normal, tangentU, tangentV };
}

function sampleBotanicalPetalColor(
  kind: LilyColorKind,
  u: number,
  v: number,
  seed: number,
  isBud?: boolean,
): THREE.Color {
  const edgeDist = Math.abs(u);
  const throat = Math.max(0, 1 - v * 2.7);
  const midrib = Math.exp(-u * u * 10);
  const spotSeed = Math.sin(seed * 91.7 + u * 19.3 + v * 37.1);
  const isFreckle = !isBud && v > 0.16 && v < 0.62 && edgeDist < 0.68 && spotSeed > 0.77;

  const col = new THREE.Color();

  if (isBud) {
    const baseGreen = new THREE.Color('#84cc16');
    const midCream = new THREE.Color('#fde68a');
    const tipColor =
      kind === 'white'
        ? new THREE.Color('#fff1f2')
        : kind === 'red'
          ? new THREE.Color('#f43f5e')
          : kind === 'lavender'
            ? new THREE.Color('#d8b4fe')
            : new THREE.Color('#f472b6');
    col.copy(baseGreen).lerp(midCream, THREE.MathUtils.smoothstep(v, 0.15, 0.62));
    col.lerp(tipColor, THREE.MathUtils.smoothstep(v, 0.42, 0.94));
    return col;
  }

  if (kind === 'pink') {
    const base = new THREE.Color('#ff4fa3');
    const deep = new THREE.Color('#be185d');
    const tip = new THREE.Color('#fbcfe8');
    const throatGreen = new THREE.Color('#d9f99d');

    col.copy(base).lerp(tip, Math.pow(edgeDist, 1.5) * 0.55 + Math.pow(v, 2.0) * 0.35);
    col.lerp(deep, midrib * (1 - v * 0.45) * 0.52);
    col.lerp(throatGreen, throat * 0.45);
    if (isFreckle) col.lerp(new THREE.Color('#831843'), 0.68);
  } else if (kind === 'white') {
    const base = new THREE.Color('#fff7fa');
    const edge = new THREE.Color('#ffffff');
    const blush = new THREE.Color('#f9a8d4');
    const throatGreen = new THREE.Color('#bef264');

    col.copy(base).lerp(edge, Math.pow(v, 1.4) * 0.5 + edgeDist * 0.3);
    col.lerp(blush, midrib * 0.36);
    col.lerp(throatGreen, throat * 0.52);
    if (isFreckle) col.lerp(new THREE.Color('#db2777'), 0.48);
  } else if (kind === 'red') {
    const base = new THREE.Color('#f42968');
    const deep = new THREE.Color('#9f1239');
    const tip = new THREE.Color('#fb7185');
    const throatGold = new THREE.Color('#fde047');

    col.copy(base).lerp(tip, Math.pow(edgeDist, 1.6) * 0.32 + Math.pow(v, 2.1) * 0.28);
    col.lerp(deep, midrib * 0.48 + (1 - v) * 0.22);
    col.lerp(throatGold, throat * 0.35);
    if (isFreckle) col.lerp(new THREE.Color('#4c0519'), 0.62);
  } else if (kind === 'lavender') {
    const base = new THREE.Color('#c084fc');
    const deep = new THREE.Color('#7e22ce');
    const tip = new THREE.Color('#f5d0fe');
    const throatCream = new THREE.Color('#fef9c3');

    col.copy(base).lerp(tip, Math.pow(edgeDist, 1.4) * 0.5 + Math.pow(v, 1.9) * 0.38);
    col.lerp(deep, midrib * 0.45);
    col.lerp(throatCream, throat * 0.42);
    if (isFreckle) col.lerp(new THREE.Color('#581c87'), 0.62);
  } else {
    // Warm blush peach lily
    const base = new THREE.Color('#fda4af');
    const deep = new THREE.Color('#f43f5e');
    const tip = new THREE.Color('#ffedd5');
    const throatGold = new THREE.Color('#fef08a');

    col.copy(base).lerp(tip, Math.pow(edgeDist, 1.4) * 0.55 + Math.pow(v, 2.0) * 0.4);
    col.lerp(deep, midrib * 0.42);
    col.lerp(throatGold, throat * 0.45);
    if (isFreckle) col.lerp(new THREE.Color('#9f1239'), 0.55);
  }

  return col;
}

export function createPhotoTileMaterial(
  atlasTexture: THREE.CanvasTexture,
  uniformsOut: {
    uTime: { value: number };
    uZoomReveal: { value: number };
    uPhotoVividness: { value: number };
    uHoveredPixelId: { value: number };
  },
): THREE.MeshPhysicalMaterial {
  const mat = new THREE.MeshPhysicalMaterial({
    map: atlasTexture,
    color: 0xffffff,
    roughness: 0.32,
    metalness: 0.05,
    clearcoat: 0.6,
    clearcoatRoughness: 0.22,
    sheen: 0.45,
    sheenRoughness: 0.5,
    sheenColor: new THREE.Color('#fbcfe8'),
    side: THREE.FrontSide,
  });

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniformsOut.uTime;
    shader.uniforms.uZoomReveal = uniformsOut.uZoomReveal;
    shader.uniforms.uPhotoVividness = uniformsOut.uPhotoVividness;
    shader.uniforms.uHoveredPixelId = uniformsOut.uHoveredPixelId;

    shader.vertexShader =
      `
      attribute vec4 aTileUv;
      attribute vec3 aTileTint;
      attribute float aTileSeed;
      attribute float aPixelId;
      varying vec4 vTileUv;
      varying vec2 vCellUv;
      varying vec3 vTileTint;
      varying float vTileSeed;
      varying float vPixelId;
      ` + shader.vertexShader;

    shader.vertexShader = shader.vertexShader.replace(
      '#include <uv_vertex>',
      `
      #include <uv_vertex>
      vTileUv = vec4(aTileUv.xy + uv * aTileUv.zw, aTileUv.zw);
      vCellUv = uv;
      vTileTint = aTileTint;
      vTileSeed = aTileSeed;
      vPixelId = aPixelId;
      `,
    );

    shader.fragmentShader =
      `
      uniform float uTime;
      uniform float uZoomReveal;
      uniform float uPhotoVividness;
      uniform float uHoveredPixelId;
      varying vec4 vTileUv;
      varying vec2 vCellUv;
      varying vec3 vTileTint;
      varying float vTileSeed;
      varying float vPixelId;
      ` + shader.fragmentShader;

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `
      vec4 photoSample = texture2D( map, vTileUv.xy );
      float photoLum = dot(photoSample.rgb, vec3(0.299, 0.587, 0.114));
      vec3 botanicalMix = mix(vTileTint * (0.46 + 0.78 * photoLum), photoSample.rgb * mix(vec3(1.0), vTileTint * 1.18, 0.42), 0.42);
      float reveal = clamp(uZoomReveal * 0.85 + uPhotoVividness * 0.52, 0.12, 0.98);
      vec3 tileAlbedo = mix(botanicalMix, photoSample.rgb, reveal);

      float borderX = smoothstep(0.0, 0.06, vCellUv.x) * smoothstep(1.0, 0.94, vCellUv.x);
      float borderY = smoothstep(0.0, 0.06, vCellUv.y) * smoothstep(1.0, 0.94, vCellUv.y);
      float gridShade = mix(0.72, 1.04, borderX * borderY);
      diffuseColor.rgb *= tileAlbedo * gridShade;
      `,
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `
      #include <emissivemap_fragment>
      float shimmer = 0.5 + 0.5 * sin(uTime * 1.85 + vTileSeed * 18.84);
      float glint = pow(shimmer, 7.0) * 0.14;
      float isHovered = 1.0 - step(0.5, abs(vPixelId - uHoveredPixelId));
      vec3 hoverGlow = vec3(1.0, 0.72, 0.9) * isHovered * 0.55;
      totalEmissiveRadiance += vTileTint * glint + diffuseColor.rgb * 0.06 + hoverGlow;
      `,
    );
  };

  mat.customProgramCacheKey = () => 'pixel-flower-mosaic-v3';
  return mat;
}

function seededRandom(seed: number): () => number {
  let s = (seed * 9301 + 49297) % 233280;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

export function buildLilyAssembly(
  config: FlowerConfig,
  flowerIndex: number,
  tileGeometry: THREE.BufferGeometry,
  tileMaterial: THREE.MeshPhysicalMaterial,
  slots: TileSlotMeta[],
  photos: UploadedPhoto[],
  pixelSize: PixelSizeMode,
  nextGlobalPixelId: { value: number },
): LilyAssembly {
  const group = new THREE.Group();
  group.position.set(config.position[0], config.position[1], config.position[2]);
  group.rotation.set(config.rotation[0], config.rotation[1], config.rotation[2]);
  group.scale.setScalar(config.scale);

  const headGroup = new THREE.Group();
  group.add(headGroup);

  // Filter slots assigned to this flower if admin assigned specific photos
  const allowedPhotoIds = new Set(
    photos
      .filter(
        (p) =>
          !p.assignedFlowerIds ||
          p.assignedFlowerIds === 'all' ||
          p.assignedFlowerIds.includes(config.id),
      )
      .map((p) => p.id),
  );
  const flowerSlots =
    allowedPhotoIds.size > 0
      ? slots.filter((s) => allowedPhotoIds.has(s.photoId))
      : slots;
  const activeSlots = flowerSlots.length > 0 ? flowerSlots : slots;

  const vSteps = pixelSize === 'small' ? 20 : pixelSize === 'medium' ? 14 : 9;
  const uMaxCols = pixelSize === 'small' ? 10 : pixelSize === 'medium' ? 7 : 5;
  const baseTileSize = pixelSize === 'small' ? 0.052 : pixelSize === 'medium' ? 0.075 : 0.114;

  const petals: PetalInstancedBuild[] = [];
  let totalTiles = 0;

  const dummyPos = new THREE.Vector3();
  const rotMat = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const scaleVec = new THREE.Vector3();
  const mat4 = new THREE.Matrix4();

  for (let p = 0; p < 6; p++) {
    const isInner = p % 2 === 1;
    const azimuth = (p * Math.PI) / 3;

    const rand = seededRandom(flowerIndex * 137 + p * 43 + 11);
    const shuffledSlotIndices = Array.from({ length: activeSlots.length }, (_, i) => i);
    for (let i = shuffledSlotIndices.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [shuffledSlotIndices[i], shuffledSlotIndices[j]] = [
        shuffledSlotIndices[j],
        shuffledSlotIndices[i],
      ];
    }

    const transforms: THREE.Matrix4[] = [];
    const uvAttrs: number[] = [];
    const tintAttrs: number[] = [];
    const seedAttrs: number[] = [];
    const pixelIdAttrs: number[] = [];
    const tilesMeta: PetalTileInstanceMeta[] = [];

    let tileCursor = 0;

    for (let iv = 0; iv < vSteps; iv++) {
      const v = (iv + 0.5) / vSteps;
      const widthEnvelope =
        Math.sin(Math.pow(v, 0.72) * Math.PI) * (0.28 + 0.72 * (1 - Math.pow(v, 2.5))) + 0.08;
      const cols = Math.max(1, Math.round(uMaxCols * widthEnvelope));

      for (let iu = 0; iu < cols; iu++) {
        const u = cols === 1 ? 0 : ((iu + 0.5) / cols) * 2 - 1;
        const { pos, normal, tangentU, tangentV } = evaluateLilyPetalSurface(u, v, isInner);

        const sizeScale = 0.78 + 0.32 * Math.sin(v * Math.PI);
        const tileW = baseTileSize * sizeScale;
        const tileH = (1.16 / vSteps) * 0.96;

        rotMat.makeBasis(tangentU, tangentV, normal);
        quat.setFromRotationMatrix(rotMat);

        dummyPos.copy(pos);
        scaleVec.set(tileW, tileH, baseTileSize * 0.75);
        mat4.compose(dummyPos, quat, scaleVec);
        transforms.push(mat4.clone());

        const slotIdx = shuffledSlotIndices[tileCursor % shuffledSlotIndices.length];
        const slot = activeSlots[slotIdx];
        tileCursor++;

        const globalId = nextGlobalPixelId.value++;
        uvAttrs.push(slot.uvRect[0], slot.uvRect[1], slot.uvRect[2], slot.uvRect[3]);
        const col = sampleBotanicalPetalColor(
          config.colorKind,
          u,
          v,
          tileCursor + p * 17,
          config.isBud,
        );
        tintAttrs.push(col.r, col.g, col.b);
        seedAttrs.push(rand());
        pixelIdAttrs.push(globalId);

        tilesMeta.push({
          slot,
          globalPixelId: globalId,
          localPixelNumber: totalTiles + transforms.length,
          uNorm: u,
          vNorm: v,
        });
      }
    }

    const count = transforms.length;
    totalTiles += count;

    const instMesh = new THREE.InstancedMesh(tileGeometry, tileMaterial, count);
    instMesh.castShadow = true;
    instMesh.receiveShadow = true;
    instMesh.userData = {
      flowerIndex,
      flowerId: config.id,
      petalIndex: p,
      tilesMeta,
    };

    for (let i = 0; i < count; i++) {
      instMesh.setMatrixAt(i, transforms[i]);
    }
    instMesh.instanceMatrix.needsUpdate = true;

    instMesh.geometry = tileGeometry.clone();
    instMesh.geometry.setAttribute(
      'aTileUv',
      new THREE.InstancedBufferAttribute(new Float32Array(uvAttrs), 4),
    );
    instMesh.geometry.setAttribute(
      'aTileTint',
      new THREE.InstancedBufferAttribute(new Float32Array(tintAttrs), 3),
    );
    instMesh.geometry.setAttribute(
      'aTileSeed',
      new THREE.InstancedBufferAttribute(new Float32Array(seedAttrs), 1),
    );
    instMesh.geometry.setAttribute(
      'aPixelId',
      new THREE.InstancedBufferAttribute(new Float32Array(pixelIdAttrs), 1),
    );
    instMesh.computeBoundingSphere();

    const petalPivot = new THREE.Group();
    petalPivot.rotation.y = azimuth;

    const baseTiltX = config.isBud
      ? isInner
        ? -0.34
        : -0.26
      : isInner
        ? 0.25
        : 0.36;
    const closedTiltX = isInner ? -0.46 : -0.38;

    instMesh.rotation.x = baseTiltX;
    petalPivot.add(instMesh);
    headGroup.add(petalPivot);

    petals.push({
      mesh: instMesh,
      isInner,
      baseTiltX,
      closedTiltX,
      azimuth,
      tilesMeta,
    });
  }

  const stamenGroup = config.isBud ? new THREE.Group() : buildLilyCenter(config.colorKind);
  headGroup.add(stamenGroup);

  const hitProxy = new THREE.Mesh(
    new THREE.SphereGeometry(0.84, 12, 12),
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  hitProxy.position.set(0, 0.45, 0);
  hitProxy.userData = { flowerIndex, flowerId: config.id };
  headGroup.add(hitProxy);

  return {
    flowerIndex,
    config,
    group,
    headGroup,
    petals,
    stamenGroup,
    hitProxy,
    totalTiles,
  };
}

function buildLilyCenter(kind: LilyColorKind): THREE.Group {
  const centerGroup = new THREE.Group();

  const calyxMat = new THREE.MeshStandardMaterial({
    color: '#4d7c0f',
    roughness: 0.55,
    metalness: 0.02,
  });
  const calyxGeo = new THREE.ConeGeometry(0.11, 0.26, 12);
  calyxGeo.rotateX(Math.PI);
  const calyx = new THREE.Mesh(calyxGeo, calyxMat);
  calyx.position.y = -0.09;
  centerGroup.add(calyx);

  const pistilCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0.02, 0.28, 0.01),
    new THREE.Vector3(0.04, 0.58, 0.03),
  ]);
  const pistilGeo = new THREE.TubeGeometry(pistilCurve, 12, 0.018, 8, false);
  const pistilMat = new THREE.MeshStandardMaterial({
    color: kind === 'white' ? '#bef264' : '#f5d0fe',
    roughness: 0.4,
  });
  centerGroup.add(new THREE.Mesh(pistilGeo, pistilMat));

  const stigmaMat = new THREE.MeshStandardMaterial({
    color: kind === 'red' ? '#fda4af' : '#a3e635',
    roughness: 0.35,
  });
  const stigma = new THREE.Mesh(new THREE.SphereGeometry(0.038, 10, 10), stigmaMat);
  stigma.position.set(0.04, 0.6, 0.03);
  stigma.scale.set(1.2, 0.75, 1.2);
  centerGroup.add(stigma);

  const filamentMat = new THREE.MeshStandardMaterial({
    color: kind === 'white' ? '#ecfccb' : '#fbcfe8',
    roughness: 0.45,
  });
  const antherMat = new THREE.MeshStandardMaterial({
    color: '#b45309',
    emissive: '#78350f',
    emissiveIntensity: 0.28,
    roughness: 0.68,
  });

  for (let i = 0; i < 6; i++) {
    const angle = (i * Math.PI) / 3 + Math.PI / 6;
    const dx = Math.sin(angle);
    const dz = Math.cos(angle);

    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0.02, 0),
      new THREE.Vector3(dx * 0.1, 0.26, dz * 0.1),
      new THREE.Vector3(dx * 0.22, 0.48, dz * 0.22),
      new THREE.Vector3(dx * 0.28, 0.56, dz * 0.28),
    ]);
    const filament = new THREE.Mesh(new THREE.TubeGeometry(curve, 10, 0.009, 6, false), filamentMat);
    centerGroup.add(filament);

    const anther = new THREE.Mesh(new THREE.CapsuleGeometry(0.02, 0.085, 4, 8), antherMat);
    anther.position.set(dx * 0.29, 0.57, dz * 0.29);
    anther.rotation.set(dz * 0.7, angle, -dx * 0.7);
    centerGroup.add(anther);
  }

  return centerGroup;
}
