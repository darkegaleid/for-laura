import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import type {
  AdminAuthStatus,
  AdminBouquetSummary,
  AdminPinStatus,
  BackupEntry,
  BouquetSiteConfig,
  EntranceSecurityConfig,
  FlowerConfig,
  FlowerCurtainConfig,
  LockScreenUiConfig,
  PinFailureAnimConfig,
  PublicEntranceStateResponse,
  UploadedPhoto,
} from './src/types/bouquet.ts';
import {
  createDefaultBouquetConfig,
  createDefaultEntranceConfig,
} from './src/utils/defaultBouquetConfig.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://qebvsswpesywtifyhtyt.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFlYnZzc3dwZXN5d3RpZnlodHl0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5NTM1Mjg0OSwiZXhwIjoyMTEwOTI4ODQ5fQ.YvVdbrxmWj0-xdZ81crzTb2eEmkVd8Eb-1jPWNpMwdQ';

const DATA_DIR = process.env.VERCEL
  ? path.resolve('/tmp', 'data')
  : path.resolve(__dirname, 'data');
const PHOTOS_DIR = path.resolve(DATA_DIR, 'media', 'photos');
const AUDIO_DIR = path.resolve(DATA_DIR, 'media', 'audio');
const STORE_PATH = path.resolve(DATA_DIR, 'bouquet-store.json');
const AUTH_PATH = path.resolve(DATA_DIR, 'auth.json');
const PIN_SECRETS_PATH = path.resolve(DATA_DIR, 'pin-secrets.json');
const VISITOR_GATES_PATH = path.resolve(DATA_DIR, 'visitor-gates.json');

try {
  fs.mkdirSync(PHOTOS_DIR, { recursive: true });
  fs.mkdirSync(AUDIO_DIR, { recursive: true });
} catch {}

async function uploadToSupabase(bucket: string, remotePath: string, body: Buffer | string, contentType: string) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return;
  try {
    const url = `${SUPABASE_URL}/storage/v1/object/${bucket}/${encodeURIComponent(remotePath)}`;
    const fetchBody = (body instanceof Buffer ? new Uint8Array(body) : body) as unknown as BodyInit;
    await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': contentType,
        'x-upsert': 'true',
      },
      body: fetchBody,
    });
  } catch (err) {
    console.error('Supabase upload error:', err);
  }
}

async function fetchFromSupabase(bucket: string, filename: string): Promise<string | null> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  try {
    const url = `${SUPABASE_URL}/storage/v1/object/authenticated/${bucket}/${filename}`;
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
    });
    if (res.ok) {
      return await res.text();
    }
  } catch {}
  return null;
}

async function syncAllFromSupabase() {
  const storeRaw = await fetchFromSupabase('app-data', 'bouquet-store.json');
  if (storeRaw) {
    try {
      const parsed = JSON.parse(storeRaw);
      if (parsed && typeof parsed.defaultSlug === 'string' && parsed.bouquets) {
        storeCache = parsed;
        try { fs.writeFileSync(STORE_PATH, storeRaw, 'utf8'); } catch {}
      }
    } catch {}
  }
  const authRaw = await fetchFromSupabase('app-data', 'auth.json');
  if (authRaw) {
    try { fs.writeFileSync(AUTH_PATH, authRaw, 'utf8'); } catch {}
  }
  const pinRaw = await fetchFromSupabase('app-data', 'pin-secrets.json');
  if (pinRaw) {
    try {
      const parsed = JSON.parse(pinRaw);
      if (parsed) {
        pinSecretsCache = parsed;
        try { fs.writeFileSync(PIN_SECRETS_PATH, pinRaw, 'utf8'); } catch {}
      }
    } catch {}
  }
}

// Ephemeral in-memory fallback for signing session tokens when SESSION_SECRET env var isn't set
const SESSION_SECRET =
  process.env.SESSION_SECRET && process.env.SESSION_SECRET.trim().length >= 16
    ? process.env.SESSION_SECRET.trim()
    : crypto.randomBytes(32).toString('hex');

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const revokedTokens = new Map<string, number>();

// Admin login rate limiter (per IP)
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

// Public PIN rate limiter (per IP + slug)
const pinAttempts = new Map<
  string,
  { failedCount: number; windowResetAt: number; lockedUntil: number }
>();

interface StoredAuthRecord {
  salt: string;
  hash: string;
  createdAt: string;
}

interface LegacyBouquetStoreData {
  published: BouquetSiteConfig;
  draft: BouquetSiteConfig;
  backups: BackupEntry[];
}

interface SingleBouquetRecord {
  slug: string;
  published: BouquetSiteConfig;
  draft: BouquetSiteConfig;
  backups: BackupEntry[];
}

interface MultiBouquetStoreData {
  defaultSlug: string;
  bouquets: Record<string, SingleBouquetRecord>;
}

interface PinSecretHash {
  salt: string;
  hash: string;
  updatedAt: string;
}

interface BouquetPinSecretRecord {
  draft?: PinSecretHash | null;
  published?: PinSecretHash | null;
}

type PinSecretsMap = Record<string, BouquetPinSecretRecord>;

interface VisitorGateRecord {
  usedFakeCount: number;
  lastTriggeredAt: string;
}

type VisitorGatesMap = Record<string, VisitorGateRecord>;

