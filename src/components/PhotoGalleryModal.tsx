import { Images, X } from 'lucide-react';
import type { UploadedPhoto } from '../types/bouquet';

interface PhotoGalleryModalProps {
  isOpen: boolean;
  photos: UploadedPhoto[];
  onClose: () => void;
  onSelectPhoto: (photoId: string) => void;
}

export function PhotoGalleryModal({
  isOpen,
  photos,
  onClose,
  onSelectPhoto,
}: PhotoGalleryModalProps) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/85 p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Bouquet Photo Memories"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-4xl max-h-[88vh] flex flex-col bg-[#08050b] border border-pink-400/45 rounded-xl overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3 border-b border-pink-400/25 bg-black">
          <div className="flex items-center gap-2 text-xs font-mono-tabular text-pink-300">
            <Images className="w-4 h-4" />
            <span>Bouquet Photo Gallery ({photos.length})</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-md border border-white/15 hover:bg-white/10 text-white/80 hover:text-white cursor-pointer"
            aria-label="Close photo gallery"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-5 custom-scrollbar">
          {photos.length === 0 ? (
            <div className="text-center py-12 text-xs font-mono-tabular text-white/60">
              No photos available yet.
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {photos.map((photo, idx) => (
                <button
                  key={photo.id}
                  type="button"
                  onClick={() => {
                    onSelectPhoto(photo.id);
                    onClose();
                  }}
                  className="group rounded-lg border border-white/12 hover:border-pink-400/60 bg-black overflow-hidden text-left transition-colors cursor-pointer flex flex-col"
                >
                  <div className="aspect-square w-full bg-[#0d0812] flex items-center justify-center overflow-hidden">
                    <img
                      src={photo.previewUrl || photo.originalUrl}
                      alt={photo.caption || photo.name}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  </div>
                  <div className="p-2 border-t border-white/10">
                    <div className="text-[11px] font-mono-tabular text-white/90 truncate">
                      {photo.caption?.trim() || photo.name}
                    </div>
                    <div className="text-[10px] font-mono-tabular text-white/45 mt-0.5">
                      #{idx + 1} · {photo.width}×{photo.height}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
