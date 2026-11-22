import { Pause, Play, SkipBack, SkipForward, Upload, Volume2, VolumeX } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { BouquetAudioController } from '../utils/ambientAudio';

interface PixelEqualizerWidgetProps {
  audioCtrl: BouquetAudioController | null;
  isPlaying: boolean;
  volume: number;
  trackName: string;
  onTogglePlay: () => void;
  onPrevTrack: () => void;
  onNextTrack: () => void;
  onVolumeChange: (val: number) => void;
  onTriggerUpload?: () => void;
}

const BAR_COUNT = 24;
const SEGMENTS_PER_BAR = 7;

export function PixelEqualizerWidget({
  audioCtrl,
  isPlaying,
  volume,
  trackName,
  onTogglePlay,
  onPrevTrack,
  onNextTrack,
  onVolumeChange,
  onTriggerUpload,
}: PixelEqualizerWidgetProps) {
  const [bars, setBars] = useState<number[]>(() => new Array(BAR_COUNT).fill(0.14));
  const [showVolume, setShowVolume] = useState(false);

  useEffect(() => {
    let rafId = 0;
    let lastTick = 0;

    const update = (nowMs: number) => {
      if (nowMs - lastTick > 60) {
        lastTick = nowMs;
        if (audioCtrl) {
          setBars(audioCtrl.getSpectrumBars(BAR_COUNT, nowMs * 0.001));
        }
      }
      rafId = requestAnimationFrame(update);
    };

    if (isPlaying) {
      rafId = requestAnimationFrame(update);
    } else {
      setBars(
        Array.from({ length: BAR_COUNT }, (_, i) => {
          const d = Math.abs(i - BAR_COUNT * 0.5) / (BAR_COUNT * 0.5);
          return 0.14 + (1 - d) * 0.14;
        }),
      );
    }

    return () => cancelAnimationFrame(rafId);
  }, [audioCtrl, isPlaying]);

  return (
    <div className="flex flex-col items-end select-none">
      {/* Volume & Optional Upload Quick Bar (toggles on click) */}
      {showVolume && (
        <div className="mb-2 flex items-center gap-2.5 px-3 py-2 rounded-lg bg-[#0c0710] border border-pink-400/45 shadow-xl">
          <span className="text-[11px] font-mono-tabular text-pink-200 max-w-[140px] truncate">
            {trackName}
          </span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.02}
            value={volume}
            onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
            className="romantic-slider w-20"
            aria-label="Music volume"
          />
          {onTriggerUpload && (
            <button
              type="button"
              onClick={onTriggerUpload}
              className="px-2 py-1 rounded bg-pink-600 hover:bg-pink-500 text-[11px] font-mono-tabular text-white flex items-center gap-1 cursor-pointer whitespace-nowrap"
              title="Upload custom audio"
            >
              <Upload className="w-3 h-3" />
              <span>MP3</span>
            </button>
          )}
        </div>
      )}

      {/* Pixel Spectrum Bars (pink-to-violet matching reference image) */}
      <div
        className="flex items-end gap-[2.5px] h-11 px-1"
        aria-hidden="true"
      >
        {bars.map((val, bIdx) => {
          const activeSegs = Math.max(1, Math.round(val * SEGMENTS_PER_BAR));
          return (
            <div key={bIdx} className="flex flex-col-reverse gap-[2px]">
              {Array.from({ length: SEGMENTS_PER_BAR }).map((_, sIdx) => {
                const isLit = sIdx < activeSegs;
                const colorClass =
                  sIdx >= 5
                    ? 'bg-pink-300'
                    : sIdx >= 3
                      ? 'bg-fuchsia-400'
                      : 'bg-purple-500';
                return (
                  <span
                    key={sIdx}
                    className={`w-[4px] h-[3.5px] rounded-[0.5px] transition-opacity duration-75 ${
                      isLit ? `${colorClass} opacity-100` : 'bg-white/10 opacity-25'
                    }`}
                  />
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Crisp White Baseline */}
      <div className="w-full h-[1.5px] bg-white/85 mt-1 mb-1.5" />

      {/* Media Controls Row: Prev | Play/Pause | Next | Volume */}
      <div className="w-full flex items-center justify-between gap-2 px-1">
        <button
          type="button"
          onClick={onPrevTrack}
          className="p-1.5 text-white/80 hover:text-pink-300 transition-colors cursor-pointer"
          aria-label="Previous track"
          title="Previous built-in track"
        >
          <SkipBack className="w-4 h-4 fill-current" />
        </button>

        <button
          type="button"
          onClick={onTogglePlay}
          className="p-1.5 text-white hover:text-pink-300 transition-colors cursor-pointer"
          aria-label={isPlaying ? 'Pause music' : 'Play music'}
          title={isPlaying ? 'Pause music' : 'Play music'}
        >
          {isPlaying ? (
            <Pause className="w-4 h-4 fill-current" />
          ) : (
            <Play className="w-4 h-4 fill-current" />
          )}
        </button>

        <button
          type="button"
          onClick={onNextTrack}
          className="p-1.5 text-white/80 hover:text-pink-300 transition-colors cursor-pointer"
          aria-label="Next track"
          title="Next built-in track"
        >
          <SkipForward className="w-4 h-4 fill-current" />
        </button>

        <button
          type="button"
          onClick={() => setShowVolume((prev) => !prev)}
          className="p-1.5 text-pink-300/85 hover:text-pink-200 transition-colors cursor-pointer"
          aria-label="Music volume"
          title="Volume"
        >
          {volume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}
