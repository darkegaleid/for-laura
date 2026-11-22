import {
  ChevronDown,
  ChevronUp,
  Download,
  Film,
  Flower2,
  Images,
  Lock,
  Maximize2,
  Minimize2,
  Moon,
  Music,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Sparkles,
  Square,
  Stars,
  Video,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AdminDashboard } from './components/AdminDashboard';
import {
  BouquetViewport,
  type BouquetViewportHandle,
  type CurtainStateSnapshot,
  type EntranceStateSnapshot,
} from './components/BouquetViewport';
import { GiftTagModal } from './components/GiftTagModal';
import { KeepsakeLetterModal } from './components/KeepsakeLetterModal';
import { PhotoGalleryModal } from './components/PhotoGalleryModal';
import { PhotoLightboxModal } from './components/PhotoLightboxModal';
import { PinLockScreen, type PinVerifyOutcome } from './components/PinLockScreen';
import { PixelEqualizerWidget } from './components/PixelEqualizerWidget';
import type {
  BouquetSiteConfig,
  ClickedPixelInfo,
  ProcessedAtlasResult,
  PublicEntranceStateResponse,
  SelectedFlowerDetail,
} from './types/bouquet';
import { BouquetAudioController } from './utils/ambientAudio';
import {
  createDefaultBouquetConfig,
  createDefaultEntranceConfig,
} from './utils/defaultBouquetConfig';
import {
  buildPhotoTileAtlas,
  createStarterPhotoSources,
  loadImageSourceFromPhoto,
  type LoadedImageSource,
} from './utils/photoProcessor';

interface RouteInfo {
  mode: 'public' | 'admin';
  slug?: string;
}

function getRouteInfo(): RouteInfo {
  const pathname = window.location.pathname;
  if (pathname.startsWith('/admin')) {
    return { mode: 'admin' };
  }
  const giftMatch = pathname.match(/^\/gift\/([^/]+)/);
  if (giftMatch?.[1]) {
    try {
      return { mode: 'public', slug: decodeURIComponent(giftMatch[1]) };
    } catch {
      return { mode: 'public', slug: giftMatch[1] };
    }
  }
  const params = new URLSearchParams(window.location.search);
  const queryGift = params.get('gift')?.trim();
  return { mode: 'public', slug: queryGift || undefined };
}