function writeJsonAtomic(filePath: string, payload: unknown) {
  const tmpPath = `${filePath}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), 'utf8');
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    console.error('Local file write error:', err);
  }
  const filename = path.basename(filePath);
  uploadToSupabase('app-data', filename, JSON.stringify(payload, null, 2), 'application/json').catch((err) => {
    console.error('Supabase upload error:', err);
  });
}

function normalizeSlug(raw: unknown, fallback = 'pixel-flower-bouquet'): string {
  if (typeof raw !== 'string') return fallback;
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, 64);
  return cleaned || fallback;
}

function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.cookie;
  const result: Record<string, string> = {};
  if (!header) return result;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) {
      try {
        result[key] = decodeURIComponent(val);
      } catch {
        result[key] = val;
      }
    }
  }
  return result;
}

function isRequestHttps(req: Request): boolean {
  const xfProto = String(req.headers['x-forwarded-proto'] || '').toLowerCase();
  return req.secure || xfProto.includes('https');
}

function setHttpCookie(
  res: Response,
  req: Request,
  name: string,
  value: string,
  maxAgeMs: number,
) {
  const isHttps = isRequestHttps(req);
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    `Max-Age=${Math.max(0, Math.floor(maxAgeMs / 1000))}`,
  ];
  if (isHttps) {
    parts.push('SameSite=None', 'Secure', 'Partitioned');
  } else {
    parts.push('SameSite=Lax');
  }
  res.append('Set-Cookie', parts.join('; '));
}

function clearHttpCookie(res: Response, req: Request, name: string) {
  setHttpCookie(res, req, name, '', 0);
}

function verifySameOriginIfPresent(req: Request): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const originHost = new URL(origin).host.toLowerCase();
    const hostHeader = String(req.headers['x-forwarded-host'] || req.headers.host || '')
      .split(',')[0]
      .trim()
      .toLowerCase();
    return Boolean(hostHeader && originHost === hostHeader);
  } catch {
    return false;
  }
}

function readAuthRecord(): StoredAuthRecord | null {
  try {
    if (!fs.existsSync(AUTH_PATH)) return null;
    const raw = fs.readFileSync(AUTH_PATH, 'utf8');
    const parsed = JSON.parse(raw) as StoredAuthRecord;
    if (typeof parsed.salt === 'string' && typeof parsed.hash === 'string') {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function getEnvPasscode(): string | null {
  const val = process.env.ADMIN_PASSCODE;
  return val && val.trim().length > 0 ? val.trim() : null;
}

function getEnvBouquetPin(): string | null {
  const val = process.env.BOUQUET_PIN?.trim() || '';
  return /^\d{6}$/.test(val) ? val : null;
}

function isFirstRunSetupNeeded(): boolean {
  if (getEnvPasscode() !== null) return false;
  return readAuthRecord() === null;
}

function verifyPassword(candidate: string): boolean {
  const envPass = getEnvPasscode();
  if (envPass !== null) {
    const a = crypto.createHash('sha256').update(candidate).digest();
    const b = crypto.createHash('sha256').update(envPass).digest();
    return crypto.timingSafeEqual(a, b);
  }
  const record = readAuthRecord();
  if (!record) return false;
  const derived = crypto.scryptSync(candidate, record.salt, 64);
  const expected = Buffer.from(record.hash, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

function signSessionToken(): string {
  const jti = crypto.randomBytes(16).toString('hex');
  const exp = Date.now() + TOKEN_TTL_MS;
  const payload = Buffer.from(JSON.stringify({ jti, exp, role: 'admin' })).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifySessionToken(token: string): { valid: boolean; jti?: string; exp?: number } {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return { valid: false };
    const [payload, sig] = parts;
    const expectedSig = crypto
      .createHmac('sha256', SESSION_SECRET)
      .update(payload)
      .digest('base64url');
    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return { valid: false };
    }
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      jti: string;
      exp: number;
      role: string;
    };
    if (decoded.role !== 'admin' || typeof decoded.exp !== 'number' || Date.now() > decoded.exp) {
      return { valid: false };
    }
    if (revokedTokens.has(decoded.jti)) {
      return { valid: false };
    }
    return { valid: true, jti: decoded.jti, exp: decoded.exp };
  } catch {
    return { valid: false };
  }
}

function extractBearerToken(req: Request): string | null {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return null;
  return auth.slice(7).trim() || null;
}

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const token = extractBearerToken(req);
  if (!token || !verifySessionToken(token).valid) {
    res.status(401).json({ error: 'Administrator authentication required' });
    return;
  }
  next();
}

// --- PIN SECRETS STORE (NEVER EXPOSED IN PUBLIC OR BOUQUET JSON) ---
function loadPinSecrets(): PinSecretsMap {
  try {
    if (fs.existsSync(PIN_SECRETS_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(PIN_SECRETS_PATH, 'utf8'));
      if (parsed && typeof parsed === 'object') {
        return parsed as PinSecretsMap;
      }
    }
  } catch {
    // Reinitialize if corrupt
  }
  return {};
}

let pinSecretsCache: PinSecretsMap = loadPinSecrets();

function savePinSecrets(next: PinSecretsMap) {
  pinSecretsCache = next;
  writeJsonAtomic(PIN_SECRETS_PATH, next);
}

function hashPin(slug: string, pin: string): PinSecretHash {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(`bouquet-pin:${slug}:${pin}`, salt, 64).toString('hex');
  return {
    salt,
    hash,
    updatedAt: new Date().toISOString(),
  };
}

function verifyPinAgainstHash(slug: string, pin: string, secret: PinSecretHash): boolean {
  try {
    const derived = crypto.scryptSync(`bouquet-pin:${slug}:${pin}`, secret.salt, 64);
    const expected = Buffer.from(secret.hash, 'hex');
    if (derived.length !== expected.length) return false;
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

function hasPublishedPin(slug: string): boolean {
  const rec = pinSecretsCache[slug];
  if (rec?.published?.hash) return true;
  if (slug === storeCache.defaultSlug && getEnvBouquetPin() !== null) return true;
  return false;
}

function hasDraftPin(slug: string): boolean {
  const rec = pinSecretsCache[slug];
  if (rec?.draft?.hash || rec?.published?.hash) return true;
  if (slug === storeCache.defaultSlug && getEnvBouquetPin() !== null) return true;
  return false;
}

function verifyPublishedPin(slug: string, candidatePin: string): boolean {
  const rec = pinSecretsCache[slug];
  if (rec?.published?.hash) {
    return verifyPinAgainstHash(slug, candidatePin, rec.published);
  }
  if (slug === storeCache.defaultSlug) {
    const envPin = getEnvBouquetPin();
    if (envPin) {
      const a = crypto.createHash('sha256').update(candidatePin).digest();
      const b = crypto.createHash('sha256').update(envPin).digest();
      return crypto.timingSafeEqual(a, b);
    }
  }
  return false;
}

function verifyDraftOrPublishedPin(slug: string, candidatePin: string): boolean {
  const rec = pinSecretsCache[slug];
  const target = rec?.draft?.hash ? rec.draft : rec?.published;
  if (target?.hash) {
    return verifyPinAgainstHash(slug, candidatePin, target);
  }
  if (slug === storeCache.defaultSlug) {
    const envPin = getEnvBouquetPin();
    if (envPin) {
      const a = crypto.createHash('sha256').update(candidatePin).digest();
      const b = crypto.createHash('sha256').update(envPin).digest();
      return crypto.timingSafeEqual(a, b);
    }
  }
  return false;
}

// --- VISITOR GATE TRACKER (FAKE FAILURE ONCE PER VISITOR PER BOUQUET) ---
function loadVisitorGates(): VisitorGatesMap {
  try {
    if (fs.existsSync(VISITOR_GATES_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(VISITOR_GATES_PATH, 'utf8'));
      if (parsed && typeof parsed === 'object') {
        return parsed as VisitorGatesMap;
      }
    }
  } catch {
    // Reinitialize if corrupt
  }
  return {};
}

let visitorGatesCache: VisitorGatesMap = loadVisitorGates();

function saveVisitorGates(next: VisitorGatesMap) {
  visitorGatesCache = next;
  writeJsonAtomic(VISITOR_GATES_PATH, next);
}

function signVisitorId(vid: string): string {
  const sig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(`vid:${vid}`)
    .digest('base64url');
  return `${vid}.${sig}`;
}

function verifySignedVisitorId(token: string | undefined): string | null {
  if (!token) return null;
  const idx = token.lastIndexOf('.');
  if (idx <= 0) return null;
  const vid = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  const expected = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(`vid:${vid}`)
    .digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  return vid;
}

function resolveVisitorId(req: Request, res: Response): string {
  const cookies = parseCookies(req);
  const verified = verifySignedVisitorId(cookies.bouquet_vid);
  if (verified) return verified;

  // Deterministic fallback for cookie-restricted contexts so fake failure still triggers once per visitor
  const ip = req.ip || 'unknown';
  const ua = String(req.headers['user-agent'] || '');
  const deterministic =
    'v-' +
    crypto
      .createHmac('sha256', SESSION_SECRET)
      .update(`anon:${ip}|${ua}`)
      .digest('hex')
      .slice(0, 24);
  setHttpCookie(res, req, 'bouquet_vid', signVisitorId(deterministic), 90 * 24 * 60 * 60 * 1000);
  return deterministic;
}

// --- UNLOCK SESSION TOKENS (SCOPED TO SLUG) ---
function signUnlockToken(slug: string, durationMinutes: number): {
  token: string;
  expiresAt: number;
} {
  const effectiveMinutes = Math.max(5, durationMinutes);
  const expiresAt = Date.now() + effectiveMinutes * 60 * 1000;
  const jti = crypto.randomBytes(12).toString('hex');
  const payload = Buffer.from(
    JSON.stringify({ typ: 'bouquet_unlock', slug, jti, exp: expiresAt }),
  ).toString('base64url');
  const sig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(`unlock:${payload}`)
    .digest('base64url');
  return { token: `${payload}.${sig}`, expiresAt };
}

function verifyUnlockToken(token: string | undefined | null, expectedSlug: string): boolean {
  if (!token) return false;
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return false;
    const [payload, sig] = parts;
    const expectedSig = crypto
      .createHmac('sha256', SESSION_SECRET)
      .update(`unlock:${payload}`)
      .digest('base64url');
    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return false;
    }
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      typ: string;
      slug: string;
      exp: number;
    };
    return (
      decoded.typ === 'bouquet_unlock' &&
      decoded.slug === expectedSlug &&
      typeof decoded.exp === 'number' &&
      Date.now() <= decoded.exp
    );
  } catch {
    return false;
  }
}

function getUnlockCookieName(slug: string): string {
  const shortHash = crypto.createHash('sha256').update(slug).digest('hex').slice(0, 10);
  return `bouquet_unlock_${shortHash}`;
}

function isRequestUnlockedForSlug(req: Request, slug: string): boolean {
  const bearer = extractBearerToken(req);
  if (verifyUnlockToken(bearer, slug)) return true;
  const cookies = parseCookies(req);
  const cookieToken = cookies[getUnlockCookieName(slug)];
  if (verifyUnlockToken(cookieToken, slug)) return true;
  // Also allow authenticated Admin sessions
  if (bearer && verifySessionToken(bearer).valid) return true;
  return false;
}

// --- NORMALIZATION & SANITIZATION ---
const safeStr = (val: unknown, maxLen: number, def: string) =>
  typeof val === 'string' ? val.slice(0, maxLen) : def;

const safeNum = (val: unknown, min: number, max: number, def: number) =>
  typeof val === 'number' && Number.isFinite(val) ? Math.min(max, Math.max(min, val)) : def;

const safeBool = (val: unknown, def: boolean) => (typeof val === 'boolean' ? val : def);

function sanitizeFailureAnim(
  raw: Partial<PinFailureAnimConfig> | undefined,
  fallback: PinFailureAnimConfig,
): PinFailureAnimConfig {
  const validStyles = new Set(['wiggle-bloom', 'bounce-blush', 'spin-shy', 'peek-petal']);
  const customMessages = Array.isArray(raw?.customMessages)
    ? raw.customMessages
        .filter((m): m is string => typeof m === 'string' && m.trim().length > 0)
        .slice(0, 10)
        .map((m) => m.slice(0, 140))
    : fallback.customMessages;
  return {
    message: safeStr(raw?.message, 140, fallback.message),
    customMessages: customMessages.length > 0 ? customMessages : fallback.customMessages,
    style: validStyles.has(String(raw?.style))
      ? (raw!.style as PinFailureAnimConfig['style'])
      : fallback.style,
    shakeIntensity: safeNum(raw?.shakeIntensity, 0.2, 2.0, fallback.shakeIntensity),
    showTeasingFlower: safeBool(raw?.showTeasingFlower, fallback.showTeasingFlower),
    teasingFlowerSize: safeNum(raw?.teasingFlowerSize, 0.6, 1.6, fallback.teasingFlowerSize),
    durationMs: Math.round(safeNum(raw?.durationMs, 800, 5000, fallback.durationMs)),
    playSound: safeBool(raw?.playSound, fallback.playSound),
    showParticles: safeBool(raw?.showParticles, fallback.showParticles),
  };
}

function sanitizeLockScreenUi(
  raw: Partial<LockScreenUiConfig> | undefined,
  fallback: LockScreenUiConfig,
): LockScreenUiConfig {
  const validFonts = new Set(['editorial', 'mono', 'modern']);
  const validSizes = new Set(['sm', 'md', 'lg']);
  const validSpacing = new Set(['tight', 'normal', 'wide']);
  return {
    heading: safeStr(raw?.heading, 120, fallback.heading),
    description: safeStr(raw?.description, 220, fallback.description),
    backgroundColor: safeStr(raw?.backgroundColor, 24, fallback.backgroundColor),
    accentColor: safeStr(raw?.accentColor, 24, fallback.accentColor),
    inputBorderColor: safeStr(raw?.inputBorderColor, 24, fallback.inputBorderColor),
    textColor: safeStr(raw?.textColor, 24, fallback.textColor),
    secondaryTextColor: safeStr(raw?.secondaryTextColor, 24, fallback.secondaryTextColor),
    fontFamily: validFonts.has(String(raw?.fontFamily))
      ? (raw!.fontFamily as LockScreenUiConfig['fontFamily'])
      : fallback.fontFamily,
    inputSize: validSizes.has(String(raw?.inputSize))
      ? (raw!.inputSize as LockScreenUiConfig['inputSize'])
      : fallback.inputSize,
    inputSpacing: validSpacing.has(String(raw?.inputSpacing))
      ? (raw!.inputSpacing as LockScreenUiConfig['inputSpacing'])
      : fallback.inputSpacing,
    showMoon: safeBool(raw?.showMoon, fallback.showMoon),
    showStars: safeBool(raw?.showStars, fallback.showStars),
    petalDensity: Math.round(safeNum(raw?.petalDensity, 0, 48, fallback.petalDensity)),
    showFloralDecor: safeBool(raw?.showFloralDecor, fallback.showFloralDecor),
    animationIntensity: safeNum(raw?.animationIntensity, 0.2, 2.0, fallback.animationIntensity),
    autoSubmit: safeBool(raw?.autoSubmit, fallback.autoSubmit),
    showUnlockButton: safeBool(raw?.showUnlockButton, fallback.showUnlockButton),
    maskInput: safeBool(raw?.maskInput, fallback.maskInput),
  };
}

function sanitizeFlowerCurtain(
  raw: Partial<FlowerCurtainConfig> | undefined,
  fallback: FlowerCurtainConfig,
): FlowerCurtainConfig {
  const validDensities = new Set(['light', 'medium', 'lush', 'extravagant']);
  const validEasing = new Set(['ease-out-cubic', 'ease-in-out-sine', 'silk-dramatic']);
  const flowerColors = Array.isArray(raw?.flowerColors)
    ? raw.flowerColors
        .filter((c): c is string => typeof c === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(c.trim()))
        .slice(0, 8)
    : fallback.flowerColors;
  const minSize = safeNum(raw?.minFlowerSize, 0.35, 1.8, fallback.minFlowerSize);
  const maxSize = Math.max(minSize, safeNum(raw?.maxFlowerSize, 0.5, 2.8, fallback.maxFlowerSize));

  return {
    enabled: safeBool(raw?.enabled, fallback.enabled),
    density: validDensities.has(String(raw?.density))
      ? (raw!.density as FlowerCurtainConfig['density'])
      : fallback.density,
    flowerCount: Math.round(safeNum(raw?.flowerCount, 60, 380, fallback.flowerCount)),
    flowerColors: flowerColors.length > 0 ? flowerColors : fallback.flowerColors,
    minFlowerSize: minSize,
    maxFlowerSize: maxSize,
    layers: Math.round(safeNum(raw?.layers, 2, 5, fallback.layers)),
    openingSpeed: safeNum(raw?.openingSpeed, 0.4, 2.2, fallback.openingSpeed),
    separationDistance: safeNum(raw?.separationDistance, 0.6, 2.0, fallback.separationDistance),
    rotationIntensity: safeNum(raw?.rotationIntensity, 0, 2.2, fallback.rotationIntensity),
    durationSec: safeNum(raw?.durationSec, 2.2, 9.0, fallback.durationSec),
    easing: validEasing.has(String(raw?.easing))
      ? (raw!.easing as FlowerCurtainConfig['easing'])
      : fallback.easing,
    particleEffects: safeBool(raw?.particleEffects, fallback.particleEffects),
    assembleBouquetAfter: safeBool(raw?.assembleBouquetAfter, fallback.assembleBouquetAfter),
  };
}

function sanitizeEntranceConfig(
  raw: Partial<EntranceSecurityConfig> | undefined,
  fallback: EntranceSecurityConfig,
): EntranceSecurityConfig {
  const def = createDefaultEntranceConfig();
  const base = fallback ?? def;
  return {
    pinEnabled: safeBool(raw?.pinEnabled, base.pinEnabled),
    maxAttempts: Math.round(safeNum(raw?.maxAttempts, 3, 20, base.maxAttempts)),
    lockoutMinutes: Math.round(safeNum(raw?.lockoutMinutes, 1, 60, base.lockoutMinutes)),
    sessionDurationMinutes: Math.round(
      safeNum(raw?.sessionDurationMinutes, 0, 1440, base.sessionDurationMinutes),
    ),
    fakeFailure: {
      enabled: safeBool(raw?.fakeFailure?.enabled, base.fakeFailure.enabled),
      count: Math.round(safeNum(raw?.fakeFailure?.count, 1, 3, base.fakeFailure.count)),
      oncePerVisitorPerBouquet: safeBool(
        raw?.fakeFailure?.oncePerVisitorPerBouquet,
        base.fakeFailure.oncePerVisitorPerBouquet,
      ),
      anim: sanitizeFailureAnim(raw?.fakeFailure?.anim, base.fakeFailure.anim),
    },
    wrongPinAnim: sanitizeFailureAnim(raw?.wrongPinAnim, base.wrongPinAnim),
    lockScreen: sanitizeLockScreenUi(raw?.lockScreen, base.lockScreen),
    curtain: sanitizeFlowerCurtain(raw?.curtain, base.curtain),
  };
}

function normalizeStoredConfig(cfg: BouquetSiteConfig): BouquetSiteConfig {
  const defaults = createDefaultBouquetConfig();
  const w = (cfg.wrap ?? {}) as Partial<BouquetSiteConfig['wrap']>;
  const a = (cfg.animation ?? {}) as Partial<BouquetSiteConfig['animation']>;
  const t = (cfg.text ?? {}) as Partial<BouquetSiteConfig['text']>;
  const th = (cfg.theme ?? {}) as Partial<NonNullable<BouquetSiteConfig['theme']>>;
  const sh = (cfg.sharing ?? {}) as Partial<NonNullable<BouquetSiteConfig['sharing']>>;
  const isLegacyWrap = w.ribbonForwardOffset === undefined;
  return {
    ...cfg,
    flowers: Array.isArray(cfg.flowers)
      ? cfg.flowers.map((f) => ({
          ...f,
          bloomIntensity: f.bloomIntensity ?? 1.0,
          swayIntensity: f.swayIntensity ?? 1.0,
        }))
      : defaults.flowers,
    wrap: {
      ...defaults.wrap,
      ...w,
      ribbonColor:
        isLegacyWrap && w.ribbonColor === '#ec4899'
          ? defaults.wrap.ribbonColor
          : w.ribbonColor || defaults.wrap.ribbonColor,
      ribbonPositionX: w.ribbonPositionX ?? defaults.wrap.ribbonPositionX,
      ribbonPositionY: w.ribbonPositionY ?? defaults.wrap.ribbonPositionY,
      ribbonPositionZ: w.ribbonPositionZ ?? defaults.wrap.ribbonPositionZ,
      ribbonForwardOffset: w.ribbonForwardOffset ?? defaults.wrap.ribbonForwardOffset,
      ribbonLoopSize: w.ribbonLoopSize ?? defaults.wrap.ribbonLoopSize,
      ribbonTailLength: w.ribbonTailLength ?? defaults.wrap.ribbonTailLength,
      ribbonThickness: w.ribbonThickness ?? defaults.wrap.ribbonThickness,
      ribbonRoughness: w.ribbonRoughness ?? defaults.wrap.ribbonRoughness,
      ribbonSheen: w.ribbonSheen ?? defaults.wrap.ribbonSheen,
      tagWidth: w.tagWidth ?? defaults.wrap.tagWidth,
      tagHeight: w.tagHeight ?? defaults.wrap.tagHeight,
      tagThickness: w.tagThickness ?? defaults.wrap.tagThickness,
      tagColor: w.tagColor ?? defaults.wrap.tagColor,
      tagTextColor:
        !w.tagTextColor ||
        ['#3d2831', '#2c1720', '#28141c'].includes(w.tagTextColor.toLowerCase())
          ? defaults.wrap.tagTextColor
          : w.tagTextColor,
      tagBrightness: w.tagBrightness ?? defaults.wrap.tagBrightness,
      tagRoughness: w.tagRoughness ?? defaults.wrap.tagRoughness,
      tagPositionX: w.tagPositionX ?? defaults.wrap.tagPositionX,
      tagPositionY: w.tagPositionY ?? defaults.wrap.tagPositionY,
      tagPositionZ: w.tagPositionZ ?? defaults.wrap.tagPositionZ,
      tagRotationZ: w.tagRotationZ ?? defaults.wrap.tagRotationZ,
      tagSwingIntensity: w.tagSwingIntensity ?? defaults.wrap.tagSwingIntensity,
      tagText: w.tagText ?? defaults.wrap.tagText,
      tagMessage: w.tagMessage ?? defaults.wrap.tagMessage,
    },
    text: {
      ...defaults.text,
      ...t,
      cardBgOpacity: t.cardBgOpacity ?? defaults.text.cardBgOpacity,
      cardBorderColor: t.cardBorderColor ?? defaults.text.cardBorderColor,
      cardTextColor: t.cardTextColor ?? defaults.text.cardTextColor,
      cardTextSize: t.cardTextSize ?? defaults.text.cardTextSize,
    },
    animation: {
      ...defaults.animation,
      ...a,
      showStars: a.showStars ?? defaults.animation.showStars,
      starDensity:
        a.starColor === undefined && (a.starDensity ?? 0) <= 560
          ? defaults.animation.starDensity
          : (a.starDensity ?? defaults.animation.starDensity),
      starSize: a.starSize ?? defaults.animation.starSize,
      starTwinkleIntensity: a.starTwinkleIntensity ?? defaults.animation.starTwinkleIntensity,
      starBrightness: a.starBrightness ?? defaults.animation.starBrightness,
      starAnimationSpeed: a.starAnimationSpeed ?? defaults.animation.starAnimationSpeed,
      starColor: a.starColor ?? defaults.animation.starColor,
      starDistribution: a.starDistribution ?? defaults.animation.starDistribution,
      showScatteredStars: a.showScatteredStars ?? defaults.animation.showScatteredStars,
      scatteredStarsDensity: a.scatteredStarsDensity ?? defaults.animation.scatteredStarsDensity,
      showMoon: a.showMoon ?? defaults.animation.showMoon,
      moonSize: a.moonSize ?? defaults.animation.moonSize,
      moonPositionX: a.moonPositionX ?? defaults.animation.moonPositionX,
      moonPositionY: a.moonPositionY ?? defaults.animation.moonPositionY,
      moonGlowIntensity: a.moonGlowIntensity ?? defaults.animation.moonGlowIntensity,
      moonOpacity: a.moonOpacity ?? defaults.animation.moonOpacity,
      moonStyle: a.moonStyle ?? defaults.animation.moonStyle,
      moonColor: a.moonColor ?? defaults.animation.moonColor,
      moonBrightness: a.moonBrightness ?? defaults.animation.moonBrightness,
      moonShowTexture: a.moonShowTexture ?? defaults.animation.moonShowTexture,
      entranceEnabled: a.entranceEnabled ?? defaults.animation.entranceEnabled,
      entranceDuration: a.entranceDuration ?? defaults.animation.entranceDuration,
      stemStageWeight: a.stemStageWeight ?? defaults.animation.stemStageWeight,
      flowerStageWeight: a.flowerStageWeight ?? defaults.animation.flowerStageWeight,
      wrapStageWeight: a.wrapStageWeight ?? defaults.animation.wrapStageWeight,
      ribbonStageWeight: a.ribbonStageWeight ?? defaults.animation.ribbonStageWeight,
      cameraEntranceIntensity:
        a.cameraEntranceIntensity ?? defaults.animation.cameraEntranceIntensity,
      allowSkipIntro: false,
    },
    theme: {
      ...defaults.theme!,
      ...th,
    },
    sharing: {
      ...defaults.sharing!,
      ...sh,
      slug: normalizeSlug(sh.slug, defaults.sharing!.slug),
    },
    entrance: sanitizeEntranceConfig(cfg.entrance, defaults.entrance!),
  };
}

function loadStore(): MultiBouquetStoreData {
  try {
    if (fs.existsSync(STORE_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8')) as
        | MultiBouquetStoreData
        | LegacyBouquetStoreData;

      // Multi-bouquet store format
      if (parsed && 'bouquets' in parsed && parsed.bouquets && typeof parsed.bouquets === 'object') {
        const normalizedBouquets: Record<string, SingleBouquetRecord> = {};
        for (const [rawKey, rec] of Object.entries(parsed.bouquets)) {
          if (!rec || !rec.published || !rec.draft) continue;
          const slug = normalizeSlug(rec.slug || rawKey);
          const pubNorm = normalizeStoredConfig(rec.published);
          const draftNorm = normalizeStoredConfig(rec.draft);
          pubNorm.sharing = { ...pubNorm.sharing!, slug };
          draftNorm.sharing = { ...draftNorm.sharing!, slug };
          normalizedBouquets[slug] = {
            slug,
            published: pubNorm,
            draft: draftNorm,
            backups: Array.isArray(rec.backups)
              ? rec.backups.map((b) => ({
                  ...b,
                  config: normalizeStoredConfig(b.config),
                }))
              : [],
          };
        }
        const keys = Object.keys(normalizedBouquets);
        if (keys.length > 0) {
          const defSlug = normalizedBouquets[parsed.defaultSlug]
            ? parsed.defaultSlug
            : keys[0];
          return {
            defaultSlug: defSlug,
            bouquets: normalizedBouquets,
          };
        }
      }

      // Auto-migrate legacy single-bouquet store
      if (parsed && 'published' in parsed && parsed.published && parsed.draft) {
        const pubNorm = normalizeStoredConfig(parsed.published);
        const draftNorm = normalizeStoredConfig(parsed.draft);
        const slug = normalizeSlug(pubNorm.sharing?.slug, 'pixel-flower-bouquet');
        pubNorm.sharing = { ...pubNorm.sharing!, slug };
        draftNorm.sharing = { ...draftNorm.sharing!, slug };
        const migrated: MultiBouquetStoreData = {
          defaultSlug: slug,
          bouquets: {
            [slug]: {
              slug,
              published: pubNorm,
              draft: draftNorm,
              backups: Array.isArray(parsed.backups)
                ? parsed.backups.map((b) => ({
                    ...b,
                    config: normalizeStoredConfig(b.config),
                  }))
                : [],
            },
          },
        };
        writeJsonAtomic(STORE_PATH, migrated);
        return migrated;
      }
    }
  } catch {
    // Reinitialize if corrupt
  }

  const initial = createDefaultBouquetConfig();
  const slug = normalizeSlug(initial.sharing?.slug, 'pixel-flower-bouquet');
  const store: MultiBouquetStoreData = {
    defaultSlug: slug,
    bouquets: {
      [slug]: {
        slug,
        published: structuredClone(initial),
        draft: structuredClone(initial),
        backups: [
          {
            id: `backup-${Date.now()}`,
            createdAt: new Date().toISOString(),
            note: 'Initial 15-flower luxury bouquet preset',
            config: structuredClone(initial),
          },
        ],
      },
    },
  };
  writeJsonAtomic(STORE_PATH, store);
  return store;
}

let storeCache: MultiBouquetStoreData = loadStore();

function saveStore(next: MultiBouquetStoreData) {
  storeCache = next;
  writeJsonAtomic(STORE_PATH, next);
}

function getBouquetRecord(rawSlug?: unknown): SingleBouquetRecord | null {
  const requested = typeof rawSlug === 'string' && rawSlug.trim() ? normalizeSlug(rawSlug) : null;
  if (!requested) {
    return (
      storeCache.bouquets[storeCache.defaultSlug] ??
      Object.values(storeCache.bouquets)[0] ??
      null
    );
  }
  return storeCache.bouquets[requested] ?? null;
}

function sanitizeBouquetConfig(input: unknown, fallback: BouquetSiteConfig): BouquetSiteConfig {
  if (!input || typeof input !== 'object') {
    throw new Error('Invalid bouquet configuration payload');
  }
  const obj = input as Partial<BouquetSiteConfig>;

  const validColors = new Set(['pink', 'white', 'red', 'lavender', 'peach']);
  const flowers: FlowerConfig[] = Array.isArray(obj.flowers)
    ? obj.flowers.slice(0, 40).map((f, idx) => ({
        id: safeStr(f?.id, 64, `flower-${idx}`),
        label: safeStr(f?.label, 80, `Lily #${idx + 1}`),
        colorKind: validColors.has(String(f?.colorKind))
          ? (f.colorKind as FlowerConfig['colorKind'])
          : 'pink',
        isBud: safeBool(f?.isBud, false),
        position: [
          safeNum(f?.position?.[0], -4, 4, 0),
          safeNum(f?.position?.[1], -1, 6, 2),
          safeNum(f?.position?.[2], -4, 4, 0),
        ],
        rotation: [
          safeNum(f?.rotation?.[0], -Math.PI, Math.PI, 0),
          safeNum(f?.rotation?.[1], -Math.PI * 2, Math.PI * 2, 0),
          safeNum(f?.rotation?.[2], -Math.PI, Math.PI, 0),
        ],
        scale: safeNum(f?.scale, 0.4, 1.8, 1),
        bloomDelay: safeNum(f?.bloomDelay, 0, 1.5, 0),
        bloomIntensity: safeNum(f?.bloomIntensity, 0.5, 1.5, 1.0),
        swayIntensity: safeNum(f?.swayIntensity, 0, 2.5, 1.0),
      }))
    : fallback.flowers;

  const isSafeMediaUrl = (url: unknown) =>
    typeof url === 'string' && (url.startsWith('/api/media/') || url.startsWith('data:image/'));

  const photos: UploadedPhoto[] = Array.isArray(obj.photos)
    ? obj.photos
        .slice(0, 60)
        .filter((p) => p && isSafeMediaUrl(p.originalUrl))
        .map((p, idx) => ({
          id: safeStr(p.id, 80, `photo-${idx}`),
          name: safeStr(p.name, 120, `memory-${idx + 1}.jpg`),
          caption: safeStr(p.caption, 200, ''),
          originalUrl: p.originalUrl,
          previewUrl: isSafeMediaUrl(p.previewUrl) ? p.previewUrl : p.originalUrl,
          width: safeNum(p.width, 16, 16000, 1024),
          height: safeNum(p.height, 16, 16000, 1024),
          fileSize: typeof p.fileSize === 'number' ? p.fileSize : undefined,
          isStarter: Boolean(p.isStarter),
          assignedFlowerIds:
            p.assignedFlowerIds === 'all' || Array.isArray(p.assignedFlowerIds)
              ? p.assignedFlowerIds
              : 'all',
        }))
    : fallback.photos;

  const validWrapThemes = new Set([
    'frosted-pink',
    'obsidian-plum',
    'champagne-ivory',
    'midnight-violet',
  ]);
  const rawWrap = obj.wrap ?? fallback.wrap;
  const wrap = {
    wrapTheme: validWrapThemes.has(String(rawWrap.wrapTheme))
      ? rawWrap.wrapTheme
      : fallback.wrap.wrapTheme,
    wrapColor: safeStr(rawWrap.wrapColor, 20, fallback.wrap.wrapColor),
    wrapInnerColor: safeStr(rawWrap.wrapInnerColor, 20, fallback.wrap.wrapInnerColor),
    wrapOpacity: safeNum(rawWrap.wrapOpacity, 0.25, 1.0, fallback.wrap.wrapOpacity),
    ribbonColor: safeStr(rawWrap.ribbonColor, 20, fallback.wrap.ribbonColor),
    bowScale: safeNum(rawWrap.bowScale, 0.6, 2.2, fallback.wrap.bowScale ?? 1.28),
    ribbonPositionX: safeNum(rawWrap.ribbonPositionX, -1.2, 1.2, fallback.wrap.ribbonPositionX ?? 0),
    ribbonPositionY: safeNum(
      rawWrap.ribbonPositionY,
      -1.5,
      0.4,
      fallback.wrap.ribbonPositionY ?? -0.66,
    ),
    ribbonPositionZ: safeNum(rawWrap.ribbonPositionZ, -0.8, 1.2, fallback.wrap.ribbonPositionZ ?? 0),
    ribbonForwardOffset: safeNum(
      rawWrap.ribbonForwardOffset,
      0.02,
      0.65,
      fallback.wrap.ribbonForwardOffset ?? 0.14,
    ),
    ribbonLoopSize: safeNum(
      rawWrap.ribbonLoopSize,
      0.6,
      1.9,
      fallback.wrap.ribbonLoopSize ?? 1.18,
    ),
    ribbonTailLength: safeNum(
      rawWrap.ribbonTailLength,
      0.5,
      1.9,
      fallback.wrap.ribbonTailLength ?? 1.15,
    ),
    ribbonThickness: safeNum(
      rawWrap.ribbonThickness,
      0.6,
      2.0,
      fallback.wrap.ribbonThickness ?? 1.0,
    ),
    ribbonRoughness: safeNum(
      rawWrap.ribbonRoughness,
      0.1,
      0.9,
      fallback.wrap.ribbonRoughness ?? 0.26,
    ),
    ribbonSheen: safeNum(rawWrap.ribbonSheen, 0, 1.2, fallback.wrap.ribbonSheen ?? 0.95),
    showGiftTag: safeBool(rawWrap.showGiftTag, true),
    tagWidth: safeNum(rawWrap.tagWidth, 0.2, 0.6, fallback.wrap.tagWidth ?? 0.34),
    tagHeight: safeNum(rawWrap.tagHeight, 0.24, 0.7, fallback.wrap.tagHeight ?? 0.42),
    tagThickness: safeNum(rawWrap.tagThickness, 0.015, 0.12, fallback.wrap.tagThickness ?? 0.044),
    tagColor: safeStr(rawWrap.tagColor, 20, fallback.wrap.tagColor ?? '#D8C6BD'),
    tagTextColor: safeStr(rawWrap.tagTextColor, 20, fallback.wrap.tagTextColor ?? '#111111'),
    tagBrightness: safeNum(rawWrap.tagBrightness, 0.35, 1.15, fallback.wrap.tagBrightness ?? 0.82),
    tagRoughness: safeNum(rawWrap.tagRoughness, 0.3, 1.0, fallback.wrap.tagRoughness ?? 0.86),
    tagPositionX: safeNum(rawWrap.tagPositionX, -0.5, 0.5, fallback.wrap.tagPositionX ?? 0.15),
    tagPositionY: safeNum(rawWrap.tagPositionY, -0.4, 0.25, fallback.wrap.tagPositionY ?? -0.05),
    tagPositionZ: safeNum(rawWrap.tagPositionZ, -0.1, 0.45, fallback.wrap.tagPositionZ ?? 0.12),
    tagRotationZ: safeNum(rawWrap.tagRotationZ, -0.8, 0.8, fallback.wrap.tagRotationZ ?? 0.09),
    tagSwingIntensity: safeNum(
      rawWrap.tagSwingIntensity,
      0,
      2.0,
      fallback.wrap.tagSwingIntensity ?? 0.65,
    ),
    tagText: safeStr(rawWrap.tagText, 40, fallback.wrap.tagText ?? ''),
    tagMessage: safeStr(rawWrap.tagMessage, 1200, fallback.wrap.tagMessage ?? ''),
  };

  const rawText = obj.text ?? fallback.text;
  const validCardSizes = new Set(['sm', 'md', 'lg']);
  const text = {
    recipientName: safeStr(rawText.recipientName, 60, ''),
    senderName: safeStr(rawText.senderName, 60, ''),
    romanticMessage: safeStr(rawText.romanticMessage, 600, fallback.text.romanticMessage),
    specialDate: safeStr(rawText.specialDate, 60, fallback.text.specialDate),
    ribbonText: safeStr(rawText.ribbonText, 90, fallback.text.ribbonText),
    terminalTitle: safeStr(rawText.terminalTitle, 60, fallback.text.terminalTitle),
    loveLines: Array.isArray(rawText.loveLines)
      ? rawText.loveLines.slice(0, 6).map((l) => safeStr(l, 40, 'Love ♥'))
      : fallback.text.loveLines,
    footerBadge: safeStr(rawText.footerBadge, 60, fallback.text.footerBadge),
    cardBgOpacity: safeNum(rawText.cardBgOpacity, 0.2, 1.0, fallback.text.cardBgOpacity ?? 0.85),
    cardBorderColor: safeStr(
      rawText.cardBorderColor,
      20,
      fallback.text.cardBorderColor ?? '#f472b6',
    ),
    cardTextColor: safeStr(rawText.cardTextColor, 20, fallback.text.cardTextColor ?? '#ffffff'),
    cardTextSize: validCardSizes.has(String(rawText.cardTextSize))
      ? (rawText.cardTextSize as 'sm' | 'md' | 'lg')
      : (fallback.text.cardTextSize ?? 'sm'),
  };

  const validPixelSizes = new Set(['small', 'medium', 'large']);
  const validMoonStyles = new Set(['full', 'crescent', 'soft-blush']);
  const validStarDist = new Set(['spherical', 'sky-dome', 'clustered']);
  const rawAnim = obj.animation ?? fallback.animation;
  const animation = {
    pixelSize: validPixelSizes.has(String(rawAnim.pixelSize))
      ? rawAnim.pixelSize
      : fallback.animation.pixelSize,
    photoVividness: safeNum(rawAnim.photoVividness, 0, 1, fallback.animation.photoVividness),
    autoRotate: safeBool(rawAnim.autoRotate, true),
    rotationSpeed: safeNum(rawAnim.rotationSpeed, 0, 1.5, fallback.animation.rotationSpeed),
    bloomSpeed: safeNum(rawAnim.bloomSpeed, 0.3, 3.0, fallback.animation.bloomSpeed),
    fallingPetalsCount: Math.round(
      safeNum(rawAnim.fallingPetalsCount, 0, 80, fallback.animation.fallingPetalsCount),
    ),
    showOrbitRing: safeBool(rawAnim.showOrbitRing, true),
    showStars: safeBool(rawAnim.showStars, fallback.animation.showStars ?? true),
    starDensity: Math.round(
      safeNum(rawAnim.starDensity, 60, 1800, fallback.animation.starDensity ?? 760),
    ),
    starSize: safeNum(rawAnim.starSize, 0.4, 2.4, fallback.animation.starSize ?? 1.0),
    starTwinkleIntensity: safeNum(
      rawAnim.starTwinkleIntensity,
      0,
      1,
      fallback.animation.starTwinkleIntensity ?? 0.48,
    ),
    starBrightness: safeNum(
      rawAnim.starBrightness,
      0.2,
      1.8,
      fallback.animation.starBrightness ?? 0.9,
    ),
    starAnimationSpeed: safeNum(
      rawAnim.starAnimationSpeed,
      0,
      2.5,
      fallback.animation.starAnimationSpeed ?? 0.85,
    ),
    starColor: safeStr(rawAnim.starColor, 20, fallback.animation.starColor ?? '#ffffff'),
    starDistribution: validStarDist.has(String(rawAnim.starDistribution))
      ? rawAnim.starDistribution
      : (fallback.animation.starDistribution ?? 'spherical'),
    showScatteredStars: safeBool(
      rawAnim.showScatteredStars,
      fallback.animation.showScatteredStars ?? true,
    ),
    scatteredStarsDensity: Math.round(
      safeNum(rawAnim.scatteredStarsDensity, 40, 900, fallback.animation.scatteredStarsDensity ?? 320),
    ),
    showMoon: safeBool(rawAnim.showMoon, fallback.animation.showMoon ?? true),
    moonSize: safeNum(rawAnim.moonSize, 0.45, 2.4, fallback.animation.moonSize ?? 1.18),
    moonPositionX: safeNum(
      rawAnim.moonPositionX,
      -9.0,
      9.0,
      fallback.animation.moonPositionX ?? -2.5,
    ),
    moonPositionY: safeNum(
      rawAnim.moonPositionY,
      1.5,
      8.5,
      fallback.animation.moonPositionY ?? 5.1,
    ),
    moonGlowIntensity: safeNum(
      rawAnim.moonGlowIntensity,
      0,
      1.8,
      fallback.animation.moonGlowIntensity ?? 0.78,
    ),
    moonOpacity: safeNum(rawAnim.moonOpacity, 0.1, 1.0, fallback.animation.moonOpacity ?? 0.94),
    moonStyle: validMoonStyles.has(String(rawAnim.moonStyle))
      ? rawAnim.moonStyle
      : (fallback.animation.moonStyle ?? 'full'),
    moonColor: safeStr(rawAnim.moonColor, 20, fallback.animation.moonColor ?? '#f7f2fa'),
    moonBrightness: safeNum(
      rawAnim.moonBrightness,
      0.4,
      1.5,
      fallback.animation.moonBrightness ?? 0.96,
    ),
    moonShowTexture: safeBool(rawAnim.moonShowTexture, fallback.animation.moonShowTexture ?? true),
    entranceEnabled: safeBool(rawAnim.entranceEnabled, fallback.animation.entranceEnabled ?? true),
    entranceDuration: safeNum(
      rawAnim.entranceDuration,
      3.0,
      18.0,
      fallback.animation.entranceDuration ?? 9.0,
    ),
    stemStageWeight: safeNum(
      rawAnim.stemStageWeight,
      0.4,
      2.0,
      fallback.animation.stemStageWeight ?? 1.0,
    ),
    flowerStageWeight: safeNum(
      rawAnim.flowerStageWeight,
      0.4,
      2.0,
      fallback.animation.flowerStageWeight ?? 1.0,
    ),
    wrapStageWeight: safeNum(
      rawAnim.wrapStageWeight,
      0.4,
      2.0,
      fallback.animation.wrapStageWeight ?? 1.0,
    ),
    ribbonStageWeight: safeNum(
      rawAnim.ribbonStageWeight,
      0.4,
      2.0,
      fallback.animation.ribbonStageWeight ?? 1.0,
    ),
    cameraEntranceIntensity: safeNum(
      rawAnim.cameraEntranceIntensity,
      0,
      1.5,
      fallback.animation.cameraEntranceIntensity ?? 0.75,
    ),
    allowSkipIntro: false,
  };

  const rawMusic = obj.music ?? fallback.music;
  const music = {
    mode: rawMusic.mode === 'uploaded' ? ('uploaded' as const) : ('builtin' as const),
    builtinTrackIndex: Math.round(safeNum(rawMusic.builtinTrackIndex, 0, 5, 0)),
    uploadedAudioUrl: isSafeMediaUrl(rawMusic.uploadedAudioUrl) ? rawMusic.uploadedAudioUrl : '',
    uploadedAudioName: safeStr(rawMusic.uploadedAudioName, 120, ''),
    defaultVolume: safeNum(rawMusic.defaultVolume, 0, 1, 0.55),
    autoPlayOnInteract: safeBool(rawMusic.autoPlayOnInteract, true),
  };

  const validThemePresets = new Set([
    'romantic-pink',
    'white-lily',
    'purple-dream',
    'midnight-blue',
    'red-rose',
  ]);
  const rawTheme = obj.theme ??
    fallback.theme ?? {
      preset: 'romantic-pink' as const,
      backgroundColor: '#000000',
      lightingIntensity: 1.0,
    };
  const theme = {
    preset: validThemePresets.has(String(rawTheme.preset))
      ? rawTheme.preset
      : ('romantic-pink' as const),
    backgroundColor: safeStr(rawTheme.backgroundColor, 20, '#000000'),
    lightingIntensity: safeNum(rawTheme.lightingIntensity, 0.4, 1.6, 1.0),
  };

  const rawSharing = obj.sharing ??
    fallback.sharing ?? {
      slug: 'pixel-flower-bouquet',
      isPublished: true,
      expiresAt: '',
    };
  const sharing = {
    slug: normalizeSlug(rawSharing.slug, fallback.sharing?.slug || 'pixel-flower-bouquet'),
    isPublished: safeBool(rawSharing.isPublished, true),
    expiresAt: safeStr(rawSharing.expiresAt, 32, ''),
  };

  const entrance = sanitizeEntranceConfig(
    obj.entrance,
    fallback.entrance ?? createDefaultEntranceConfig(),
  );

  return {
    version: (fallback.version || 1) + 1,
    updatedAt: new Date().toISOString(),
    photos,
    flowers,
    wrap,
    text,
    animation,
    music,
    theme,
    sharing,
    entrance,
  };
}

