import { useState, useEffect, useRef, useCallback } from "react";
import { Sparkles, X, ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";

interface ReelPhoto {
  id: string;
  thumbnailUrl?: string;
  url: string;
  takenAt?: string;
  uploadedAt?: string;
  filename?: string;
}

interface OnThisDayReelProps {
  photos: ReelPhoto[];
  onDismiss: () => void;
}

const SLIDE_DURATION = 3000; // ms per slide

export default function OnThisDayReel({ photos, onDismiss }: OnThisDayReelProps) {
  const [current, setCurrent] = useState(0);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const [animDir, setAnimDir] = useState<"next" | "prev">("next");
  const [visible, setVisible] = useState(true); // for exit animation
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const progressRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const goTo = useCallback((idx: number, dir: "next" | "prev") => {
    setAnimDir(dir);
    setCurrent(idx);
    setProgress(0);
  }, []);

  const goNext = useCallback(() => {
    goTo((current + 1) % photos.length, "next");
  }, [current, photos.length, goTo]);

  const goPrev = useCallback(() => {
    goTo((current - 1 + photos.length) % photos.length, "prev");
  }, [current, photos.length, goTo]);

  // Auto-advance
  useEffect(() => {
    if (paused || photos.length <= 1) return;
    intervalRef.current = setInterval(goNext, SLIDE_DURATION);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [paused, goNext, photos.length]);

  // Progress bar tick (60 fps feel)
  useEffect(() => {
    if (paused) return;
    setProgress(0);
    const step = 100 / (SLIDE_DURATION / 50);
    progressRef.current = setInterval(() => {
      setProgress(p => Math.min(p + step, 100));
    }, 50);
    return () => { if (progressRef.current) clearInterval(progressRef.current); };
  }, [current, paused]);

  const handleDismiss = () => {
    setVisible(false);
    setTimeout(onDismiss, 300);
  };

  const photo = photos[current];
  const year = new Date(photo.takenAt ?? photo.uploadedAt ?? "").getFullYear();
  const dateLabel = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric" });

  if (!visible) return null;

  return (
    <div
      className="mb-6 rounded-2xl border border-border bg-card overflow-hidden transition-all duration-300"
      style={{ opacity: visible ? 1 : 0 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary animate-pulse" />
          <span className="text-sm font-semibold text-foreground">On this day</span>
          <span className="text-xs text-muted-foreground">— {dateLabel} in past years</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setPaused(p => !p)}
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title={paused ? "Play" : "Pause"}
          >
            {paused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={handleDismiss}
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Reel area */}
      <div
        className="relative flex items-center justify-center py-5 px-4 bg-gradient-to-b from-muted/30 to-background"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
      >
        {/* Stacked background cards */}
        {photos.length > 2 && (
          <div
            className="absolute rounded-xl overflow-hidden shadow-sm"
            style={{
              width: 180,
              height: 180,
              transform: "rotate(-6deg) translateY(8px) translateX(-6px)",
              zIndex: 1,
            }}
          >
            <img
              src={photos[(current + 2) % photos.length].thumbnailUrl || photos[(current + 2) % photos.length].url}
              className="w-full h-full object-cover opacity-50"
              alt=""
            />
          </div>
        )}
        {photos.length > 1 && (
          <div
            className="absolute rounded-xl overflow-hidden shadow-md"
            style={{
              width: 195,
              height: 195,
              transform: "rotate(-3deg) translateY(4px) translateX(-3px)",
              zIndex: 2,
            }}
          >
            <img
              src={photos[(current + 1) % photos.length].thumbnailUrl || photos[(current + 1) % photos.length].url}
              className="w-full h-full object-cover opacity-70"
              alt=""
            />
          </div>
        )}

        {/* Active card */}
        <div
          key={`${photo.id}-${current}`}
          className="relative rounded-2xl overflow-hidden shadow-2xl"
          style={{
            width: 210,
            height: 210,
            zIndex: 10,
            animation: `reel-${animDir} 0.35s cubic-bezier(0.34,1.56,0.64,1)`,
          }}
        >
          <img
            src={photo.thumbnailUrl || photo.url}
            alt={photo.filename}
            className="w-full h-full object-cover"
          />
          {/* Year badge */}
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent pt-8 pb-3 px-3">
            <p className="text-white font-bold text-lg leading-none">{year}</p>
            <p className="text-white/70 text-xs mt-0.5">{dateLabel}</p>
          </div>
        </div>

        {/* Prev / Next arrows */}
        {photos.length > 1 && (
          <>
            <button
              onClick={goPrev}
              className="absolute left-3 p-1.5 rounded-full bg-black/30 text-white hover:bg-black/50 transition-colors z-20"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={goNext}
              className="absolute right-3 p-1.5 rounded-full bg-black/30 text-white hover:bg-black/50 transition-colors z-20"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </>
        )}
      </div>

      {/* Progress bar + dots */}
      <div className="px-4 pb-3">
        {/* Thin progress bar for current slide */}
        <div className="w-full h-0.5 bg-muted rounded-full mb-2 overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-none"
            style={{ width: `${paused ? progress : progress}%` }}
          />
        </div>
        {/* Dots */}
        <div className="flex items-center justify-center gap-1.5">
          {photos.map((_, i) => (
            <button
              key={i}
              onClick={() => goTo(i, i > current ? "next" : "prev")}
              className={`rounded-full transition-all duration-200 ${
                i === current
                  ? "w-4 h-1.5 bg-primary"
                  : "w-1.5 h-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/60"
              }`}
            />
          ))}
        </div>
      </div>

      {/* CSS keyframes injected inline */}
      <style>{`
        @keyframes reel-next {
          from { opacity: 0; transform: scale(0.82) translateX(30px) rotate(4deg); }
          to   { opacity: 1; transform: scale(1)    translateX(0)     rotate(0deg); }
        }
        @keyframes reel-prev {
          from { opacity: 0; transform: scale(0.82) translateX(-30px) rotate(-4deg); }
          to   { opacity: 1; transform: scale(1)    translateX(0)      rotate(0deg); }
        }
      `}</style>
    </div>
  );
}
