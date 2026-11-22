import { X } from 'lucide-react';
import type { PersonalizationData } from '../types/bouquet';

interface KeepsakeLetterModalProps {
  isOpen: boolean;
  data: PersonalizationData;
  onClose: () => void;
  onEdit?: () => void;
}

export function KeepsakeLetterModal({
  isOpen,
  data,
  onClose,
  onEdit,
}: KeepsakeLetterModalProps) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/75 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Keepsake Romantic Letter"
    >
      <div className="relative w-full max-w-lg bg-[#140d1b] border border-pink-200/20 rounded-2xl p-7 sm:p-9 shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg text-white/65 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          aria-label="Close letter"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="space-y-5">
          <div className="text-xs text-pink-300/80 font-mono-tabular">
            {data.specialDate || 'A Timeless Keepsake'}
          </div>

          <h2 className="font-display text-3xl sm:text-4xl font-semibold text-white leading-tight">
            {data.recipientName ? `Dearest ${data.recipientName},` : 'For You,'}
          </h2>

          <p className="text-sm sm:text-base text-pink-50/85 leading-relaxed whitespace-pre-line">
            {data.romanticMessage ||
              'Every petal in this bouquet is sculpted from fragments of our favorite moments together. Zoom in closely to see each memory shine.'}
          </p>

          <div className="pt-4 border-t border-white/10 flex items-end justify-between gap-4">
            <div>
              <p className="font-display italic text-lg text-pink-200">
                “{data.ribbonText || 'Every pixel of this flower reminds me of you.'}”
              </p>
              <p className="text-xs text-white/60 mt-1">
                With love, <span className="text-white/90 font-medium">{data.senderName || 'Yours'}</span>
              </p>
            </div>

            {onEdit && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onEdit();
                }}
                className="px-3.5 py-2 rounded-lg border border-white/15 hover:bg-white/10 text-xs text-white/85 whitespace-nowrap shrink-0 cursor-pointer"
              >
                Edit Note
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
