import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  Copy,
  Download,
  Eye,
  FastForward,
  Flower2,
  Gift,
  History,
  ImagePlus,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  Monitor,
  Moon,
  Music,
  Palette,
  Play,
  Plus,
  QrCode,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
  Sliders,
  Smartphone,
  Sparkles,
  Tablet,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AdminAuthStatus,
  AdminBouquetSummary,
  AdminPinStatus,
  BouquetSiteConfig,
  ClickedPixelInfo,
  EntranceSecurityConfig,
  FlowerConfig,
  LilyColorKind,
  MoonStyle,
  PixelSizeMode,
  ProcessedAtlasResult,
  StarDistributionMode,
  ThemePresetId,
  UploadedPhoto,
  WrapThemeId,
} from '../types/bouquet';
import {
  createDefaultEntranceConfig,
  TAG_COLOR_PRESETS,
  THEME_PRESETS,
  WRAP_THEMES,
} from '../utils/defaultBouquetConfig';
import {
  buildPhotoTileAtlas,
  createStarterPhotoSources,
  loadImageSourceFromPhoto,
  readImageFileDimensions,
  type LoadedImageSource,
} from '../utils/photoProcessor';
import {
  AdminEntranceTab,
  type AdminEntrancePreviewAction,
} from './AdminEntranceTab';
import { BouquetViewport, type BouquetViewportHandle } from './BouquetViewport';
import { GiftTagModal } from './GiftTagModal';
import { PhotoLightboxModal } from './PhotoLightboxModal';
import { PinLockScreen, type PinVerifyOutcome } from './PinLockScreen';

type AdminTabId =
  | 'ringkasan'
  | 'foto'
  | 'bunga'
  | 'pita-tag'
  | 'pesan-tema'
  | 'animasi-langit'
  | 'pin-tirai'
  | 'publikasi';

type PreviewDeviceMode = 'desktop' | 'tablet' | 'mobile';

interface BackupSummary {
  id: string;
  createdAt: string;
  note: string;
  flowerCount: number;
  photoCount: number;
}

interface ConfirmDialogState {
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
}

interface AdminDashboardProps {
  onNavigatePublic: () => void;
}

const COLOR_OPTIONS: Array<{ id: LilyColorKind; label: string; swatch: string }> = [
  { id: 'pink', label: 'Merah Muda Stargazer', swatch: '#ec4899' },
  { id: 'white', label: 'Putih Casablanca', swatch: '#fff1f2' },
  { id: 'red', label: 'Merah Crimson', swatch: '#e11d48' },
  { id: 'lavender', label: 'Lavender Anggrek', swatch: '#c084fc' },
  { id: 'peach', label: 'Peach Lembut', swatch: '#fda4af' },
];

function ShareMatrixSvg({ value }: { value: string }) {
  const size = 21;
  const cells: boolean[][] = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => false),
  );

  const drawFinder = (ox: number, oy: number) => {
    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < 7; x++) {
        const border = x === 0 || x === 6 || y === 0 || y === 6;
        const inner = x >= 2 && x <= 4 && y >= 2 && y <= 4;
        cells[oy + y][ox + x] = border || inner;
      }
    }
  };
  drawFinder(0, 0);
  drawFinder(size - 7, 0);
  drawFinder(0, size - 7);

  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const inTL = x < 8 && y < 8;
      const inTR = x >= size - 8 && y < 8;
      const inBL = x < 8 && y >= size - 8;
      if (inTL || inTR || inBL) continue;
      if (x === 6 || y === 6) {
        cells[y][x] = (x + y) % 2 === 0;
        continue;
      }
      const bit = ((hash ^ (x * 73 + y * 151)) >>> ((x + y) % 16)) & 1;
      cells[y][x] = bit === 1;
    }
  }

  return (
    <svg
      viewBox={`0 0 ${size + 2} ${size + 2}`}
      className="w-24 h-24 rounded-lg bg-white p-1.5 shrink-0"
      role="img"
      aria-label={`QR pratinjau tautan ${value}`}
    >
      {cells.map((row, y) =>
        row.map((on, x) =>
          on ? (
            <rect key={`${x}-${y}`} x={x + 1} y={y + 1} width={1} height={1} fill="#14091a" />
          ) : null,
        ),
      )}
    </svg>
  );
}