function buildPublicBouquetPayload(record: SingleBouquetRecord): BouquetSiteConfig {
  const pub = structuredClone(record.published);
  const hasPin = hasPublishedPin(record.slug);
  if (pub.entrance) {
    pub.entrance.hasPinConfigured = hasPin;
  }
  return pub;
}

function buildPublicEntranceState(
  record: SingleBouquetRecord,
  alreadyUnlocked: boolean,
): PublicEntranceStateResponse {
  const pub = record.published;
  const ent = pub.entrance ?? createDefaultEntranceConfig();
  const hasPin = hasPublishedPin(record.slug);
  return {
    slug: record.slug,
    exists: true,
    pinRequired: Boolean(ent.pinEnabled),
    hasPinConfigured: hasPin,
    alreadyUnlocked,
    lockScreen: ent.lockScreen,
    curtain: ent.curtain,
    skyPreview: {
      backgroundColor: pub.theme?.backgroundColor || '#000000',
      showStars: pub.animation.showStars ?? true,
      showScatteredStars: pub.animation.showScatteredStars ?? true,
      starColor: pub.animation.starColor ?? '#ffffff',
      starDensity: pub.animation.starDensity ?? 760,
      showMoon: pub.animation.showMoon ?? true,
      moonStyle: pub.animation.moonStyle ?? 'full',
      moonColor: pub.animation.moonColor ?? '#f7f2fa',
      moonSize: pub.animation.moonSize ?? 1.18,
      moonPositionX: pub.animation.moonPositionX ?? -2.5,
      moonPositionY: pub.animation.moonPositionY ?? 5.1,
      moonGlowIntensity: pub.animation.moonGlowIntensity ?? 0.78,
    },
  };
}

