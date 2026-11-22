import {
  Check,
  Copy,
  Eye,
  Flower2,
  KeyRound,
  Layers,
  Link2,
  Lock,
  Palette,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Star,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';
import type {
  AdminBouquetSummary,
  AdminPinStatus,
  BouquetSiteConfig,
  CurtainEasingMode,
  EntranceSecurityConfig,
  FlowerCurtainConfig,
  LockScreenUiConfig,
  PinFailureAnimConfig,
  PinWrongAnimStyle,
} from '../types/bouquet';
import {
  createDefaultEntranceConfig,
  DEFAULT_FAKE_FAILURE_MESSAGES,
  DEFAULT_WRONG_PIN_MESSAGES,
} from '../utils/defaultBouquetConfig';

export type AdminEntrancePreviewAction =
  | 'preview-lock'
  | 'test-wrong'
  | 'test-fake'
  | 'test-success'
  | 'replay-curtain'
  | 'replay-full'
  | 'reset-preview';

interface AdminEntranceTabProps {
  draft: BouquetSiteConfig;
  selectedSlug: string;
  bouquets: AdminBouquetSummary[];
  pinStatus: AdminPinStatus | null;
  onUpdateEntrance: (updater: (prev: EntranceSecurityConfig) => EntranceSecurityConfig) => void;
  onSelectBouquet: (slug: string) => void;
  onCreateBouquet: (slug: string, recipientName: string, cloneFromSlug?: string) => Promise<void>;
  onDeleteBouquet: (slug: string) => Promise<void>;
  onSetDefaultBouquet: (slug: string) => Promise<void>;
  onSavePin: (pin: string, confirmPin: string) => Promise<void>;
  onResetVisitorFakeFailure: () => Promise<void>;
  onLaunchPreviewAction: (action: AdminEntrancePreviewAction) => void;
  onShowToast: (msg: string) => void;
}

const ANIM_STYLE_OPTIONS: Array<{ id: PinWrongAnimStyle; label: string }> = [
  { id: 'wiggle-bloom', label: 'Bunga Bergoyang Lucu' },
  { id: 'bounce-blush', label: 'Bunga Memantul Malu' },
  { id: 'spin-shy', label: 'Bunga Berputar Manja' },
  { id: 'peek-petal', label: 'Bunga Mengedip Menggoda' },
];

const DENSITY_PRESETS: Array<{
  id: FlowerCurtainConfig['density'];
  label: string;
  count: number;
  layers: number;
}> = [
  { id: 'light', label: 'Ringan', count: 100, layers: 2 },
  { id: 'medium', label: 'Sedang', count: 165, layers: 3 },
  { id: 'lush', label: 'Rimbun', count: 230, layers: 4 },
  { id: 'extravagant', label: 'Megah Maksimal', count: 320, layers: 5 },
];

function FailureAnimEditor({
  title,
  subtitle,
  value,
  presets,
  onChange,
}: {
  title: string;
  subtitle: string;
  value: PinFailureAnimConfig;
  presets: string[];
  onChange: (next: PinFailureAnimConfig) => void;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/55 p-4 space-y-3.5">
      <div>
        <h4 className="text-xs font-mono-tabular font-semibold text-pink-200">{title}</h4>
        <p className="text-[11px] text-white/55 mt-0.5">{subtitle}</p>
      </div>

      <div>
        <label className="block text-[11px] font-mono-tabular text-white/75 mb-1">
          Pesan Godaan Utama
        </label>
        <input
          type="text"
          value={value.message}
          onChange={(e) => onChange({ ...value, message: e.target.value })}
          maxLength={140}
          className="w-full px-3 py-1.5 rounded-lg bg-[#0b0710] border border-white/15 focus:border-pink-400 text-xs text-white outline-none"
        />
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          {presets.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onChange({ ...value, message: p })}
              className="px-2 py-0.5 rounded bg-white/[0.05] hover:bg-pink-500/20 border border-white/10 text-[10px] text-pink-100/85 cursor-pointer"
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-[11px] font-mono-tabular text-white/75 mb-1">
          Daftar Variasi Pesan (1 per baris)
        </label>
        <textarea
          rows={3}
          value={(value.customMessages ?? []).join('\n')}
          onChange={(e) =>
            onChange({
              ...value,
              customMessages: e.target.value
                .split('\n')
                .map((l) => l.trim())
                .filter(Boolean)
                .slice(0, 10),
            })
          }
          className="w-full px-3 py-1.5 rounded-lg bg-[#0b0710] border border-white/15 focus:border-pink-400 text-xs text-white outline-none resize-none"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-[11px] font-mono-tabular text-white/75 mb-1">
            Gaya Animasi Bunga
          </label>
          <select
            value={value.style}
            onChange={(e) => onChange({ ...value, style: e.target.value as PinWrongAnimStyle })}
            className="w-full px-2.5 py-1.5 rounded-lg bg-[#0b0710] border border-white/15 text-xs text-white outline-none"
          >
            {ANIM_STYLE_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <div className="flex justify-between text-[11px] font-mono-tabular text-white/75 mb-1">
            <span>Durasi Animasi</span>
            <span>{(value.durationMs / 1000).toFixed(1)} dtk</span>
          </div>
          <input
            type="range"
            min={900}
            max={4500}
            step={100}
            value={value.durationMs}
            onChange={(e) => onChange({ ...value, durationMs: parseInt(e.target.value, 10) })}
            className="romantic-slider w-full"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <div className="flex justify-between text-[11px] font-mono-tabular text-white/75 mb-1">
            <span>Intensitas Getar Kotak PIN</span>
            <span>{value.shakeIntensity.toFixed(1)}x</span>
          </div>
          <input
            type="range"
            min={0.3}
            max={2.0}
            step={0.1}
            value={value.shakeIntensity}
            onChange={(e) => onChange({ ...value, shakeIntensity: parseFloat(e.target.value) })}
            className="romantic-slider w-full"
          />
        </div>

        <div>
          <div className="flex justify-between text-[11px] font-mono-tabular text-white/75 mb-1">
            <span>Ukuran Bunga Penggoda</span>
            <span>{value.teasingFlowerSize.toFixed(2)}x</span>
          </div>
          <input
            type="range"
            min={0.6}
            max={1.55}
            step={0.05}
            value={value.teasingFlowerSize}
            onChange={(e) => onChange({ ...value, teasingFlowerSize: parseFloat(e.target.value) })}
            className="romantic-slider w-full"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
        <label className="flex items-center justify-between gap-2 text-[11px] text-white/85 cursor-pointer bg-white/[0.03] px-2.5 py-2 rounded-lg border border-white/10">
          <span>Bunga Penggoda</span>
          <input
            type="checkbox"
            checked={value.showTeasingFlower}
            onChange={(e) => onChange({ ...value, showTeasingFlower: e.target.checked })}
            className="accent-pink-500 w-3.5 h-3.5"
          />
        </label>
        <label className="flex items-center justify-between gap-2 text-[11px] text-white/85 cursor-pointer bg-white/[0.03] px-2.5 py-2 rounded-lg border border-white/10">
          <span>Partikel Kilau</span>
          <input
            type="checkbox"
            checked={value.showParticles}
            onChange={(e) => onChange({ ...value, showParticles: e.target.checked })}
            className="accent-pink-500 w-3.5 h-3.5"
          />
        </label>
        <label className="flex items-center justify-between gap-2 text-[11px] text-white/85 cursor-pointer bg-white/[0.03] px-2.5 py-2 rounded-lg border border-white/10">
          <span>Nada Lembut</span>
          <input
            type="checkbox"
            checked={value.playSound}
            onChange={(e) => onChange({ ...value, playSound: e.target.checked })}
            className="accent-pink-500 w-3.5 h-3.5"
          />
        </label>
      </div>
    </div>
  );
}

export function AdminEntranceTab({
  draft,
  selectedSlug,
  bouquets,
  pinStatus,
  onUpdateEntrance,
  onSelectBouquet,
  onCreateBouquet,
  onDeleteBouquet,
  onSetDefaultBouquet,
  onSavePin,
  onResetVisitorFakeFailure,
  onLaunchPreviewAction,
  onShowToast,
}: AdminEntranceTabProps) {
  const ent = draft.entrance ?? createDefaultEntranceConfig();

  // New bouquet creation state
  const [newSlug, setNewSlug] = useState('');
  const [newRecipient, setNewRecipient] = useState('');
  const [cloneSource, setCloneSource] = useState(selectedSlug);
  const [creatingBouquet, setCreatingBouquet] = useState(false);

  // Set / Change 6-digit PIN form state
  const [pinInput, setPinInput] = useState('');
  const [confirmPinInput, setConfirmPinInput] = useState('');
  const [savingPin, setSavingPin] = useState(false);

  // Curtain new color swatch state
  const [newCurtainColor, setNewCurtainColor] = useState('#fb7185');

  const directGiftUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/gift/${encodeURIComponent(selectedSlug)}`
      : `/gift/${selectedSlug}`;

  const handlePinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(pinInput)) {
      onShowToast('PIN harus berupa tepat 6 digit angka (0–9).');
      return;
    }
    if (pinInput !== confirmPinInput) {
      onShowToast('Konfirmasi PIN tidak cocok.');
      return;
    }
    setSavingPin(true);
    try {
      await onSavePin(pinInput, confirmPinInput);
      setPinInput('');
      setConfirmPinInput('');
    } finally {
      setSavingPin(false);
    }
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSlug.trim()) {
      onShowToast('Masukkan slug URL untuk buket baru (misal: for-you).');
      return;
    }
    setCreatingBouquet(true);
    try {
      await onCreateBouquet(newSlug.trim(), newRecipient.trim(), cloneSource || undefined);
      setNewSlug('');
      setNewRecipient('');
    } finally {
      setCreatingBouquet(false);
    }
  };

  const updateLockScreen = (patch: Partial<LockScreenUiConfig>) => {
    onUpdateEntrance((prev) => ({
      ...prev,
      lockScreen: { ...prev.lockScreen, ...patch },
    }));
  };

  const updateCurtain = (patch: Partial<FlowerCurtainConfig>) => {
    onUpdateEntrance((prev) => ({
      ...prev,
      curtain: { ...prev.curtain, ...patch },
    }));
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-2xl font-semibold text-white">
          PIN Rahasia, Kegagalan Palsu & Tirai Bunga 3D
        </h2>
        <p className="text-xs text-white/65 mt-0.5">
          Atur layar kunci romantis 6 digit, lelucon kegagalan pertama, dan animasi tirai bunga
          pembuka untuk setiap buket.
        </p>
      </div>

      {/* Warning if PIN protection is active without a published PIN yet */}
      {ent.pinEnabled && !pinStatus?.hasPublishedPin && (
        <div className="rounded-xl border border-amber-400/45 bg-amber-500/10 p-3.5 flex items-start gap-2.5 text-xs text-amber-100">
          <ShieldAlert className="w-4 h-4 text-amber-300 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <div className="font-mono-tabular font-semibold text-amber-200">
              {pinStatus?.hasDraftPin
                ? 'PIN baru tersimpan di Draf — klik "Publikasikan Live" di atas agar aktif untuk pengunjung.'
                : 'Proteksi PIN aktif, namun PIN 6 digit publik belum diatur untuk buket ini.'}
            </div>
            <p className="text-[11px] text-amber-100/80">
              {pinStatus?.hasDraftPin
                ? 'Pengunjung masih menunggu PIN dipublikasikan. Anda dapat mengujinya terlebih dahulu melalui Panel Uji Pratinjau di bawah.'
                : 'Simpan 6 digit PIN rahasia pada formulir di bawah lalu klik Publikasikan Live.'}
            </p>
          </div>
        </div>
      )}

      {/* 1. PER-BOUQUET URL & MULTI-BOUQUET MANAGER */}
      <section className="rounded-xl border border-pink-400/30 bg-[#0e0914] p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-display text-lg font-semibold text-white flex items-center gap-2">
            <Link2 className="w-4 h-4 text-pink-400" />
            <span>Manajemen Buket & URL Khusus (`/gift/...`)</span>
          </h3>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard?.writeText(directGiftUrl);
              onShowToast(`Tautan disalin: ${directGiftUrl}`);
            }}
            className="px-2.5 py-1 rounded-lg border border-pink-400/40 hover:bg-pink-500/20 text-[11px] font-mono-tabular text-pink-100 flex items-center gap-1.5 cursor-pointer"
          >
            <Copy className="w-3 h-3" />
            <span>Salin `/gift/{selectedSlug}`</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {bouquets.map((b) => {
            const active = b.slug === selectedSlug;
            return (
              <div
                key={b.slug}
                className={`rounded-xl border p-3 flex flex-col justify-between gap-2 transition-colors ${
                  active
                    ? 'bg-pink-600/15 border-pink-400 text-white'
                    : 'bg-black/50 border-white/10 text-white/80 hover:border-white/25'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => onSelectBouquet(b.slug)}
                    className="text-left min-w-0 flex-1 cursor-pointer"
                  >
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-mono-tabular text-xs font-semibold text-pink-200 truncate">
                        /gift/{b.slug}
                      </span>
                      {b.isDefault && (
                        <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 border border-emerald-400/35 text-[9px] font-mono-tabular text-emerald-200">
                          Utama (/)
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-white/60 mt-0.5 truncate">
                      {b.recipientName ? `Untuk ${b.recipientName}` : 'Tanpa nama penerima'} ·{' '}
                      {b.flowerCount} bunga · {b.pinEnabled ? 'PIN Aktif' : 'Terbuka'}
                    </div>
                  </button>

                  <div className="flex items-center gap-1 shrink-0">
                    {!b.isDefault && (
                      <button
                        type="button"
                        onClick={() => onSetDefaultBouquet(b.slug)}
                        title="Jadikan buket utama di /"
                        className="p-1.5 rounded-lg border border-white/10 hover:border-amber-400/50 text-white/60 hover:text-amber-300 cursor-pointer"
                      >
                        <Star className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {bouquets.length > 1 && (
                      <button
                        type="button"
                        onClick={() => onDeleteBouquet(b.slug)}
                        title="Hapus buket"
                        className="p-1.5 rounded-lg border border-white/10 hover:border-rose-400/50 text-white/60 hover:text-rose-300 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Create New Bouquet URL */}
        <form
          onSubmit={handleCreateSubmit}
          className="pt-3 border-t border-white/10 grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 items-end"
        >
          <div>
            <label className="block text-[11px] font-mono-tabular text-white/70 mb-1">
              Slug URL Baru (misal: for-you)
            </label>
            <input
              type="text"
              value={newSlug}
              onChange={(e) => setNewSlug(e.target.value.replace(/[^a-zA-Z0-9_-]/g, '-'))}
              placeholder="happy-birthday"
              className="w-full px-3 py-1.5 rounded-lg bg-black border border-white/15 focus:border-pink-400 text-xs font-mono-tabular text-white outline-none"
            />
          </div>
          <div>
            <label className="block text-[11px] font-mono-tabular text-white/70 mb-1">
              Nama Penerima (Opsional) & Salin Dari
            </label>
            <div className="flex gap-1.5">
              <input
                type="text"
                value={newRecipient}
                onChange={(e) => setNewRecipient(e.target.value)}
                placeholder="Nama penerima"
                className="w-1/2 px-2.5 py-1.5 rounded-lg bg-black border border-white/15 text-xs text-white outline-none"
              />
              <select
                value={cloneSource}
                onChange={(e) => setCloneSource(e.target.value)}
                className="w-1/2 px-2 py-1.5 rounded-lg bg-black border border-white/15 text-[11px] text-white outline-none"
              >
                <option value="">Preset Bawaan</option>
                {bouquets.map((b) => (
                  <option key={b.slug} value={b.slug}>
                    Salin: {b.slug}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <button
            type="submit"
            disabled={creatingBouquet}
            className="px-3.5 py-1.5 rounded-lg bg-pink-600 hover:bg-pink-500 disabled:opacity-50 text-xs font-mono-tabular text-white flex items-center justify-center gap-1.5 cursor-pointer h-[34px]"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{creatingBouquet ? 'Membuat...' : 'Buat Buket'}</span>
          </button>
        </form>
      </section>

      {/* 2. ISOLATED ADMIN LIVE ENTRANCE PREVIEW LAUNCHER (ALL 7 ACTIONS) */}
      <section className="rounded-xl border border-pink-400/40 bg-[#120919] p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-display text-lg font-semibold text-white flex items-center gap-2">
              <Eye className="w-4 h-4 text-pink-400" />
              <span>Uji & Pratinjau Pengalaman Masuk (Terisolasi)</span>
            </h3>
            <p className="text-[11px] text-white/65 mt-0.5">
              Uji PIN draf, kegagalan palsu, salah PIN, hingga tirai bunga 3D tanpa memengaruhi
              pengunjung publik.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <button
            type="button"
            onClick={() => onLaunchPreviewAction('preview-lock')}
            className="px-3 py-2 rounded-lg bg-black/75 border border-white/15 hover:border-pink-400/60 text-[11px] font-mono-tabular text-white flex items-center gap-1.5 cursor-pointer"
          >
            <Lock className="w-3.5 h-3.5 text-pink-300 shrink-0" />
            <span className="truncate">Pratinjau Layar Kunci</span>
          </button>
          <button
            type="button"
            onClick={() => onLaunchPreviewAction('test-wrong')}
            className="px-3 py-2 rounded-lg bg-black/75 border border-white/15 hover:border-rose-400/60 text-[11px] font-mono-tabular text-rose-100 flex items-center gap-1.5 cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5 text-rose-400 shrink-0" />
            <span className="truncate">Uji PIN Salah</span>
          </button>
          <button
            type="button"
            onClick={() => onLaunchPreviewAction('test-fake')}
            className="px-3 py-2 rounded-lg bg-black/75 border border-white/15 hover:border-amber-400/60 text-[11px] font-mono-tabular text-amber-100 flex items-center gap-1.5 cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-300 shrink-0" />
            <span className="truncate">Uji Kegagalan Palsu</span>
          </button>
          <button
            type="button"
            onClick={() => onLaunchPreviewAction('test-success')}
            className="px-3 py-2 rounded-lg bg-black/75 border border-white/15 hover:border-emerald-400/60 text-[11px] font-mono-tabular text-emerald-100 flex items-center gap-1.5 cursor-pointer"
          >
            <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span className="truncate">Uji PIN Benar</span>
          </button>
          <button
            type="button"
            onClick={() => onLaunchPreviewAction('replay-curtain')}
            className="px-3 py-2 rounded-lg bg-pink-600/20 border border-pink-400/45 hover:bg-pink-600/35 text-[11px] font-mono-tabular text-pink-100 flex items-center gap-1.5 cursor-pointer"
          >
            <Flower2 className="w-3.5 h-3.5 text-pink-300 shrink-0" />
            <span className="truncate">Putar Ulang Tirai Bunga</span>
          </button>
          <button
            type="button"
            onClick={() => onLaunchPreviewAction('replay-full')}
            className="px-3 py-2 rounded-lg bg-pink-600 hover:bg-pink-500 text-[11px] font-mono-tabular text-white flex items-center gap-1.5 cursor-pointer col-span-2 sm:col-span-2"
          >
            <Play className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">Putar Ulang Pembukaan Lengkap</span>
          </button>
          <button
            type="button"
            onClick={() => onLaunchPreviewAction('reset-preview')}
            className="px-3 py-2 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] border border-white/15 text-[11px] font-mono-tabular text-white/85 flex items-center gap-1.5 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">Reset Pratinjau</span>
          </button>
        </div>
      </section>

      {/* 3. SECRET 6-DIGIT PIN CONFIGURATION */}
      <section className="rounded-xl border border-white/12 bg-[#0e0914] p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-display text-lg font-semibold text-white flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-pink-400" />
            <span>Konfigurasi PIN Rahasia 6 Digit</span>
          </h3>

          <label className="flex items-center gap-2 text-xs font-mono-tabular text-white cursor-pointer">
            <span>Aktifkan Layar Kunci PIN</span>
            <input
              type="checkbox"
              checked={ent.pinEnabled}
              onChange={(e) =>
                onUpdateEntrance((prev) => ({ ...prev, pinEnabled: e.target.checked }))
              }
              className="accent-pink-500 w-4 h-4"
            />
          </label>
        </div>

        {/* Status pills (plain concise badges, never exposing PIN) */}
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono-tabular">
          <span
            className={`px-2.5 py-1 rounded-md border ${
              pinStatus?.hasDraftPin
                ? 'bg-emerald-500/15 border-emerald-400/35 text-emerald-200'
                : 'bg-amber-500/15 border-amber-400/35 text-amber-200'
            }`}
          >
            {pinStatus?.hasDraftPin ? 'PIN Draf Terpasang (Terenkripsi)' : 'PIN Draf Belum Diatur'}
          </span>
          <span
            className={`px-2.5 py-1 rounded-md border ${
              pinStatus?.hasPublishedPin
                ? 'bg-pink-500/15 border-pink-400/35 text-pink-200'
                : 'bg-white/5 border-white/15 text-white/60'
            }`}
          >
            {pinStatus?.hasPublishedPin ? 'PIN Publik Aktif' : 'Belum Ada PIN Publik'}
          </span>
          {pinStatus?.pinDraftPendingPublish && (
            <span className="px-2.5 py-1 rounded-md border bg-amber-500/20 border-amber-400/45 text-amber-200">
              PIN Baru Menunggu Publikasi
            </span>
          )}
        </div>

        <form
          onSubmit={handlePinSubmit}
          className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-3 items-end pt-1"
        >
          <div>
            <label className="block text-[11px] font-mono-tabular text-white/75 mb-1">
              PIN Rahasia Baru (6 Digit Angka)
            </label>
            <div className="relative">
              <KeyRound className="w-3.5 h-3.5 text-pink-400/70 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={pinInput}
                onChange={(e) => setPinInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="••••••"
                className="w-full pl-9 pr-3 py-2 rounded-lg bg-black border border-white/15 focus:border-pink-400 text-xs font-mono-tabular tracking-[0.3em] text-white outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-mono-tabular text-white/75 mb-1">
              Konfirmasi PIN 6 Digit
            </label>
            <input
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={confirmPinInput}
              onChange={(e) => setConfirmPinInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="••••••"
              className="w-full px-3 py-2 rounded-lg bg-black border border-white/15 focus:border-pink-400 text-xs font-mono-tabular tracking-[0.3em] text-white outline-none"
            />
          </div>

          <button
            type="submit"
            disabled={savingPin || pinInput.length !== 6 || confirmPinInput.length !== 6}
            className="px-4 py-2 rounded-lg bg-pink-600 hover:bg-pink-500 disabled:opacity-45 text-xs font-mono-tabular font-medium text-white cursor-pointer h-[36px]"
          >
            {savingPin ? 'Menyimpan...' : 'Simpan PIN Draf'}
          </button>
        </form>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2 border-t border-white/10">
          <div>
            <div className="flex justify-between text-[11px] font-mono-tabular text-white/75 mb-1">
              <span>Batas Percobaan Salah</span>
              <span>{ent.maxAttempts}x</span>
            </div>
            <input
              type="range"
              min={3}
              max={20}
              step={1}
              value={ent.maxAttempts}
              onChange={(e) =>
                onUpdateEntrance((prev) => ({
                  ...prev,
                  maxAttempts: parseInt(e.target.value, 10),
                }))
              }
              className="romantic-slider w-full"
            />
          </div>

          <div>
            <div className="flex justify-between text-[11px] font-mono-tabular text-white/75 mb-1">
              <span>Jeda Tunggu Saat Terkunci</span>
              <span>{ent.lockoutMinutes} mnt</span>
            </div>
            <input
              type="range"
              min={1}
              max={30}
              step={1}
              value={ent.lockoutMinutes}
              onChange={(e) =>
                onUpdateEntrance((prev) => ({
                  ...prev,
                  lockoutMinutes: parseInt(e.target.value, 10),
                }))
              }
              className="romantic-slider w-full"
            />
          </div>

          <div>
            <div className="flex justify-between text-[11px] font-mono-tabular text-white/75 mb-1">
              <span>Durasi Sesi Terbuka</span>
              <span>
                {ent.sessionDurationMinutes === 0
                  ? 'Kunci tiap muat ulang'
                  : `${ent.sessionDurationMinutes} mnt`}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={240}
              step={15}
              value={ent.sessionDurationMinutes}
              onChange={(e) =>
                onUpdateEntrance((prev) => ({
                  ...prev,
                  sessionDurationMinutes: parseInt(e.target.value, 10),
                }))
              }
              className="romantic-slider w-full"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <label className="flex items-center justify-between text-xs text-white/85 cursor-pointer bg-black/45 px-3 py-2 rounded-lg border border-white/10">
            <span>Kirim otomatis di digit ke-6</span>
            <input
              type="checkbox"
              checked={ent.lockScreen.autoSubmit}
              onChange={(e) => updateLockScreen({ autoSubmit: e.target.checked })}
              className="accent-pink-500 w-4 h-4"
            />
          </label>
          <label className="flex items-center justify-between text-xs text-white/85 cursor-pointer bg-black/45 px-3 py-2 rounded-lg border border-white/10">
            <span>Tampilkan tombol Buka</span>
            <input
              type="checkbox"
              checked={ent.lockScreen.showUnlockButton}
              onChange={(e) => updateLockScreen({ showUnlockButton: e.target.checked })}
              className="accent-pink-500 w-4 h-4"
            />
          </label>
          <label className="flex items-center justify-between text-xs text-white/85 cursor-pointer bg-black/45 px-3 py-2 rounded-lg border border-white/10">
            <span>Sembunyikan angka (titik ●)</span>
            <input
              type="checkbox"
              checked={ent.lockScreen.maskInput}
              onChange={(e) => updateLockScreen({ maskInput: e.target.checked })}
              className="accent-pink-500 w-4 h-4"
            />
          </label>
        </div>
      </section>

      {/* 4. PLAYFUL FAKE FAILURE + GENUINE WRONG PIN ANIMATIONS */}
      <section className="rounded-xl border border-white/12 bg-[#0e0914] p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-display text-lg font-semibold text-white flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-pink-400" />
              <span>Lelucon Kegagalan Palsu & Animasi PIN Salah</span>
            </h3>
            <p className="text-[11px] text-white/60">
              Saat pengunjung memasukkan PIN yang BENAR pertama kali, tampilkan godaan lucu terlebih
              dahulu sebelum terbuka pada percobaan berikutnya.
            </p>
          </div>
          <button
            type="button"
            onClick={onResetVisitorFakeFailure}
            className="px-3 py-1.5 rounded-lg border border-white/15 hover:border-pink-400/50 text-[11px] font-mono-tabular text-pink-200 flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className="w-3 h-3" />
            <span>
              Reset Status Pengunjung ({pinStatus?.fakeFailureVisitorCount ?? 0})
            </span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-black/45 p-3 rounded-xl border border-white/10">
          <label className="flex items-center justify-between text-xs text-white cursor-pointer">
            <span>Aktifkan Kegagalan Palsu Pertama</span>
            <input
              type="checkbox"
              checked={ent.fakeFailure.enabled}
              onChange={(e) =>
                onUpdateEntrance((prev) => ({
                  ...prev,
                  fakeFailure: { ...prev.fakeFailure, enabled: e.target.checked },
                }))
              }
              className="accent-pink-500 w-4 h-4"
            />
          </label>

          <div>
            <div className="flex justify-between text-[11px] font-mono-tabular text-white/75 mb-1">
              <span>Jumlah Godaan Palsu</span>
              <span>{ent.fakeFailure.count}x</span>
            </div>
            <input
              type="range"
              min={1}
              max={3}
              step={1}
              value={ent.fakeFailure.count}
              onChange={(e) =>
                onUpdateEntrance((prev) => ({
                  ...prev,
                  fakeFailure: { ...prev.fakeFailure, count: parseInt(e.target.value, 10) },
                }))
              }
              className="romantic-slider w-full"
            />
          </div>
        </div>

        <FailureAnimEditor
          title="Konfigurasi Animasi Kegagalan Palsu Pertama"
          subtitle="Muncul ketika pengunjung pertama kali memasukkan PIN yang benar."
          value={ent.fakeFailure.anim}
          presets={DEFAULT_FAKE_FAILURE_MESSAGES}
          onChange={(anim) =>
            onUpdateEntrance((prev) => ({
              ...prev,
              fakeFailure: { ...prev.fakeFailure, anim },
            }))
          }
        />

        <FailureAnimEditor
          title="Konfigurasi Animasi PIN Salah Asli"
          subtitle="Muncul ketika pengunjung benar-benar memasukkan kombinasi 6 digit yang keliru."
          value={ent.wrongPinAnim}
          presets={DEFAULT_WRONG_PIN_MESSAGES}
          onChange={(wrongPinAnim) => onUpdateEntrance((prev) => ({ ...prev, wrongPinAnim }))}
        />
      </section>

      {/* 5. LOCK SCREEN VISUAL CUSTOMIZATION */}
      <section className="rounded-xl border border-white/12 bg-[#0e0914] p-4 space-y-4">
        <h3 className="font-display text-lg font-semibold text-white flex items-center gap-2">
          <Palette className="w-4 h-4 text-pink-400" />
          <span>Desain & Atmosfer Layar Kunci</span>
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] font-mono-tabular text-white/75 mb-1">
              Judul Layar Kunci
            </label>
            <input
              type="text"
              value={ent.lockScreen.heading}
              onChange={(e) => updateLockScreen({ heading: e.target.value })}
              maxLength={120}
              className="w-full px-3 py-1.5 rounded-lg bg-black border border-white/15 focus:border-pink-400 text-xs text-white outline-none"
            />
          </div>
          <div>
            <label className="block text-[11px] font-mono-tabular text-white/75 mb-1">
              Deskripsi Singkat
            </label>
            <input
              type="text"
              value={ent.lockScreen.description}
              onChange={(e) => updateLockScreen({ description: e.target.value })}
              maxLength={200}
              className="w-full px-3 py-1.5 rounded-lg bg-black border border-white/15 focus:border-pink-400 text-xs text-white outline-none"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <label className="block text-[11px] font-mono-tabular text-white/75 mb-1">
              Aksen & Glow
            </label>
            <input
              type="color"
              value={ent.lockScreen.accentColor}
              onChange={(e) => updateLockScreen({ accentColor: e.target.value })}
              className="w-full h-8 rounded bg-black border border-white/15 cursor-pointer"
            />
          </div>
          <div>
            <label className="block text-[11px] font-mono-tabular text-white/75 mb-1">
              Garis Kotak PIN
            </label>
            <input
              type="color"
              value={ent.lockScreen.inputBorderColor}
              onChange={(e) => updateLockScreen({ inputBorderColor: e.target.value })}
              className="w-full h-8 rounded bg-black border border-white/15 cursor-pointer"
            />
          </div>
          <div>
            <label className="block text-[11px] font-mono-tabular text-white/75 mb-1">
              Warna Teks Utama
            </label>
            <input
              type="color"
              value={ent.lockScreen.textColor}
              onChange={(e) => updateLockScreen({ textColor: e.target.value })}
              className="w-full h-8 rounded bg-black border border-white/15 cursor-pointer"
            />
          </div>
          <div>
            <label className="block text-[11px] font-mono-tabular text-white/75 mb-1">
              Warna Latar
            </label>
            <input
              type="color"
              value={ent.lockScreen.backgroundColor}
              onChange={(e) => updateLockScreen({ backgroundColor: e.target.value })}
              className="w-full h-8 rounded bg-black border border-white/15 cursor-pointer"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-[11px] font-mono-tabular text-white/75 mb-1">
              Jenis Huruf Judul
            </label>
            <select
              value={ent.lockScreen.fontFamily}
              onChange={(e) =>
                updateLockScreen({
                  fontFamily: e.target.value as LockScreenUiConfig['fontFamily'],
                })
              }
              className="w-full px-2.5 py-1.5 rounded-lg bg-black border border-white/15 text-xs text-white outline-none"
            >
              <option value="editorial">Editorial Romantis</option>
              <option value="mono">Terminal Monospace</option>
              <option value="modern">Modern Minimal</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-mono-tabular text-white/75 mb-1">
              Ukuran Kotak PIN
            </label>
            <select
              value={ent.lockScreen.inputSize}
              onChange={(e) =>
                updateLockScreen({
                  inputSize: e.target.value as LockScreenUiConfig['inputSize'],
                })
              }
              className="w-full px-2.5 py-1.5 rounded-lg bg-black border border-white/15 text-xs text-white outline-none"
            >
              <option value="sm">Ringkas</option>
              <option value="md">Sedang (Standar)</option>
              <option value="lg">Besar</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-mono-tabular text-white/75 mb-1">
              Jarak Kotak PIN
            </label>
            <select
              value={ent.lockScreen.inputSpacing}
              onChange={(e) =>
                updateLockScreen({
                  inputSpacing: e.target.value as LockScreenUiConfig['inputSpacing'],
                })
              }
              className="w-full px-2.5 py-1.5 rounded-lg bg-black border border-white/15 text-xs text-white outline-none"
            >
              <option value="tight">Rapat</option>
              <option value="normal">Seimbang</option>
              <option value="wide">Lega</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
          <div>
            <div className="flex justify-between text-[11px] font-mono-tabular text-white/75 mb-1">
              <span>Kepadatan Kelopak Melayang</span>
              <span>{ent.lockScreen.petalDensity}</span>
            </div>
            <input
              type="range"
              min={0}
              max={45}
              step={1}
              value={ent.lockScreen.petalDensity}
              onChange={(e) =>
                updateLockScreen({ petalDensity: parseInt(e.target.value, 10) })
              }
              className="romantic-slider w-full"
            />
          </div>
          <div>
            <div className="flex justify-between text-[11px] font-mono-tabular text-white/75 mb-1">
              <span>Kecepatan Kelopak Layar Kunci</span>
              <span>{ent.lockScreen.animationIntensity.toFixed(1)}x</span>
            </div>
            <input
              type="range"
              min={0.3}
              max={2.0}
              step={0.1}
              value={ent.lockScreen.animationIntensity}
              onChange={(e) =>
                updateLockScreen({ animationIntensity: parseFloat(e.target.value) })
              }
              className="romantic-slider w-full"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <label className="flex items-center justify-between text-xs text-white/85 cursor-pointer bg-black/45 px-3 py-2 rounded-lg border border-white/10">
            <span>Tampilkan Bintang</span>
            <input
              type="checkbox"
              checked={ent.lockScreen.showStars}
              onChange={(e) => updateLockScreen({ showStars: e.target.checked })}
              className="accent-pink-500 w-4 h-4"
            />
          </label>
          <label className="flex items-center justify-between text-xs text-white/85 cursor-pointer bg-black/45 px-3 py-2 rounded-lg border border-white/10">
            <span>Tampilkan Bulan</span>
            <input
              type="checkbox"
              checked={ent.lockScreen.showMoon}
              onChange={(e) => updateLockScreen({ showMoon: e.target.checked })}
              className="accent-pink-500 w-4 h-4"
            />
          </label>
          <label className="flex items-center justify-between text-xs text-white/85 cursor-pointer bg-black/45 px-3 py-2 rounded-lg border border-white/10">
            <span>Ornamen Bunga Sudut</span>
            <input
              type="checkbox"
              checked={ent.lockScreen.showFloralDecor}
              onChange={(e) => updateLockScreen({ showFloralDecor: e.target.checked })}
              className="accent-pink-500 w-4 h-4"
            />
          </label>
        </div>
      </section>

      {/* 6. MASSIVE 3D FLOWER CURTAIN REVEAL SETTINGS */}
      <section className="rounded-xl border border-white/12 bg-[#0e0914] p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-display text-lg font-semibold text-white flex items-center gap-2">
            <Layers className="w-4 h-4 text-pink-400" />
            <span>Tirai Bunga 3D Pembuka (Flower Curtain)</span>
          </h3>
          <label className="flex items-center gap-2 text-xs font-mono-tabular text-white cursor-pointer">
            <span>Aktifkan Tirai Bunga</span>
            <input
              type="checkbox"
              checked={ent.curtain.enabled}
              onChange={(e) => updateCurtain({ enabled: e.target.checked })}
              className="accent-pink-500 w-4 h-4"
            />
          </label>
        </div>

        {/* Density Presets */}
        <div>
          <label className="block text-[11px] font-mono-tabular text-white/75 mb-1.5">
            Preset Kepadatan Tirai
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {DENSITY_PRESETS.map((preset) => {
              const active = ent.curtain.density === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() =>
                    updateCurtain({
                      density: preset.id,
                      flowerCount: preset.count,
                      layers: preset.layers,
                    })
                  }
                  className={`py-2 px-2.5 rounded-lg border text-xs font-mono-tabular cursor-pointer transition-colors ${
                    active
                      ? 'bg-pink-600/25 border-pink-400 text-pink-100'
                      : 'bg-black/50 border-white/10 text-white/70 hover:text-white'
                  }`}
                >
                  <div>{preset.label}</div>
                  <div className="text-[10px] opacity-65">{preset.count} bunga</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Color Palette for Curtain Blossoms */}
        <div>
          <label className="block text-[11px] font-mono-tabular text-white/75 mb-1.5">
            Palet Warna Kelopak Tirai ({ent.curtain.flowerColors.length} warna)
          </label>
          <div className="flex flex-wrap items-center gap-2">
            {ent.curtain.flowerColors.map((col, idx) => (
              <div
                key={`${col}-${idx}`}
                className="flex items-center gap-1 bg-black/60 border border-white/15 rounded-lg p-1"
              >
                <input
                  type="color"
                  value={col}
                  onChange={(e) => {
                    const next = [...ent.curtain.flowerColors];
                    next[idx] = e.target.value;
                    updateCurtain({ flowerColors: next });
                  }}
                  className="w-6 h-6 rounded bg-transparent cursor-pointer"
                />
                {ent.curtain.flowerColors.length > 1 && (
                  <button
                    type="button"
                    onClick={() =>
                      updateCurtain({
                        flowerColors: ent.curtain.flowerColors.filter((_, i) => i !== idx),
                      })
                    }
                    className="text-white/50 hover:text-rose-300 px-1 text-xs cursor-pointer"
                    aria-label="Hapus warna"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            {ent.curtain.flowerColors.length < 7 && (
              <div className="flex items-center gap-1">
                <input
                  type="color"
                  value={newCurtainColor}
                  onChange={(e) => setNewCurtainColor(e.target.value)}
                  className="w-7 h-7 rounded bg-black border border-white/15 cursor-pointer"
                />
                <button
                  type="button"
                  onClick={() =>
                    updateCurtain({
                      flowerColors: [...ent.curtain.flowerColors, newCurtainColor],
                    })
                  }
                  className="px-2.5 py-1 rounded-lg border border-pink-400/35 hover:bg-pink-500/20 text-[11px] font-mono-tabular text-pink-200 cursor-pointer"
                >
                  + Warna
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <div className="flex justify-between text-[11px] font-mono-tabular text-white/75 mb-1">
              <span>Jumlah Bunga Tirai</span>
              <span>{ent.curtain.flowerCount}</span>
            </div>
            <input
              type="range"
              min={80}
              max={360}
              step={10}
              value={ent.curtain.flowerCount}
              onChange={(e) => updateCurtain({ flowerCount: parseInt(e.target.value, 10) })}
              className="romantic-slider w-full"
            />
          </div>

          <div>
            <div className="flex justify-between text-[11px] font-mono-tabular text-white/75 mb-1">
              <span>Jumlah Lapisan Kedalaman</span>
              <span>{ent.curtain.layers} lapis</span>
            </div>
            <input
              type="range"
              min={2}
              max={5}
              step={1}
              value={ent.curtain.layers}
              onChange={(e) => updateCurtain({ layers: parseInt(e.target.value, 10) })}
              className="romantic-slider w-full"
            />
          </div>

          <div>
            <div className="flex justify-between text-[11px] font-mono-tabular text-white/75 mb-1">
              <span>Durasi Tirai Terbuka</span>
              <span>{ent.curtain.durationSec.toFixed(1)} dtk</span>
            </div>
            <input
              type="range"
              min={2.4}
              max={8.5}
              step={0.2}
              value={ent.curtain.durationSec}
              onChange={(e) => updateCurtain({ durationSec: parseFloat(e.target.value) })}
              className="romantic-slider w-full"
            />
          </div>

          <div>
            <div className="flex justify-between text-[11px] font-mono-tabular text-white/75 mb-1">
              <span>Kecepatan & Kurva Terbuka</span>
              <span>{ent.curtain.openingSpeed.toFixed(2)}x</span>
            </div>
            <div className="flex gap-2 items-center">
              <input
                type="range"
                min={0.5}
                max={2.0}
                step={0.05}
                value={ent.curtain.openingSpeed}
                onChange={(e) => updateCurtain({ openingSpeed: parseFloat(e.target.value) })}
                className="romantic-slider w-1/2"
              />
              <select
                value={ent.curtain.easing}
                onChange={(e) =>
                  updateCurtain({ easing: e.target.value as CurtainEasingMode })
                }
                className="w-1/2 px-2 py-1 rounded-lg bg-black border border-white/15 text-[11px] text-white outline-none"
              >
                <option value="silk-dramatic">Sutera Dramatis</option>
                <option value="ease-out-cubic">Halus Cepat Awal</option>
                <option value="ease-in-out-sine">Gelombang Lembut</option>
              </select>
            </div>
          </div>

          <div>
            <div className="flex justify-between text-[11px] font-mono-tabular text-white/75 mb-1">
              <span>Jarak Belahan Kiri / Kanan</span>
              <span>{ent.curtain.separationDistance.toFixed(2)}x</span>
            </div>
            <input
              type="range"
              min={0.7}
              max={1.8}
              step={0.05}
              value={ent.curtain.separationDistance}
              onChange={(e) =>
                updateCurtain({ separationDistance: parseFloat(e.target.value) })
              }
              className="romantic-slider w-full"
            />
          </div>

          <div>
            <div className="flex justify-between text-[11px] font-mono-tabular text-white/75 mb-1">
              <span>Rotasi & Skala Bunga</span>
              <span>
                {ent.curtain.rotationIntensity.toFixed(1)}x ·{' '}
                {ent.curtain.minFlowerSize.toFixed(1)}–{ent.curtain.maxFlowerSize.toFixed(1)}
              </span>
            </div>
            <div className="flex gap-2">
              <input
                type="range"
                min={0}
                max={2.0}
                step={0.1}
                value={ent.curtain.rotationIntensity}
                onChange={(e) =>
                  updateCurtain({ rotationIntensity: parseFloat(e.target.value) })
                }
                className="romantic-slider w-1/2"
              />
              <input
                type="range"
                min={0.9}
                max={2.4}
                step={0.05}
                value={ent.curtain.maxFlowerSize}
                onChange={(e) => {
                  const maxVal = parseFloat(e.target.value);
                  updateCurtain({
                    maxFlowerSize: maxVal,
                    minFlowerSize: Number(Math.min(ent.curtain.minFlowerSize, maxVal * 0.65).toFixed(2)),
                  });
                }}
                className="romantic-slider w-1/2"
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
          <label className="flex items-center justify-between text-xs text-white/85 cursor-pointer bg-black/45 px-3 py-2 rounded-lg border border-white/10">
            <span>Partikel Debu Bintang Tirai</span>
            <input
              type="checkbox"
              checked={ent.curtain.particleEffects}
              onChange={(e) => updateCurtain({ particleEffects: e.target.checked })}
              className="accent-pink-500 w-4 h-4"
            />
          </label>
          <label className="flex items-center justify-between text-xs text-white/85 cursor-pointer bg-black/45 px-3 py-2 rounded-lg border border-white/10">
            <span>Rakit Buket Otomatis Setelah Tirai Terbuka</span>
            <input
              type="checkbox"
              checked={ent.curtain.assembleBouquetAfter}
              onChange={(e) => updateCurtain({ assembleBouquetAfter: e.target.checked })}
              className="accent-pink-500 w-4 h-4"
            />
          </label>
        </div>
      </section>
    </div>
  );
}