export function AdminDashboard({ onNavigatePublic }: AdminDashboardProps) {
  // Authentication state
  const [authStatus, setAuthStatus] = useState<AdminAuthStatus | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [passwordInput, setPasswordInput] = useState('');
  const [confirmPassInput, setConfirmPassInput] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSubmitting, setAuthSubmitting] = useState(false);

  // Admin state from server (multi-bouquet aware)
  const [selectedSlug, setSelectedSlug] = useState<string>('pixel-flower-bouquet');
  const [bouquets, setBouquets] = useState<AdminBouquetSummary[]>([]);
  const [pinStatus, setPinStatus] = useState<AdminPinStatus | null>(null);
  const [draft, setDraft] = useState<BouquetSiteConfig | null>(null);
  const [published, setPublished] = useState<BouquetSiteConfig | null>(null);
  const [backups, setBackups] = useState<BackupSummary[]>([]);
  const [loadingState, setLoadingState] = useState(false);

  // Isolated Live Entrance Preview state
  const [entrancePreviewOpen, setEntrancePreviewOpen] = useState(false);
  const [entrancePreviewDevice, setEntrancePreviewDevice] = useState<PreviewDeviceMode>('desktop');
  const [entrancePreviewStage, setEntrancePreviewStage] = useState<'lock' | 'curtain-or-bouquet'>('lock');
  const [previewSimFakeUsed, setPreviewSimFakeUsed] = useState(0);
  const [forcedTestEvent, setForcedTestEvent] = useState<{
    nonce: number;
    kind: 'wrong' | 'fake' | 'success';
    anim?: ReturnType<typeof createDefaultEntranceConfig>['wrongPinAnim'];
  } | null>(null);
  const entrancePreviewViewportRef = useRef<BouquetViewportHandle | null>(null);

  // Save / publish / upload status
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishNote, setPublishNote] = useState('');
  const [isUploadingPhotos, setIsUploadingPhotos] = useState(false);
  const [isUploadingAudio, setIsUploadingAudio] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Editor UI state
  const [activeTab, setActiveTab] = useState<AdminTabId>('ringkasan');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [selectedFlowerId, setSelectedFlowerId] = useState<string | null>(null);
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const [previewDevice, setPreviewDevice] = useState<PreviewDeviceMode>('desktop');
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);

  // Live 3D preview atlas & lightbox
  const viewportRef = useRef<BouquetViewportHandle | null>(null);
  const [loadedSources, setLoadedSources] = useState<LoadedImageSource[]>(() =>
    createStarterPhotoSources(),
  );
  const [atlas, setAtlas] = useState<ProcessedAtlasResult | null>(null);
  const [lightboxPhotoId, setLightboxPhotoId] = useState<string | null>(null);
  const [lightboxPixelInfo, setLightboxPixelInfo] = useState<ClickedPixelInfo | null>(null);
  const [tagModalOpen, setTagModalOpen] = useState(false);
  const [totalTiles, setTotalTiles] = useState(0);

  // Media input refs
  const multiPhotoInputRef = useRef<HTMLInputElement | null>(null);
  const replacePhotoInputRef = useRef<HTMLInputElement | null>(null);
  const replacingPhotoIdRef = useRef<string | null>(null);
  const audioUploadInputRef = useRef<HTMLInputElement | null>(null);

  const skipNextAutoSaveRef = useRef(true);
  const saveTimerRef = useRef<number | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => {
      setToast((curr) => (curr === msg ? null : curr));
    }, 3200);
  }, []);

  const fetchAuthStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/auth/status');
      if (res.ok) {
        const data = (await res.json()) as AdminAuthStatus;
        setAuthStatus(data);
      }
    } catch {
      setAuthError('Tidak dapat terhubung ke layanan autentikasi server.');
    }
  }, []);

  useEffect(() => {
    fetchAuthStatus();
  }, [fetchAuthStatus]);

  const loadAdminState = useCallback(async (activeToken: string, targetSlug?: string) => {
    setLoadingState(true);
    try {
      const url = targetSlug
        ? `/api/admin/state?slug=${encodeURIComponent(targetSlug)}`
        : '/api/admin/state';
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${activeToken}` },
      });
      if (res.status === 401) {
        setToken(null);
        setAuthError('Sesi berakhir. Silakan masuk kembali.');
        return;
      }
      if (!res.ok) throw new Error('Gagal memuat konfigurasi admin');
      const data = (await res.json()) as {
        slug: string;
        bouquets: AdminBouquetSummary[];
        pinStatus: AdminPinStatus;
        draft: BouquetSiteConfig;
        published: BouquetSiteConfig;
        backups: BackupSummary[];
      };
      skipNextAutoSaveRef.current = true;
      setSelectedSlug(data.slug);
      setBouquets(data.bouquets ?? []);
      setPinStatus(data.pinStatus ?? null);
      setDraft(data.draft);
      setPublished(data.published);
      setBackups(data.backups);
      setSelectedFlowerId(data.draft.flowers[0]?.id ?? null);
      setSaveStatus('saved');
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Gagal memuat data dashboard');
    } finally {
      setLoadingState(false);
    }
  }, []);

  useEffect(() => {
    if (token) {
      loadAdminState(token);
    }
  }, [token, loadAdminState]);

  useEffect(() => {
    let cancelled = false;
    const photos = draft?.photos ?? [];
    if (photos.length === 0) {
      setLoadedSources(createStarterPhotoSources());
      return;
    }

    Promise.all(photos.map(loadImageSourceFromPhoto)).then((results) => {
      if (cancelled) return;
      const valid = results.filter((r): r is LoadedImageSource => r !== null);
      setLoadedSources(valid.length > 0 ? valid : createStarterPhotoSources());
    });

    return () => {
      cancelled = true;
    };
  }, [draft?.photos]);

  useEffect(() => {
    const caps = viewportRef.current?.getCapabilities() ?? {
      maxTextureSize: 2048,
      maxAnisotropy: 4,
    };
    const nextAtlas = buildPhotoTileAtlas(loadedSources, caps.maxTextureSize, caps.maxAnisotropy);
    setAtlas((prev) => {
      if (prev?.atlasTexture) prev.atlasTexture.dispose();
      return nextAtlas;
    });
  }, [loadedSources]);

  const persistDraftNow = useCallback(
    async (nextDraft: BouquetSiteConfig, activeToken: string, slugOverride?: string) => {
      const slugToUse = slugOverride ?? selectedSlug;
      setSaveStatus('saving');
      setSaveError(null);
      try {
        const res = await fetch(`/api/admin/draft?slug=${encodeURIComponent(slugToUse)}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${activeToken}`,
          },
          body: JSON.stringify(nextDraft),
        });
        if (res.status === 401) {
          setToken(null);
          setAuthError('Sesi berakhir. Silakan masuk kembali.');
          return;
        }
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          throw new Error(errBody.error || 'Penyimpanan otomatis gagal');
        }
        const savedData = await res.json().catch(() => ({}));
        if (savedData.pinStatus) {
          setPinStatus(savedData.pinStatus);
        }
        setSaveStatus('saved');
      } catch (err) {
        setSaveStatus('error');
        setSaveError(err instanceof Error ? err.message : 'Penyimpanan otomatis gagal');
      }
    },
    [selectedSlug],
  );

  useEffect(() => {
    if (!draft || !token) return;
    if (skipNextAutoSaveRef.current) {
      skipNextAutoSaveRef.current = false;
      return;
    }
    setSaveStatus('saving');
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(() => {
      persistDraftNow(draft, token, selectedSlug);
    }, 700);
    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, [draft, token, selectedSlug, persistDraftNow]);

  const hasUnpublishedChanges = useMemo(() => {
    if (!draft || !published) return false;
    const stripMeta = (cfg: BouquetSiteConfig) =>
      JSON.stringify({ ...cfg, version: 0, updatedAt: '' });
    return stripMeta(draft) !== stripMeta(published);
  }, [draft, published]);

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);

    if (authStatus?.needsSetup) {
      if (passwordInput.length < 8) {
        setAuthError('Kata sandi minimal harus 8 karakter.');
        return;
      }
      if (passwordInput !== confirmPassInput) {
        setAuthError('Konfirmasi kata sandi tidak cocok.');
        return;
      }
    }

    setAuthSubmitting(true);
    try {
      const endpoint = authStatus?.needsSetup ? '/api/admin/auth/setup' : '/api/admin/auth/login';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: passwordInput }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Autentikasi gagal');
      }
      setPasswordInput('');
      setConfirmPassInput('');
      setToken(data.token);
      setAuthStatus((prev) => (prev ? { ...prev, needsSetup: false, authenticated: true } : prev));
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Autentikasi gagal');
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleLogout = async () => {
    if (token) {
      await fetch('/api/admin/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
    setToken(null);
    setDraft(null);
    setPublished(null);
    fetchAuthStatus();
  };

  const uploadSinglePhotoBinary = async (file: File): Promise<UploadedPhoto> => {
    if (!token) throw new Error('Belum terautentikasi');
    const dims = await readImageFileDimensions(file);
    const buffer = await file.arrayBuffer();
    const res = await fetch('/api/admin/media/photo', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': file.type || 'application/octet-stream',
        'x-file-name': encodeURIComponent(file.name),
        'x-image-width': String(dims.width),
        'x-image-height': String(dims.height),
      },
      body: buffer,
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `Gagal mengunggah ${file.name}`);
    }
    return (await res.json()) as UploadedPhoto;
  };

  const handleUploadMultiplePhotos = async (files: FileList) => {
    const imgFiles = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (imgFiles.length === 0) return;

    setIsUploadingPhotos(true);
    try {
      const uploaded: UploadedPhoto[] = [];
      for (const file of imgFiles.slice(0, 30)) {
        const rec = await uploadSinglePhotoBinary(file);
        uploaded.push(rec);
      }
      setDraft((prev) =>
        prev
          ? {
              ...prev,
              photos: [...prev.photos, ...uploaded],
            }
          : prev,
      );
      showToast(`Berhasil mengunggah ${uploaded.length} foto resolusi penuh`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unggah foto gagal');
    } finally {
      setIsUploadingPhotos(false);
    }
  };

  const handleReplacePhotoFile = async (photoId: string, file: File) => {
    if (!file.type.startsWith('image/')) return;
    setIsUploadingPhotos(true);
    try {
      const rec = await uploadSinglePhotoBinary(file);
      setDraft((prev) => {
        if (!prev) return prev;
        const old = prev.photos.find((p) => p.id === photoId);
        const merged: UploadedPhoto = {
          ...rec,
          caption: old?.caption ?? '',
          assignedFlowerIds: old?.assignedFlowerIds ?? 'all',
        };
        return {
          ...prev,
          photos: prev.photos.map((p) => (p.id === photoId ? merged : p)),
        };
      });
      showToast(`Foto diganti dengan ${file.name}`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Gagal mengganti foto');
    } finally {
      setIsUploadingPhotos(false);
    }
  };

  const handleMovePhoto = (index: number, delta: -1 | 1) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const target = index + delta;
      if (target < 0 || target >= prev.photos.length) return prev;
      const nextPhotos = [...prev.photos];
      const [moved] = nextPhotos.splice(index, 1);
      nextPhotos.splice(target, 0, moved);
      return { ...prev, photos: nextPhotos };
    });
  };

  const handleTogglePhotoFlowerAssignment = (photoId: string, flowerId: string | 'all') => {
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        photos: prev.photos.map((p) => {
          if (p.id !== photoId) return p;
          if (flowerId === 'all') {
            return { ...p, assignedFlowerIds: 'all' };
          }
          const current =
            p.assignedFlowerIds === 'all' || !p.assignedFlowerIds
              ? prev.flowers.map((f) => f.id)
              : p.assignedFlowerIds;
          const exists = current.includes(flowerId);
          const next = exists ? current.filter((id) => id !== flowerId) : [...current, flowerId];
          return {
            ...p,
            assignedFlowerIds: next.length === prev.flowers.length ? 'all' : next,
          };
        }),
      };
    });
  };

  const handleAddFlower = (isBud: boolean) => {
    if (!draft) return;
    const count = draft.flowers.length;
    const angle = count * 1.15;
    const radius = isBud ? 1.15 : 0.85;
    const newFlower: FlowerConfig = {
      id: `lily-${Date.now()}`,
      label: isBud ? `Kuncup Lily #${count + 1}` : `Lily Mekar #${count + 1}`,
      colorKind: COLOR_OPTIONS[count % COLOR_OPTIONS.length].id,
      isBud,
      position: [
        Number((Math.cos(angle) * radius).toFixed(2)),
        Number((isBud ? 2.9 : 2.15 + (count % 3) * 0.25).toFixed(2)),
        Number((Math.sin(angle) * radius).toFixed(2)),
      ],
      rotation: [0.35, Number((angle * 0.5).toFixed(2)), 0],
      scale: isBud ? 0.78 : 1.0,
      bloomDelay: Math.min(0.8, Number((count * 0.04).toFixed(2))),
      bloomIntensity: 1.0,
      swayIntensity: 1.0,
    };
    setDraft((prev) => (prev ? { ...prev, flowers: [...prev.flowers, newFlower] } : prev));
    setSelectedFlowerId(newFlower.id);
    showToast(`Ditambahkan: ${newFlower.label}`);
  };

  const handleDuplicateFlower = (flower: FlowerConfig) => {
    const clone: FlowerConfig = {
      ...flower,
      id: `lily-${Date.now()}`,
      label: `${flower.label} (Salinan)`,
      position: [
        Number(Math.min(3.2, flower.position[0] + 0.35).toFixed(2)),
        flower.position[1],
        Number(Math.min(3.2, flower.position[2] + 0.25).toFixed(2)),
      ],
      rotation: [...flower.rotation] as [number, number, number],
    };
    setDraft((prev) => (prev ? { ...prev, flowers: [...prev.flowers, clone] } : prev));
    setSelectedFlowerId(clone.id);
    showToast(`Diduplikasi: ${flower.label}`);
  };

  const updateFlower = (flowerId: string, patch: Partial<FlowerConfig>) => {
    setDraft((prev) =>
      prev
        ? {
            ...prev,
            flowers: prev.flowers.map((f) => (f.id === flowerId ? { ...f, ...patch } : f)),
          }
        : prev,
    );
  };

  const handleUploadAudio = async (file: File) => {
    if (!token) return;
    setIsUploadingAudio(true);
    try {
      const buffer = await file.arrayBuffer();
      const res = await fetch('/api/admin/media/audio', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': file.type || 'application/octet-stream',
          'x-file-name': encodeURIComponent(file.name),
        },
        body: buffer,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Unggah audio gagal');
      setDraft((prev) =>
        prev
          ? {
              ...prev,
              music: {
                ...prev.music,
                mode: 'uploaded',
                uploadedAudioUrl: data.url,
                uploadedAudioName: data.name,
              },
            }
          : prev,
      );
      showToast(`Audio diunggah: ${data.name}`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unggah audio gagal');
    } finally {
      setIsUploadingAudio(false);
    }
  };

  const handlePublishLive = async () => {
    if (!token || !draft) return;
    setIsPublishing(true);
    try {
      await persistDraftNow(draft, token, selectedSlug);
      const res = await fetch(`/api/admin/publish?slug=${encodeURIComponent(selectedSlug)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ note: publishNote.trim() || 'Pembaruan buket dipublikasikan' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Publikasi gagal');

      skipNextAutoSaveRef.current = true;
      setPublished(data.published);
      setDraft(structuredClone(data.published));
      if (data.pinStatus) setPinStatus(data.pinStatus);
      if (data.bouquets) setBouquets(data.bouquets);
      if (data.backup) {
        setBackups((prev) => [data.backup, ...prev].slice(0, 12));
      }
      setPublishNote('');
      showToast('Berhasil dipublikasikan! Perubahan kini tampil di halaman publik.');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Publikasi gagal');
    } finally {
      setIsPublishing(false);
    }
  };

  const handleDiscardDraft = async () => {
    if (!token) return;
    const res = await fetch(`/api/admin/discard-draft?slug=${encodeURIComponent(selectedSlug)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      skipNextAutoSaveRef.current = true;
      setDraft(data.draft);
      if (data.pinStatus) setPinStatus(data.pinStatus);
      setSaveStatus('saved');
      showToast('Draf dikembalikan agar sesuai versi publik terbaru');
    }
  };

  const handleCreateManualBackup = async () => {
    if (!token || !draft) return;
    await persistDraftNow(draft, token, selectedSlug);
    const res = await fetch(`/api/admin/backups?slug=${encodeURIComponent(selectedSlug)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ note: publishNote.trim() || 'Snapshot manual' }),
    });
    if (res.ok) {
      const b = (await res.json()) as BackupSummary;
      setBackups((prev) => [b, ...prev].slice(0, 12));
      setPublishNote('');
      showToast('Snapshot cadangan tersimpan');
    }
  };

  const handleRestoreBackup = async (backupId: string) => {
    if (!token) return;
    const res = await fetch(
      `/api/admin/backups/${encodeURIComponent(backupId)}/restore?slug=${encodeURIComponent(selectedSlug)}`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    if (res.ok) {
      const data = await res.json();
      skipNextAutoSaveRef.current = true;
      setDraft(data.draft);
      setSaveStatus('saved');
      showToast('Cadangan dipulihkan ke draf. Klik Publikasikan untuk tayang.');
    }
  };

  const handleExportJsonBackup = async () => {
    if (!token) return;
    const res = await fetch('/api/admin/export-backup', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pixel-flower-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Cadangan JSON berhasil diekspor');
  };

  // --- MULTI-BOUQUET & PIN MANAGEMENT HANDLERS ---
  const handleSelectBouquet = async (slug: string) => {
    if (!token || slug === selectedSlug) return;
    if (draft) {
      await persistDraftNow(draft, token, selectedSlug);
    }
    await loadAdminState(token, slug);
    showToast(`Beralih ke buket /gift/${slug}`);
  };

  const handleCreateBouquet = async (
    slug: string,
    recipientName: string,
    cloneFromSlug?: string,
  ) => {
    if (!token) return;
    const res = await fetch('/api/admin/bouquets', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ slug, recipientName, cloneFromSlug }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showToast(data.error || 'Gagal membuat buket baru');
      return;
    }
    await loadAdminState(token, data.slug);
    showToast(`Buket baru /gift/${data.slug} siap dikelola`);
  };

  const handleDeleteBouquet = async (slug: string) => {
    if (!token) return;
    const res = await fetch(`/api/admin/bouquets/${encodeURIComponent(slug)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showToast(data.error || 'Gagal menghapus buket');
      return;
    }
    const nextTarget = slug === selectedSlug ? data.defaultSlug : selectedSlug;
    await loadAdminState(token, nextTarget);
    showToast(`Buket /gift/${slug} dihapus`);
  };

  const handleSetDefaultBouquet = async (slug: string) => {
    if (!token) return;
    const res = await fetch(`/api/admin/bouquets/${encodeURIComponent(slug)}/set-default`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showToast(data.error || 'Gagal mengatur buket utama');
      return;
    }
    setBouquets(data.bouquets ?? []);
    showToast(`/gift/${slug} ditetapkan sebagai buket utama di halaman depan (/)`);
  };

  const handleSavePin = async (pin: string, confirmPin: string) => {
    if (!token) return;
    const res = await fetch(`/api/admin/bouquets/${encodeURIComponent(selectedSlug)}/pin`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ pin, confirmPin }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showToast(data.error || 'Gagal menyimpan PIN');
      return;
    }
    if (data.pinStatus) setPinStatus(data.pinStatus);
    if (data.draft) {
      skipNextAutoSaveRef.current = true;
      setDraft(data.draft);
    }
    showToast('PIN 6 digit tersimpan di Draf! Klik Publikasikan Live agar berlaku untuk pengunjung.');
  };

  const handleResetVisitorFakeFailure = async () => {
    if (!token) return;
    const res = await fetch(
      `/api/admin/bouquets/${encodeURIComponent(selectedSlug)}/reset-fake-failure`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showToast(data.error || 'Gagal mereset status pengunjung');
      return;
    }
    if (data.pinStatus) setPinStatus(data.pinStatus);
    showToast('Status kegagalan palsu pengunjung berhasil direset.');
  };

  const updateEntrance = useCallback(
    (updater: (prev: EntranceSecurityConfig) => EntranceSecurityConfig) => {
      setDraft((prev) => {
        if (!prev) return prev;
        const curr = prev.entrance ?? createDefaultEntranceConfig();
        return {
          ...prev,
          entrance: updater(curr),
        };
      });
    },
    [],
  );

  const handleLaunchPreviewAction = useCallback(
    (action: AdminEntrancePreviewAction) => {
      const ent = draft?.entrance ?? createDefaultEntranceConfig();
      setEntrancePreviewOpen(true);

      if (action === 'preview-lock' || action === 'reset-preview') {
        setPreviewSimFakeUsed(0);
        setForcedTestEvent(null);
        setEntrancePreviewStage('lock');
        if (action === 'reset-preview') {
          showToast('Status pratinjau direset — siap uji kegagalan palsu pertama lagi.');
        }
        return;
      }

      if (action === 'test-wrong') {
        setEntrancePreviewStage('lock');
        window.setTimeout(() => {
          setForcedTestEvent({
            nonce: Date.now(),
            kind: 'wrong',
            anim: ent.wrongPinAnim,
          });
        }, 60);
        return;
      }

      if (action === 'test-fake') {
        setEntrancePreviewStage('lock');
        window.setTimeout(() => {
          setForcedTestEvent({
            nonce: Date.now(),
            kind: 'fake',
            anim: ent.fakeFailure.anim,
          });
        }, 60);
        return;
      }

      if (action === 'test-success') {
        setEntrancePreviewStage('lock');
        window.setTimeout(() => {
          setForcedTestEvent({
            nonce: Date.now(),
            kind: 'success',
          });
        }, 60);
        return;
      }

      if (action === 'replay-curtain') {
        setForcedTestEvent(null);
        setEntrancePreviewStage('curtain-or-bouquet');
        window.setTimeout(() => {
          entrancePreviewViewportRef.current?.playFlowerCurtain({
            assembleAfter: ent.curtain.assembleBouquetAfter,
          });
        }, 80);
        return;
      }

      if (action === 'replay-full') {
        setPreviewSimFakeUsed(0);
        setForcedTestEvent(null);
        setEntrancePreviewStage('lock');
        window.setTimeout(() => {
          setForcedTestEvent({
            nonce: Date.now(),
            kind: 'success',
          });
        }, 650);
      }
    },
    [draft?.entrance, showToast],
  );

  const handlePreviewPinSubmit = async (pin: string): Promise<PinVerifyOutcome> => {
    if (!token) return { unlocked: false, error: 'Sesi admin tidak valid' };
    const res = await fetch(
      `/api/admin/bouquets/${encodeURIComponent(selectedSlug)}/preview-verify`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          pin,
          simulatedFakeUsed: previewSimFakeUsed,
        }),
      },
    );
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.unlocked) {
      return { unlocked: true };
    }
    if (typeof data.nextFakeUsed === 'number') {
      setPreviewSimFakeUsed(data.nextFakeUsed);
    }
    return {
      unlocked: false,
      error: data.error,
      anim: data.anim,
    };
  };

  // --- AUTH GATE VIEW ---
  if (!token) {
    return (
      <div className="min-h-screen w-full bg-black text-[#f9f4f7] flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-md rounded-2xl bg-[#0d0812] border border-pink-400/35 p-7 sm:p-8 shadow-2xl space-y-6">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-xl bg-pink-500/15 border border-pink-400/35 flex items-center justify-center">
                <ShieldCheck className="w-5 h-5 text-pink-400" />
              </div>
              <div>
                <h1 className="font-mono-tabular text-sm font-semibold text-pink-300">
                  &gt; Studio Admin Buket
                </h1>
                <p className="text-xs text-white/60">
                  {authStatus?.needsSetup
                    ? 'Pengaturan kata sandi admin pertama kali'
                    : 'Masuk sebagai administrator'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onNavigatePublic}
              className="px-3 py-1.5 rounded-lg border border-white/15 hover:bg-white/10 text-xs font-mono-tabular text-white/80 flex items-center gap-1.5 cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Halaman Publik</span>
            </button>
          </div>

          {authStatus?.needsSetup && (
            <div className="p-3.5 rounded-xl bg-pink-500/10 border border-pink-400/25 text-xs text-pink-100/90 leading-relaxed">
              Buat kata sandi administrator untuk mengelola isi buket. Pengunjung umum tetap hanya
              dapat melihat (view-only).
            </div>
          )}

          <form onSubmit={handleAuthSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-mono-tabular text-white/80 mb-1.5">
                {authStatus?.needsSetup ? 'Kata Sandi Baru (min 8 karakter)' : 'Kata Sandi Admin'}
              </label>
              <div className="relative">
                <KeyRound className="w-4 h-4 text-pink-400/70 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  placeholder="Masukkan kata sandi"
                  required
                  autoFocus
                  className="w-full pl-10 pr-3.5 py-2.5 rounded-lg bg-black border border-white/15 focus:border-pink-400 text-sm text-white outline-none"
                />
              </div>
            </div>

            {authStatus?.needsSetup && (
              <div>
                <label className="block text-xs font-mono-tabular text-white/80 mb-1.5">
                  Konfirmasi Kata Sandi
                </label>
                <input
                  type="password"
                  value={confirmPassInput}
                  onChange={(e) => setConfirmPassInput(e.target.value)}
                  placeholder="Ulangi kata sandi"
                  required
                  className="w-full px-3.5 py-2.5 rounded-lg bg-black border border-white/15 focus:border-pink-400 text-sm text-white outline-none"
                />
              </div>
            )}

            {authError && (
              <div className="p-3 rounded-lg bg-rose-500/15 border border-rose-400/40 text-xs text-rose-200">
                {authError}
              </div>
            )}

            <button
              type="submit"
              disabled={authSubmitting || !authStatus}
              className="w-full py-2.5 rounded-lg bg-pink-600 hover:bg-pink-500 disabled:opacity-50 text-sm font-mono-tabular font-medium text-white transition-colors cursor-pointer"
            >
              {authSubmitting
                ? 'Memverifikasi...'
                : authStatus?.needsSetup
                  ? 'Simpan Sandi & Masuk Studio'
                  : 'Buka Dashboard Admin'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (loadingState || !draft) {
    return (
      <div className="min-h-screen bg-black text-pink-200 flex items-center justify-center font-mono-tabular text-sm">
        &gt; Memuat Studio Admin Buket 3D...
      </div>
    );
  }

  const allAdminPhotos = loadedSources.map((s) => s.photo);
  const lightboxIdx = lightboxPhotoId
    ? allAdminPhotos.findIndex((p) => p.id === lightboxPhotoId)
    : -1;
  const activeLightboxPhoto = lightboxIdx >= 0 ? allAdminPhotos[lightboxIdx] : null;
  const selectedFlower =
    draft.flowers.find((f) => f.id === selectedFlowerId) ?? draft.flowers[0] ?? null;
  const selectedFlowerIndex = selectedFlower
    ? draft.flowers.findIndex((f) => f.id === selectedFlower.id)
    : 0;

  const publicShareUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/gift/${encodeURIComponent(selectedSlug)}`
      : 'https://buket.local';

  const navTabs: Array<{ id: AdminTabId; label: string; icon: typeof ImagePlus; count?: number }> = [
    { id: 'ringkasan', label: 'Ringkasan', icon: LayoutDashboard },
    { id: 'pin-tirai', label: 'PIN & Tirai Bunga', icon: KeyRound },
    { id: 'foto', label: 'Foto & Piksel', icon: ImagePlus, count: draft.photos.length },
    { id: 'bunga', label: 'Rangkaian Bunga', icon: Flower2, count: draft.flowers.length },
    { id: 'pita-tag', label: 'Pembungkus & Tag', icon: Gift },
    { id: 'pesan-tema', label: 'Pesan & Tema', icon: Palette },
    { id: 'animasi-langit', label: 'Intro, Langit & Audio', icon: Sliders },
    { id: 'publikasi', label: 'Publikasi & Cadangan', icon: History, count: backups.length },
  ];

  const previewFrameClass =
    previewDevice === 'mobile'
      ? 'w-[340px] max-w-full h-[580px] rounded-2xl border-2 border-pink-400/45 shadow-2xl overflow-hidden'
      : previewDevice === 'tablet'
        ? 'w-[600px] max-w-full h-[560px] rounded-2xl border-2 border-pink-400/40 shadow-2xl overflow-hidden'
        : 'w-full h-full';

  return (
    <div className="min-h-screen w-full bg-[#060409] text-[#f9f4f7] flex flex-col">
      {/* Hidden file inputs */}
      <input
        ref={multiPhotoInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) {
            handleUploadMultiplePhotos(e.target.files);
            e.target.value = '';
          }
        }}
      />
      <input
        ref={replacePhotoInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          const targetId = replacingPhotoIdRef.current;
          if (f && targetId) {
            handleReplacePhotoFile(targetId, f);
            e.target.value = '';
          }
        }}
      />
      <input
        ref={audioUploadInputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) {
            handleUploadAudio(f);
            e.target.value = '';
          }
        }}
      />

      {/* TOP ADMIN HEADER */}
      <header className="sticky top-0 z-30 border-b border-pink-400/25 bg-black/95 px-3 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            type="button"
            onClick={() => setMobileMenuOpen((v) => !v)}
            className="lg:hidden p-2 rounded-lg border border-white/15 hover:bg-white/10 text-white cursor-pointer"
            aria-label="Buka menu navigasi admin"
          >
            {mobileMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
          </button>

          <button
            type="button"
            onClick={onNavigatePublic}
            className="px-3 py-1.5 rounded-lg border border-white/15 hover:bg-white/10 text-xs font-mono-tabular text-white/85 flex items-center gap-1.5 cursor-pointer shrink-0"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Lihat Publik</span>
          </button>

          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono-tabular text-sm font-semibold text-pink-400 truncate">
                &gt; Admin Studio Buket 3D
              </span>
              {bouquets.length > 0 && (
                <select
                  value={selectedSlug}
                  onChange={(e) => handleSelectBouquet(e.target.value)}
                  aria-label="Pilih buket aktif"
                  className="px-2 py-0.5 rounded bg-black border border-pink-400/35 text-[11px] font-mono-tabular text-pink-100 outline-none cursor-pointer"
                >
                  {bouquets.map((b) => (
                    <option key={b.slug} value={b.slug}>
                      /gift/{b.slug}
                      {b.isDefault ? ' (Utama)' : ''}
                    </option>
                  ))}
                </select>
              )}
              {hasUnpublishedChanges || pinStatus?.pinDraftPendingPublish ? (
                <span className="px-2 py-0.5 rounded bg-amber-500/20 border border-amber-400/40 text-[10px] font-mono-tabular text-amber-200 whitespace-nowrap">
                  Draf Belum Tayang
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-400/35 text-[10px] font-mono-tabular text-emerald-200 whitespace-nowrap">
                  Tersinkron Live
                </span>
              )}
            </div>
            <div className="text-[11px] font-mono-tabular text-white/55 flex items-center gap-2">
              <span>
                {draft.flowers.length} bunga · {totalTiles.toLocaleString()} piksel ·{' '}
                {draft.photos.length > 0 ? `${draft.photos.length} foto` : 'set bawaan'}
              </span>
              <span>·</span>
              <span
                className={
                  saveStatus === 'error'
                    ? 'text-rose-400'
                    : saveStatus === 'saving'
                      ? 'text-amber-300'
                      : 'text-emerald-300'
                }
              >
                {saveStatus === 'saving'
                  ? 'Menyimpan...'
                  : saveStatus === 'error'
                    ? saveError || 'Gagal menyimpan'
                    : 'Tersimpan otomatis'}
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => handleLaunchPreviewAction('preview-lock')}
            className="px-3 py-1.5 rounded-lg border border-pink-400/40 bg-pink-500/10 hover:bg-pink-500/20 text-xs font-mono-tabular text-pink-200 flex items-center gap-1.5 cursor-pointer"
          >
            <KeyRound className="w-3.5 h-3.5 text-pink-300" />
            <span>Uji PIN & Tirai</span>
          </button>

          <button
            type="button"
            onClick={() => setPreviewExpanded((p) => !p)}
            className="px-3 py-1.5 rounded-lg border border-white/15 hover:bg-white/10 text-xs font-mono-tabular text-white/90 flex items-center gap-1.5 cursor-pointer"
          >
            <Eye className="w-3.5 h-3.5 text-pink-300" />
            <span>{previewExpanded ? 'Tampilan Bagi' : 'Pratinjau Penuh'}</span>
          </button>

          {hasUnpublishedChanges && (
            <button
              type="button"
              onClick={() =>
                setConfirmDialog({
                  title: 'Batalkan perubahan draf?',
                  description:
                    'Draf akan dikembalikan agar sama persis dengan versi publik saat ini. Berkas foto yang sudah diunggah tetap aman.',
                  confirmLabel: 'Kembalikan Draf',
                  danger: true,
                  onConfirm: () => {
                    setConfirmDialog(null);
                    handleDiscardDraft();
                  },
                })
              }
              className="px-3 py-1.5 rounded-lg border border-rose-400/35 hover:bg-rose-500/15 text-xs font-mono-tabular text-rose-200 flex items-center gap-1.5 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Batal Draf</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => persistDraftNow(draft, token)}
            className="px-3 py-1.5 rounded-lg border border-white/15 hover:bg-white/10 text-xs font-mono-tabular text-white/85 flex items-center gap-1.5 cursor-pointer"
          >
            <Save className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Simpan Draf</span>
          </button>

          <button
            type="button"
            onClick={handlePublishLive}
            disabled={isPublishing}
            className="px-4 py-1.5 rounded-lg bg-pink-600 hover:bg-pink-500 disabled:opacity-50 text-xs font-mono-tabular font-medium text-white flex items-center gap-1.5 cursor-pointer"
          >
            <Check className="w-3.5 h-3.5" />
            <span>{isPublishing ? 'Memublikasikan...' : 'Publikasikan Live'}</span>
          </button>

          <button
            type="button"
            onClick={handleLogout}
            className="p-2 rounded-lg border border-white/15 hover:bg-white/10 text-white/75 hover:text-white cursor-pointer"
            title="Keluar dari Studio Admin"
            aria-label="Keluar"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* TOAST */}
      {toast && (
        <div
          role="status"
          className="fixed top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg bg-[#140a1d] border border-pink-400/60 text-xs font-mono-tabular text-pink-100 shadow-2xl"
        >
          {toast}
        </div>
      )}

      {/* MOBILE DRAWER OVERLAY */}
      {mobileMenuOpen && !previewExpanded && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/75 flex"
          onClick={() => setMobileMenuOpen(false)}
        >
          <aside
            className="w-64 h-full bg-[#09060e] border-r border-pink-400/30 p-3 flex flex-col gap-1.5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-2 py-2 text-xs font-mono-tabular text-pink-300 border-b border-white/10 mb-1">
              Menu Pengaturan
            </div>
            {navTabs.map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setActiveTab(tab.id);
                    setMobileMenuOpen(false);
                  }}
                  className={`flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg text-xs font-mono-tabular transition-colors cursor-pointer ${
                    active
                      ? 'bg-pink-600/20 border border-pink-400/45 text-pink-200'
                      : 'text-white/70 hover:text-white hover:bg-white/[0.05] border border-transparent'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Icon className="w-4 h-4 text-pink-400" />
                    <span>{tab.label}</span>
                  </span>
                  {tab.count !== undefined && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-white/75">
                      {tab.count}
                    </span>
                  )}
                </button>
              );
            })}
          </aside>
        </div>
      )}

      {/* WORKSPACE GRID */}
      <div
        className={`flex-1 grid grid-cols-1 ${
          previewExpanded ? '' : 'lg:grid-cols-[230px_minmax(0,1fr)_minmax(380px,43%)]'
        }`}
      >
        {/* LEFT NAVIGATION SIDEBAR */}
        {!previewExpanded && (
          <aside className="hidden lg:flex flex-col border-r border-white/10 bg-[#09060e] p-3 gap-1.5">
            {navTabs.map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg text-xs font-mono-tabular transition-colors whitespace-nowrap cursor-pointer ${
                    active
                      ? 'bg-pink-600/20 border border-pink-400/45 text-pink-200'
                      : 'text-white/70 hover:text-white hover:bg-white/[0.05] border border-transparent'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Icon className="w-4 h-4 text-pink-400" />
                    <span>{tab.label}</span>
                  </span>
                  {tab.count !== undefined && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-white/75">
                      {tab.count}
                    </span>
                  )}
                </button>
              );
            })}
          </aside>
        )}

        {/* MIDDLE MANAGEMENT PANEL */}
        {!previewExpanded && (
          <main className="p-4 sm:p-6 overflow-y-auto lg:max-h-[calc(100vh-61px)] custom-scrollbar space-y-6">
            {/* Quick Mobile Tab Strip */}
            <div className="flex lg:hidden gap-1.5 overflow-x-auto pb-1 custom-scrollbar">
              {navTabs.map((tab) => {
                const active = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`px-3 py-1.5 rounded-lg text-[11px] font-mono-tabular whitespace-nowrap shrink-0 cursor-pointer border ${
                      active
                        ? 'bg-pink-600/25 border-pink-400 text-pink-100'
                        : 'bg-[#0e0914] border-white/10 text-white/70'
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {/* TAB 0: RINGKASAN / OVERVIEW */}
            {activeTab === 'ringkasan' && (
              <div className="space-y-6">
                <div>
                  <h2 className="font-display text-2xl font-semibold text-white">
                    Ringkasan Buket & Tautan Hadiah
                  </h2>
                  <p className="text-xs text-white/65 mt-0.5">
                    Pantau statistik buket, uji animasi masuk 6 tahap, dan kelola tautan berbagi.
                  </p>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="rounded-xl border border-white/12 bg-[#0e0914] p-3.5">
                    <div className="text-[11px] font-mono-tabular text-white/55">Total Bunga</div>
                    <div className="text-xl font-semibold font-mono-tabular text-white mt-1">
                      {draft.flowers.length}
                    </div>
                  </div>
                  <div className="rounded-xl border border-white/12 bg-[#0e0914] p-3.5">
                    <div className="text-[11px] font-mono-tabular text-white/55">Piksel Foto</div>
                    <div className="text-xl font-semibold font-mono-tabular text-pink-300 mt-1">
                      {totalTiles.toLocaleString()}
                    </div>
                  </div>
                  <div className="rounded-xl border border-white/12 bg-[#0e0914] p-3.5">
                    <div className="text-[11px] font-mono-tabular text-white/55">Foto Asli</div>
                    <div className="text-xl font-semibold font-mono-tabular text-white mt-1">
                      {draft.photos.length}
                    </div>
                  </div>
                  <div className="rounded-xl border border-white/12 bg-[#0e0914] p-3.5">
                    <div className="text-[11px] font-mono-tabular text-white/55">Bintang Aktif</div>
                    <div className="text-xl font-semibold font-mono-tabular text-fuchsia-300 mt-1">
                      {draft.animation.starDensity}
                    </div>
                  </div>
                </div>

                {/* Quick Share Slug & QR Card */}
                <section className="rounded-xl border border-pink-400/30 bg-[#0e0914] p-4 flex flex-col sm:flex-row items-start sm:items-center gap-4">
                  <ShareMatrixSvg value={publicShareUrl} />
                  <div className="flex-1 min-w-0 space-y-2.5 w-full">
                    <div className="flex items-center gap-2 text-xs font-mono-tabular text-pink-300">
                      <QrCode className="w-4 h-4" />
                      <span>Tautan & Kode QR Publik</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <input
                        type="text"
                        value={draft.sharing?.slug || 'pixel-flower-bouquet'}
                        onChange={(e) =>
                          setDraft((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  sharing: {
                                    slug: e.target.value.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 64),
                                    isPublished: prev.sharing?.isPublished ?? true,
                                    expiresAt: prev.sharing?.expiresAt ?? '',
                                  },
                                }
                              : prev,
                          )
                        }
                        placeholder="slug-tautan-hadiah"
                        className="flex-1 min-w-[160px] px-3 py-1.5 rounded-lg bg-black border border-white/15 text-xs font-mono-tabular text-white outline-none focus:border-pink-400"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard?.writeText(publicShareUrl);
                          showToast('Tautan publik disalin ke papan klip');
                        }}
                        className="px-3 py-1.5 rounded-lg border border-pink-400/45 hover:bg-pink-500/20 text-xs font-mono-tabular text-pink-100 cursor-pointer"
                      >
                        Salin Tautan
                      </button>
                    </div>
                    <div className="text-[11px] font-mono-tabular text-white/55 truncate">
                      {publicShareUrl}
                    </div>
                  </div>
                </section>

                {/* Quick Actions Grid */}
                <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => viewportRef.current?.replayEntrance()}
                    className="p-4 rounded-xl border border-white/12 hover:border-pink-400/50 bg-[#0e0914] text-left space-y-1 cursor-pointer transition-colors"
                  >
                    <div className="text-xs font-mono-tabular text-pink-300 flex items-center gap-1.5">
                      <Play className="w-3.5 h-3.5" />
                      <span>Uji Animasi Masuk 6 Tahap</span>
                    </div>
                    <p className="text-xs text-white/65">
                      Putar dari langit malam → batang → lily → kertas buket → pita & tag hadiah.
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('pita-tag')}
                    className="p-4 rounded-xl border border-white/12 hover:border-pink-400/50 bg-[#0e0914] text-left space-y-1 cursor-pointer transition-colors"
                  >
                    <div className="text-xs font-mono-tabular text-pink-300 flex items-center gap-1.5">
                      <Gift className="w-3.5 h-3.5" />
                      <span>Atur Pita & Tag Tebal 3D</span>
                    </div>
                    <p className="text-xs text-white/65">
                      Sesuaikan warna matte cream/dusty pink, ketebalan kartu 3D, dan ayunan tag.
                    </p>
                  </button>
                </section>
              </div>
            )}

            {/* TAB 1: FOTO & PIKSEL */}
            {activeTab === 'foto' && (
              <div className="space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="font-display text-2xl font-semibold text-white">
                      Galeri Foto Resolusi Penuh
                    </h2>
                    <p className="text-xs text-white/65 mt-0.5">
                      Setiap kotak piksel terhubung ke foto asli utuh saat diklik pengunjung.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => multiPhotoInputRef.current?.click()}
                    disabled={isUploadingPhotos}
                    className="px-4 py-2 rounded-lg bg-pink-600 hover:bg-pink-500 disabled:opacity-50 text-xs font-mono-tabular font-medium text-white flex items-center gap-2 cursor-pointer"
                  >
                    <Upload className="w-4 h-4" />
                    <span>{isUploadingPhotos ? 'Mengunggah...' : 'Unggah Banyak Foto'}</span>
                  </button>
                </div>

                {draft.photos.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-pink-400/40 bg-pink-500/5 p-8 text-center space-y-3">
                    <p className="text-sm text-pink-100">
                      Saat ini memakai gambar bawaan. Unggah 10–30 foto asli agar setiap kelopak
                      lily tersusun dari kenangan nyata!
                    </p>
                    <button
                      type="button"
                      onClick={() => multiPhotoInputRef.current?.click()}
                      className="px-4 py-2 rounded-lg bg-pink-600 hover:bg-pink-500 text-xs font-mono-tabular text-white cursor-pointer"
                    >
                      Pilih Banyak Foto
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {draft.photos.map((photo, idx) => {
                      const assignedAll =
                        !photo.assignedFlowerIds || photo.assignedFlowerIds === 'all';
                      return (
                        <div
                          key={photo.id}
                          className="rounded-xl border border-white/12 bg-[#0e0914] overflow-hidden flex flex-col"
                        >
                          <div className="relative h-44 bg-black flex items-center justify-center overflow-hidden">
                            <img
                              src={photo.originalUrl}
                              alt={photo.name}
                              className="w-full h-full object-contain"
                            />
                            <div className="absolute top-2 left-2 flex gap-1">
                              <button
                                type="button"
                                disabled={idx === 0}
                                onClick={() => handleMovePhoto(idx, -1)}
                                className="p-1.5 rounded bg-black/80 border border-white/15 disabled:opacity-30 text-white hover:bg-white/15 cursor-pointer"
                                title="Geser naik"
                              >
                                <ArrowUp className="w-3 h-3" />
                              </button>
                              <button
                                type="button"
                                disabled={idx === draft.photos.length - 1}
                                onClick={() => handleMovePhoto(idx, 1)}
                                className="p-1.5 rounded bg-black/80 border border-white/15 disabled:opacity-30 text-white hover:bg-white/15 cursor-pointer"
                                title="Geser turun"
                              >
                                <ArrowDown className="w-3 h-3" />
                              </button>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setLightboxPhotoId(photo.id);
                                setLightboxPixelInfo(null);
                              }}
                              className="absolute bottom-2 right-2 px-2.5 py-1 rounded bg-black/80 border border-pink-400/45 text-[11px] font-mono-tabular text-pink-200 hover:bg-pink-600/40 cursor-pointer"
                            >
                              Resolusi Penuh
                            </button>
                          </div>

                          <div className="p-3.5 space-y-3 flex-1 flex flex-col justify-between">
                            <div>
                              <div className="text-xs font-medium text-white truncate">
                                #{idx + 1} · {photo.name}
                              </div>
                              <div className="text-[11px] font-mono-tabular text-white/55 mt-0.5">
                                {photo.width} × {photo.height} px
                                {photo.fileSize
                                  ? ` · ${(photo.fileSize / 1024 / 1024).toFixed(2)} MB`
                                  : ''}
                              </div>
                            </div>

                            <div>
                              <label className="block text-[10px] font-mono-tabular text-white/60 mb-1">
                                Keterangan Foto (tampil di lightbox)
                              </label>
                              <input
                                type="text"
                                value={photo.caption ?? ''}
                                onChange={(e) => {
                                  const nextCap = e.target.value;
                                  setDraft((prev) =>
                                    prev
                                      ? {
                                          ...prev,
                                          photos: prev.photos.map((p) =>
                                            p.id === photo.id ? { ...p, caption: nextCap } : p,
                                          ),
                                        }
                                      : prev,
                                  );
                                }}
                                placeholder="Contoh: Senyum paling manis hari itu..."
                                className="w-full px-2.5 py-1.5 rounded-lg bg-black border border-white/15 text-xs text-white outline-none focus:border-pink-400"
                              />
                            </div>

                            {/* Penugasan Bunga */}
                            <div className="space-y-1.5">
                              <div className="flex items-center justify-between text-[11px] font-mono-tabular text-pink-200/80">
                                <span>Penempatan Lily</span>
                                <button
                                  type="button"
                                  onClick={() => handleTogglePhotoFlowerAssignment(photo.id, 'all')}
                                  className={`px-2 py-0.5 rounded cursor-pointer ${
                                    assignedAll
                                      ? 'bg-pink-600 text-white'
                                      : 'bg-white/10 text-white/70 hover:text-white'
                                  }`}
                                >
                                  Semua Bunga
                                </button>
                              </div>
                              <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto">
                                {draft.flowers.map((fl, fIdx) => {
                                  const checked =
                                    assignedAll ||
                                    (Array.isArray(photo.assignedFlowerIds) &&
                                      photo.assignedFlowerIds.includes(fl.id));
                                  return (
                                    <button
                                      key={fl.id}
                                      type="button"
                                      onClick={() =>
                                        handleTogglePhotoFlowerAssignment(photo.id, fl.id)
                                      }
                                      className={`px-1.5 py-0.5 rounded text-[10px] font-mono-tabular cursor-pointer border ${
                                        checked
                                          ? 'bg-pink-500/20 border-pink-400/45 text-pink-100'
                                          : 'bg-black/50 border-white/10 text-white/45'
                                      }`}
                                      title={fl.label}
                                    >
                                      #{fIdx + 1}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>

                            <div className="flex items-center gap-2 pt-2 border-t border-white/10">
                              <button
                                type="button"
                                onClick={() => {
                                  replacingPhotoIdRef.current = photo.id;
                                  replacePhotoInputRef.current?.click();
                                }}
                                className="flex-1 py-1.5 rounded-lg border border-white/15 hover:bg-white/10 text-xs font-mono-tabular text-white/85 flex items-center justify-center gap-1.5 cursor-pointer"
                              >
                                <RefreshCw className="w-3.5 h-3.5" />
                                <span>Ganti</span>
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setConfirmDialog({
                                    title: `Hapus "${photo.name}"?`,
                                    description:
                                      'Foto ini akan dihapus dari mozaik piksel draf buket Anda.',
                                    confirmLabel: 'Hapus Foto',
                                    danger: true,
                                    onConfirm: () => {
                                      setConfirmDialog(null);
                                      setDraft((prev) =>
                                        prev
                                          ? {
                                              ...prev,
                                              photos: prev.photos.filter((p) => p.id !== photo.id),
                                            }
                                          : prev,
                                      );
                                      showToast(`Foto dihapus: ${photo.name}`);
                                    },
                                  })
                                }
                                className="px-3 py-1.5 rounded-lg border border-rose-400/35 hover:bg-rose-500/20 text-xs font-mono-tabular text-rose-200 flex items-center gap-1 cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                <span>Hapus</span>
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* TAB 2: RANGKAIAN & BUNGA */}
            {activeTab === 'bunga' && (
              <div className="space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="font-display text-2xl font-semibold text-white">
                      Susunan Buket Bunga 3D
                    </h2>
                    <p className="text-xs text-white/65 mt-0.5">
                      Tambah, hapus, duplikasi, ubah warna, posisi, mekar, dan ayunan tiap lily.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleAddFlower(false)}
                      className="px-3 py-2 rounded-lg bg-pink-600 hover:bg-pink-500 text-xs font-mono-tabular text-white flex items-center gap-1.5 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Tambah Lily</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleAddFlower(true)}
                      className="px-3 py-2 rounded-lg border border-pink-400/40 hover:bg-pink-500/15 text-xs font-mono-tabular text-pink-200 flex items-center gap-1.5 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Tambah Kuncup</span>
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-60 overflow-y-auto pr-1 custom-scrollbar">
                  {draft.flowers.map((fl, idx) => {
                    const isSelected = selectedFlower?.id === fl.id;
                    const colorMeta = COLOR_OPTIONS.find((c) => c.id === fl.colorKind);
                    return (
                      <button
                        key={fl.id}
                        type="button"
                        onClick={() => {
                          setSelectedFlowerId(fl.id);
                          viewportRef.current?.focusFlower(idx);
                        }}
                        className={`p-2.5 rounded-lg border text-left flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                          isSelected
                            ? 'bg-pink-600/20 border-pink-400/60 text-white'
                            : 'bg-[#0e0914] border-white/10 text-white/80 hover:border-white/25'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="w-3 h-3 rounded-full shrink-0 border border-white/30"
                            style={{ backgroundColor: colorMeta?.swatch ?? '#ec4899' }}
                          />
                          <div className="min-w-0">
                            <div className="text-xs font-medium truncate">
                              #{idx + 1} {fl.label}
                            </div>
                            <div className="text-[10px] font-mono-tabular text-white/55">
                              {fl.isBud ? 'Kuncup' : 'Lily Mekar'} · Skala {fl.scale.toFixed(2)}
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>

                {selectedFlower && (
                  <div className="rounded-xl border border-pink-400/30 bg-[#0e0914] p-4 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-white/10">
                      <div className="text-xs font-mono-tabular text-pink-300">
                        Mengedit #{selectedFlowerIndex + 1}: {selectedFlower.label}
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleDuplicateFlower(selectedFlower)}
                          className="px-2.5 py-1 rounded border border-white/15 hover:bg-white/10 text-[11px] font-mono-tabular text-white/85 flex items-center gap-1 cursor-pointer"
                        >
                          <Copy className="w-3 h-3" />
                          <span>Duplikasi</span>
                        </button>
                        {draft.flowers.length > 1 && (
                          <button
                            type="button"
                            onClick={() =>
                              setConfirmDialog({
                                title: `Hapus "${selectedFlower.label}"?`,
                                description:
                                  'Bunga lily beserta tangkainya akan dihapus dari rangkaian buket.',
                                confirmLabel: 'Hapus Bunga',
                                danger: true,
                                onConfirm: () => {
                                  setConfirmDialog(null);
                                  setDraft((prev) => {
                                    if (!prev) return prev;
                                    const nextFlowers = prev.flowers.filter(
                                      (f) => f.id !== selectedFlower.id,
                                    );
                                    setSelectedFlowerId(nextFlowers[0]?.id ?? null);
                                    return { ...prev, flowers: nextFlowers };
                                  });
                                },
                              })
                            }
                            className="px-2.5 py-1 rounded border border-rose-400/35 hover:bg-rose-500/20 text-[11px] font-mono-tabular text-rose-200 flex items-center gap-1 cursor-pointer"
                          >
                            <Trash2 className="w-3 h-3" />
                            <span>Hapus</span>
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-mono-tabular text-white/70 mb-1">
                          Nama Bunga
                        </label>
                        <input
                          type="text"
                          value={selectedFlower.label}
                          onChange={(e) => updateFlower(selectedFlower.id, { label: e.target.value })}
                          className="w-full px-3 py-2 rounded-lg bg-black border border-white/15 text-xs text-white outline-none focus:border-pink-400"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-mono-tabular text-white/70 mb-1">
                          Bentuk & Warna Kelopak
                        </label>
                        <div className="flex items-center gap-2">
                          <select
                            value={selectedFlower.colorKind}
                            onChange={(e) =>
                              updateFlower(selectedFlower.id, {
                                colorKind: e.target.value as LilyColorKind,
                              })
                            }
                            className="flex-1 px-2.5 py-2 rounded-lg bg-black border border-white/15 text-xs text-white outline-none focus:border-pink-400"
                          >
                            {COLOR_OPTIONS.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.label}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() =>
                              updateFlower(selectedFlower.id, { isBud: !selectedFlower.isBud })
                            }
                            className={`px-3 py-2 rounded-lg border text-xs font-mono-tabular cursor-pointer ${
                              selectedFlower.isBud
                                ? 'bg-emerald-500/20 border-emerald-400/45 text-emerald-200'
                                : 'bg-pink-500/20 border-pink-400/45 text-pink-200'
                            }`}
                          >
                            {selectedFlower.isBud ? 'Kuncup' : 'Mekar'}
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                      {(
                        [
                          { label: 'Posisi X', axis: 0, min: -2.5, max: 2.5 },
                          { label: 'Tinggi Y', axis: 1, min: 0.4, max: 4.5 },
                          { label: 'Kedalaman Z', axis: 2, min: -2.2, max: 2.2 },
                        ] as const
                      ).map((ctrl) => (
                        <div key={ctrl.label}>
                          <div className="flex justify-between text-[11px] font-mono-tabular text-white/75 mb-1">
                            <span>{ctrl.label}</span>
                            <span>{selectedFlower.position[ctrl.axis].toFixed(2)}</span>
                          </div>
                          <input
                            type="range"
                            min={ctrl.min}
                            max={ctrl.max}
                            step={0.05}
                            value={selectedFlower.position[ctrl.axis]}
                            onChange={(e) => {
                              const nextPos = [...selectedFlower.position] as [
                                number,
                                number,
                                number,
                              ];
                              nextPos[ctrl.axis] = parseFloat(e.target.value);
                              updateFlower(selectedFlower.id, { position: nextPos });
                            }}
                            className="romantic-slider w-full"
                          />
                        </div>
                      ))}

                      <div>
                        <div className="flex justify-between text-[11px] font-mono-tabular text-white/75 mb-1">
                          <span>Skala Bunga</span>
                          <span>{selectedFlower.scale.toFixed(2)}×</span>
                        </div>
                        <input
                          type="range"
                          min={0.5}
                          max={1.55}
                          step={0.02}
                          value={selectedFlower.scale}
                          onChange={(e) =>
                            updateFlower(selectedFlower.id, { scale: parseFloat(e.target.value) })
                          }
                          className="romantic-slider w-full"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                      {(
                        [
                          { label: 'Kemiringan Depan', axis: 0, min: -1.4, max: 1.4 },
                          { label: 'Arah Hadap (Yaw)', axis: 1, min: -3.14, max: 3.14 },
                          { label: 'Kemiringan Samping', axis: 2, min: -1.2, max: 1.2 },
                        ] as const
                      ).map((ctrl) => (
                        <div key={ctrl.label}>
                          <div className="flex justify-between text-[11px] font-mono-tabular text-white/75 mb-1">
                            <span>{ctrl.label}</span>
                            <span>{selectedFlower.rotation[ctrl.axis].toFixed(2)} rad</span>
                          </div>
                          <input
                            type="range"
                            min={ctrl.min}
                            max={ctrl.max}
                            step={0.04}
                            value={selectedFlower.rotation[ctrl.axis]}
                            onChange={(e) => {
                              const nextRot = [...selectedFlower.rotation] as [
                                number,
                                number,
                                number,
                              ];
                              nextRot[ctrl.axis] = parseFloat(e.target.value);
                              updateFlower(selectedFlower.id, { rotation: nextRot });
                            }}
                            className="romantic-slider w-full"
                          />
                        </div>
                      ))}

                      <div>
                        <div className="flex justify-between text-[11px] font-mono-tabular text-white/75 mb-1">
                          <span>Intensitas Mekar</span>
                          <span>{(selectedFlower.bloomIntensity ?? 1.0).toFixed(2)}×</span>
                        </div>
                        <input
                          type="range"
                          min={0.4}
                          max={1.4}
                          step={0.04}
                          value={selectedFlower.bloomIntensity ?? 1.0}
                          onChange={(e) =>
                            updateFlower(selectedFlower.id, {
                              bloomIntensity: parseFloat(e.target.value),
                            })
                          }
                          className="romantic-slider w-full"
                        />
                      </div>

                      <div>
                        <div className="flex justify-between text-[11px] font-mono-tabular text-white/75 mb-1">
                          <span>Intensitas Ayunan</span>
                          <span>{(selectedFlower.swayIntensity ?? 1.0).toFixed(2)}×</span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={2.0}
                          step={0.05}
                          value={selectedFlower.swayIntensity ?? 1.0}
                          onChange={(e) =>
                            updateFlower(selectedFlower.id, {
                              swayIntensity: parseFloat(e.target.value),
                            })
                          }
                          className="romantic-slider w-full"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* TAB 3: PEMBUNGKUS, PITA & GIFT TAG 3D */}
            {activeTab === 'pita-tag' && (
              <div className="space-y-6">
                <section className="rounded-xl border border-white/12 bg-[#0e0914] p-4 space-y-4">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="font-display text-xl font-semibold text-white">
                      Kertas Pembungkus & Pita Satin 3D
                    </h2>
                    <button
                      type="button"
                      onClick={() =>
                        setDraft((prev) =>
                          prev
                            ? {
                                ...prev,
                                wrap: {
                                  ...prev.wrap,
                                  ribbonColor: '#f48fb1',
                                  bowScale: 1.28,
                                  ribbonPositionX: 0,
                                  ribbonPositionY: -0.66,
                                  ribbonPositionZ: 0,
                                  ribbonForwardOffset: 0.14,
                                  ribbonLoopSize: 1.18,
                                  ribbonTailLength: 1.15,
                                  ribbonThickness: 1.0,
                                  ribbonRoughness: 0.26,
                                  ribbonSheen: 0.95,
                                },
                              }
                            : prev,
                        )
                      }
                      className="px-2.5 py-1 rounded-lg border border-white/15 hover:bg-white/10 text-[11px] font-mono-tabular text-white/80 cursor-pointer"
                    >
                      Reset Pita
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    {(Object.keys(WRAP_THEMES) as WrapThemeId[]).map((themeId) => {
                      const t = WRAP_THEMES[themeId];
                      const active = draft.wrap.wrapTheme === themeId;
                      return (
                        <button
                          key={themeId}
                          type="button"
                          onClick={() =>
                            setDraft((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    wrap: {
                                      ...prev.wrap,
                                      wrapTheme: themeId,
                                      wrapColor: t.outer,
                                      wrapInnerColor: t.inner,
                                      ribbonColor: t.ribbon,
                                    },
                                  }
                                : prev,
                            )
                          }
                          className={`p-2.5 rounded-lg border text-left flex items-center gap-2.5 cursor-pointer ${
                            active
                              ? 'border-pink-400 bg-pink-500/15'
                              : 'border-white/10 bg-black/50 hover:border-white/25'
                          }`}
                        >
                          <div className="flex -space-x-1 shrink-0">
                            <span
                              className="w-4 h-4 rounded-full border border-white/30"
                              style={{ backgroundColor: t.outer }}
                            />
                            <span
                              className="w-4 h-4 rounded-full border border-white/30"
                              style={{ backgroundColor: t.ribbon }}
                            />
                          </div>
                          <span className="text-xs text-white truncate">{t.label}</span>
                        </button>
                      );
                    })}
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[11px] font-mono-tabular text-white/70 mb-1">
                        Kertas Luar
                      </label>
                      <input
                        type="color"
                        value={draft.wrap.wrapColor}
                        onChange={(e) =>
                          setDraft((prev) =>
                            prev
                              ? { ...prev, wrap: { ...prev.wrap, wrapColor: e.target.value } }
                              : prev,
                          )
                        }
                        className="w-full h-9 rounded bg-black border border-white/15 cursor-pointer"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-mono-tabular text-white/70 mb-1">
                        Lapisan Dalam
                      </label>
                      <input
                        type="color"
                        value={draft.wrap.wrapInnerColor}
                        onChange={(e) =>
                          setDraft((prev) =>
                            prev
                              ? { ...prev, wrap: { ...prev.wrap, wrapInnerColor: e.target.value } }
                              : prev,
                          )
                        }
                        className="w-full h-9 rounded bg-black border border-white/15 cursor-pointer"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-mono-tabular text-white/70 mb-1">
                        Warna Pita Satin
                      </label>
                      <input
                        type="color"
                        value={draft.wrap.ribbonColor}
                        onChange={(e) =>
                          setDraft((prev) =>
                            prev
                              ? { ...prev, wrap: { ...prev.wrap, ribbonColor: e.target.value } }
                              : prev,
                          )
                        }
                        className="w-full h-9 rounded bg-black border border-white/15 cursor-pointer"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                    <div>
                      <div className="flex justify-between text-[11px] font-mono-tabular text-white/75 mb-1">
                        <span>Opasitas Pembungkus</span>
                        <span>{Math.round(draft.wrap.wrapOpacity * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min={0.35}
                        max={1}
                        step={0.05}
                        value={draft.wrap.wrapOpacity}
                        onChange={(e) =>
                          setDraft((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  wrap: { ...prev.wrap, wrapOpacity: parseFloat(e.target.value) },
                                }
                              : prev,
                          )
                        }
                        className="romantic-slider w-full"
                      />
                    </div>

                    <div>
                      <div className="flex justify-between text-[11px] font-mono-tabular text-white/75 mb-1">
                        <span>Skala Pita Kupu-Kupu</span>
                        <span>{(draft.wrap.bowScale ?? 1.28).toFixed(2)}×</span>
                      </div>
                      <input
                        type="range"
                        min={0.7}
                        max={2.0}
                        step={0.04}
                        value={draft.wrap.bowScale ?? 1.28}
                        onChange={(e) =>
                          setDraft((prev) =>
                            prev
                              ? { ...prev, wrap: { ...prev.wrap, bowScale: parseFloat(e.target.value) } }
                              : prev,
                          )
                        }
                        className="romantic-slider w-full"
                      />
                    </div>

                    <div>
                      <div className="flex justify-between text-[11px] font-mono-tabular text-white/75 mb-1">
                        <span>Ukuran Loop Pita</span>
                        <span>{(draft.wrap.ribbonLoopSize ?? 1.18).toFixed(2)}×</span>
                      </div>
                      <input
                        type="range"
                        min={0.65}
                        max={1.8}
                        step={0.05}
                        value={draft.wrap.ribbonLoopSize ?? 1.18}
                        onChange={(e) =>
                          setDraft((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  wrap: {
                                    ...prev.wrap,
                                    ribbonLoopSize: parseFloat(e.target.value),
                                  },
                                }
                              : prev,
                          )
                        }
                        className="romantic-slider w-full"
                      />
                    </div>

                    <div>
                      <div className="flex justify-between text-[11px] font-mono-tabular text-white/75 mb-1">
                        <span>Panjang Ekor Pita</span>
                        <span>{(draft.wrap.ribbonTailLength ?? 1.15).toFixed(2)}×</span>
                      </div>
                      <input
                        type="range"
                        min={0.55}
                        max={1.8}
                        step={0.05}
                        value={draft.wrap.ribbonTailLength ?? 1.15}
                        onChange={(e) =>
                          setDraft((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  wrap: {
                                    ...prev.wrap,
                                    ribbonTailLength: parseFloat(e.target.value),
                                  },
                                }
                              : prev,
                          )
                        }
                        className="romantic-slider w-full"
                      />
                    </div>

                    <div>
                      <div className="flex justify-between text-[11px] font-mono-tabular text-white/75 mb-1">
                        <span>Ketebalan Kain Pita</span>
                        <span>{(draft.wrap.ribbonThickness ?? 1.0).toFixed(2)}×</span>
                      </div>
                      <input
                        type="range"
                        min={0.5}
                        max={2.0}
                        step={0.05}
                        value={draft.wrap.ribbonThickness ?? 1.0}
                        onChange={(e) =>
                          setDraft((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  wrap: {
                                    ...prev.wrap,
                                    ribbonThickness: parseFloat(e.target.value),
                                  },
                                }
                              : prev,
                          )
                        }
                        className="romantic-slider w-full"
                      />
                    </div>

                    <div>
                      <div className="flex justify-between text-[11px] font-mono-tabular text-white/75 mb-1">
                        <span>Tekstur Matte / Satin Pita</span>
                        <span>{Math.round((draft.wrap.ribbonRoughness ?? 0.26) * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min={0.1}
                        max={0.8}
                        step={0.02}
                        value={draft.wrap.ribbonRoughness ?? 0.26}
                        onChange={(e) =>
                          setDraft((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  wrap: {
                                    ...prev.wrap,
                                    ribbonRoughness: parseFloat(e.target.value),
                                  },
                                }
                              : prev,
                          )
                        }
                        className="romantic-slider w-full"
                      />
                    </div>

                    <div>
                      <div className="flex justify-between text-[11px] font-mono-tabular text-white/75 mb-1">
                        <span>Jarak Maju Pita (Depan Wrap)</span>
                        <span>{(draft.wrap.ribbonForwardOffset ?? 0.14).toFixed(2)}</span>
                      </div>
                      <input
                        type="range"
                        min={0.02}
                        max={0.55}
                        step={0.01}
                        value={draft.wrap.ribbonForwardOffset ?? 0.14}
                        onChange={(e) =>
                          setDraft((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  wrap: {
                                    ...prev.wrap,
                                    ribbonForwardOffset: parseFloat(e.target.value),
                                  },
                                }
                              : prev,
                          )
                        }
                        className="romantic-slider w-full"
                      />
                    </div>

                    <div>
                      <div className="flex justify-between text-[11px] font-mono-tabular text-white/75 mb-1">
                        <span>Posisi X / Y Pita</span>
                        <span>
                          {(draft.wrap.ribbonPositionX ?? 0).toFixed(2)} /{' '}
                          {(draft.wrap.ribbonPositionY ?? -0.66).toFixed(2)}
                        </span>
                      </div>
                      <div className="flex gap-2">
                        <input
                          type="range"
                          min={-0.8}
                          max={0.8}
                          step={0.02}
                          value={draft.wrap.ribbonPositionX ?? 0}
                          onChange={(e) =>
                            setDraft((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    wrap: {
                                      ...prev.wrap,
                                      ribbonPositionX: parseFloat(e.target.value),
                                    },
                                  }
                                : prev,
                            )
                          }
                          className="romantic-slider w-1/2"
                        />
                        <input
                          type="range"
                          min={-1.35}
                          max={0.25}
                          step={0.02}
                          value={draft.wrap.ribbonPositionY ?? -0.66}
                          onChange={(e) =>
                            setDraft((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    wrap: {
                                      ...prev.wrap,
                                      ribbonPositionY: parseFloat(e.target.value),
                                    },
                                  }
                                : prev,
                            )
                          }
                          className="romantic-slider w-1/2"
                        />
                      </div>
                    </div>
                  </div>
                </section>

                {/* KARTU / TAG HADIAH 3D TEBAL & MUTED */}
                <section className="rounded-xl border border-pink-400/25 bg-[#0e0914] p-4 space-y-4">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="font-display text-xl font-semibold text-white">
                      Kartu Tag Hadiah 3D (Tebal & Matte)
                    </h2>
                    <label className="flex items-center gap-2 text-xs text-white/85 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={draft.wrap.showGiftTag}
                        onChange={(e) =>
                          setDraft((prev) =>
                            prev
                              ? { ...prev, wrap: { ...prev.wrap, showGiftTag: e.target.checked } }
                              : prev,
                          )
                        }
                        className="accent-pink-500 w-4 h-4"
                      />
                      <span>Tampilkan Tag</span>
                    </label>
                  </div>

                  {/* Preset warna muted */}
                  <div className="grid grid-cols-3 gap-2">
                    {TAG_COLOR_PRESETS.map((preset) => {
                      const active =
                        (draft.wrap.tagColor || '#D8C6BD').toLowerCase() ===
                        preset.color.toLowerCase();
                      return (
                        <button
                          key={preset.label}
                          type="button"
                          onClick={() =>
                            setDraft((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    wrap: {
                                      ...prev.wrap,
                                      tagColor: preset.color,
                                      tagTextColor: preset.textColor,
                                    },
                                  }
                                : prev,
                            )
                          }
                          className={`p-2 rounded-lg border text-left flex items-center gap-2 cursor-pointer ${
                            active
                              ? 'border-pink-400 bg-pink-500/15'
                              : 'border-white/10 bg-black/50 hover:border-white/25'
                          }`}
                        >
                          <span
                            className="w-4 h-4 rounded-full shrink-0 border border-white/25"
                            style={{ backgroundColor: preset.color }}
                          />
                          <span className="text-[11px] font-mono-tabular text-white truncate">
                            {preset.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-mono-tabular text-white/70 mb-1">
                        Teks Tag Custom (kosong = For &lt;Nama&gt; ♥)
                      </label>
                      <input
                        type="text"
                        value={draft.wrap.tagText ?? ''}
                        onChange={(e) =>
                          setDraft((prev) =>
                            prev ? { ...prev, wrap: { ...prev.wrap, tagText: e.target.value } } : prev,
                          )
                        }
                        placeholder="Contoh: For You ♥"
                        className="w-full px-3 py-2 rounded-lg bg-black border border-white/15 text-xs text-white outline-none focus:border-pink-400"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[11px] font-mono-tabular text-white/70 mb-1">
                          Warna Kartu Tag
                        </label>
                        <input
                          type="color"
                          value={draft.wrap.tagColor ?? '#D8C6BD'}
                          onChange={(e) =>
                            setDraft((prev) =>
                              prev
                                ? { ...prev, wrap: { ...prev.wrap, tagColor: e.target.value } }
                                : prev,
                            )
                          }
                          className="w-full h-9 rounded bg-black border border-white/15 cursor-pointer"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-mono-tabular text-white/70 mb-1">
                          Warna Teks Tag
                        </label>
                        <input
                          type="color"
                          value={draft.wrap.tagTextColor ?? '#111111'}
                          onChange={(e) =>
                            setDraft((prev) =>
                              prev
                                ? { ...prev, wrap: { ...prev.wrap, tagTextColor: e.target.value } }
                                : prev,
                            )
                          }
                          className="w-full h-9 rounded bg-black border border-white/15 cursor-pointer"
                        />
                      </div>
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-[11px] font-mono-tabular text-white/70">
                        Kata-Kata Saat Tag Diklik (Popup Kartu Tag)
                      </label>
                      <button
                        type="button"
                        onClick={() => setTagModalOpen(true)}
                        className="text-[11px] font-mono-tabular text-pink-300 hover:text-pink-200 underline cursor-pointer"
                      >
                        Pratinjau Popup Tag
                      </button>
                    </div>
                    <textarea
                      rows={3}
                      value={draft.wrap.tagMessage ?? ''}
                      onChange={(e) =>
                        setDraft((prev) =>
                          prev
                            ? { ...prev, wrap: { ...prev.wrap, tagMessage: e.target.value } }
                            : prev,
                        )
                      }
                      placeholder="Tulis kata-kata spesial yang muncul ketika tag pada pita diklik pengunjung..."
                      className="w-full px-3 py-2 rounded-lg bg-black border border-white/15 text-xs text-white outline-none focus:border-pink-400 leading-relaxed"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <div className="flex justify-between text-[11px] font-mono-tabular text-white/75 mb-1">
                        <span>Ketebalan 3D Tag (Cardstock)</span>
                        <span>{(draft.wrap.tagThickness ?? 0.044).toFixed(3)}</span>
                      </div>
                      <input
                        type="range"
                        min={0.024}
                        max={0.095}
                        step={0.002}
                        value={draft.wrap.tagThickness ?? 0.044}
                        onChange={(e) =>
                          setDraft((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  wrap: { ...prev.wrap, tagThickness: parseFloat(e.target.value) },
                                }
                              : prev,
                          )
                        }
                        className="romantic-slider w-full"
                      />
                    </div>

                    <div>
                      <div className="flex justify-between text-[11px] font-mono-tabular text-white/75 mb-1">
                        <span>Kecerahan Tag (Muted Alami)</span>
                        <span>{Math.round((draft.wrap.tagBrightness ?? 0.82) * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min={0.5}
                        max={1.0}
                        step={0.02}
                        value={draft.wrap.tagBrightness ?? 0.82}
                        onChange={(e) =>
                          setDraft((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  wrap: { ...prev.wrap, tagBrightness: parseFloat(e.target.value) },
                                }
                              : prev,
                          )
                        }
                        className="romantic-slider w-full"
                      />
                    </div>

                    <div>
                      <div className="flex justify-between text-[11px] font-mono-tabular text-white/75 mb-1">
                        <span>Tekstur Kertas Matte (Roughness)</span>
                        <span>{Math.round((draft.wrap.tagRoughness ?? 0.86) * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min={0.5}
                        max={0.98}
                        step={0.02}
                        value={draft.wrap.tagRoughness ?? 0.86}
                        onChange={(e) =>
                          setDraft((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  wrap: { ...prev.wrap, tagRoughness: parseFloat(e.target.value) },
                                }
                              : prev,
                          )
                        }
                        className="romantic-slider w-full"
                      />
                    </div>

                    <div>
                      <div className="flex justify-between text-[11px] font-mono-tabular text-white/75 mb-1">
                        <span>Lebar × Tinggi Tag</span>
                        <span>
                          {(draft.wrap.tagWidth ?? 0.34).toFixed(2)} ×{' '}
                          {(draft.wrap.tagHeight ?? 0.42).toFixed(2)}
                        </span>
                      </div>
                      <div className="flex gap-2">
                        <input
                          type="range"
                          min={0.24}
                          max={0.58}
                          step={0.02}
                          value={draft.wrap.tagWidth ?? 0.34}
                          onChange={(e) =>
                            setDraft((prev) =>
                              prev
                                ? { ...prev, wrap: { ...prev.wrap, tagWidth: parseFloat(e.target.value) } }
                                : prev,
                            )
                          }
                          className="romantic-slider w-1/2"
                        />
                        <input
                          type="range"
                          min={0.28}
                          max={0.68}
                          step={0.02}
                          value={draft.wrap.tagHeight ?? 0.42}
                          onChange={(e) =>
                            setDraft((prev) =>
                              prev
                                ? { ...prev, wrap: { ...prev.wrap, tagHeight: parseFloat(e.target.value) } }
                                : prev,
                            )
                          }
                          className="romantic-slider w-1/2"
                        />
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between text-[11px] font-mono-tabular text-white/75 mb-1">
                        <span>Kemiringan & Ayunan Tag</span>
                        <span>{(draft.wrap.tagSwingIntensity ?? 0.65).toFixed(2)}×</span>
                      </div>
                      <div className="flex gap-2">
                        <input
                          type="range"
                          min={-0.6}
                          max={0.6}
                          step={0.02}
                          value={draft.wrap.tagRotationZ ?? 0.09}
                          onChange={(e) =>
                            setDraft((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    wrap: { ...prev.wrap, tagRotationZ: parseFloat(e.target.value) },
                                  }
                                : prev,
                            )
                          }
                          className="romantic-slider w-1/2"
                        />
                        <input
                          type="range"
                          min={0}
                          max={1.4}
                          step={0.05}
                          value={draft.wrap.tagSwingIntensity ?? 0.65}
                          onChange={(e) =>
                            setDraft((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    wrap: {
                                      ...prev.wrap,
                                      tagSwingIntensity: parseFloat(e.target.value),
                                    },
                                  }
                                : prev,
                            )
                          }
                          className="romantic-slider w-1/2"
                        />
                      </div>
                    </div>
                  </div>
                </section>
              </div>
            )}

            {/* TAB 4: PESAN & TAMPILAN TEMA */}
            {activeTab === 'pesan-tema' && (
              <div className="space-y-6">
                <section className="rounded-xl border border-white/12 bg-[#0e0914] p-4 space-y-4">
                  <h2 className="font-display text-xl font-semibold text-white">
                    Pesan Romantis, Penerima & Kartu Ucapan
                  </h2>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-mono-tabular text-white/70 mb-1">
                        Nama Penerima
                      </label>
                      <input
                        type="text"
                        value={draft.text.recipientName}
                        onChange={(e) =>
                          setDraft((prev) =>
                            prev
                              ? { ...prev, text: { ...prev.text, recipientName: e.target.value } }
                              : prev,
                          )
                        }
                        placeholder="contoh: Clara"
                        className="w-full px-3 py-2 rounded-lg bg-black border border-white/15 text-xs text-white outline-none focus:border-pink-400"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-mono-tabular text-white/70 mb-1">
                        Nama Pengirim
                      </label>
                      <input
                        type="text"
                        value={draft.text.senderName}
                        onChange={(e) =>
                          setDraft((prev) =>
                            prev
                              ? { ...prev, text: { ...prev.text, senderName: e.target.value } }
                              : prev,
                          )
                        }
                        placeholder="contoh: Julian"
                        className="w-full px-3 py-2 rounded-lg bg-black border border-white/15 text-xs text-white outline-none focus:border-pink-400"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-mono-tabular text-white/70 mb-1">
                        Tanggal Spesial
                      </label>
                      <input
                        type="text"
                        value={draft.text.specialDate}
                        onChange={(e) =>
                          setDraft((prev) =>
                            prev
                              ? { ...prev, text: { ...prev.text, specialDate: e.target.value } }
                              : prev,
                          )
                        }
                        className="w-full px-3 py-2 rounded-lg bg-black border border-white/15 text-xs text-white outline-none focus:border-pink-400"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-mono-tabular text-white/70 mb-1">
                        Teks Di Pita Satin 3D
                      </label>
                      <input
                        type="text"
                        value={draft.text.ribbonText}
                        onChange={(e) =>
                          setDraft((prev) =>
                            prev
                              ? { ...prev, text: { ...prev.text, ribbonText: e.target.value } }
                              : prev,
                          )
                        }
                        className="w-full px-3 py-2 rounded-lg bg-black border border-white/15 text-xs text-white outline-none focus:border-pink-400"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-mono-tabular text-white/70 mb-1">
                      Pesan Romantis Utama (Kartu Pojok Kanan Atas)
                    </label>
                    <textarea
                      rows={3}
                      value={draft.text.romanticMessage}
                      onChange={(e) =>
                        setDraft((prev) =>
                          prev
                            ? { ...prev, text: { ...prev.text, romanticMessage: e.target.value } }
                            : prev,
                        )
                      }
                      className="w-full px-3 py-2 rounded-lg bg-black border border-white/15 text-xs text-white outline-none focus:border-pink-400 resize-y"
                    />
                  </div>

                  {/* Card Styling */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-white/10">
                    <div>
                      <label className="block text-[11px] font-mono-tabular text-white/70 mb-1">
                        Border Kartu
                      </label>
                      <input
                        type="color"
                        value={draft.text.cardBorderColor ?? '#f472b6'}
                        onChange={(e) =>
                          setDraft((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  text: { ...prev.text, cardBorderColor: e.target.value },
                                }
                              : prev,
                          )
                        }
                        className="w-full h-9 rounded bg-black border border-white/15 cursor-pointer"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-mono-tabular text-white/70 mb-1">
                        Teks Kartu
                      </label>
                      <input
                        type="color"
                        value={draft.text.cardTextColor ?? '#ffffff'}
                        onChange={(e) =>
                          setDraft((prev) =>
                            prev
                              ? { ...prev, text: { ...prev.text, cardTextColor: e.target.value } }
                              : prev,
                          )
                        }
                        className="w-full h-9 rounded bg-black border border-white/15 cursor-pointer"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-mono-tabular text-white/70 mb-1">
                        Ukuran Teks
                      </label>
                      <select
                        value={draft.text.cardTextSize ?? 'sm'}
                        onChange={(e) =>
                          setDraft((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  text: {
                                    ...prev.text,
                                    cardTextSize: e.target.value as 'sm' | 'md' | 'lg',
                                  },
                                }
                              : prev,
                          )
                        }
                        className="w-full h-9 px-2 rounded bg-black border border-white/15 text-xs text-white outline-none"
                      >
                        <option value="sm">Kecil</option>
                        <option value="md">Sedang</option>
                        <option value="lg">Besar</option>
                      </select>
                    </div>
                    <div>
                      <div className="flex justify-between text-[11px] font-mono-tabular text-white/75 mb-1">
                        <span>Opasitas</span>
                        <span>{Math.round((draft.text.cardBgOpacity ?? 0.85) * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min={0.3}
                        max={1}
                        step={0.05}
                        value={draft.text.cardBgOpacity ?? 0.85}
                        onChange={(e) =>
                          setDraft((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  text: {
                                    ...prev.text,
                                    cardBgOpacity: parseFloat(e.target.value),
                                  },
                                }
                              : prev,
                          )
                        }
                        className="romantic-slider w-full mt-2"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-white/10">
                    <div>
                      <label className="block text-[11px] font-mono-tabular text-white/70 mb-1">
                        Baris Cinta Kiri-Bawah (satu per baris)
                      </label>
                      <textarea
                        rows={4}
                        value={draft.text.loveLines.join('\n')}
                        onChange={(e) =>
                          setDraft((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  text: {
                                    ...prev.text,
                                    loveLines: e.target.value.split('\n').slice(0, 6),
                                  },
                                }
                              : prev,
                          )
                        }
                        className="w-full px-3 py-2 rounded-lg bg-black border border-white/15 text-xs font-mono-tabular text-white outline-none focus:border-pink-400"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-mono-tabular text-white/70 mb-1">
                        Lencana Footer Kiri-Bawah
                      </label>
                      <input
                        type="text"
                        value={draft.text.footerBadge}
                        onChange={(e) =>
                          setDraft((prev) =>
                            prev
                              ? { ...prev, text: { ...prev.text, footerBadge: e.target.value } }
                              : prev,
                          )
                        }
                        className="w-full px-3 py-2 rounded-lg bg-black border border-white/15 text-xs font-mono-tabular text-white outline-none focus:border-pink-400"
                      />
                    </div>
                  </div>
                </section>

                {/* TEMA ATMOSFER & PENCAHAYAAN */}
                <section className="rounded-xl border border-white/12 bg-[#0e0914] p-4 space-y-4">
                  <h2 className="font-display text-xl font-semibold text-white">
                    Preset Tema & Pencahayaan Panggung 3D
                  </h2>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {(Object.keys(THEME_PRESETS) as ThemePresetId[]).map((presetId) => {
                      const p = THEME_PRESETS[presetId];
                      const active = (draft.theme?.preset ?? 'romantic-pink') === presetId;
                      return (
                        <button
                          key={presetId}
                          type="button"
                          onClick={() =>
                            setDraft((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    theme: {
                                      preset: presetId,
                                      backgroundColor: p.backgroundColor,
                                      lightingIntensity: p.lightingIntensity,
                                    },
                                    wrap: {
                                      ...prev.wrap,
                                      wrapTheme: p.wrapTheme,
                                      ribbonColor: p.ribbonColor,
                                    },
                                    animation: {
                                      ...prev.animation,
                                      starColor: p.starColor,
                                      moonColor: p.moonColor,
                                    },
                                  }
                                : prev,
                            )
                          }
                          className={`p-2.5 rounded-lg border text-left flex items-center gap-2 cursor-pointer ${
                            active
                              ? 'border-pink-400 bg-pink-500/15 text-white'
                              : 'border-white/10 bg-black/50 text-white/75 hover:border-white/25'
                          }`}
                        >
                          <span
                            className="w-4 h-4 rounded-full border border-white/30 shrink-0"
                            style={{ backgroundColor: p.ribbonColor }}
                          />
                          <span className="text-xs truncate">{p.label}</span>
                        </button>
                      );
                    })}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[11px] font-mono-tabular text-white/70 mb-1">
                        Warna Latar Langit
                      </label>
                      <input
                        type="color"
                        value={draft.theme?.backgroundColor ?? '#000000'}
                        onChange={(e) =>
                          setDraft((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  theme: {
                                    preset: prev.theme?.preset ?? 'romantic-pink',
                                    lightingIntensity: prev.theme?.lightingIntensity ?? 1.0,
                                    backgroundColor: e.target.value,
                                  },
                                }
                              : prev,
                          )
                        }
                        className="w-full h-9 rounded bg-black border border-white/15 cursor-pointer"
                      />
                    </div>
                    <div>
                      <div className="flex justify-between text-[11px] font-mono-tabular text-white/75 mb-1">
                        <span>Intensitas Cahaya 3D</span>
                        <span>{Math.round((draft.theme?.lightingIntensity ?? 1.0) * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min={0.5}
                        max={1.6}
                        step={0.05}
                        value={draft.theme?.lightingIntensity ?? 1.0}
                        onChange={(e) =>
                          setDraft((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  theme: {
                                    preset: prev.theme?.preset ?? 'romantic-pink',
                                    backgroundColor: prev.theme?.backgroundColor ?? '#000000',
                                    lightingIntensity: parseFloat(e.target.value),
                                  },
                                }
                              : prev,
                          )
                        }
                        className="romantic-slider w-full mt-2"
                      />
                    </div>
                  </div>
                </section>
              </div>
            )}

            {/* TAB 5: INTRO 6-TAHAP, BINTANG, BULAN & MUSIK */}
            {activeTab === 'animasi-langit' && (
              <div className="space-y-6">
                {/* 1. ANIMASI MASUK 6 TAHAP */}
                <section className="rounded-xl border border-pink-400/25 bg-[#0e0914] p-4 space-y-4">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="font-display text-xl font-semibold text-white flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-fuchsia-300" />
                      <span>Animasi Masuk Buket (6 Tahap)</span>
                    </h2>
                    <button
                      type="button"
                      onClick={() => viewportRef.current?.replayEntrance()}
                      className="px-3 py-1.5 rounded-lg bg-pink-600 hover:bg-pink-500 text-xs font-mono-tabular text-white cursor-pointer"
                    >
                      Putar Ulang Intro
                    </button>
                  </div>

                  <div className="flex flex-wrap gap-5">
                    <label className="flex items-center gap-2 text-xs text-white/85 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={draft.animation.entranceEnabled ?? true}
                        onChange={(e) =>
                          setDraft((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  animation: {
                                    ...prev.animation,
                                    entranceEnabled: e.target.checked,
                                  },
                                }
                              : prev,
                          )
                        }
                        className="accent-pink-500 w-4 h-4"
                      />
                      <span>Aktifkan perakitan bertahap saat buka halaman</span>
                    </label>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <div className="flex justify-between text-[11px] font-mono-tabular text-white/75 mb-1">
                        <span>Total Durasi Intro</span>
                        <span>{(draft.animation.entranceDuration ?? 9.0).toFixed(1)} dtk</span>
                      </div>
                      <input
                        type="range"
                        min={4}
                        max={16}
                        step={0.5}
                        value={draft.animation.entranceDuration ?? 9.0}
                        onChange={(e) =>
                          setDraft((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  animation: {
                                    ...prev.animation,
                                    entranceDuration: parseFloat(e.target.value),
                                  },
                                }
                              : prev,
                          )
                        }
                        className="romantic-slider w-full"
                      />
                    </div>
                    <div>
                      <div className="flex justify-between text-[11px] font-mono-tabular text-white/75 mb-1">
                        <span>Intensitas Zoom Kamera Masuk</span>
                        <span>
                          {Math.round((draft.animation.cameraEntranceIntensity ?? 0.75) * 100)}%
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={1.5}
                        step={0.05}
                        value={draft.animation.cameraEntranceIntensity ?? 0.75}
                        onChange={(e) =>
                          setDraft((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  animation: {
                                    ...prev.animation,
                                    cameraEntranceIntensity: parseFloat(e.target.value),
                                  },
                                }
                              : prev,
                          )
                        }
                        className="romantic-slider w-full"
                      />
                    </div>
                  </div>
                </section>

                {/* 2. PIKSEL & GERAK BUKET */}
                <section className="rounded-xl border border-white/12 bg-[#0e0914] p-4 space-y-4">
                  <h2 className="font-display text-xl font-semibold text-white">
                    Resolusi Piksel & Gerak Idle
                  </h2>

                  <div>
                    <label className="block text-[11px] font-mono-tabular text-white/70 mb-1.5">
                      Ukuran Piksel Foto
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {(
                        [
                          { id: 'small', label: 'Kecil (Detail)' },
                          { id: 'medium', label: 'Sedang' },
                          { id: 'large', label: 'Besar' },
                        ] as Array<{ id: PixelSizeMode; label: string }>
                      ).map((sz) => (
                        <button
                          key={sz.id}
                          type="button"
                          onClick={() =>
                            setDraft((prev) =>
                              prev
                                ? { ...prev, animation: { ...prev.animation, pixelSize: sz.id } }
                                : prev,
                            )
                          }
                          className={`py-2 rounded-lg border text-xs font-mono-tabular cursor-pointer ${
                            draft.animation.pixelSize === sz.id
                              ? 'bg-pink-600 border-pink-400 text-white'
                              : 'bg-black/50 border-white/10 text-white/75'
                          }`}
                        >
                          {sz.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <div className="flex justify-between text-[11px] font-mono-tabular text-white/75 mb-1">
                        <span>Kejelasan Foto di Kelopak</span>
                        <span>{Math.round(draft.animation.photoVividness * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.02}
                        value={draft.animation.photoVividness}
                        onChange={(e) =>
                          setDraft((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  animation: {
                                    ...prev.animation,
                                    photoVividness: parseFloat(e.target.value),
                                  },
                                }
                              : prev,
                          )
                        }
                        className="romantic-slider w-full"
                      />
                    </div>

                    <div>
                      <div className="flex justify-between text-[11px] font-mono-tabular text-white/75 mb-1">
                        <span>Kecepatan Putar 360°</span>
                        <span>{draft.animation.rotationSpeed.toFixed(2)}×</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={1.0}
                        step={0.02}
                        value={draft.animation.rotationSpeed}
                        onChange={(e) =>
                          setDraft((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  animation: {
                                    ...prev.animation,
                                    rotationSpeed: parseFloat(e.target.value),
                                  },
                                }
                              : prev,
                          )
                        }
                        className="romantic-slider w-full"
                      />
                    </div>

                    <div>
                      <div className="flex justify-between text-[11px] font-mono-tabular text-white/75 mb-1">
                        <span>Jumlah Kelopak Berjatuhan</span>
                        <span>{draft.animation.fallingPetalsCount}</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={80}
                        step={2}
                        value={draft.animation.fallingPetalsCount}
                        onChange={(e) =>
                          setDraft((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  animation: {
                                    ...prev.animation,
                                    fallingPetalsCount: parseInt(e.target.value, 10),
                                  },
                                }
                              : prev,
                          )
                        }
                        className="romantic-slider w-full"
                      />
                    </div>

                    <div className="flex flex-col justify-center gap-2">
                      <label className="flex items-center gap-2 text-xs text-white/85 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={draft.animation.autoRotate}
                          onChange={(e) =>
                            setDraft((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    animation: { ...prev.animation, autoRotate: e.target.checked },
                                  }
                                : prev,
                            )
                          }
                          className="accent-pink-500 w-4 h-4"
                        />
                        <span>Putar Otomatis 360°</span>
                      </label>
                      <label className="flex items-center gap-2 text-xs text-white/85 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={draft.animation.showOrbitRing}
                          onChange={(e) =>
                            setDraft((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    animation: {
                                      ...prev.animation,
                                      showOrbitRing: e.target.checked,
                                    },
                                  }
                                : prev,
                            )
                          }
                          className="accent-pink-500 w-4 h-4"
                        />
                        <span>Tampilkan Cincin Cahaya Orbit</span>
                      </label>
                    </div>
                  </div>
                </section>

                {/* 3. BINTANG & BULAN */}
                <section className="rounded-xl border border-white/12 bg-[#0e0914] p-4 space-y-5">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="font-display text-xl font-semibold text-white flex items-center gap-2">
                      <Moon className="w-4 h-4 text-pink-300" />
                      <span>Langit Malam: Bintang & Bulan</span>
                    </h2>
                    <button
                      type="button"
                      onClick={() =>
                        setDraft((prev) =>
                          prev
                            ? {
                                ...prev,
                                animation: {
                                  ...prev.animation,
                                  showStars: true,
                                  starDensity: 760,
                                  starSize: 1.0,
                                  starTwinkleIntensity: 0.48,
                                  starBrightness: 0.9,
                                  starAnimationSpeed: 0.85,
                                  starColor: '#ffffff',
                                  starDistribution: 'spherical',
                                  showScatteredStars: true,
                                  scatteredStarsDensity: 320,
                                  showMoon: true,
                                  moonSize: 1.18,
                                  moonPositionX: -2.5,
                                  moonPositionY: 5.1,
                                  moonGlowIntensity: 0.78,
                                  moonOpacity: 0.94,
                                  moonStyle: 'full',
                                  moonColor: '#f7f2fa',
                                  moonBrightness: 0.96,
                                  moonShowTexture: true,
                                },
                              }
                            : prev,
                        )
                      }
                      className="px-2.5 py-1 rounded-lg border border-white/15 hover:bg-white/10 text-[11px] font-mono-tabular text-white/80 cursor-pointer"
                    >
                      Reset Langit
                    </button>
                  </div>

                  {/* Bintang */}
                  <div className="space-y-3 pt-1 border-t border-white/10">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono-tabular text-pink-200">
                        Bintang (Bawaan + Bintang Ekstra)
                      </span>
                      <label className="flex items-center gap-2 text-xs text-white/85 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={draft.animation.showStars ?? true}
                          onChange={(e) =>
                            setDraft((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    animation: { ...prev.animation, showStars: e.target.checked },
                                  }
                                : prev,
                            )
                          }
                          className="accent-pink-500 w-4 h-4"
                        />
                        <span>Tampilkan Bintang</span>
                      </label>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <div className="flex justify-between text-[11px] font-mono-tabular text-white/75 mb-1">
                          <span>Jumlah Bintang</span>
                          <span>{draft.animation.starDensity}</span>
                        </div>
                        <input
                          type="range"
                          min={60}
                          max={1800}
                          step={20}
                          value={draft.animation.starDensity}
                          onChange={(e) =>
                            setDraft((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    animation: {
                                      ...prev.animation,
                                      starDensity: parseInt(e.target.value, 10),
                                    },
                                  }
                                : prev,
                            )
                          }
                          className="romantic-slider w-full"
                        />
                      </div>

                      <div>
                        <div className="flex justify-between text-[11px] font-mono-tabular text-white/75 mb-1">
                          <span>Ukuran Bintang</span>
                          <span>{(draft.animation.starSize ?? 1.0).toFixed(2)}×</span>
                        </div>
                        <input
                          type="range"
                          min={0.4}
                          max={2.2}
                          step={0.05}
                          value={draft.animation.starSize ?? 1.0}
                          onChange={(e) =>
                            setDraft((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    animation: {
                                      ...prev.animation,
                                      starSize: parseFloat(e.target.value),
                                    },
                                  }
                                : prev,
                            )
                          }
                          className="romantic-slider w-full"
                        />
                      </div>

                      <div>
                        <div className="flex justify-between text-[11px] font-mono-tabular text-white/75 mb-1">
                          <span>Intensitas Kelap-Kelip</span>
                          <span>
                            {Math.round((draft.animation.starTwinkleIntensity ?? 0.48) * 100)}%
                          </span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.05}
                          value={draft.animation.starTwinkleIntensity ?? 0.48}
                          onChange={(e) =>
                            setDraft((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    animation: {
                                      ...prev.animation,
                                      starTwinkleIntensity: parseFloat(e.target.value),
                                    },
                                  }
                                : prev,
                            )
                          }
                          className="romantic-slider w-full"
                        />
                      </div>

                      <div>
                        <div className="flex justify-between text-[11px] font-mono-tabular text-white/75 mb-1">
                          <span>Kecerahan & Kecepatan Bintang</span>
                          <span>{Math.round((draft.animation.starBrightness ?? 0.9) * 100)}%</span>
                        </div>
                        <div className="flex gap-2">
                          <input
                            type="range"
                            min={0.2}
                            max={1.6}
                            step={0.05}
                            value={draft.animation.starBrightness ?? 0.9}
                            onChange={(e) =>
                              setDraft((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      animation: {
                                        ...prev.animation,
                                        starBrightness: parseFloat(e.target.value),
                                      },
                                    }
                                  : prev,
                              )
                            }
                            className="romantic-slider w-1/2"
                          />
                          <input
                            type="range"
                            min={0}
                            max={2.5}
                            step={0.05}
                            value={draft.animation.starAnimationSpeed ?? 0.85}
                            onChange={(e) =>
                              setDraft((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      animation: {
                                        ...prev.animation,
                                        starAnimationSpeed: parseFloat(e.target.value),
                                      },
                                    }
                                  : prev,
                              )
                            }
                            className="romantic-slider w-1/2"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-[11px] font-mono-tabular text-white/70 mb-1">
                          Warna Dasar Bintang
                        </label>
                        <input
                          type="color"
                          value={draft.animation.starColor ?? '#ffffff'}
                          onChange={(e) =>
                            setDraft((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    animation: { ...prev.animation, starColor: e.target.value },
                                  }
                                : prev,
                            )
                          }
                          className="w-full h-9 rounded bg-black border border-white/15 cursor-pointer"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-mono-tabular text-white/70 mb-1">
                          Pola Sebaran Bintang
                        </label>
                        <select
                          value={draft.animation.starDistribution ?? 'spherical'}
                          onChange={(e) =>
                            setDraft((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    animation: {
                                      ...prev.animation,
                                      starDistribution: e.target.value as StarDistributionMode,
                                    },
                                  }
                                : prev,
                            )
                          }
                          className="w-full h-9 px-2.5 rounded bg-black border border-white/15 text-xs text-white outline-none"
                        >
                          <option value="spherical">Bola Langit Penuh (360°)</option>
                          <option value="sky-dome">Kubah Langit Atas</option>
                          <option value="clustered">Rasi Bintang Berkelompok</option>
                        </select>
                      </div>

                      <div className="flex items-center justify-between gap-3 sm:col-span-2 pt-2 border-t border-white/10">
                        <label className="flex items-center gap-2 text-xs text-white/85 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={draft.animation.showScatteredStars ?? true}
                            onChange={(e) =>
                              setDraft((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      animation: {
                                        ...prev.animation,
                                        showScatteredStars: e.target.checked,
                                      },
                                    }
                                  : prev,
                              )
                            }
                            className="accent-pink-500 w-4 h-4"
                          />
                          <span>Efek Bintang Bertaburan & Bintang Jatuh</span>
                        </label>
                        <div className="w-44">
                          <div className="flex justify-between text-[10px] font-mono-tabular text-white/65 mb-0.5">
                            <span>Kepadatan Taburan</span>
                            <span>{draft.animation.scatteredStarsDensity ?? 320}</span>
                          </div>
                          <input
                            type="range"
                            min={40}
                            max={480}
                            step={20}
                            value={draft.animation.scatteredStarsDensity ?? 320}
                            onChange={(e) =>
                              setDraft((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      animation: {
                                        ...prev.animation,
                                        scatteredStarsDensity: parseInt(e.target.value, 10),
                                      },
                                    }
                                  : prev,
                              )
                            }
                            className="romantic-slider w-full"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Bulan */}
                  <div className="space-y-3 pt-4 border-t border-white/10">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono-tabular text-pink-200">
                        Bulan Bercahaya Lembut
                      </span>
                      <div className="flex items-center gap-4">
                        <label className="flex items-center gap-2 text-xs text-white/85 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={draft.animation.moonShowTexture ?? true}
                            onChange={(e) =>
                              setDraft((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      animation: {
                                        ...prev.animation,
                                        moonShowTexture: e.target.checked,
                                      },
                                    }
                                  : prev,
                              )
                            }
                            className="accent-pink-500 w-4 h-4"
                          />
                          <span>Tekstur Kawah</span>
                        </label>
                        <label className="flex items-center gap-2 text-xs text-white/85 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={draft.animation.showMoon ?? true}
                            onChange={(e) =>
                              setDraft((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      animation: { ...prev.animation, showMoon: e.target.checked },
                                    }
                                  : prev,
                              )
                            }
                            className="accent-pink-500 w-4 h-4"
                          />
                          <span>Tampilkan Bulan</span>
                        </label>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      {(
                        [
                          { id: 'full', label: 'Purnama' },
                          { id: 'crescent', label: 'Bulan Sabit' },
                          { id: 'soft-blush', label: 'Blush Lembut' },
                        ] as Array<{ id: MoonStyle; label: string }>
                      ).map((st) => (
                        <button
                          key={st.id}
                          type="button"
                          onClick={() =>
                            setDraft((prev) =>
                              prev
                                ? { ...prev, animation: { ...prev.animation, moonStyle: st.id } }
                                : prev,
                            )
                          }
                          className={`py-2 px-2 rounded-lg border text-xs font-mono-tabular cursor-pointer ${
                            (draft.animation.moonStyle ?? 'full') === st.id
                              ? 'bg-pink-600 border-pink-400 text-white'
                              : 'bg-black/50 border-white/10 text-white/75 hover:border-white/25'
                          }`}
                        >
                          {st.label}
                        </button>
                      ))}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[11px] font-mono-tabular text-white/70 mb-1">
                          Warna Bulan
                        </label>
                        <input
                          type="color"
                          value={draft.animation.moonColor ?? '#f7f2fa'}
                          onChange={(e) =>
                            setDraft((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    animation: { ...prev.animation, moonColor: e.target.value },
                                  }
                                : prev,
                            )
                          }
                          className="w-full h-9 rounded bg-black border border-white/15 cursor-pointer"
                        />
                      </div>

                      <div>
                        <div className="flex justify-between text-[11px] font-mono-tabular text-white/75 mb-1">
                          <span>Kecerahan Bulan</span>
                          <span>{Math.round((draft.animation.moonBrightness ?? 0.96) * 100)}%</span>
                        </div>
                        <input
                          type="range"
                          min={0.4}
                          max={1.4}
                          step={0.04}
                          value={draft.animation.moonBrightness ?? 0.96}
                          onChange={(e) =>
                            setDraft((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    animation: {
                                      ...prev.animation,
                                      moonBrightness: parseFloat(e.target.value),
                                    },
                                  }
                                : prev,
                            )
                          }
                          className="romantic-slider w-full mt-2"
                        />
                      </div>

                      <div>
                        <div className="flex justify-between text-[11px] font-mono-tabular text-white/75 mb-1">
                          <span>Ukuran & Glow Halo</span>
                          <span>{(draft.animation.moonSize ?? 1.18).toFixed(2)}×</span>
                        </div>
                        <div className="flex gap-2">
                          <input
                            type="range"
                            min={0.45}
                            max={2.4}
                            step={0.05}
                            value={draft.animation.moonSize ?? 1.18}
                            onChange={(e) =>
                              setDraft((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      animation: {
                                        ...prev.animation,
                                        moonSize: parseFloat(e.target.value),
                                      },
                                    }
                                  : prev,
                              )
                            }
                            className="romantic-slider w-1/2"
                          />
                          <input
                            type="range"
                            min={0}
                            max={1.8}
                            step={0.05}
                            value={draft.animation.moonGlowIntensity ?? 0.78}
                            onChange={(e) =>
                              setDraft((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      animation: {
                                        ...prev.animation,
                                        moonGlowIntensity: parseFloat(e.target.value),
                                      },
                                    }
                                  : prev,
                              )
                            }
                            className="romantic-slider w-1/2"
                          />
                        </div>
                      </div>

                      <div>
                        <div className="flex justify-between text-[11px] font-mono-tabular text-white/75 mb-1">
                          <span>Posisi X / Y Bulan</span>
                          <span>
                            {(draft.animation.moonPositionX ?? -2.5).toFixed(1)} /{' '}
                            {(draft.animation.moonPositionY ?? 5.1).toFixed(1)}
                          </span>
                        </div>
                        <div className="flex gap-2">
                          <input
                            type="range"
                            min={-8.0}
                            max={8.0}
                            step={0.1}
                            value={draft.animation.moonPositionX ?? -2.5}
                            onChange={(e) =>
                              setDraft((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      animation: {
                                        ...prev.animation,
                                        moonPositionX: parseFloat(e.target.value),
                                      },
                                    }
                                  : prev,
                              )
                            }
                            className="romantic-slider w-1/2"
                          />
                          <input
                            type="range"
                            min={2.0}
                            max={8.0}
                            step={0.1}
                            value={draft.animation.moonPositionY ?? 5.1}
                            onChange={(e) =>
                              setDraft((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      animation: {
                                        ...prev.animation,
                                        moonPositionY: parseFloat(e.target.value),
                                      },
                                    }
                                  : prev,
                              )
                            }
                            className="romantic-slider w-1/2"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </section>

                {/* 4. MUSIK LATAR */}
                <section className="rounded-xl border border-white/12 bg-[#0e0914] p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="font-display text-xl font-semibold text-white flex items-center gap-2">
                      <Music className="w-4 h-4 text-pink-400" />
                      <span>Musik Latar Romantis</span>
                    </h2>
                    <button
                      type="button"
                      onClick={() => audioUploadInputRef.current?.click()}
                      disabled={isUploadingAudio}
                      className="px-3 py-1.5 rounded-lg bg-pink-600 hover:bg-pink-500 text-xs font-mono-tabular text-white flex items-center gap-1.5 cursor-pointer"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <span>{isUploadingAudio ? 'Mengunggah...' : 'Unggah Audio'}</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setDraft((prev) =>
                          prev ? { ...prev, music: { ...prev.music, mode: 'builtin' } } : prev,
                        )
                      }
                      className={`py-2 px-3 rounded-lg border text-xs font-mono-tabular cursor-pointer ${
                        draft.music.mode === 'builtin'
                          ? 'bg-pink-600/20 border-pink-400 text-pink-100'
                          : 'bg-black/50 border-white/10 text-white/70'
                      }`}
                    >
                      Musik Synth Bawaan
                    </button>
                    <button
                      type="button"
                      disabled={!draft.music.uploadedAudioUrl}
                      onClick={() =>
                        setDraft((prev) =>
                          prev ? { ...prev, music: { ...prev.music, mode: 'uploaded' } } : prev,
                        )
                      }
                      className={`py-2 px-3 rounded-lg border text-xs font-mono-tabular cursor-pointer disabled:opacity-40 ${
                        draft.music.mode === 'uploaded'
                          ? 'bg-pink-600/20 border-pink-400 text-pink-100'
                          : 'bg-black/50 border-white/10 text-white/70'
                      }`}
                    >
                      Audio Unggahan
                    </button>
                  </div>

                  {draft.music.mode === 'builtin' ? (
                    <div className="flex gap-2">
                      {['Starlight Chimes', 'Midnight Lilies'].map((title, idx) => (
                        <button
                          key={title}
                          type="button"
                          onClick={() =>
                            setDraft((prev) =>
                              prev
                                ? { ...prev, music: { ...prev.music, builtinTrackIndex: idx } }
                                : prev,
                            )
                          }
                          className={`flex-1 py-2 px-3 rounded-lg border text-xs cursor-pointer ${
                            draft.music.builtinTrackIndex === idx
                              ? 'border-pink-400 bg-pink-500/15 text-white'
                              : 'border-white/10 bg-black/40 text-white/70'
                          }`}
                        >
                          {title}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="p-3 rounded-lg bg-black/60 border border-white/10 flex items-center justify-between gap-3">
                      <span className="text-xs font-mono-tabular text-pink-200 truncate">
                        {draft.music.uploadedAudioName || 'Audio Unggahan'}
                      </span>
                      <audio controls src={draft.music.uploadedAudioUrl} className="h-8 max-w-[200px]" />
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                    <div>
                      <div className="flex justify-between text-[11px] font-mono-tabular text-white/75 mb-1">
                        <span>Volume Default</span>
                        <span>{Math.round(draft.music.defaultVolume * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={draft.music.defaultVolume}
                        onChange={(e) =>
                          setDraft((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  music: {
                                    ...prev.music,
                                    defaultVolume: parseFloat(e.target.value),
                                  },
                                }
                              : prev,
                          )
                        }
                        className="romantic-slider w-full"
                      />
                    </div>

                    <label className="flex items-center justify-between text-xs text-white/85 cursor-pointer">
                      <span>Putar otomatis saat sentuhan pertama</span>
                      <input
                        type="checkbox"
                        checked={draft.music.autoPlayOnInteract}
                        onChange={(e) =>
                          setDraft((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  music: { ...prev.music, autoPlayOnInteract: e.target.checked },
                                }
                              : prev,
                          )
                        }
                        className="accent-pink-500 w-4 h-4"
                      />
                    </label>
                  </div>
                </section>
              </div>
            )}

            {/* TAB 6: PUBLIKASI & CADANGAN */}
            {activeTab === 'publikasi' && (
              <div className="space-y-6">
                <section className="rounded-xl border border-pink-400/35 bg-[#0e0914] p-4 space-y-4">
                  <h2 className="font-display text-xl font-semibold text-white">
                    Publikasi & Snapshot Cadangan
                  </h2>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="text"
                      value={publishNote}
                      onChange={(e) => setPublishNote(e.target.value)}
                      placeholder="Catatan snapshot opsional (misal: Tambah 12 foto anniversary)"
                      className="flex-1 px-3 py-2 rounded-lg bg-black border border-white/15 text-xs text-white outline-none focus:border-pink-400"
                    />
                    <button
                      type="button"
                      onClick={handleCreateManualBackup}
                      className="px-3.5 py-2 rounded-lg border border-white/20 hover:bg-white/10 text-xs font-mono-tabular text-white flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
                    >
                      <Save className="w-3.5 h-3.5" />
                      <span>Simpan Snapshot</span>
                    </button>
                    <button
                      type="button"
                      onClick={handlePublishLive}
                      disabled={isPublishing}
                      className="px-4 py-2 rounded-lg bg-pink-600 hover:bg-pink-500 text-xs font-mono-tabular font-medium text-white flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Publikasikan Live</span>
                    </button>
                  </div>

                  <div className="pt-2 border-t border-white/10 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs text-white/65">
                      Riwayat server menyimpan hingga 12 titik pemulihan secara otomatis.
                    </span>
                    <button
                      type="button"
                      onClick={handleExportJsonBackup}
                      className="px-3 py-1.5 rounded-lg border border-pink-400/35 hover:bg-pink-500/15 text-xs font-mono-tabular text-pink-200 flex items-center gap-1.5 cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Ekspor Cadangan JSON</span>
                    </button>
                  </div>
                </section>

                <section className="space-y-2">
                  {backups.map((b) => (
                    <div
                      key={b.id}
                      className="rounded-xl border border-white/10 bg-[#0e0914] p-3.5 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-white truncate">{b.note}</div>
                        <div className="text-[11px] font-mono-tabular text-white/55 mt-0.5">
                          {new Date(b.createdAt).toLocaleString('id-ID')} · {b.flowerCount} bunga ·{' '}
                          {b.photoCount} foto
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setConfirmDialog({
                            title: 'Pulihkan snapshot cadangan ini?',
                            description: `Draf saat ini akan diganti dengan "${b.note}". Anda dapat meninjau hasilnya sebelum menekan Publikasikan Live.`,
                            confirmLabel: 'Pulihkan ke Draf',
                            onConfirm: () => {
                              setConfirmDialog(null);
                              handleRestoreBackup(b.id);
                            },
                          })
                        }
                        className="px-3 py-1.5 rounded-lg border border-white/15 hover:bg-white/10 text-xs font-mono-tabular text-white/85 shrink-0 cursor-pointer"
                      >
                        Pulihkan
                      </button>
                    </div>
                  ))}
                </section>
              </div>
            )}

            {/* TAB BARU: PIN RAHASIA & TIRAI BUNGA */}
            {activeTab === 'pin-tirai' && (
              <AdminEntranceTab
                draft={draft}
                selectedSlug={selectedSlug}
                bouquets={bouquets}
                pinStatus={pinStatus}
                onUpdateEntrance={updateEntrance}
                onSelectBouquet={handleSelectBouquet}
                onCreateBouquet={handleCreateBouquet}
                onDeleteBouquet={handleDeleteBouquet}
                onSetDefaultBouquet={handleSetDefaultBouquet}
                onSavePin={handleSavePin}
                onResetVisitorFakeFailure={handleResetVisitorFakeFailure}
                onLaunchPreviewAction={handleLaunchPreviewAction}
                onShowToast={showToast}
              />
            )}
          </main>
        )}

        {/* RIGHT: LIVE INTERACTIVE 3D DRAFT PREVIEW WITH DEVICE FRAMES */}
        <section
          className={`relative bg-[#040207] border-t lg:border-t-0 lg:border-l border-white/10 flex flex-col items-center justify-center p-2 sm:p-3 ${
            previewExpanded ? 'h-[calc(100vh-61px)]' : 'h-[480px] lg:h-[calc(100vh-61px)]'
          }`}
        >
          {/* Preview Toolbar */}
          <div className="w-full flex flex-wrap items-center justify-between gap-2 mb-2 px-1">
            <div className="flex items-center gap-1 bg-black/80 border border-white/10 rounded-lg p-0.5">
              {(
                [
                  { id: 'desktop', icon: Monitor, label: 'Desktop' },
                  { id: 'tablet', icon: Tablet, label: 'Tablet' },
                  { id: 'mobile', icon: Smartphone, label: 'Mobile' },
                ] as const
              ).map((dev) => {
                const DevIcon = dev.icon;
                const active = previewDevice === dev.id;
                return (
                  <button
                    key={dev.id}
                    type="button"
                    onClick={() => setPreviewDevice(dev.id)}
                    className={`px-2 py-1 rounded text-[11px] font-mono-tabular flex items-center gap-1 cursor-pointer ${
                      active
                        ? 'bg-pink-600/30 text-pink-200 border border-pink-400/40'
                        : 'text-white/60 hover:text-white'
                    }`}
                  >
                    <DevIcon className="w-3 h-3" />
                    <span className="hidden sm:inline">{dev.label}</span>
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => viewportRef.current?.replayEntrance()}
                className="px-2.5 py-1 rounded-lg bg-black/85 border border-pink-400/40 hover:bg-pink-500/20 text-[11px] font-mono-tabular text-pink-200 flex items-center gap-1 cursor-pointer"
              >
                <Play className="w-3 h-3" />
                <span>Putar Ulang Intro</span>
              </button>
              <button
                type="button"
                onClick={() => viewportRef.current?.skipEntrance()}
                className="px-2.5 py-1 rounded-lg bg-black/85 border border-white/15 hover:bg-white/10 text-[11px] font-mono-tabular text-white/85 flex items-center gap-1 cursor-pointer"
              >
                <FastForward className="w-3 h-3" />
                <span>Hasil Akhir</span>
              </button>
              <button
                type="button"
                onClick={() => viewportRef.current?.resetView()}
                className="px-2.5 py-1 rounded-lg bg-black/85 border border-white/15 hover:bg-white/10 text-[11px] font-mono-tabular text-white/85 flex items-center gap-1 cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" />
                <span className="hidden sm:inline">Reset Kamera</span>
              </button>
            </div>
          </div>

          <div className={`relative flex-1 flex items-center justify-center w-full overflow-hidden`}>
            <div className={`relative ${previewFrameClass}`}>
              <BouquetViewport
                ref={viewportRef}
                flowers={draft.flowers}
                photos={draft.photos}
                atlas={atlas}
                wrapConfig={draft.wrap}
                animationConfig={draft.animation}
                curtainConfig={draft.entrance?.curtain}
                themeConfig={draft.theme}
                ribbonText={draft.text.ribbonText}
                recipientName={draft.text.recipientName}
                autoPlayEntrance={false}
                onClickPixel={(info) => {
                  setLightboxPhotoId(info.photoId);
                  setLightboxPixelInfo(info);
                }}
                onClickGiftTag={() => setTagModalOpen(true)}
                onSelectFlower={() => {}}
                onTotalTilesChange={setTotalTiles}
              />

              <div className="absolute top-3 left-3 pointer-events-none px-3 py-1 rounded-lg bg-black/80 border border-pink-400/35 text-[11px] font-mono-tabular text-pink-200">
                &gt; Pratinjau Draf Live · Klik piksel atau tag pita
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* ISOLATED ADMIN LIVE ENTRANCE PREVIEW MODAL (PIN + FAKE FAILURE + 3D FLOWER CURTAIN) */}
      {entrancePreviewOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/95 flex flex-col p-3 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Pratinjau Terisolasi Pengalaman Masuk"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-pink-400/25">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono-tabular text-xs font-semibold text-pink-300">
                &gt; Pratinjau Terisolasi (`/gift/{selectedSlug}`)
              </span>
              <div className="flex items-center gap-1 bg-black border border-white/15 rounded-lg p-0.5">
                {(
                  [
                    { id: 'desktop', icon: Monitor, label: 'Desktop' },
                    { id: 'tablet', icon: Tablet, label: 'Tablet' },
                    { id: 'mobile', icon: Smartphone, label: 'Mobile' },
                  ] as const
                ).map((dev) => {
                  const DevIcon = dev.icon;
                  const active = entrancePreviewDevice === dev.id;
                  return (
                    <button
                      key={dev.id}
                      type="button"
                      onClick={() => setEntrancePreviewDevice(dev.id)}
                      className={`px-2 py-1 rounded text-[11px] font-mono-tabular flex items-center gap-1 cursor-pointer ${
                        active
                          ? 'bg-pink-600/30 text-pink-200 border border-pink-400/40'
                          : 'text-white/60 hover:text-white'
                      }`}
                    >
                      <DevIcon className="w-3 h-3" />
                      <span className="hidden sm:inline">{dev.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  { id: 'preview-lock', label: 'Layar Kunci' },
                  { id: 'test-wrong', label: 'PIN Salah' },
                  { id: 'test-fake', label: 'Gagal Palsu' },
                  { id: 'test-success', label: 'PIN Benar' },
                  { id: 'replay-curtain', label: 'Tirai Bunga' },
                  { id: 'replay-full', label: 'Masuk Lengkap' },
                  { id: 'reset-preview', label: 'Reset Status' },
                ] as const
              ).map((btn) => (
                <button
                  key={btn.id}
                  type="button"
                  onClick={() => handleLaunchPreviewAction(btn.id)}
                  className="px-2.5 py-1 rounded-lg border border-white/15 hover:border-pink-400/55 bg-white/[0.05] hover:bg-pink-500/15 text-[11px] font-mono-tabular text-white cursor-pointer"
                >
                  {btn.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setEntrancePreviewOpen(false)}
                className="px-3 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-[11px] font-mono-tabular text-white flex items-center gap-1 cursor-pointer ml-1"
              >
                <X className="w-3.5 h-3.5" />
                <span>Tutup</span>
              </button>
            </div>
          </div>

          <div className="flex-1 flex items-center justify-center overflow-hidden pt-3">
            <div
              className={`relative ${
                entrancePreviewDevice === 'mobile'
                  ? 'w-[360px] max-w-full h-[640px] max-h-full rounded-2xl border-2 border-pink-400/50 overflow-hidden'
                  : entrancePreviewDevice === 'tablet'
                    ? 'w-[680px] max-w-full h-[620px] max-h-full rounded-2xl border-2 border-pink-400/45 overflow-hidden'
                    : 'w-full h-full rounded-xl border border-white/10 overflow-hidden'
              }`}
            >
              <BouquetViewport
                ref={entrancePreviewViewportRef}
                flowers={draft.flowers}
                photos={draft.photos}
                atlas={atlas}
                wrapConfig={draft.wrap}
                animationConfig={draft.animation}
                curtainConfig={draft.entrance?.curtain}
                themeConfig={draft.theme}
                ribbonText={draft.text.ribbonText}
                recipientName={draft.text.recipientName}
                lockedSkyOnly={entrancePreviewStage === 'lock'}
                autoPlayEntrance={false}
                onClickPixel={(info) => {
                  setLightboxPhotoId(info.photoId);
                  setLightboxPixelInfo(info);
                }}
                onClickGiftTag={() => setTagModalOpen(true)}
                onSelectFlower={() => {}}
              />

              {entrancePreviewStage === 'lock' && (
                <PinLockScreen
                  ui={(draft.entrance ?? createDefaultEntranceConfig()).lockScreen}
                  hasPinConfigured={Boolean(pinStatus?.hasDraftPin)}
                  onSubmitPin={handlePreviewPinSubmit}
                  forcedTestEvent={forcedTestEvent}
                  onUnlockVisualComplete={() => {
                    const ent = draft.entrance ?? createDefaultEntranceConfig();
                    setEntrancePreviewStage('curtain-or-bouquet');
                    if (ent.curtain.enabled) {
                      entrancePreviewViewportRef.current?.playFlowerCurtain({
                        assembleAfter: ent.curtain.assembleBouquetAfter,
                      });
                    } else if (ent.curtain.assembleBouquetAfter) {
                      entrancePreviewViewportRef.current?.replayEntrance();
                    }
                  }}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* GIFT TAG POPUP PREVIEW */}
      <GiftTagModal
        isOpen={tagModalOpen}
        wrapConfig={draft.wrap}
        textConfig={draft.text}
        onClose={() => setTagModalOpen(false)}
      />

      {/* FULL-RESOLUTION LIGHTBOX */}
      <PhotoLightboxModal
        photo={activeLightboxPhoto}
        pixelInfo={lightboxPixelInfo}
        totalPhotos={allAdminPhotos.length}
        currentPhotoIndex={Math.max(0, lightboxIdx)}
        onClose={() => {
          setLightboxPhotoId(null);
          setLightboxPixelInfo(null);
        }}
        onPrevPhoto={() => {
          if (allAdminPhotos.length === 0 || lightboxIdx < 0) return;
          const prevIdx = (lightboxIdx - 1 + allAdminPhotos.length) % allAdminPhotos.length;
          setLightboxPhotoId(allAdminPhotos[prevIdx].id);
          setLightboxPixelInfo(null);
        }}
        onNextPhoto={() => {
          if (allAdminPhotos.length === 0 || lightboxIdx < 0) return;
          const nextIdx = (lightboxIdx + 1) % allAdminPhotos.length;
          setLightboxPhotoId(allAdminPhotos[nextIdx].id);
          setLightboxPixelInfo(null);
        }}
        onFocusFlower={(idx) => viewportRef.current?.focusFlower(idx)}
      />

      {/* DELETE / DISCARD CONFIRMATION MODAL */}
      {confirmDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-sm rounded-xl bg-[#140d1b] border border-pink-400/35 p-6 shadow-2xl space-y-4">
            <h3 className="font-display text-xl font-semibold text-white">
              {confirmDialog.title}
            </h3>
            <p className="text-xs text-white/75 leading-relaxed">{confirmDialog.description}</p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmDialog(null)}
                className="px-3.5 py-2 rounded-lg border border-white/15 hover:bg-white/10 text-xs font-mono-tabular text-white/80 cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={confirmDialog.onConfirm}
                className={`px-4 py-2 rounded-lg text-xs font-mono-tabular font-medium text-white cursor-pointer ${
                  confirmDialog.danger
                    ? 'bg-rose-600 hover:bg-rose-500'
                    : 'bg-pink-600 hover:bg-pink-500'
                }`}
              >
                {confirmDialog.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
