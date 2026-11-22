import { Heart, Tag, X } from 'lucide-react';
import type { PersonalizationData, WrapRibbonConfig } from '../types/bouquet';

interface GiftTagModalProps {
  isOpen: boolean;
  wrapConfig: WrapRibbonConfig;
  textConfig: PersonalizationData;
  onClose: () => void;
}

export function GiftTagModal({ isOpen, wrapConfig, textConfig, onClose }: GiftTagModalProps) {
  if (!isOpen) return null;

  const titleLine =
    wrapConfig.tagText.trim() ||
    (textConfig.recipientName.trim() ? `For ${textConfig.recipientName.trim()} ♥` : 'For You ♥');
  const message =
    (wrapConfig.tagMessage ?? '').trim() ||
    'Every pixel of this bouquet holds a quiet wish for your happiness. Thank you for being my favorite story ♥';

  const tagPaperColor = wrapConfig.tagColor || '#D8C6BD';
  const tagInkColor = wrapConfig.tagTextColor || '#111111';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Gift Tag Message"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md rounded-2xl shadow-2xl border p-6 sm:p-8 transition-transform"
        style={{
          backgroundColor: tagPaperColor,
          color: tagInkColor,
          borderColor: 'rgba(136, 19, 55, 0.32)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Inner cardstock border frame */}
        <div
          className="pointer-events-none absolute inset-3 rounded-xl border"
          style={{ borderColor: 'rgba(136, 19, 55, 0.24)' }}
        />

        {/* Brass eyelet detail at top center */}
        <div className="flex justify-center mb-3">
          <div className="w-5 h-5 rounded-full border-4 border-[#78350f] bg-[#181014] shadow-inner" />
        </div>

        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg hover:bg-black/10 transition-colors cursor-pointer"
          style={{ color: tagInkColor }}
          aria-label="Close tag message"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="relative z-10 text-center space-y-4 pt-1 pb-2">
          <div className="inline-flex items-center gap-1.5 text-[10px] font-mono-tabular uppercase tracking-widest opacity-70">
            <Tag className="w-3 h-3" />
            <span>Bouquet Gift Tag</span>
          </div>

          <h2 className="font-display italic text-3xl sm:text-4xl font-bold leading-tight">
            {titleLine}
          </h2>

          <div className="w-12 h-px mx-auto bg-rose-900/30" />

          <p className="text-sm sm:text-base leading-relaxed whitespace-pre-line font-medium px-2">
            {message}
          </p>

          {(textConfig.senderName.trim() || textConfig.specialDate.trim()) && (
            <div className="pt-3 text-xs font-mono-tabular opacity-80 flex items-center justify-center gap-2">
              <Heart className="w-3 h-3 text-rose-800 fill-rose-800" />
              <span>
                {[
                  textConfig.senderName.trim() ? `From ${textConfig.senderName.trim()}` : '',
                  textConfig.specialDate.trim(),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
