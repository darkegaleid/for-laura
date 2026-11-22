import { Lock, ShieldAlert, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LockScreenUiConfig, PinFailureAnimConfig, PinWrongAnimStyle } from '../types/bouquet';

export interface PinVerifyOutcome {
  unlocked: boolean;
  lockedOut?: boolean;
  retryAfterSeconds?: number;
  error?: string;
  anim?: PinFailureAnimConfig;
}

export interface PinLockScreenProps {
  ui: LockScreenUiConfig;
  hasPinConfigured: boolean;
  onSubmitPin: (pin: string) => Promise<PinVerifyOutcome>;
  /** Called right after the brief 450ms pink glow + heart confirmation completes */
  onUnlockVisualComplete?: () => void;
  onNavigateAdmin?: () => void;
  /** External override from Admin Live Preview to demonstrate wrong/fake/success immediately */
  forcedTestEvent?: {
    nonce: number;
    kind: 'wrong' | 'fake' | 'success';
    anim?: PinFailureAnimConfig;
  } | null;
  /** Render internal stars/moon backdrop (used when previewed standalone or over sky) */
  renderStandaloneSkyBackdrop?: boolean;
  compactPreview?: boolean;
}

function playGentleTeaseChime() {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const notes = [523.25, 440.0];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.11);
      gain.gain.setValueAtTime(0.001, now + idx * 0.11);
      gain.gain.exponentialRampToValueAtTime(0.06, now + idx * 0.11 + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.11 + 0.24);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + idx * 0.11);
      osc.stop(now + idx * 0.11 + 0.26);
    });

    window.setTimeout(() => {
      ctx.close().catch(() => {});
    }, 800);
  } catch {
    // Ignore audio context restrictions cleanly
  }
}

function TeasingFlowerSvg({
  styleKind,
  accentColor,
  sizeScale,
  showParticles,
}: {
  styleKind: PinWrongAnimStyle;
  accentColor: string;
  sizeScale: number;
  showParticles: boolean;
}) {
  const animName =
    styleKind === 'bounce-blush'
      ? 'teasingFlowerBounce'
      : styleKind === 'spin-shy'
        ? 'teasingFlowerSpinShy'
        : 'teasingFlowerWiggle';

  const pxSize = Math.round(62 * Math.max(0.6, Math.min(1.6, sizeScale)));

  return (
    <div
      className="relative flex items-center justify-center select-none pointer-events-none"
      style={{
        width: pxSize + 24,
        height: pxSize + 10,
        animation: `${animName} 900ms cubic-bezier(0.22, 1, 0.36, 1) forwards`,
      }}
    >
      {showParticles && (
        <>
          <span
            className="absolute -top-1 left-2 text-[11px] opacity-85"
            style={{ color: accentColor }}
          >
            ✦
          </span>
          <span
            className="absolute top-1 right-1 text-[10px] opacity-80"
            style={{ color: '#fda4af' }}
          >
            ♡
          </span>
          <span
            className="absolute bottom-1 left-0 text-[9px] opacity-70"
            style={{ color: '#fbcfe8' }}
          >
            ✧
          </span>
          <span
            className="absolute -bottom-1 right-2 text-[10px] opacity-80"
            style={{ color: accentColor }}
          >
            ✿
          </span>
        </>
      )}

      <svg
        width={pxSize}
        height={pxSize}
        viewBox="0 0 80 80"
        fill="none"
        aria-hidden="true"
      >
        {/* Soft stem */}
        <path
          d="M40 50 Q42 63 39 74"
          stroke="#4ade80"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <path
          d="M40 64 Q30 59 27 65 Q33 70 40 64Z"
          fill="#4ade80"
          opacity="0.88"
        />

        {/* 6 Plump Playful Petals */}
        {[0, 60, 120, 180, 240, 300].map((deg) => (
          <ellipse
            key={deg}
            cx="40"
            cy="21"
            rx="10"
            ry="15"
            fill={deg % 120 === 0 ? accentColor : '#fbcfe8'}
            opacity={deg % 120 === 0 ? 0.96 : 0.9}
            transform={`rotate(${deg} 40 36)`}
          />
        ))}

        {/* Cute Flower Face */}
        <circle cx="40" cy="36" r="13" fill="#fff5f8" stroke={accentColor} strokeWidth="2" />

        {styleKind === 'peek-petal' ? (
          <>
            {/* Winking playful eyes */}
            <path
              d="M33 34 Q35.5 31.5 38 34"
              stroke="#3d1c2e"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <circle cx="45" cy="34" r="1.7" fill="#3d1c2e" />
          </>
        ) : (
          <>
            <circle cx="35.5" cy="34" r="1.7" fill="#3d1c2e" />
            <path
              d="M42.5 34 Q45 31.5 47.5 34"
              stroke="#3d1c2e"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </>
        )}

        {/* Rosy cheeks */}
        <ellipse cx="32.5" cy="38" rx="2.6" ry="1.5" fill="#fb7185" opacity="0.55" />
        <ellipse cx="47.5" cy="38" rx="2.6" ry="1.5" fill="#fb7185" opacity="0.55" />

        {/* Playful cheeky smile + tiny tongue */}
        <path
          d="M36 39 Q40 43.5 44 39"
          stroke="#3d1c2e"
          strokeWidth="1.9"
          strokeLinecap="round"
          fill="none"
        />
        <path
          d="M38.5 41.2 Q40 44.8 41.8 41.2"
          fill="#fb7185"
        />
      </svg>
    </div>
  );
}