function pickAnimPayload(anim: PinFailureAnimConfig, indexHint: number): PinFailureAnimConfig {
  const list =
    Array.isArray(anim.customMessages) && anim.customMessages.length > 0
      ? anim.customMessages
      : [anim.message];
  const chosen =
    indexHint === 0 && anim.message.trim()
      ? anim.message
      : list[Math.abs(indexHint) % list.length] || anim.message;
  return {
    ...anim,
    message: chosen,
  };
}

function buildAdminSummaries(): AdminBouquetSummary[] {
  return Object.values(storeCache.bouquets).map((rec) => ({
    slug: rec.slug,
    recipientName: rec.draft.text.recipientName || '',
    flowerCount: rec.draft.flowers.length,
    photoCount: rec.draft.photos.length,
    pinEnabled: Boolean(rec.draft.entrance?.pinEnabled),
    hasPublishedPin: hasPublishedPin(rec.slug),
    hasDraftPin: hasDraftPin(rec.slug),
    isDefault: rec.slug === storeCache.defaultSlug,
    updatedAt: rec.draft.updatedAt,
  }));
}

function buildAdminPinStatus(slug: string): AdminPinStatus {
  const rec = pinSecretsCache[slug];
  const draftHash = rec?.draft?.hash || '';
  const pubHash = rec?.published?.hash || '';
  const fakeFailureVisitorCount = Object.keys(visitorGatesCache).filter((k) =>
    k.endsWith(`::${slug}`),
  ).length;
  return {
    hasDraftPin: hasDraftPin(slug),
    hasPublishedPin: hasPublishedPin(slug),
    pinDraftPendingPublish: Boolean(draftHash && draftHash !== pubHash),
    envPinFallbackActive: Boolean(
      slug === storeCache.defaultSlug && !pubHash && getEnvBouquetPin() !== null,
    ),
    fakeFailureVisitorCount,
  };
}