function PublicBouquetView({
  requestedSlug,
  onNavigateAdmin,
  onNavigateHome,
}: {
  requestedSlug?: string;
  onNavigateAdmin: () => void;
  onNavigateHome: () => void;
}) {
  const viewportRef = useRef<BouquetViewportHandle | null>(null);
  const audioRef = useRef<BouquetAudioController | null>(null);
  const hasAutoStartedMusicRef = useRef(false);
  const userPausedMusicRef = useRef(false);
  const lastConfigStampRef = useRef<string>('');
  const unlockTokenRef = useRef<string | null>(null);

  // Entrance & Lock Gate state
  const [entrancePhase, setEntrancePhase] = useState<
    'checking' | 'not-found' | 'locked' | 'unlocked'
  >('checking');
  const [entranceMeta, setEntranceMeta] = useState<PublicEntranceStateResponse | null>(null);
  const [resolvedSlug, setResolvedSlug] = useState<string | undefined>(requestedSlug);
  const [curtainState, setCurtainState] = useState<CurtainStateSnapshot>({
    active: false,
    progress: 1,
    phase: 'idle',
  });
  const [shouldAutoPlayOnReady, setShouldAutoPlayOnReady] = useState(true);

  const [siteConfig, setSiteConfig] = useState<BouquetSiteConfig>(() =>
    createDefaultBouquetConfig(),
  );
  const [photoSources, setPhotoSources] = useState<LoadedImageSource[]>(() =>
    createStarterPhotoSources(),
  );
  const [atlas, setAtlas] = useState<ProcessedAtlasResult | null>(null);

  // View-only viewer states (does not modify persisted site config)
  const [autoRotateOverride, setAutoRotateOverride] = useState<boolean | undefined>(undefined);
  const [pausedOverride, setPausedOverride] = useState(false);
  const [showStarsOverride, setShowStarsOverride] = useState<boolean | undefined>(undefined);
  const [showMoonOverride, setShowMoonOverride] = useState<boolean | undefined>(undefined);
  const [showPetalsOverride, setShowPetalsOverride] = useState<boolean | undefined>(undefined);
  const [entranceState, setEntranceState] = useState<EntranceStateSnapshot>({
    isPlaying: true,
    progress: 0,
    stage: 1,
  });

  const [totalTiles, setTotalTiles] = useState(0);
  const [zoomPercent, setZoomPercent] = useState(45);
  const [hoveredPixel, setHoveredPixel] = useState<ClickedPixelInfo | null>(null);
  const [hoveredGiftTag, setHoveredGiftTag] = useState(false);
  const [selectedFlower, setSelectedFlower] = useState<SelectedFlowerDetail | null>(null);

  // Lightbox, Gallery, Tag & Letter Modals
  const [lightboxPhotoId, setLightboxPhotoId] = useState<string | null>(null);
  const [lightboxPixelInfo, setLightboxPixelInfo] = useState<ClickedPixelInfo | null>(null);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [letterOpen, setLetterOpen] = useState(false);
  const [tagModalOpen, setTagModalOpen] = useState(false);

  // View-only UI toggles
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [mobileMusicOpen, setMobileMusicOpen] = useState(false);
  const [videoMenuOpen, setVideoMenuOpen] = useState(false);
  const [isRecordingVideo, setIsRecordingVideo] = useState(false);
  const [videoProgress, setVideoProgress] = useState(0);
  const videoCancelledRef = useRef(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Music state
  const [isMusicPlaying, setIsMusicPlaying] = useState(false);
  const [musicVolume, setMusicVolume] = useState(0.55);
  const [trackName, setTrackName] = useState('Starlight Chimes (Built-in)');

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    window.setTimeout(() => {
      setToastMessage((curr) => (curr === msg ? null : curr));
    }, 2800);
  }, []);

  // Poll published bouquet state from backend ONLY once unlocked
  const fetchPublishedConfig = useCallback(
    async (slugOverride?: string) => {
      const targetSlug = slugOverride ?? resolvedSlug;
      try {
        const headers: Record<string, string> = {};
        if (unlockTokenRef.current) {
          headers.Authorization = `Bearer ${unlockTokenRef.current}`;
        }
        const url = targetSlug
          ? `/api/public/bouquet?slug=${encodeURIComponent(targetSlug)}`
          : '/api/public/bouquet';
        const res = await fetch(url, { cache: 'no-store', headers });
        if (res.status === 401) {
          unlockTokenRef.current = null;
          setEntrancePhase('locked');
          return;
        }
        if (!res.ok) return;
        const incoming = (await res.json()) as BouquetSiteConfig;
        const stamp = `${incoming.version}:${incoming.updatedAt}`;
        if (stamp !== lastConfigStampRef.current) {
          lastConfigStampRef.current = stamp;
          setSiteConfig(incoming);
          setMusicVolume(incoming.music.defaultVolume ?? 0.55);
          setAutoRotateOverride(undefined);
          setShowStarsOverride(undefined);
          setShowMoonOverride(undefined);
          setShowPetalsOverride(undefined);
        }
      } catch {
        // Retain last valid bouquet state if transient network hiccup occurs
      }
    },
    [resolvedSlug],
  );

  // Initial Entrance Check (before loading or showing protected bouquet data)
  useEffect(() => {
    let cancelled = false;
    unlockTokenRef.current = null;
    lastConfigStampRef.current = '';
    setEntrancePhase('checking');

    const checkEntrance = async () => {
      try {
        const url = requestedSlug
          ? `/api/public/entrance?slug=${encodeURIComponent(requestedSlug)}`
          : '/api/public/entrance';
        const res = await fetch(url, { cache: 'no-store' });
        const data = (await res.json()) as PublicEntranceStateResponse;
        if (cancelled) return;

        setEntranceMeta(data);
        setResolvedSlug(data.slug);

        if (res.status === 404 || !data.exists) {
          setEntrancePhase('not-found');
          return;
        }

        if (!data.pinRequired || data.alreadyUnlocked) {
          setShouldAutoPlayOnReady(true);
          await fetchPublishedConfig(data.slug);
          if (!cancelled) {
            setEntrancePhase('unlocked');
          }
          return;
        }

        // Stay locked cleanly without fetching any bouquet photos, flowers, or messages
        setShouldAutoPlayOnReady(false);
        setEntrancePhase('locked');
      } catch {
        if (!cancelled) {
          setEntrancePhase('locked');
        }
      }
    };

    checkEntrance();
    return () => {
      cancelled = true;
    };
  }, [requestedSlug, fetchPublishedConfig]);

  // Keep published config updated only while unlocked
  useEffect(() => {
    if (entrancePhase !== 'unlocked') return;
    const onFocus = () => fetchPublishedConfig();
    window.addEventListener('focus', onFocus);
    const intervalId = window.setInterval(() => fetchPublishedConfig(), 15000);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.clearInterval(intervalId);
    };
  }, [entrancePhase, fetchPublishedConfig]);

  // Initialize audio controller
  useEffect(() => {
    const ctrl = new BouquetAudioController();
    audioRef.current = ctrl;
    return () => {
      ctrl.dispose();
      audioRef.current = null;
    };
  }, []);

  // Sync audio controller when unlocked published music config changes
  useEffect(() => {
    if (entrancePhase !== 'unlocked') return;
    const ctrl = audioRef.current;
    if (!ctrl) return;
    ctrl.setVolume(siteConfig.music.defaultVolume ?? 0.55);
    if (siteConfig.music.mode === 'uploaded' && siteConfig.music.uploadedAudioUrl) {
      ctrl.loadRemoteAudioUrl(siteConfig.music.uploadedAudioUrl);
      setTrackName(siteConfig.music.uploadedAudioName || 'Romantic Soundtrack');
    } else {
      const name = ctrl.setBuiltinTrack(siteConfig.music.builtinTrackIndex ?? 0);
      setTrackName(name);
    }
  }, [
    entrancePhase,
    siteConfig.music.mode,
    siteConfig.music.builtinTrackIndex,
    siteConfig.music.uploadedAudioUrl,
    siteConfig.music.uploadedAudioName,
    siteConfig.music.defaultVolume,
  ]);

  // Load intact photos from unlocked published config & build GPU mosaic atlas
  useEffect(() => {
    if (entrancePhase !== 'unlocked') return;
    let cancelled = false;
    const photos = siteConfig.photos ?? [];
    if (photos.length === 0) {
      setPhotoSources(createStarterPhotoSources());
      return;
    }

    Promise.all(photos.map(loadImageSourceFromPhoto)).then((results) => {
      if (cancelled) return;
      const valid = results.filter((r): r is LoadedImageSource => r !== null);
      setPhotoSources(valid.length > 0 ? valid : createStarterPhotoSources());
    });

    return () => {
      cancelled = true;
    };
  }, [entrancePhase, siteConfig.photos]);

  useEffect(() => {
    if (entrancePhase !== 'unlocked') return;
    const caps = viewportRef.current?.getCapabilities() ?? {
      maxTextureSize: 2048,
      maxAnisotropy: 4,
    };
    const nextAtlas = buildPhotoTileAtlas(
      photoSources,
      caps.maxTextureSize,
      caps.maxAnisotropy,
    );
    setAtlas((prev) => {
      if (prev?.atlasTexture) prev.atlasTexture.dispose();
      return nextAtlas;
    });
  }, [entrancePhase, photoSources]);

  const handleFirstInteraction = useCallback(() => {
    if (entrancePhase !== 'unlocked') return;
    if (
      !siteConfig.music.autoPlayOnInteract ||
      hasAutoStartedMusicRef.current ||
      userPausedMusicRef.current
    ) {
      return;
    }
    hasAutoStartedMusicRef.current = true;
    const ctrl = audioRef.current;
    if (!ctrl) return;
    ctrl.play().then((started) => {
      if (started) setIsMusicPlaying(true);
    });
  }, [entrancePhase, siteConfig.music.autoPlayOnInteract]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (entrancePhase !== 'unlocked') return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key.toLowerCase() === 'h') {
        setDockCollapsed((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [entrancePhase]);

  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  // Verify 6-digit secret PIN with server (including server-side fake failure gate)
  const handleVerifyPin = useCallback(
    async (pin: string): Promise<PinVerifyOutcome> => {
      const res = await fetch('/api/public/pin/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: resolvedSlug,
          pin,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.unlocked && data.bouquet) {
        unlockTokenRef.current = data.unlockToken || null;
        const incoming = data.bouquet as BouquetSiteConfig;
        lastConfigStampRef.current = `${incoming.version}:${incoming.updatedAt}`;
        setSiteConfig(incoming);
        setMusicVolume(incoming.music.defaultVolume ?? 0.55);
        setAutoRotateOverride(undefined);
        setShowStarsOverride(undefined);
        setShowMoonOverride(undefined);
        setShowPetalsOverride(undefined);
        return { unlocked: true };
      }

      return {
        unlocked: false,
        lockedOut: Boolean(data.lockedOut),
        retryAfterSeconds: data.retryAfterSeconds,
        error: data.error,
        anim: data.anim,
      };
    },
    [resolvedSlug],
  );

  // Called once Lock Screen completes its brief rose-pink glow & heart confirmation
  const handleUnlockVisualComplete = useCallback(() => {
    setShouldAutoPlayOnReady(false);
    setEntrancePhase('unlocked');

    const curtain = siteConfig.entrance?.curtain ?? entranceMeta?.curtain ?? createDefaultEntranceConfig().curtain;
    window.requestAnimationFrame(() => {
      if (curtain.enabled) {
        viewportRef.current?.playFlowerCurtain({
          assembleAfter: curtain.assembleBouquetAfter,
        });
      } else if (curtain.assembleBouquetAfter) {
        viewportRef.current?.replayEntrance();
      }
    });
  }, [siteConfig.entrance?.curtain, entranceMeta?.curtain]);

  const handleClickPixel = useCallback((info: ClickedPixelInfo) => {
    setLightboxPhotoId(info.photoId);
    setLightboxPixelInfo(info);
  }, []);

  const handleToggleMusic = async () => {
    const ctrl = audioRef.current;
    if (!ctrl) return;
    hasAutoStartedMusicRef.current = true;
    if (isMusicPlaying) {
      userPausedMusicRef.current = true;
      ctrl.pause();
      setIsMusicPlaying(false);
    } else {
      userPausedMusicRef.current = false;
      const ok = await ctrl.play();
      setIsMusicPlaying(ok);
    }
  };

  const handleCycleTrack = async (delta: 1 | -1) => {
    const ctrl = audioRef.current;
    if (!ctrl) return;
    const nextName = ctrl.cycleBuiltInTrack(delta);
    setTrackName(nextName);
    if (!isMusicPlaying) {
      hasAutoStartedMusicRef.current = true;
      userPausedMusicRef.current = false;
      const ok = await ctrl.play();
      setIsMusicPlaying(ok);
    }
  };

  const handleVolumeChange = (val: number) => {
    setMusicVolume(val);
    audioRef.current?.setVolume(val);
  };

  const handleToggleFullscreen = async () => {
    handleFirstInteraction();
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      showToast('Fullscreen is restricted in this preview window');
    }
  };

  const handleSaveSnapshot = () => {
    handleFirstInteraction();
    const dataUrl = viewportRef.current?.captureSnapshot(siteConfig.text);
    if (!dataUrl) return;
    const link = document.createElement('a');
    link.download = 'pixel-flower-bouquet.png';
    link.href = dataUrl;
    link.click();
    showToast('Saved keepsake image');
  };

  const handleStartVideoDownload = (mode: 'intro' | 'loop') => {
    handleFirstInteraction();
    setVideoMenuOpen(false);
    setPausedOverride(false);
    videoCancelledRef.current = false;
    setVideoProgress(0);
    setIsRecordingVideo(true);

    const started = viewportRef.current?.startVideoRecording({
      mode,
      personalization: siteConfig.text,
      onProgress: (pct) => setVideoProgress(pct),
      onComplete: (blob, filename) => {
        setIsRecordingVideo(false);
        setVideoProgress(0);
        if (videoCancelledRef.current) {
          videoCancelledRef.current = false;
          return;
        }
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.setTimeout(() => URL.revokeObjectURL(url), 4000);
        showToast('Animation video downloaded');
      },
      onError: (msg) => {
        setIsRecordingVideo(false);
        setVideoProgress(0);
        showToast(msg || 'Could not record video');
      },
    });

    if (!started) {
      setIsRecordingVideo(false);
    }
  };

  const handleStopAndSaveVideo = () => {
    videoCancelledRef.current = false;
    viewportRef.current?.stopVideoRecording();
  };

  const handleCancelVideo = () => {
    videoCancelledRef.current = true;
    viewportRef.current?.stopVideoRecording();
    setIsRecordingVideo(false);
    setVideoProgress(0);
    showToast('Video recording cancelled');
  };

  const handleFocusNextLily = () => {
    const flowerCount = Math.max(1, siteConfig.flowers.length);
    const nextIdx = selectedFlower ? (selectedFlower.flowerIndex + 1) % flowerCount : 0;
    viewportRef.current?.focusFlower(nextIdx);
  };

  // Safe sky-only preview config while locked (contains zero bouquet secrets)
  const lockedSkyConfig = useMemo(() => {
    const base = createDefaultBouquetConfig();
    const sky = entranceMeta?.skyPreview;
    const lockUi = entranceMeta?.lockScreen;
    return {
      theme: {
        preset: 'romantic-pink' as const,
        backgroundColor: lockUi?.backgroundColor || sky?.backgroundColor || '#000000',
        lightingIntensity: 0.9,
      },
      animation: {
        ...base.animation,
        showStars: lockUi ? lockUi.showStars : (sky?.showStars ?? true),
        showScatteredStars: lockUi
          ? lockUi.showStars
          : (sky?.showScatteredStars ?? true),
        starColor: sky?.starColor || '#ffffff',
        starDensity: sky?.starDensity ?? 760,
        showMoon: lockUi ? lockUi.showMoon : (sky?.showMoon ?? true),
        moonStyle: sky?.moonStyle ?? 'full',
        moonColor: sky?.moonColor ?? '#f7f2fa',
        moonSize: sky?.moonSize ?? 1.18,
        moonPositionX: sky?.moonPositionX ?? -2.5,
        moonPositionY: sky?.moonPositionY ?? 5.1,
        moonGlowIntensity: sky?.moonGlowIntensity ?? 0.78,
        fallingPetalsCount: 0,
      },
    };
  }, [entranceMeta]);

  if (entrancePhase === 'checking') {
    return (
      <div className="w-screen h-screen bg-black flex items-center justify-center text-pink-200/75 font-mono-tabular text-xs">
        <span className="animate-pulse">Preparing starry sky...</span>
      </div>
    );
  }

  if (entrancePhase === 'not-found') {
    return (
      <div className="w-screen h-screen bg-black text-[#f9f4f7] flex flex-col items-center justify-center p-6 text-center space-y-4">
        <div className="w-12 h-12 rounded-full bg-pink-500/15 border border-pink-400/35 flex items-center justify-center text-pink-300 text-xl">
          ✿
        </div>
        <h1 className="font-display text-2xl sm:text-3xl font-semibold text-white">
          This Gift Bouquet Could Not Be Found
        </h1>
        <p className="text-xs sm:text-sm text-white/65 max-w-sm">
          The gift link you followed may have been moved or removed by its creator.
        </p>
        <div className="flex items-center gap-2.5 pt-2">
          <button
            type="button"
            onClick={onNavigateHome}
            className="px-4 py-2 rounded-xl bg-pink-600 hover:bg-pink-500 text-xs font-mono-tabular text-white cursor-pointer"
          >
            Open Main Bouquet
          </button>
          <button
            type="button"
            onClick={onNavigateAdmin}
            className="px-4 py-2 rounded-xl border border-white/15 hover:bg-white/10 text-xs font-mono-tabular text-white/80 cursor-pointer"
          >
            Admin Studio
          </button>
        </div>
      </div>
    );
  }

  const isLocked = entrancePhase === 'locked';
  const showPublicHud = entrancePhase === 'unlocked' && !curtainState.active;

  const effectiveAutoRotate =
    autoRotateOverride !== undefined ? autoRotateOverride : siteConfig.animation.autoRotate;
  const effectiveShowStars =
    showStarsOverride !== undefined ? showStarsOverride : (siteConfig.animation.showStars ?? true);
  const effectiveShowMoon =
    showMoonOverride !== undefined ? showMoonOverride : (siteConfig.animation.showMoon ?? true);
  const effectiveShowPetals = showPetalsOverride !== undefined ? showPetalsOverride : true;

  const allPhotos = photoSources.map((s) => s.photo);
  const lightboxIdx = lightboxPhotoId
    ? allPhotos.findIndex((p) => p.id === lightboxPhotoId)
    : -1;
  const activeLightboxPhoto = lightboxIdx >= 0 ? allPhotos[lightboxIdx] : null;

  const cardBgOpacity = siteConfig.text.cardBgOpacity ?? 0.85;
  const cardBorderCol = siteConfig.text.cardBorderColor || '#f472b6';
  const cardTextCol = siteConfig.text.cardTextColor || '#ffffff';
  const cardSizeClass =
    siteConfig.text.cardTextSize === 'lg'
      ? 'text-xs sm:text-sm'
      : siteConfig.text.cardTextSize === 'md'
        ? 'text-[11px] sm:text-[13px]'
        : 'text-[11px] sm:text-xs';

  return (
    <div
      className="relative w-screen h-screen overflow-hidden text-[#f9f4f7]"
      style={{
        backgroundColor: isLocked
          ? lockedSkyConfig.theme.backgroundColor
          : siteConfig.theme?.backgroundColor || '#000000',
      }}
      onPointerDownCapture={handleFirstInteraction}
    >
      {/* Full-Viewport 3D Starry Canvas */}
      <div className="absolute inset-0 z-0">
        <BouquetViewport
          ref={viewportRef}
          flowers={isLocked ? [] : siteConfig.flowers}
          photos={isLocked ? [] : siteConfig.photos}
          atlas={isLocked ? null : atlas}
          wrapConfig={siteConfig.wrap}
          animationConfig={isLocked ? lockedSkyConfig.animation : siteConfig.animation}
          curtainConfig={siteConfig.entrance?.curtain ?? entranceMeta?.curtain}
          themeConfig={isLocked ? lockedSkyConfig.theme : siteConfig.theme}
          ribbonText={isLocked ? '' : siteConfig.text.ribbonText}
          recipientName={isLocked ? '' : siteConfig.text.recipientName}
          lockedSkyOnly={isLocked}
          autoPlayEntrance={!isLocked && shouldAutoPlayOnReady && (siteConfig.animation.entranceEnabled ?? true)}
          autoRotateOverride={autoRotateOverride}
          pausedOverride={pausedOverride}
          showStarsOverride={isLocked ? undefined : showStarsOverride}
          showMoonOverride={isLocked ? undefined : showMoonOverride}
          showPetalsOverride={isLocked ? false : showPetalsOverride}
          onClickPixel={handleClickPixel}
          onHoverPixel={setHoveredPixel}
          onClickGiftTag={() => setTagModalOpen(true)}
          onHoverGiftTag={setHoveredGiftTag}
          onSelectFlower={setSelectedFlower}
          onEntranceStateChange={setEntranceState}
          onCurtainStateChange={setCurtainState}
          onZoomChange={setZoomPercent}
          onTotalTilesChange={setTotalTiles}
          onFirstInteract={handleFirstInteraction}
        />
      </div>

      {/* ROMANTIC 6-DIGIT SECRET PIN LOCK SCREEN */}
      {isLocked && entranceMeta && (
        <PinLockScreen
          ui={entranceMeta.lockScreen}
          hasPinConfigured={entranceMeta.hasPinConfigured}
          onSubmitPin={handleVerifyPin}
          onUnlockVisualComplete={handleUnlockVisualComplete}
          onNavigateAdmin={onNavigateAdmin}
        />
      )}

      {/* Subtle hovered pixel or gift tag readout above bottom dock */}
      {showPublicHud &&
      hoveredGiftTag &&
      !dockCollapsed &&
      !entranceState.isPlaying &&
      !isRecordingVideo &&
      !videoMenuOpen ? (
        <div className="hidden sm:block fixed bottom-[84px] left-1/2 -translate-x-1/2 z-20 pointer-events-none select-none px-3 py-1 rounded-lg bg-black/85 border border-pink-400/45 text-[11px] font-mono-tabular text-pink-200 whitespace-nowrap">
          Gift Tag · Klik untuk membaca kata-kata ♥
        </div>
      ) : (
        showPublicHud &&
        hoveredPixel &&
        !dockCollapsed &&
        !entranceState.isPlaying &&
        !isRecordingVideo &&
        !videoMenuOpen && (
          <div className="hidden sm:block fixed bottom-[84px] left-1/2 -translate-x-1/2 z-20 pointer-events-none select-none px-3 py-1 rounded-lg bg-black/85 border border-pink-400/35 text-[11px] font-mono-tabular text-pink-200 whitespace-nowrap">
            {hoveredPixel.flowerLabel} · Pixel #{hoveredPixel.pixelNumber}
          </div>
        )
      )}

      {/* Video Animation Download Menu Popover */}
      {showPublicHud && videoMenuOpen && !isRecordingVideo && !dockCollapsed && (
        <div
          role="dialog"
          aria-label="Download Animation Video Menu"
          className="fixed bottom-[86px] left-1/2 -translate-x-1/2 z-30 w-[90vw] max-w-xs rounded-xl bg-[#0b0610]/95 border border-pink-400/45 p-3 shadow-2xl space-y-2"
        >
          <div className="flex items-center justify-between border-b border-white/10 pb-2">
            <div className="flex items-center gap-1.5 text-xs font-mono-tabular text-pink-200">
              <Film className="w-3.5 h-3.5 text-pink-400" />
              <span>Download Video Animasi</span>
            </div>
            <button
              type="button"
              onClick={() => setVideoMenuOpen(false)}
              className="p-1 text-white/60 hover:text-white cursor-pointer"
              aria-label="Close video menu"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <button
            type="button"
            onClick={() => handleStartVideoDownload('intro')}
            className="w-full text-left px-3 py-2 rounded-lg bg-pink-600/20 hover:bg-pink-600/35 border border-pink-400/35 transition-colors cursor-pointer space-y-0.5"
          >
            <div className="text-xs font-mono-tabular font-medium text-white">
              Animasi Intro Lengkap (~10 dtk)
            </div>
            <div className="text-[11px] text-white/65">
              Rekam dari langit berbintang hingga buket mekar sempurna
            </div>
          </button>
          <button
            type="button"
            onClick={() => handleStartVideoDownload('loop')}
            className="w-full text-left px-3 py-2 rounded-lg bg-white/[0.05] hover:bg-white/[0.12] border border-white/12 transition-colors cursor-pointer space-y-0.5"
          >
            <div className="text-xs font-mono-tabular font-medium text-white">
              Loop Putaran 360° (6 dtk)
            </div>
            <div className="text-[11px] text-white/65">
              Rekam buket berputar di bawah taburan bintang & kelopak
            </div>
          </button>
        </div>
      )}

      {/* Active Video Recording Progress Indicator */}
      {showPublicHud && isRecordingVideo && (
        <div
          role="status"
          className="fixed bottom-[86px] left-1/2 -translate-x-1/2 z-30 w-[90vw] max-w-xs rounded-xl bg-[#0b0610]/95 border border-pink-400/60 px-3.5 py-2.5 shadow-2xl space-y-2"
        >
          <div className="flex items-center justify-between gap-2 text-xs font-mono-tabular text-pink-100">
            <span className="flex items-center gap-1.5">
              <Video className="w-3.5 h-3.5 text-rose-400" />
              <span>Merekam Video... {videoProgress}%</span>
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleStopAndSaveVideo}
                className="px-2 py-0.5 rounded bg-pink-600 hover:bg-pink-500 text-[10px] font-mono-tabular text-white flex items-center gap-1 cursor-pointer"
                title="Save recording now"
              >
                <Square className="w-2.5 h-2.5 fill-current" />
                <span>Simpan</span>
              </button>
              <button
                type="button"
                onClick={handleCancelVideo}
                className="px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 text-[10px] font-mono-tabular text-white/80 cursor-pointer"
              >
                Batal
              </button>
            </div>
          </div>
          <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-pink-500 to-fuchsia-400 transition-all duration-150"
              style={{ width: `${Math.max(4, videoProgress)}%` }}
            />
          </div>
        </div>
      )}

      {/* TOP-RIGHT ROMANTIC MESSAGE CARD (View-only, hidden while locked/curtain) */}
      {showPublicHud && (
        <button
          type="button"
          onClick={() => setLetterOpen(true)}
          style={{
            backgroundColor: `rgba(0, 0, 0, ${cardBgOpacity})`,
            borderColor: cardBorderCol,
            color: cardTextCol,
          }}
          className="absolute top-3.5 right-4 sm:top-5 sm:right-6 z-20 text-left max-w-[185px] sm:max-w-[270px] px-3.5 py-2.5 sm:px-4 sm:py-3 rounded-xl border transition-colors cursor-pointer group"
          title="Click to read keepsake message"
        >
          <div className={`font-mono-tabular ${cardSizeClass} flex items-center gap-1.5`}>
            <span style={{ color: cardBorderCol }}>♥</span>
            <span className="truncate">
              {siteConfig.text.recipientName.trim()
                ? `For ${siteConfig.text.recipientName.trim()}...`
                : 'For you...'}
            </span>
          </div>
          <p
            className={`font-mono-tabular ${cardSizeClass} opacity-90 mt-1 line-clamp-2 leading-snug`}
          >
            {siteConfig.text.romanticMessage || 'May your life be filled with happiness ♡'}
          </p>
        </button>
      )}

      {/* BOTTOM-LEFT TERMINAL ROMANTIC LIST */}
      {showPublicHud && !dockCollapsed && (
        <div className="hidden md:flex flex-col justify-end absolute bottom-4 left-6 z-20 pointer-events-none select-none font-mono-tabular text-xs leading-relaxed">
          <div className="space-y-0.5 text-white/90 mb-5">
            {(siteConfig.text.loveLines?.length
              ? siteConfig.text.loveLines
              : ['Love ♥', 'Happiness ♥', 'Forever ♥', 'With You ♥']
            ).map((line, idx) => (
              <div key={idx}>
                &gt; {line.replace(/♥$/, '').trim()}{' '}
                {line.includes('♥') && <span className="text-pink-400">♥</span>}
              </div>
            ))}
            <div className="flex items-center gap-1.5 pt-0.5">
              <span className="text-white/80">—</span>
              <span className="inline-block w-2.5 h-4 border border-pink-400 bg-pink-500/25 terminal-cursor" />
            </div>
          </div>

          <div className="text-white/90 text-xs">
            {siteConfig.text.footerBadge || '[ Welcome to my world ] ♡'}
          </div>
        </div>
      )}

      {/* BOTTOM-RIGHT PIXEL EQUALIZER & VIEW-ONLY AUDIO CONTROLS */}
      {showPublicHud && !dockCollapsed && (
        <div className="hidden sm:block absolute bottom-4 right-5 z-20">
          <PixelEqualizerWidget
            audioCtrl={audioRef.current}
            isPlaying={isMusicPlaying}
            volume={musicVolume}
            trackName={trackName}
            onTogglePlay={handleToggleMusic}
            onPrevTrack={() => handleCycleTrack(-1)}
            onNextTrack={() => handleCycleTrack(1)}
            onVolumeChange={handleVolumeChange}
          />
        </div>
      )}

      {/* Toast */}
      {toastMessage && (
        <div
          role="status"
          className="fixed top-20 left-1/2 -translate-x-1/2 z-30 px-4 py-2 rounded-lg bg-[#0d0712] border border-pink-400/50 text-xs font-mono-tabular text-pink-100 shadow-lg whitespace-nowrap"
        >
          {toastMessage}
        </div>
      )}

      {/* Mobile View-Only Music Popover */}
      {showPublicHud && mobileMusicOpen && !dockCollapsed && (
        <div className="sm:hidden fixed bottom-20 left-1/2 -translate-x-1/2 z-30 w-[90vw] max-w-xs rounded-xl bg-[#0c0710] border border-pink-400/50 p-3.5 shadow-2xl space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-mono-tabular text-pink-200 truncate">{trackName}</span>
            <button
              type="button"
              onClick={() => setMobileMusicOpen(false)}
              className="p-1 text-white/60 hover:text-white cursor-pointer"
              aria-label="Close music controls"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={handleToggleMusic}
              className="min-w-[38px] min-h-[38px] flex items-center justify-center rounded-lg bg-pink-600 text-white cursor-pointer"
              aria-label={isMusicPlaying ? 'Pause music' : 'Play music'}
            >
              {isMusicPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.02}
              value={musicVolume}
              onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
              className="romantic-slider flex-1"
              aria-label="Music volume"
            />
          </div>
        </div>
      )}

      {/* COLLAPSIBLE VIEW-ONLY BOTTOM-CENTER CONTROL DOCK */}
      {showPublicHud && (
        <div
          className={`fixed bottom-3 left-1/2 -translate-x-1/2 z-30 flex flex-col items-center transition-transform duration-200 ease-out max-w-[94vw] md:max-w-[58vw] ${
            dockCollapsed ? 'translate-y-[calc(100%-32px)]' : 'translate-y-0'
          }`}
        >
          <button
            type="button"
            onClick={() => setDockCollapsed((prev) => !prev)}
            className="px-3 py-1 rounded-t-lg bg-black/95 border border-b-0 border-pink-400/40 text-[10px] font-mono-tabular text-pink-200/85 hover:text-white flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap"
          >
            {dockCollapsed ? (
              <>
                <ChevronUp className="w-3 h-3" />
                <span>Controls</span>
              </>
            ) : (
              <>
                <ChevronDown className="w-3 h-3" />
                <span>Hide UI</span>
              </>
            )}
          </button>

          <nav
            aria-label="Bouquet Viewer Controls"
            className="w-full overflow-x-auto custom-scrollbar rounded-xl bg-black/92 border border-pink-400/45 px-2 py-1.5 shadow-2xl"
          >
            <div className="flex items-center gap-1.5 min-w-max">
              {/* Play / Pause Scene Animation */}
              <button
                type="button"
                onClick={() => setPausedOverride((p) => !p)}
                className={`min-h-[38px] min-w-[38px] p-1.5 rounded-lg flex items-center justify-center transition-colors shrink-0 cursor-pointer ${
                  pausedOverride
                    ? 'bg-amber-500/20 border border-amber-400/45 text-amber-200'
                    : 'bg-white/[0.06] hover:bg-white/[0.12] text-white/90'
                }`}
                title={pausedOverride ? 'Resume animation' : 'Pause animation'}
                aria-label={pausedOverride ? 'Resume animation' : 'Pause animation'}
              >
                {pausedOverride ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
              </button>

              {/* Replay Intro Assembly */}
              <button
                type="button"
                onClick={() => {
                  setPausedOverride(false);
                  viewportRef.current?.replayEntrance();
                }}
                className="min-h-[38px] px-2.5 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-white text-xs font-mono-tabular flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                title="Replay bouquet assembly intro"
              >
                <Sparkles className="w-3.5 h-3.5 text-fuchsia-300" />
                <span>Replay</span>
              </button>

              {/* 360 Rotation */}
              <button
                type="button"
                onClick={() => setAutoRotateOverride(!effectiveAutoRotate)}
                className={`min-h-[38px] px-2.5 py-1.5 rounded-lg text-xs font-mono-tabular flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  effectiveAutoRotate
                    ? 'bg-pink-500/25 border border-pink-400/45 text-pink-200'
                    : 'bg-white/[0.06] hover:bg-white/[0.12] text-white/75'
                }`}
                title="Toggle 360° rotation"
              >
                <RotateCw className="w-3.5 h-3.5" />
                <span>360°</span>
              </button>

              {/* Toggle Stars */}
              <button
                type="button"
                onClick={() => setShowStarsOverride(!effectiveShowStars)}
                className={`min-h-[38px] min-w-[38px] p-1.5 rounded-lg flex items-center justify-center transition-colors shrink-0 cursor-pointer ${
                  effectiveShowStars
                    ? 'bg-pink-500/20 border border-pink-400/40 text-pink-200'
                    : 'bg-white/[0.06] hover:bg-white/[0.12] text-white/55'
                }`}
                title="Toggle stars"
                aria-label="Toggle stars"
              >
                <Stars className="w-3.5 h-3.5" />
              </button>

              {/* Toggle Moon */}
              <button
                type="button"
                onClick={() => setShowMoonOverride(!effectiveShowMoon)}
                className={`min-h-[38px] min-w-[38px] p-1.5 rounded-lg flex items-center justify-center transition-colors shrink-0 cursor-pointer ${
                  effectiveShowMoon
                    ? 'bg-pink-500/20 border border-pink-400/40 text-pink-200'
                    : 'bg-white/[0.06] hover:bg-white/[0.12] text-white/55'
                }`}
                title="Toggle moon"
                aria-label="Toggle moon"
              >
                <Moon className="w-3.5 h-3.5" />
              </button>

              {/* Toggle Falling Petals */}
              <button
                type="button"
                onClick={() => setShowPetalsOverride(!effectiveShowPetals)}
                className={`min-h-[38px] min-w-[38px] p-1.5 rounded-lg flex items-center justify-center transition-colors shrink-0 cursor-pointer ${
                  effectiveShowPetals
                    ? 'bg-pink-500/20 border border-pink-400/40 text-pink-200'
                    : 'bg-white/[0.06] hover:bg-white/[0.12] text-white/55'
                }`}
                title="Toggle falling petals"
                aria-label="Toggle falling petals"
              >
                <Flower2 className="w-3.5 h-3.5" />
              </button>

              {/* Mobile Music Popover Toggle */}
              <button
                type="button"
                onClick={() => setMobileMusicOpen((prev) => !prev)}
                className="sm:hidden min-h-[38px] px-2.5 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-xs font-mono-tabular text-pink-200 flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Music className="w-3.5 h-3.5" />
                <span>{isMusicPlaying ? 'Playing' : 'Music'}</span>
              </button>

              {/* Inspect Lily Zoom */}
              <button
                type="button"
                onClick={handleFocusNextLily}
                className="min-h-[38px] px-2.5 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-white text-xs font-mono-tabular whitespace-nowrap shrink-0 cursor-pointer"
                title={`Zoom to inspect lily (${zoomPercent}% · ${totalTiles.toLocaleString()} photo pixels)`}
              >
                Inspect
              </button>

              {/* Photo Gallery Browser */}
              <button
                type="button"
                onClick={() => setGalleryOpen(true)}
                className="min-h-[38px] px-2.5 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-white text-xs font-mono-tabular flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                title="Browse bouquet photo gallery"
              >
                <Images className="w-3.5 h-3.5 text-pink-300" />
                <span className="hidden sm:inline">Photos</span>
              </button>

              {/* Reset View */}
              <button
                type="button"
                onClick={() => viewportRef.current?.resetView()}
                className="min-h-[38px] min-w-[38px] p-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-white/85 flex items-center justify-center transition-colors shrink-0 cursor-pointer"
                title="Reset view"
                aria-label="Reset camera view"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>

              {/* Save Image */}
              <button
                type="button"
                onClick={handleSaveSnapshot}
                className="min-h-[38px] min-w-[38px] p-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-white/85 flex items-center justify-center transition-colors shrink-0 cursor-pointer"
                title="Save bouquet as PNG"
                aria-label="Save bouquet as image"
              >
                <Download className="w-3.5 h-3.5" />
              </button>

              {/* Download Video Animation Menu */}
              <button
                type="button"
                onClick={() => {
                  if (isRecordingVideo) {
                    handleStopAndSaveVideo();
                  } else {
                    setVideoMenuOpen((prev) => !prev);
                  }
                }}
                className={`min-h-[38px] px-2.5 py-1.5 rounded-lg text-xs font-mono-tabular flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  isRecordingVideo || videoMenuOpen
                    ? 'bg-pink-500/25 border border-pink-400/50 text-pink-100'
                    : 'bg-white/[0.06] hover:bg-white/[0.12] text-white'
                }`}
                title="Download animation video"
                aria-label="Download animation video"
              >
                <Video className="w-3.5 h-3.5 text-pink-300" />
                <span>{isRecordingVideo ? `${videoProgress}%` : 'Video'}</span>
              </button>

              {/* Fullscreen */}
              <button
                type="button"
                onClick={handleToggleFullscreen}
                className="min-h-[38px] min-w-[38px] p-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-white/85 flex items-center justify-center transition-colors shrink-0 cursor-pointer"
                title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
                aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
              >
                {isFullscreen ? (
                  <Minimize2 className="w-3.5 h-3.5" />
                ) : (
                  <Maximize2 className="w-3.5 h-3.5" />
                )}
              </button>

              {/* Subtle Admin Studio Entry Link */}
              <button
                type="button"
                onClick={onNavigateAdmin}
                className="min-h-[38px] px-2.5 py-1.5 rounded-lg border border-white/10 hover:border-pink-400/45 bg-white/[0.03] hover:bg-pink-500/15 text-[11px] font-mono-tabular text-white/65 hover:text-pink-200 flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                title="Administrator Dashboard"
              >
                <Lock className="w-3 h-3" />
                <span>Admin</span>
              </button>
            </div>
          </nav>
        </div>
      )}

      {/* FULL-RESOLUTION ORIGINAL PHOTO LIGHTBOX (Triggered by clicking ANY pixel) */}
      <PhotoLightboxModal
        photo={activeLightboxPhoto}
        pixelInfo={lightboxPixelInfo}
        totalPhotos={allPhotos.length}
        currentPhotoIndex={Math.max(0, lightboxIdx)}
        onClose={() => {
          setLightboxPhotoId(null);
          setLightboxPixelInfo(null);
        }}
        onPrevPhoto={() => {
          if (allPhotos.length === 0 || lightboxIdx < 0) return;
          const prevIdx = (lightboxIdx - 1 + allPhotos.length) % allPhotos.length;
          setLightboxPhotoId(allPhotos[prevIdx].id);
          setLightboxPixelInfo(null);
        }}
        onNextPhoto={() => {
          if (allPhotos.length === 0 || lightboxIdx < 0) return;
          const nextIdx = (lightboxIdx + 1) % allPhotos.length;
          setLightboxPhotoId(allPhotos[nextIdx].id);
          setLightboxPixelInfo(null);
        }}
        onFocusFlower={(flowerIdx) => {
          viewportRef.current?.focusFlower(flowerIdx);
        }}
      />

      {/* VIEW-ONLY PHOTO GALLERY MODAL */}
      <PhotoGalleryModal
        isOpen={galleryOpen}
        photos={allPhotos}
        onClose={() => setGalleryOpen(false)}
        onSelectPhoto={(photoId) => {
          setLightboxPhotoId(photoId);
          setLightboxPixelInfo(null);
        }}
      />

      {/* VIEW-ONLY KEEPSAKE LETTER MODAL */}
      <KeepsakeLetterModal
        isOpen={letterOpen}
        data={siteConfig.text}
        onClose={() => setLetterOpen(false)}
      />

      {/* VIEW-ONLY GIFT TAG MESSAGE MODAL (Triggered by clicking the 3D ribbon tag) */}
      <GiftTagModal
        isOpen={tagModalOpen}
        wrapConfig={siteConfig.wrap}
        textConfig={siteConfig.text}
        onClose={() => setTagModalOpen(false)}
      />
    </div>
  );
}

export default function App() {
  const [route, setRoute] = useState<RouteInfo>(() => getRouteInfo());

  useEffect(() => {
    const onPopState = () => {
      setRoute(getRouteInfo());
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = useCallback((nextPath: '/' | '/admin') => {
    if (window.location.pathname !== nextPath) {
      window.history.pushState({}, '', nextPath);
    }
    setRoute(getRouteInfo());
  }, []);

  if (route.mode === 'admin') {
    return <AdminDashboard onNavigatePublic={() => navigate('/')} />;
  }

  return (
    <PublicBouquetView
      requestedSlug={route.slug}
      onNavigateAdmin={() => navigate('/admin')}
      onNavigateHome={() => navigate('/')}
    />
  );
}
