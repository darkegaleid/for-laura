import { ChevronLeft, ChevronRight, Focus, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { ClickedPixelInfo, UploadedPhoto } from '../types/bouquet';

interface PhotoLightboxModalProps {
  photo: UploadedPhoto | null;
  pixelInfo: ClickedPixelInfo | null;
  totalPhotos: number;
  currentPhotoIndex: number;
  onClose: () => void;
  onPrevPhoto: () => void;
  onNextPhoto: () => void;
  onFocusFlower: (flowerIndex: number) => void;
}

export function PhotoLightboxModal({
  photo,
  pixelInfo,
  totalPhotos,
  currentPhotoIndex,
  onClose,
  onPrevPhoto,
  onNextPhoto,
  onFocusFlower,
}: PhotoLightboxModalProps) {
  const touchStartXRef = useRef<number | null>(null);
  const touchStartYRef = useRef<number | null>(null);

  useEffect(() => {
    if (!photo) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') onPrevPhoto();
      else if (e.key === 'ArrowRight') onNextPhoto();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [photo, onClose, onPrevPhoto, onNextPhoto]);

  if (!photo) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/88 p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={`Original full-resolution photo: ${photo.name}`}
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-4xl max-h-[92vh] flex flex-col bg-[#08050b] border border-pink-400/50 rounded-xl overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Terminal Bar */}
        <div className="flex items-center justify-between gap-4 px-4 sm:px-5 py-3 border-b border-pink-400/25 bg-black">
          <div className="min-w-0">
            <div className="text-xs font-mono-tabular text-pink-300 truncate">
              {pixelInfo
                ? `> ${pixelInfo.flowerLabel} · Petal ${pixelInfo.petalNumber} · Pixel #${pixelInfo.pixelNumber}`
                : '> Original Memory'}
            </div>
            <div className="text-[11px] font-mono-tabular text-white/65 truncate mt-0.5">
              {photo.name} · {photo.width} × {photo.height} px (Full Original Resolution)
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {pixelInfo && (
              <button
                type="button"
                onClick={() => {
                  onFocusFlower(pixelInfo.flowerIndex);
                  onClose();
                }}
                className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-pink-400/40 hover:bg-pink-500/20 text-xs font-mono-tabular text-pink-100 transition-colors cursor-pointer whitespace-nowrap"
              >
                <Focus className="w-3.5 h-3.5" />
                <span>Zoom to Lily</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="min-w-[38px] min-h-[38px] flex items-center justify-center rounded-md border border-white/15 hover:bg-white/10 text-white/80 hover:text-white transition-colors cursor-pointer"
              aria-label="Close photo lightbox"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Uncropped Full-Resolution Original Image Container (supports touch swipe left/right) */}
        <div
          className="relative flex-1 min-h-[260px] flex flex-col items-center justify-center bg-black p-3 sm:p-5 overflow-hidden select-none"
          onTouchStart={(e) => {
            if (e.touches.length !== 1) return;
            touchStartXRef.current = e.touches[0].clientX;
            touchStartYRef.current = e.touches[0].clientY;
          }}
          onTouchEnd={(e) => {
            if (touchStartXRef.current === null || touchStartYRef.current === null) return;
            const touch = e.changedTouches[0];
            const dx = touch.clientX - touchStartXRef.current;
            const dy = touch.clientY - touchStartYRef.current;
            touchStartXRef.current = null;
            touchStartYRef.current = null;
            if (totalPhotos > 1 && Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.2) {
              if (dx > 0) onPrevPhoto();
              else onNextPhoto();
            }
          }}
        >
          <img
            src={photo.originalUrl}
            alt={photo.caption || photo.name}
            referrerPolicy="no-referrer"
            className="max-w-full max-h-[64vh] w-auto h-auto object-contain rounded border border-white/10"
          />

          {photo.caption && photo.caption.trim().length > 0 && (
            <p className="mt-3 max-w-2xl text-center text-xs sm:text-sm font-display italic text-pink-100/90 px-4">
              “{photo.caption.trim()}”
            </p>
          )}

          {totalPhotos > 1 && (
            <>
              <button
                type="button"
                onClick={onPrevPhoto}
                className="absolute left-3 top-1/2 -translate-y-1/2 min-w-[42px] min-h-[42px] flex items-center justify-center rounded-lg bg-black/80 border border-pink-400/40 hover:bg-pink-600/40 text-white transition-colors cursor-pointer"
                aria-label="Previous original photo"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={onNextPhoto}
                className="absolute right-3 top-1/2 -translate-y-1/2 min-w-[42px] min-h-[42px] flex items-center justify-center rounded-lg bg-black/80 border border-pink-400/40 hover:bg-pink-600/40 text-white transition-colors cursor-pointer"
                aria-label="Next original photo"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </>
          )}
        </div>

        {/* Bottom Status Bar */}
        <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-2.5 border-t border-pink-400/20 bg-black text-[11px] font-mono-tabular text-white/65">
          <span>
            Photo {currentPhotoIndex + 1} of {totalPhotos} · Intact original aspect ratio preserved
          </span>
          {pixelInfo && (
            <button
              type="button"
              onClick={() => {
                onFocusFlower(pixelInfo.flowerIndex);
                onClose();
              }}
              className="sm:hidden text-pink-300 hover:text-pink-200 underline cursor-pointer"
            >
              Zoom to Lily
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