function detectImageExtension(buf: Buffer, mimeType: string): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return '.jpg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return '.png';
  if (buf.subarray(0, 3).toString('ascii') === 'GIF') return '.gif';
  if (
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return '.webp';
  }
  if (mimeType === 'image/jpeg') return '.jpg';
  if (mimeType === 'image/png') return '.png';
  if (mimeType === 'image/webp') return '.webp';
  return null;
}

function detectAudioExtension(mimeType: string, origName: string): string | null {
  const lower = origName.toLowerCase();
  if (mimeType.includes('mpeg') || lower.endsWith('.mp3')) return '.mp3';
  if (mimeType.includes('wav') || lower.endsWith('.wav')) return '.wav';
  if (mimeType.includes('ogg') || lower.endsWith('.ogg')) return '.ogg';
  if (mimeType.includes('mp4') || mimeType.includes('m4a') || lower.endsWith('.m4a')) return '.m4a';
  if (mimeType.includes('webm') || lower.endsWith('.webm')) return '.webm';
  return null;
}

export function createServerApp() {
  const app = express();
  app.set('trust proxy', true);
  app.use(express.json({ limit: '4mb' }));

  let initialSynced = false;
  app.use(async (_req, _res, next) => {
    if (!initialSynced && SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
      initialSynced = true;
      await syncAllFromSupabase().catch(() => {});
    }
    next();
  });

  // --- PUBLIC VIEW-ONLY & ENTRANCE API ---
  app.get('/api/public/entrance', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const requestedSlug = typeof req.query.slug === 'string' ? req.query.slug : undefined;
    const record = getBouquetRecord(requestedSlug);
    if (!record) {
      const def = createDefaultEntranceConfig();
      res.status(404).json({
        slug: normalizeSlug(requestedSlug, storeCache.defaultSlug),
        exists: false,
        pinRequired: true,
        hasPinConfigured: false,
        alreadyUnlocked: false,
        lockScreen: def.lockScreen,
        curtain: def.curtain,
        skyPreview: {
          backgroundColor: '#000000',
          showStars: true,
          showScatteredStars: true,
          starColor: '#ffffff',
          starDensity: 760,
          showMoon: true,
          moonStyle: 'full',
          moonColor: '#f7f2fa',
          moonSize: 1.18,
          moonPositionX: -2.5,
          moonPositionY: 5.1,
          moonGlowIntensity: 0.78,
        },
      } satisfies PublicEntranceStateResponse);
      return;
    }

    const ent = record.published.entrance ?? createDefaultEntranceConfig();
    const pinRequired = Boolean(ent.pinEnabled);
    const hasPin = hasPublishedPin(record.slug);
    const unlocked = !pinRequired || (hasPin && isRequestUnlockedForSlug(req, record.slug));
    res.json(buildPublicEntranceState(record, unlocked));
  });

  app.post('/api/public/pin/verify', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!verifySameOriginIfPresent(req)) {
      res.status(403).json({ error: 'Cross-origin PIN verification is not permitted' });
      return;
    }

    const requestedSlug = typeof req.body?.slug === 'string' ? req.body.slug : undefined;
    const record = getBouquetRecord(requestedSlug);
    if (!record) {
      res.status(404).json({ error: 'Bouquet not found' });
      return;
    }

    const pin = typeof req.body?.pin === 'string' ? req.body.pin.trim() : '';
    const ent = record.published.entrance ?? createDefaultEntranceConfig();

    if (!ent.pinEnabled) {
      const { token, expiresAt } = signUnlockToken(record.slug, ent.sessionDurationMinutes || 60);
      res.json({
        unlocked: true,
        unlockToken: token,
        expiresAt,
        bouquet: buildPublicBouquetPayload(record),
      });
      return;
    }

    if (!hasPublishedPin(record.slug)) {
      res.status(409).json({
        error: 'This bouquet does not have a secret PIN configured yet.',
      });
      return;
    }

    if (!/^\d{6}$/.test(pin)) {
      res.status(400).json({ error: 'Please enter a valid 6-digit numeric PIN.' });
      return;
    }

    const ip = req.ip || 'unknown';
    const rateKey = `${ip}::${record.slug}`;
    const now = Date.now();
    const maxAttempts = Math.max(3, Math.min(20, ent.maxAttempts || 6));
    const lockoutMs = Math.max(1, Math.min(60, ent.lockoutMinutes || 3)) * 60 * 1000;
    const attemptEntry = pinAttempts.get(rateKey);

    if (attemptEntry && attemptEntry.lockedUntil > now) {
      const retryAfterSeconds = Math.ceil((attemptEntry.lockedUntil - now) / 1000);
      res.status(429).json({
        unlocked: false,
        lockedOut: true,
        retryAfterSeconds,
        error: `Too many attempts. Please wait ${retryAfterSeconds}s before trying again.`,
        anim: pickAnimPayload(ent.wrongPinAnim, attemptEntry.failedCount),
      });
      return;
    }

    const isPinValid = verifyPublishedPin(record.slug, pin);

    if (!isPinValid) {
      const prevCount =
        attemptEntry && attemptEntry.windowResetAt > now ? attemptEntry.failedCount : 0;
      const nextCount = prevCount + 1;
      const hitLimit = nextCount >= maxAttempts;
      pinAttempts.set(rateKey, {
        failedCount: nextCount,
        windowResetAt: now + 30 * 60 * 1000,
        lockedUntil: hitLimit ? now + lockoutMs : 0,
      });
      res.status(401).json({
        unlocked: false,
        lockedOut: hitLimit,
        retryAfterSeconds: hitLimit ? Math.ceil(lockoutMs / 1000) : undefined,
        anim: pickAnimPayload(ent.wrongPinAnim, nextCount - 1),
      });
      return;
    }

    // PIN IS VALID -> Check intentional playful first failure gate server-side
    const visitorId = resolveVisitorId(req, res);
    const gateKey = `${visitorId}::${record.slug}`;
    const fakeCfg = ent.fakeFailure;
    const targetFakeCount = fakeCfg.enabled
      ? Math.max(1, Math.min(3, fakeCfg.count || 1))
      : 0;
    const gateEntry = visitorGatesCache[gateKey] ?? { usedFakeCount: 0, lastTriggeredAt: '' };

    if (fakeCfg.enabled && gateEntry.usedFakeCount < targetFakeCount) {
      const nextFakeCount = gateEntry.usedFakeCount + 1;
      visitorGatesCache[gateKey] = {
        usedFakeCount: nextFakeCount,
        lastTriggeredAt: new Date().toISOString(),
      };
      saveVisitorGates(visitorGatesCache);

      // Identical HTTP status & payload shape as a wrong PIN so network inspection cannot distinguish
      res.status(401).json({
        unlocked: false,
        lockedOut: false,
        anim: pickAnimPayload(fakeCfg.anim, gateEntry.usedFakeCount),
      });
      return;
    }

    // Genuine final unlock!
    pinAttempts.delete(rateKey);
    const sessionMins = Math.max(0, ent.sessionDurationMinutes ?? 60);
    const { token, expiresAt } = signUnlockToken(record.slug, sessionMins);

    if (sessionMins > 0) {
      setHttpCookie(
        res,
        req,
        getUnlockCookieName(record.slug),
        token,
        sessionMins * 60 * 1000,
      );
    } else {
      clearHttpCookie(res, req, getUnlockCookieName(record.slug));
    }

    res.json({
      unlocked: true,
      unlockToken: token,
      expiresAt,
      bouquet: buildPublicBouquetPayload(record),
    });
  });

  const handlePublicBouquetGet = (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    const requestedSlug =
      typeof req.params.slug === 'string'
        ? req.params.slug
        : typeof req.query.slug === 'string'
          ? req.query.slug
          : undefined;
    const record = getBouquetRecord(requestedSlug);
    if (!record) {
      res.status(404).json({ error: 'Bouquet not found' });
      return;
    }

    const ent = record.published.entrance ?? createDefaultEntranceConfig();
    if (ent.pinEnabled) {
      const hasPin = hasPublishedPin(record.slug);
      if (!hasPin || !isRequestUnlockedForSlug(req, record.slug)) {
        res.status(401).json({
          locked: true,
          slug: record.slug,
          hasPinConfigured: hasPin,
          error: 'Secret PIN required to access this bouquet.',
        });
        return;
      }
    }

    res.json(buildPublicBouquetPayload(record));
  };

  app.get('/api/public/bouquet', handlePublicBouquetGet);
  app.get('/api/public/bouquets/:slug', handlePublicBouquetGet);

  // Safe static media serving with strict path confinement (with Supabase CDN fallback)
  app.get('/api/media/photos/:filename', (req, res) => {
    const safeName = path.basename(req.params.filename || '');
    const resolved = path.resolve(PHOTOS_DIR, safeName);
    if (fs.existsSync(resolved)) {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.sendFile(resolved);
      return;
    }
    if (SUPABASE_URL) {
      res.redirect(302, `${SUPABASE_URL}/storage/v1/object/public/media/photos/${encodeURIComponent(safeName)}`);
      return;
    }
    res.status(404).end();
  });

  app.get('/api/media/audio/:filename', (req, res) => {
    const safeName = path.basename(req.params.filename || '');
    const resolved = path.resolve(AUDIO_DIR, safeName);
    if (fs.existsSync(resolved)) {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.sendFile(resolved);
      return;
    }
    if (SUPABASE_URL) {
      res.redirect(302, `${SUPABASE_URL}/storage/v1/object/public/media/audio/${encodeURIComponent(safeName)}`);
      return;
    }
    res.status(404).end();
  });

  // --- ADMIN AUTHENTICATION ROUTES ---
  app.get('/api/admin/auth/status', (req, res) => {
    const token = extractBearerToken(req);
    const authenticated = Boolean(token && verifySessionToken(token).valid);
    const payload: AdminAuthStatus = {
      needsSetup: isFirstRunSetupNeeded(),
      envManaged: getEnvPasscode() !== null,
      authenticated,
    };
    res.json(payload);
  });

  app.post('/api/admin/auth/setup', (req, res) => {
    if (!isFirstRunSetupNeeded()) {
      res.status(403).json({ error: 'Administrator password is already configured' });
      return;
    }
    const password = typeof req.body?.password === 'string' ? req.body.password.trim() : '';
    if (password.length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters long' });
      return;
    }
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    writeJsonAtomic(AUTH_PATH, {
      salt,
      hash,
      createdAt: new Date().toISOString(),
    });
    const token = signSessionToken();
    res.json({ token });
  });

  app.post('/api/admin/auth/login', (req, res) => {
    if (isFirstRunSetupNeeded()) {
      res.status(409).json({ error: 'First-run administrator setup required' });
      return;
    }

    const ip = req.ip || 'unknown';
    const now = Date.now();
    const entry = loginAttempts.get(ip);
    if (entry && entry.resetAt > now && entry.count >= 12) {
      res.status(429).json({ error: 'Too many login attempts. Please wait a few minutes.' });
      return;
    }

    const password = typeof req.body?.password === 'string' ? req.body.password.trim() : '';
    if (!password || !verifyPassword(password)) {
      const nextCount = entry && entry.resetAt > now ? entry.count + 1 : 1;
      loginAttempts.set(ip, { count: nextCount, resetAt: now + 15 * 60 * 1000 });
      res.status(401).json({ error: 'Invalid administrator password' });
      return;
    }

    loginAttempts.delete(ip);
    const token = signSessionToken();
    res.json({ token });
  });

  app.post('/api/admin/auth/logout', requireAdmin, (req, res) => {
    const token = extractBearerToken(req);
    if (token) {
      const check = verifySessionToken(token);
      if (check.jti && check.exp) {
        revokedTokens.set(check.jti, check.exp);
      }
    }
    res.json({ ok: true });
  });

  // --- PROTECTED ADMIN MULTI-BOUQUET ROUTES ---
  app.get('/api/admin/bouquets', requireAdmin, (_req, res) => {
    res.json({
      defaultSlug: storeCache.defaultSlug,
      bouquets: buildAdminSummaries(),
    });
  });

  app.post('/api/admin/bouquets', requireAdmin, (req, res) => {
    const rawSlug = typeof req.body?.slug === 'string' ? req.body.slug : '';
    const slug = normalizeSlug(rawSlug, `gift-${Date.now().toString(36)}`);
    if (storeCache.bouquets[slug]) {
      res.status(409).json({ error: `Slug "${slug}" sudah digunakan oleh buket lain.` });
      return;
    }

    const cloneFromSlug =
      typeof req.body?.cloneFromSlug === 'string' ? normalizeSlug(req.body.cloneFromSlug, '') : '';
    const sourceRec = cloneFromSlug ? storeCache.bouquets[cloneFromSlug] : null;
    const baseCfg = sourceRec ? structuredClone(sourceRec.draft) : createDefaultBouquetConfig();
    const recipientName =
      typeof req.body?.recipientName === 'string'
        ? req.body.recipientName.trim().slice(0, 60)
        : baseCfg.text.recipientName;

    baseCfg.version = 1;
    baseCfg.updatedAt = new Date().toISOString();
    baseCfg.text.recipientName = recipientName;
    baseCfg.sharing = {
      slug,
      isPublished: true,
      expiresAt: '',
    };
    if (!baseCfg.entrance) {
      baseCfg.entrance = createDefaultEntranceConfig();
    }
    baseCfg.entrance.hasPinConfigured = false;

    const nextStore: MultiBouquetStoreData = {
      ...storeCache,
      bouquets: {
        ...storeCache.bouquets,
        [slug]: {
          slug,
          published: structuredClone(baseCfg),
          draft: structuredClone(baseCfg),
          backups: [
            {
              id: `backup-${Date.now()}`,
              createdAt: baseCfg.updatedAt,
              note: sourceRec ? `Duplikat dari /gift/${sourceRec.slug}` : 'Buket baru dibuat',
              config: structuredClone(baseCfg),
            },
          ],
        },
      },
    };
    saveStore(nextStore);
    savePinSecrets({ ...pinSecretsCache, [slug]: { draft: null, published: null } });

    res.json({
      slug,
      defaultSlug: nextStore.defaultSlug,
      bouquets: buildAdminSummaries(),
    });
  });

  app.delete('/api/admin/bouquets/:slug', requireAdmin, (req, res) => {
    const slug = normalizeSlug(req.params.slug, '');
    const keys = Object.keys(storeCache.bouquets);
    if (!slug || !storeCache.bouquets[slug]) {
      res.status(404).json({ error: 'Buket tidak ditemukan' });
      return;
    }
    if (keys.length <= 1) {
      res.status(400).json({ error: 'Tidak dapat menghapus satu-satunya buket yang tersedia.' });
      return;
    }
    const nextBouquets = { ...storeCache.bouquets };
    delete nextBouquets[slug];
    const nextDefault =
      storeCache.defaultSlug === slug ? Object.keys(nextBouquets)[0] : storeCache.defaultSlug;
    saveStore({ defaultSlug: nextDefault, bouquets: nextBouquets });

    const nextSecrets = { ...pinSecretsCache };
    delete nextSecrets[slug];
    savePinSecrets(nextSecrets);

    const nextGates = { ...visitorGatesCache };
    for (const k of Object.keys(nextGates)) {
      if (k.endsWith(`::${slug}`)) delete nextGates[k];
    }
    saveVisitorGates(nextGates);

    res.json({
      defaultSlug: nextDefault,
      bouquets: buildAdminSummaries(),
    });
  });

  app.post('/api/admin/bouquets/:slug/set-default', requireAdmin, (req, res) => {
    const slug = normalizeSlug(req.params.slug, '');
    if (!slug || !storeCache.bouquets[slug]) {
      res.status(404).json({ error: 'Buket tidak ditemukan' });
      return;
    }
    saveStore({ ...storeCache, defaultSlug: slug });
    res.json({
      defaultSlug: slug,
      bouquets: buildAdminSummaries(),
    });
  });

  // --- PROTECTED ADMIN MANAGEMENT ROUTES ---
  app.get('/api/admin/state', requireAdmin, (req, res) => {
    const slugParam = typeof req.query.slug === 'string' ? req.query.slug : undefined;
    const record = getBouquetRecord(slugParam);
    if (!record) {
      res.status(404).json({ error: 'Buket tidak ditemukan' });
      return;
    }

    const draftCopy = structuredClone(record.draft);
    const pubCopy = structuredClone(record.published);
    if (draftCopy.entrance) draftCopy.entrance.hasPinConfigured = hasDraftPin(record.slug);
    if (pubCopy.entrance) pubCopy.entrance.hasPinConfigured = hasPublishedPin(record.slug);

    res.json({
      slug: record.slug,
      defaultSlug: storeCache.defaultSlug,
      bouquets: buildAdminSummaries(),
      pinStatus: buildAdminPinStatus(record.slug),
      draft: draftCopy,
      published: pubCopy,
      backups: record.backups.map((b) => ({
        id: b.id,
        createdAt: b.createdAt,
        note: b.note,
        flowerCount: b.config.flowers.length,
        photoCount: b.config.photos.length,
      })),
    });
  });

  app.put('/api/admin/draft', requireAdmin, (req, res) => {
    try {
      const slugParam = typeof req.query.slug === 'string' ? req.query.slug : undefined;
      const record = getBouquetRecord(slugParam);
      if (!record) {
        res.status(404).json({ error: 'Buket tidak ditemukan' });
        return;
      }

      const sanitized = sanitizeBouquetConfig(req.body, record.draft);
      // Preserve record slug ownership unless explicitly renamed via bouquet manager
      sanitized.sharing = {
        ...sanitized.sharing!,
        slug: record.slug,
      };
      if (sanitized.entrance) {
        sanitized.entrance.hasPinConfigured = hasDraftPin(record.slug);
      }

      saveStore({
        ...storeCache,
        bouquets: {
          ...storeCache.bouquets,
          [record.slug]: {
            ...record,
            draft: sanitized,
          },
        },
      });
      res.json({ draft: sanitized, pinStatus: buildAdminPinStatus(record.slug) });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid draft payload' });
    }
  });

  app.put('/api/admin/bouquets/:slug/pin', requireAdmin, (req, res) => {
    const slug = normalizeSlug(req.params.slug, '');
    const record = storeCache.bouquets[slug];
    if (!record) {
      res.status(404).json({ error: 'Buket tidak ditemukan' });
      return;
    }

    const pin = typeof req.body?.pin === 'string' ? req.body.pin.trim() : '';
    const confirmPin = typeof req.body?.confirmPin === 'string' ? req.body.confirmPin.trim() : '';
    if (!/^\d{6}$/.test(pin)) {
      res.status(400).json({ error: 'PIN harus terdiri dari tepat 6 digit angka (0–9).' });
      return;
    }
    if (pin !== confirmPin) {
      res.status(400).json({ error: 'Konfirmasi PIN 6 digit tidak cocok.' });
      return;
    }

    const hashed = hashPin(slug, pin);
    const existingSecret = pinSecretsCache[slug] ?? {};
    savePinSecrets({
      ...pinSecretsCache,
      [slug]: {
        ...existingSecret,
        draft: hashed,
      },
    });

    const nextDraft = structuredClone(record.draft);
    if (!nextDraft.entrance) nextDraft.entrance = createDefaultEntranceConfig();
    nextDraft.entrance.hasPinConfigured = true;
    nextDraft.updatedAt = new Date().toISOString();

    saveStore({
      ...storeCache,
      bouquets: {
        ...storeCache.bouquets,
        [slug]: {
          ...record,
          draft: nextDraft,
        },
      },
    });

    res.json({
      ok: true,
      pinStatus: buildAdminPinStatus(slug),
      draft: nextDraft,
    });
  });

  app.post('/api/admin/bouquets/:slug/reset-fake-failure', requireAdmin, (req, res) => {
    const slug = normalizeSlug(req.params.slug, '');
    if (!storeCache.bouquets[slug]) {
      res.status(404).json({ error: 'Buket tidak ditemukan' });
      return;
    }
    const nextGates = { ...visitorGatesCache };
    let cleared = 0;
    for (const key of Object.keys(nextGates)) {
      if (key.endsWith(`::${slug}`)) {
        delete nextGates[key];
        cleared++;
      }
    }
    saveVisitorGates(nextGates);
    res.json({
      ok: true,
      cleared,
      pinStatus: buildAdminPinStatus(slug),
    });
  });

  app.post('/api/admin/bouquets/:slug/preview-verify', requireAdmin, (req, res) => {
    const slug = normalizeSlug(req.params.slug, '');
    const record = storeCache.bouquets[slug];
    if (!record) {
      res.status(404).json({ error: 'Buket tidak ditemukan' });
      return;
    }
    const pin = typeof req.body?.pin === 'string' ? req.body.pin.trim() : '';
    const simulatedFakeUsed =
      typeof req.body?.simulatedFakeUsed === 'number' ? req.body.simulatedFakeUsed : 0;

    if (!/^\d{6}$/.test(pin)) {
      res.status(400).json({ error: 'Masukkan 6 digit angka PIN untuk menguji.' });
      return;
    }

    const ent = record.draft.entrance ?? createDefaultEntranceConfig();
    if (!hasDraftPin(slug)) {
      res.status(409).json({
        error: 'PIN 6 digit belum disimpan pada draf ini. Simpan PIN terlebih dahulu untuk menguji.',
      });
      return;
    }

    const isPinValid = verifyDraftOrPublishedPin(slug, pin);
    if (!isPinValid) {
      res.status(401).json({
        unlocked: false,
        kind: 'wrong',
        anim: pickAnimPayload(ent.wrongPinAnim, 0),
      });
      return;
    }

    const targetFakeCount = ent.fakeFailure.enabled
      ? Math.max(1, Math.min(3, ent.fakeFailure.count || 1))
      : 0;
    if (ent.fakeFailure.enabled && simulatedFakeUsed < targetFakeCount) {
      res.status(401).json({
        unlocked: false,
        kind: 'fake',
        nextFakeUsed: simulatedFakeUsed + 1,
        anim: pickAnimPayload(ent.fakeFailure.anim, simulatedFakeUsed),
      });
      return;
    }

    res.json({
      unlocked: true,
      kind: 'success',
    });
  });

  app.post('/api/admin/publish', requireAdmin, (req, res) => {
    const slugParam = typeof req.query.slug === 'string' ? req.query.slug : undefined;
    const record = getBouquetRecord(slugParam);
    if (!record) {
      res.status(404).json({ error: 'Buket tidak ditemukan' });
      return;
    }

    const note =
      typeof req.body?.note === 'string' && req.body.note.trim()
        ? req.body.note.trim().slice(0, 120)
        : 'Published update';

    // Promote draft PIN secret to published only upon Publish Live
    const currentSecret = pinSecretsCache[record.slug] ?? {};
    const nextPublishedSecret = currentSecret.draft ?? currentSecret.published ?? null;
    if (currentSecret.draft || currentSecret.published) {
      savePinSecrets({
        ...pinSecretsCache,
        [record.slug]: {
          draft: nextPublishedSecret,
          published: nextPublishedSecret,
        },
      });
    }

    const publishedCopy = structuredClone(record.draft);
    publishedCopy.updatedAt = new Date().toISOString();
    if (publishedCopy.entrance) {
      publishedCopy.entrance.hasPinConfigured = hasPublishedPin(record.slug);
    }

    const backup: BackupEntry = {
      id: `backup-${Date.now()}`,
      createdAt: publishedCopy.updatedAt,
      note,
      config: structuredClone(publishedCopy),
    };

    const nextBackups = [backup, ...record.backups].slice(0, 12);

    saveStore({
      ...storeCache,
      bouquets: {
        ...storeCache.bouquets,
        [record.slug]: {
          slug: record.slug,
          published: publishedCopy,
          draft: structuredClone(publishedCopy),
          backups: nextBackups,
        },
      },
    });

    res.json({
      slug: record.slug,
      published: publishedCopy,
      pinStatus: buildAdminPinStatus(record.slug),
      bouquets: buildAdminSummaries(),
      backup: {
        id: backup.id,
        createdAt: backup.createdAt,
        note: backup.note,
        flowerCount: backup.config.flowers.length,
        photoCount: backup.config.photos.length,
      },
    });
  });

  app.post('/api/admin/discard-draft', requireAdmin, (req, res) => {
    const slugParam = typeof req.query.slug === 'string' ? req.query.slug : undefined;
    const record = getBouquetRecord(slugParam);
    if (!record) {
      res.status(404).json({ error: 'Buket tidak ditemukan' });
      return;
    }

    // Revert draft PIN back to published PIN
    const currentSecret = pinSecretsCache[record.slug];
    if (currentSecret) {
      savePinSecrets({
        ...pinSecretsCache,
        [record.slug]: {
          draft: currentSecret.published ?? null,
          published: currentSecret.published ?? null,
        },
      });
    }

    const reverted = structuredClone(record.published);
    if (reverted.entrance) {
      reverted.entrance.hasPinConfigured = hasDraftPin(record.slug);
    }
    saveStore({
      ...storeCache,
      bouquets: {
        ...storeCache.bouquets,
        [record.slug]: {
          ...record,
          draft: reverted,
        },
      },
    });
    res.json({ draft: reverted, pinStatus: buildAdminPinStatus(record.slug) });
  });

  app.post('/api/admin/backups', requireAdmin, (req, res) => {
    const slugParam = typeof req.query.slug === 'string' ? req.query.slug : undefined;
    const record = getBouquetRecord(slugParam);
    if (!record) {
      res.status(404).json({ error: 'Buket tidak ditemukan' });
      return;
    }

    const note =
      typeof req.body?.note === 'string' && req.body.note.trim()
        ? req.body.note.trim().slice(0, 120)
        : 'Manual snapshot';

    const backup: BackupEntry = {
      id: `backup-${Date.now()}`,
      createdAt: new Date().toISOString(),
      note,
      config: structuredClone(record.draft),
    };

    saveStore({
      ...storeCache,
      bouquets: {
        ...storeCache.bouquets,
        [record.slug]: {
          ...record,
          backups: [backup, ...record.backups].slice(0, 12),
        },
      },
    });

    res.json({
      id: backup.id,
      createdAt: backup.createdAt,
      note: backup.note,
      flowerCount: backup.config.flowers.length,
      photoCount: backup.config.photos.length,
    });
  });

  app.post('/api/admin/backups/:id/restore', requireAdmin, (req, res) => {
    const slugParam = typeof req.query.slug === 'string' ? req.query.slug : undefined;
    const record = getBouquetRecord(slugParam);
    if (!record) {
      res.status(404).json({ error: 'Buket tidak ditemukan' });
      return;
    }

    const target = record.backups.find((b) => b.id === req.params.id);
    if (!target) {
      res.status(404).json({ error: 'Backup snapshot not found' });
      return;
    }
    const restored = normalizeStoredConfig(structuredClone(target.config));
    restored.sharing = { ...restored.sharing!, slug: record.slug };
    restored.updatedAt = new Date().toISOString();
    if (restored.entrance) {
      restored.entrance.hasPinConfigured = hasDraftPin(record.slug);
    }

    saveStore({
      ...storeCache,
      bouquets: {
        ...storeCache.bouquets,
        [record.slug]: {
          ...record,
          draft: restored,
        },
      },
    });
    res.json({ draft: restored });
  });

  app.get('/api/admin/export-backup', requireAdmin, (_req, res) => {
    // Exports non-secret bouquet store only (PIN hashes stored separately)
    res.setHeader('Content-Disposition', 'attachment; filename="pixel-flower-backup.json"');
    res.json(storeCache);
  });

  // Upload intact full-resolution original photo (binary stream)
  app.post(
    '/api/admin/media/photo',
    requireAdmin,
    express.raw({ type: ['image/*', 'application/octet-stream'], limit: '22mb' }),
    (req, res) => {
      const buf = req.body;
      if (!Buffer.isBuffer(buf) || buf.length === 0) {
        res.status(400).json({ error: 'Empty image payload' });
        return;
      }
      const mimeType = String(req.headers['content-type'] || '');
      const ext = detectImageExtension(buf, mimeType);
      if (!ext) {
        res.status(400).json({ error: 'Unsupported image format. Please use JPG, PNG, or WEBP.' });
        return;
      }

      const rawName = decodeURIComponent(String(req.headers['x-file-name'] || 'photo'));
      const cleanName = path.basename(rawName).slice(0, 120) || `photo${ext}`;
      const width = Math.max(16, Math.min(16000, Number(req.headers['x-image-width']) || 1024));
      const height = Math.max(16, Math.min(16000, Number(req.headers['x-image-height']) || 1024));

      const storedFilename = `${crypto.randomUUID()}${ext}`;
      const resolved = path.resolve(PHOTOS_DIR, storedFilename);
      if (!resolved.startsWith(PHOTOS_DIR + path.sep)) {
        res.status(400).json({ error: 'Invalid file destination' });
        return;
      }

      try {
        fs.writeFileSync(resolved, buf);
      } catch (err) {
        console.warn('Local photo write skipped or failed:', err);
      }
      uploadToSupabase('media', `photos/${storedFilename}`, buf, mimeType);
      const url = `/api/media/photos/${storedFilename}`;

      const photoRecord: UploadedPhoto = {
        id: `photo-${crypto.randomUUID()}`,
        name: cleanName,
        originalUrl: url,
        previewUrl: url,
        width,
        height,
        fileSize: buf.length,
        isStarter: false,
        assignedFlowerIds: 'all',
      };

      res.json(photoRecord);
    },
  );

  // Upload custom background audio file (binary stream)
  app.post(
    '/api/admin/media/audio',
    requireAdmin,
    express.raw({ type: ['audio/*', 'application/octet-stream'], limit: '28mb' }),
    (req, res) => {
      const buf = req.body;
      if (!Buffer.isBuffer(buf) || buf.length === 0) {
        res.status(400).json({ error: 'Empty audio payload' });
        return;
      }
      const mimeType = String(req.headers['content-type'] || '');
      const rawName = decodeURIComponent(String(req.headers['x-file-name'] || 'soundtrack.mp3'));
      const cleanName = path.basename(rawName).slice(0, 120) || 'soundtrack.mp3';
      const ext = detectAudioExtension(mimeType, cleanName);
      if (!ext) {
        res
          .status(400)
          .json({ error: 'Unsupported audio format. Please use MP3, WAV, OGG, or M4A.' });
        return;
      }

      const storedFilename = `${crypto.randomUUID()}${ext}`;
      const resolved = path.resolve(AUDIO_DIR, storedFilename);
      if (!resolved.startsWith(AUDIO_DIR + path.sep)) {
        res.status(400).json({ error: 'Invalid file destination' });
        return;
      }

      try {
        fs.writeFileSync(resolved, buf);
      } catch (err) {
        console.warn('Local audio write skipped or failed:', err);
      }
      uploadToSupabase('media', `audio/${storedFilename}`, buf, mimeType);
      res.json({
        url: `/api/media/audio/${storedFilename}`,
        name: cleanName,
      });
    },
  );

  return app;
}

export const app = createServerApp();

async function startServer() {
  // --- VITE DEV MIDDLEWARE / PRODUCTION STATIC ---
  if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else if (!process.env.VERCEL) {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Pixel Flower Bouquet server listening on http://0.0.0.0:${PORT}`);
  });
}

if (!process.env.VERCEL) {
  startServer().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}

export default app;