function FloralCornerAccent({ color, flip }: { color: string; flip?: boolean }) {
  return (
    <svg
      width="86"
      height="86"
      viewBox="0 0 86 86"
      fill="none"
      aria-hidden="true"
      className={`pointer-events-none opacity-35 ${flip ? 'scale-x-[-1]' : ''}`}
    >
      <path
        d="M8 74 C18 46, 38 24, 72 12"
        stroke={color}
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path
        d="M22 48 C14 40, 14 30, 24 32 C28 38, 26 44, 22 48Z"
        fill={color}
        opacity="0.45"
      />
      <path
        d="M44 28 C44 18, 54 14, 58 22 C54 29, 48 30, 44 28Z"
        fill={color}
        opacity="0.55"
      />
      <circle cx="72" cy="12" r="4.2" fill={color} opacity="0.65" />
      <circle cx="14" cy="64" r="2.2" fill={color} opacity="0.5" />
    </svg>
  );
}

export function PinLockScreen({
  ui,
  hasPinConfigured,
  onSubmitPin,
  onUnlockVisualComplete,
  onNavigateAdmin,
  forcedTestEvent,
  renderStandaloneSkyBackdrop = false,
  compactPreview = false,
}: PinLockScreenProps) {
  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [activeIdx, setActiveIdx] = useState<number>(0);
  const [isVerifying, setIsVerifying] = useState(false);
  const [activeFailure, setActiveFailure] = useState<PinFailureAnimConfig | null>(null);
  const [failureNonce, setFailureNonce] = useState(0);
  const [unlockPhase, setUnlockPhase] = useState<'locked' | 'glowing' | 'fading'>('locked');
  const [lockoutSeconds, setLockoutSeconds] = useState(0);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);

  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const failureTimerRef = useRef<number | null>(null);
  const unlockTimerRef = useRef<number | null>(null);
  const lastHandledEventRef = useRef<number>(0);

  const focusBox = useCallback((idx: number) => {
    const clamped = Math.max(0, Math.min(5, idx));
    setActiveIdx(clamped);
    window.requestAnimationFrame(() => {
      inputRefs.current[clamped]?.focus();
    });
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (hasPinConfigured && !compactPreview) {
        inputRefs.current[0]?.focus();
      }
    }, 120);
    return () => window.clearTimeout(timer);
  }, [hasPinConfigured, compactPreview]);

  useEffect(() => {
    if (lockoutSeconds <= 0) return;
    const id = window.setInterval(() => {
      setLockoutSeconds((s) => (s > 1 ? s - 1 : 0));
    }, 1000);
    return () => window.clearInterval(id);
  }, [lockoutSeconds]);

  useEffect(() => {
    return () => {
      if (failureTimerRef.current !== null) window.clearTimeout(failureTimerRef.current);
      if (unlockTimerRef.current !== null) window.clearTimeout(unlockTimerRef.current);
    };
  }, []);

  const triggerFailureSequence = useCallback(
    (anim: PinFailureAnimConfig, prefillSample = false) => {
      if (failureTimerRef.current !== null) {
        window.clearTimeout(failureTimerRef.current);
      }
      if (prefillSample) {
        setDigits(['1', '4', '0', '2', '2', '6']);
      }
      setActiveFailure(anim);
      setFailureNonce((n) => n + 1);
      if (anim.playSound) {
        playGentleTeaseChime();
      }
      const duration = Math.max(850, Math.min(5000, anim.durationMs || 2100));
      failureTimerRef.current = window.setTimeout(() => {
        setActiveFailure(null);
        setDigits(['', '', '', '', '', '']);
        focusBox(0);
      }, duration);
    },
    [focusBox],
  );

  const triggerSuccessSequence = useCallback(() => {
    if (unlockTimerRef.current !== null) window.clearTimeout(unlockTimerRef.current);
    setActiveFailure(null);
    setErrorNotice(null);
    setUnlockPhase('glowing');

    unlockTimerRef.current = window.setTimeout(() => {
      setUnlockPhase('fading');
      onUnlockVisualComplete?.();
    }, 480);
  }, [onUnlockVisualComplete]);

  // Handle Admin Live Preview simulated events
  useEffect(() => {
    if (!forcedTestEvent || forcedTestEvent.nonce === lastHandledEventRef.current) return;
    lastHandledEventRef.current = forcedTestEvent.nonce;

    if (forcedTestEvent.kind === 'success') {
      setDigits(['2', '2', '1', '1', '2', '6']);
      triggerSuccessSequence();
    } else if (forcedTestEvent.anim) {
      triggerFailureSequence(forcedTestEvent.anim, true);
    }
  }, [forcedTestEvent, triggerFailureSequence, triggerSuccessSequence]);

  const submitPin = useCallback(
    async (pinValue: string) => {
      if (isVerifying || unlockPhase !== 'locked' || lockoutSeconds > 0) return;
      if (!/^\d{6}$/.test(pinValue)) {
        setErrorNotice('Please enter all 6 numeric digits.');
        return;
      }

      setErrorNotice(null);
      setIsVerifying(true);
      try {
        const result = await onSubmitPin(pinValue);
        if (result.unlocked) {
          triggerSuccessSequence();
          return;
        }
        if (result.lockedOut && result.retryAfterSeconds) {
          setLockoutSeconds(result.retryAfterSeconds);
        }
        if (result.error) {
          setErrorNotice(result.error);
        }
        if (result.anim) {
          triggerFailureSequence(result.anim, false);
        } else {
          setDigits(['', '', '', '', '', '']);
          focusBox(0);
        }
      } catch {
        setErrorNotice('Could not verify code right now. Please try again.');
      } finally {
        setIsVerifying(false);
      }
    },
    [
      isVerifying,
      unlockPhase,
      lockoutSeconds,
      onSubmitPin,
      triggerSuccessSequence,
      triggerFailureSequence,
      focusBox,
    ],
  );

  const handleDigitChange = (idx: number, rawVal: string) => {
    if (isVerifying || unlockPhase !== 'locked' || lockoutSeconds > 0) return;
    const cleaned = rawVal.replace(/\D/g, '');

    if (!cleaned) {
      setDigits((prev) => {
        const next = [...prev];
        next[idx] = '';
        return next;
      });
      return;
    }

    // Handle multi-digit paste or fast mobile autofill
    if (cleaned.length > 1) {
      const next = [...digits];
      let cursor = idx;
      for (const ch of cleaned) {
        if (cursor > 5) break;
        next[cursor] = ch;
        cursor++;
      }
      setDigits(next);
      const nextEmpty = next.findIndex((d) => !d);
      if (nextEmpty !== -1) {
        focusBox(nextEmpty);
      } else {
        focusBox(5);
        if (ui.autoSubmit) {
          submitPin(next.join(''));
        }
      }
      return;
    }

    const ch = cleaned[0];
    const next = [...digits];
    next[idx] = ch;
    setDigits(next);

    if (idx < 5) {
      focusBox(idx + 1);
    } else if (ui.autoSubmit && next.every((d) => d.length === 1)) {
      submitPin(next.join(''));
    }
  };

  const handleKeyDown = (idx: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      e.preventDefault();
      if (digits[idx]) {
        const next = [...digits];
        next[idx] = '';
        setDigits(next);
      } else if (idx > 0) {
        const next = [...digits];
        next[idx - 1] = '';
        setDigits(next);
        focusBox(idx - 1);
      }
    } else if (e.key === 'ArrowLeft' && idx > 0) {
      e.preventDefault();
      focusBox(idx - 1);
    } else if (e.key === 'ArrowRight' && idx < 5) {
      e.preventDefault();
      focusBox(idx + 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const joined = digits.join('');
      if (joined.length === 6) submitPin(joined);
    }
  };

  const handlePaste = (idx: number, e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text').replace(/\D/g, '');
    if (!text) return;
    e.preventDefault();
    handleDigitChange(idx, text);
  };

  const floatingPetals = useMemo(() => {
    const count = Math.max(0, Math.min(48, ui.petalDensity || 0));
    return Array.from({ length: count }, (_, i) => ({
      id: i,
      left: `${((i * 37 + 11) % 94) + 3}%`,
      delay: `${((i * 1.37) % 9).toFixed(2)}s`,
      duration: `${(7.5 + (i % 5) * 1.4) / Math.max(0.4, ui.animationIntensity || 1)}s`,
      size: 7 + (i % 5) * 2.5,
      opacity: 0.35 + (i % 4) * 0.14,
    }));
  }, [ui.petalDensity, ui.animationIntensity]);

  const fallbackStars = useMemo(() => {
    if (!renderStandaloneSkyBackdrop || !ui.showStars) return [];
    return Array.from({ length: 42 }, (_, i) => ({
      id: i,
      left: `${(i * 29 + 7) % 96}%`,
      top: `${(i * 43 + 5) % 92}%`,
      size: i % 5 === 0 ? 2.5 : 1.5,
      delay: `${((i * 0.41) % 3.5).toFixed(2)}s`,
    }));
  }, [renderStandaloneSkyBackdrop, ui.showStars]);

  const fontClass =
    ui.fontFamily === 'mono'
      ? 'font-mono-tabular'
      : ui.fontFamily === 'modern'
        ? 'font-sans'
        : 'font-display';

  const gapClass =
    ui.inputSpacing === 'tight'
      ? 'gap-1.5 sm:gap-2'
      : ui.inputSpacing === 'wide'
        ? 'gap-2.5 sm:gap-4'
        : 'gap-2 sm:gap-3';

  const boxSizeStyle =
    ui.inputSize === 'sm'
      ? { width: 'clamp(36px, 11vw, 46px)', height: 'clamp(42px, 12vw, 52px)' }
      : ui.inputSize === 'lg'
        ? { width: 'clamp(44px, 13.5vw, 60px)', height: 'clamp(50px, 15vw, 66px)' }
        : { width: 'clamp(40px, 12.2vw, 54px)', height: 'clamp(46px, 13.5vw, 60px)' };

  const joinedPin = digits.join('');
  const isFailureActive = Boolean(activeFailure);
  const shakeMagnitude = activeFailure?.shakeIntensity ?? 1;

  return (
    <div
      className={`absolute inset-0 z-40 flex flex-col items-center justify-center overflow-hidden px-4 py-6 transition-opacity duration-500 ${
        unlockPhase === 'fading' ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
      style={{
        backgroundColor: renderStandaloneSkyBackdrop
          ? ui.backgroundColor || '#000000'
          : ui.backgroundColor && ui.backgroundColor.toLowerCase() !== '#000000'
            ? `${ui.backgroundColor}cc`
            : 'rgba(0, 0, 0, 0.34)',
      }}
    >
      {/* Standalone backdrop stars & crescent moon (if rendered inside Admin preview modal) */}
      {renderStandaloneSkyBackdrop && ui.showStars && (
        <div className="absolute inset-0 pointer-events-none">
          {fallbackStars.map((st) => (
            <span
              key={st.id}
              className="absolute rounded-full bg-white"
              style={{
                left: st.left,
                top: st.top,
                width: st.size,
                height: st.size,
                animation: `twinkleStarSoft 3.4s ease-in-out ${st.delay} infinite`,
              }}
            />
          ))}
        </div>
      )}

      {renderStandaloneSkyBackdrop && ui.showMoon && (
        <div
          className="absolute top-7 left-7 sm:top-10 sm:left-12 pointer-events-none rounded-full"
          style={{
            width: compactPreview ? 40 : 54,
            height: compactPreview ? 40 : 54,
            background: 'radial-gradient(circle at 35% 35%, #fff8fb 0%, #f3d6e4 58%, #9d6f89 100%)',
            boxShadow: `0 0 28px ${ui.accentColor}44`,
            opacity: 0.88,
          }}
        />
      )}

      {/* Ambient Floating Lock-Screen Petals */}
      {floatingPetals.length > 0 && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          {floatingPetals.map((p) => (
            <span
              key={p.id}
              className="absolute -top-6 rounded-tl-full rounded-br-full"
              style={{
                left: p.left,
                width: p.size,
                height: p.size * 0.72,
                backgroundColor: p.id % 2 === 0 ? ui.accentColor : '#fbcfe8',
                opacity: p.opacity,
                animation: `lockPetalFloat ${p.duration} linear ${p.delay} infinite`,
              }}
            />
          ))}
        </div>
      )}

      {/* Main Romantic Lock Card (no backdrop-filter over WebGL) */}
      <div
        className="relative w-full max-w-[460px] rounded-2xl border px-5 py-7 sm:px-8 sm:py-9 text-center shadow-2xl"
        style={{
          backgroundColor: 'rgba(10, 5, 14, 0.88)',
          borderColor:
            unlockPhase === 'glowing'
              ? ui.accentColor
              : isFailureActive
                ? '#fb7185'
                : `${ui.accentColor}44`,
          boxShadow:
            unlockPhase === 'glowing'
              ? `0 0 45px ${ui.accentColor}66, 0 22px 60px rgba(0,0,0,0.85)`
              : `0 0 36px ${ui.accentColor}1c, 0 22px 60px rgba(0,0,0,0.85)`,
        }}
      >
        {ui.showFloralDecor && (
          <>
            <div className="absolute top-0 left-0 pointer-events-none">
              <FloralCornerAccent color={ui.accentColor} />
            </div>
            <div className="absolute top-0 right-0 pointer-events-none">
              <FloralCornerAccent color={ui.accentColor} flip />
            </div>
          </>
        )}

        {/* Small Heart / Lock Crest */}
        <div className="flex justify-center mb-3">
          {unlockPhase === 'glowing' ? (
            <div
              className="w-11 h-11 rounded-full flex items-center justify-center text-xl"
              style={{
                backgroundColor: `${ui.accentColor}30`,
                border: `1px solid ${ui.accentColor}`,
                color: ui.accentColor,
                animation: 'lockHeartBeat 460ms ease-out forwards',
              }}
            >
              ♥
            </div>
          ) : (
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center"
              style={{
                backgroundColor: `${ui.accentColor}1a`,
                border: `1px solid ${ui.accentColor}4d`,
                color: ui.accentColor,
              }}
            >
              <Lock className="w-4 h-4" />
            </div>
          )}
        </div>

        {/* Heading & Description */}
        <h1
          className={`${fontClass} text-2xl sm:text-3xl font-semibold tracking-wide leading-tight`}
          style={{ color: ui.textColor || '#fff5f8' }}
        >
          {ui.heading || 'A Little Secret For You ♡'}
        </h1>
        <p
          className="mt-2 text-xs sm:text-sm leading-relaxed max-w-xs mx-auto"
          style={{ color: ui.secondaryTextColor || '#fbcfe8', opacity: 0.88 }}
        >
          {ui.description || 'Enter the 6-digit secret code to unlock your surprise.'}
        </p>

        {!hasPinConfigured ? (
          <div className="mt-6 p-4 rounded-xl bg-amber-500/10 border border-amber-400/35 text-xs text-amber-100/90 space-y-2.5">
            <div className="flex items-center justify-center gap-1.5 font-mono-tabular text-amber-200">
              <ShieldAlert className="w-4 h-4" />
              <span>Secret Code Not Configured Yet</span>
            </div>
            <p className="text-[11px] leading-relaxed text-amber-100/80">
              The creator has enabled secret PIN protection, but has not saved a 6-digit PIN yet.
            </p>
            {onNavigateAdmin && (
              <button
                type="button"
                onClick={onNavigateAdmin}
                className="px-3 py-1.5 rounded-lg bg-pink-600 hover:bg-pink-500 text-[11px] font-mono-tabular text-white cursor-pointer"
              >
                Open Admin Dashboard
              </button>
            )}
          </div>
        ) : (
          <>
            {/* 6 Individual PIN Input Boxes */}
            <div
              key={failureNonce}
              className={`mt-6 flex items-center justify-center ${gapClass}`}
              style={
                isFailureActive
                  ? {
                      animation: `pinShakeSoft ${Math.round(420 / Math.max(0.5, shakeMagnitude))}ms ease-in-out`,
                    }
                  : undefined
              }
            >
              {digits.map((digit, idx) => {
                const isFocused = activeIdx === idx;
                const filled = digit.length === 1;
                const borderColor =
                  unlockPhase === 'glowing'
                    ? ui.accentColor
                    : isFailureActive
                      ? '#fb7185'
                      : isFocused || filled
                        ? ui.inputBorderColor || ui.accentColor
                        : `${ui.inputBorderColor || ui.accentColor}48`;

                return (
                  <div
                    key={idx}
                    className="relative flex items-center justify-center rounded-xl transition-all duration-150"
                    style={{
                      ...boxSizeStyle,
                      backgroundColor:
                        unlockPhase === 'glowing'
                          ? `${ui.accentColor}26`
                          : filled
                            ? 'rgba(255, 255, 255, 0.06)'
                            : 'rgba(0, 0, 0, 0.72)',
                      border: `1.5px solid ${borderColor}`,
                      boxShadow:
                        unlockPhase === 'glowing'
                          ? `0 0 18px ${ui.accentColor}88`
                          : isFocused
                            ? `0 0 14px ${ui.accentColor}44`
                            : 'none',
                    }}
                  >
                    <input
                      ref={(el) => {
                        inputRefs.current[idx] = el;
                      }}
                      type="tel"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      autoComplete={idx === 0 ? 'one-time-code' : 'off'}
                      maxLength={6}
                      disabled={isVerifying || unlockPhase !== 'locked' || lockoutSeconds > 0}
                      value={digit}
                      onFocus={() => setActiveIdx(idx)}
                      onChange={(e) => handleDigitChange(idx, e.target.value)}
                      onKeyDown={(e) => handleKeyDown(idx, e)}
                      onPaste={(e) => handlePaste(idx, e)}
                      aria-label={`Secret PIN digit ${idx + 1} of 6`}
                      className={`w-full h-full bg-transparent text-center font-mono-tabular text-lg sm:text-xl outline-none caret-pink-400 ${
                        ui.maskInput ? 'text-transparent selection:bg-transparent' : ''
                      }`}
                      style={!ui.maskInput ? { color: ui.textColor || '#fff5f8' } : undefined}
                    />

                    {/* Masked Romantic Dot / Empty Ring Indicator */}
                    {ui.maskInput && (
                      <span
                        className="pointer-events-none absolute inset-0 flex items-center justify-center font-mono-tabular text-lg select-none transition-transform duration-150"
                        style={{
                          color: filled
                            ? unlockPhase === 'glowing'
                              ? '#ffffff'
                              : ui.accentColor
                            : `${ui.secondaryTextColor || '#fbcfe8'}55`,
                          transform: filled ? 'scale(1.08)' : 'scale(0.95)',
                        }}
                      >
                        {filled ? '●' : '○'}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Playful Teasing Flower & Message Stage */}
            <div className="min-h-[88px] mt-4 flex flex-col items-center justify-center">
              {activeFailure ? (
                <div className="flex flex-col items-center gap-1.5">
                  {activeFailure.showTeasingFlower && (
                    <TeasingFlowerSvg
                      styleKind={activeFailure.style}
                      accentColor={ui.accentColor}
                      sizeScale={activeFailure.teasingFlowerSize}
                      showParticles={activeFailure.showParticles}
                    />
                  )}
                  <p
                    className="text-xs sm:text-sm font-medium px-3 py-1 rounded-full"
                    style={{
                      color: '#fecdd3',
                      backgroundColor: 'rgba(251, 113, 133, 0.14)',
                      border: '1px solid rgba(251, 113, 133, 0.35)',
                    }}
                  >
                    {activeFailure.message}
                  </p>
                </div>
              ) : unlockPhase === 'glowing' ? (
                <div className="flex items-center gap-1.5 text-xs font-mono-tabular text-pink-200">
                  <Sparkles className="w-3.5 h-3.5 text-pink-400" />
                  <span>Opening your bouquet...</span>
                </div>
              ) : lockoutSeconds > 0 ? (
                <div className="text-xs font-mono-tabular text-rose-300 bg-rose-500/10 border border-rose-400/35 px-3 py-1.5 rounded-lg">
                  Too many tries · Please wait {lockoutSeconds}s
                </div>
              ) : errorNotice ? (
                <div className="text-xs text-rose-300">{errorNotice}</div>
              ) : (
                <p
                  className="text-[11px] font-mono-tabular opacity-60"
                  style={{ color: ui.secondaryTextColor || '#fbcfe8' }}
                >
                  Tap the circles or type your 6-digit code
                </p>
              )}
            </div>

            {/* Optional Explicit Unlock Button */}
            {ui.showUnlockButton && (
              <button
                type="button"
                disabled={
                  joinedPin.length !== 6 ||
                  isVerifying ||
                  unlockPhase !== 'locked' ||
                  lockoutSeconds > 0
                }
                onClick={() => submitPin(joinedPin)}
                className="mt-1 w-full sm:w-auto min-w-[200px] px-6 py-2.5 rounded-xl text-xs sm:text-sm font-mono-tabular font-medium text-white transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                style={{
                  backgroundColor: ui.accentColor || '#f472b6',
                  boxShadow:
                    joinedPin.length === 6
                      ? `0 6px 24px ${ui.accentColor}55`
                      : 'none',
                }}
              >
                {isVerifying ? 'Checking Secret Code...' : 'Unlock Surprise ♡'}
              </button>
            )}
          </>
        )}
      </div>

      {/* Discreet Admin Link */}
      {onNavigateAdmin && (
        <button
          type="button"
          onClick={onNavigateAdmin}
          className="mt-5 px-3 py-1 rounded-lg border border-white/10 hover:border-pink-400/40 bg-black/50 text-[11px] font-mono-tabular text-white/45 hover:text-pink-200 flex items-center gap-1.5 transition-colors cursor-pointer"
        >
          <Lock className="w-3 h-3" />
          <span>Admin</span>
        </button>
      )}
    </div>
  );
}
