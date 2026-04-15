import { useState, useEffect, useCallback, useRef } from "react";
import { ChevronRight, ChevronLeft, X, Pause, Play } from "lucide-react";

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

function getYear(photo: ReelPhoto) {
  const d = photo.takenAt ?? photo.uploadedAt;
  if (!d) return null;
  return new Date(d).getFullYear();
}

const SLIDE_MS = 3500;

export default function OnThisDayReel({ photos, onDismiss }: OnThisDayReelProps) {
  const [current, setCurrent] = useState(0);
  const [paused, setPaused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [dir, setDir] = useState<"next" | "prev">("next");
  const [progress, setProgress] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const progressRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const goTo = useCallback((idx: number, d: "next" | "prev") => {
    setDir(d);
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
    timerRef.current = setInterval(goNext, SLIDE_MS);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [paused, goNext, photos.length]);

  // Progress bar
  useEffect(() => {
    if (paused) return;
    setProgress(0);
    const step = 100 / (SLIDE_MS / 50);
    progressRef.current = setInterval(() => setProgress(p => Math.min(p + step, 100)), 50);
    return () => { if (progressRef.current) clearInterval(progressRef.current); };
  }, [current, paused]);

  const handleDismiss = () => {
    setDismissed(true);
    setTimeout(onDismiss, 280);
  };

  const today = new Date();
  const dayName = today.toLocaleDateString("en-US", { weekday: "long" });

  const photo = photos[current];
  const year = getYear(photo);

  // Cards behind the active one
  const behind1 = photos[(current + 1) % photos.length];
  const behind2 = photos[(current + 2) % photos.length];

  return (
    <>
      <style>{`
        @keyframes card-in-next {
          from { opacity: 0; transform: translateX(48px) scale(0.88) rotate(3deg); }
          to   { opacity: 1; transform: translateX(0)    scale(1)    rotate(0deg); }
        }
        @keyframes card-in-prev {
          from { opacity: 0; transform: translateX(-48px) scale(0.88) rotate(-3deg); }
          to   { opacity: 1; transform: translateX(0)     scale(1)    rotate(0deg); }
        }
      `}</style>

      <div
        className="mb-6"
        style={{
          opacity: dismissed ? 0 : 1,
          transform: dismissed ? "scale(0.96) translateY(-6px)" : "scale(1) translateY(0)",
          transition: "opacity 280ms ease, transform 280ms ease",
        }}
      >
        {/* Header row */}
        <div className="flex items-center justify-between mb-3 px-0.5">
          <div>
            <h2 className="text-base font-semibold text-foreground">On {dayName}s</h2>
            <p className="text-xs text-muted-foreground">
              Past {dayName}s · {photos.length} {photos.length === 1 ? "memory" : "memories"}
            </p>
          </div>
          <div className="flex items-center gap-1">
            {photos.length > 1 && (
              <button
                onClick={() => setPaused(p => !p)}
                className="p-1.5 rounded-full hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                title={paused ? "Play" : "Pause"}
              >
                {paused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
              </button>
            )}
            <button
              onClick={handleDismiss}
              className="p-1.5 rounded-full hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              title="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Reel stage */}
        <div
          className="relative flex items-center justify-center"
          style={{ height: 300 }}
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
        >
          {/* Card 3rd back */}
          {photos.length > 2 && (
            <div
              className="absolute rounded-2xl overflow-hidden shadow-md"
              style={{
                width: 220,
                height: 260,
                transform: "rotate(-6deg) translateY(14px) translateX(-10px)",
                zIndex: 1,
                opacity: 0.45,
              }}
            >
              <img src={behind2.thumbnailUrl || behind2.url} className="w-full h-full object-cover" alt="" />
            </div>
          )}

          {/* Card 2nd back */}
          {photos.length > 1 && (
            <div
              className="absolute rounded-2xl overflow-hidden shadow-lg"
              style={{
                width: 234,
                height: 272,
                transform: "rotate(-3deg) translateY(8px) translateX(-5px)",
                zIndex: 2,
                opacity: 0.7,
              }}
            >
              <img src={behind1.thumbnailUrl || behind1.url} className="w-full h-full object-cover" alt="" />
            </div>
          )}

          {/* Active card */}
          <div
            key={`${photo.id}-${current}`}
            className="absolute rounded-2xl overflow-hidden shadow-2xl"
            style={{
              width: 248,
              height: 286,
              zIndex: 10,
              animation: `card-in-${dir} 0.38s cubic-bezier(0.34, 1.4, 0.64, 1) both`,
            }}
          >
            <img
              src={photo.thumbnailUrl || photo.url}
              alt={photo.filename}
              className="w-full h-full object-cover"
            />
            {/* Gradient overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />

            {/* Progress bar on active card */}
            <div className="absolute top-0 inset-x-0 h-1 bg-white/20 rounded-full overflow-hidden">
              <div
                className="h-full bg-white rounded-full"
                style={{ width: `${progress}%`, transition: paused ? "none" : "none" }}
              />
            </div>

            {/* Bottom info */}
            <div className="absolute bottom-0 inset-x-0 p-4">
              {year && (
                <p className="text-white/70 text-xs font-medium mb-0.5">{year}</p>
              )}
              <p className="text-white font-bold text-base leading-tight">
                {dayName} memory
              </p>
            </div>

            {/* Counter badge top-right */}
            <div className="absolute top-3 right-3 bg-black/50 text-white text-xs font-semibold px-2 py-0.5 rounded-full backdrop-blur-sm">
              {current + 1} / {photos.length}
            </div>
          </div>

          {/* Prev button */}
          {photos.length > 1 && (
            <button
              onClick={goPrev}
              className="absolute left-[calc(50%-148px)] top-1/2 -translate-y-1/2 -translate-x-5
                         z-20 w-9 h-9 rounded-full bg-white/90 shadow-lg
                         flex items-center justify-center text-gray-800
                         hover:bg-white hover:shadow-xl transition-all
                         opacity-0 hover:opacity-100"
              style={{ opacity: undefined }}
              onMouseEnter={e => (e.currentTarget.style.opacity = "1")}
              onMouseLeave={e => (e.currentTarget.style.opacity = "")}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          )}

          {/* Next button */}
          {photos.length > 1 && (
            <button
              onClick={goNext}
              className="absolute right-[calc(50%-148px)] top-1/2 -translate-y-1/2 translate-x-5
                         z-20 w-9 h-9 rounded-full bg-white/90 shadow-lg
                         flex items-center justify-center text-gray-800
                         hover:bg-white hover:shadow-xl transition-all"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Dot indicators */}
        {photos.length > 1 && (
          <div className="flex items-center justify-center gap-1.5 mt-3">
            {photos.map((_, i) => (
              <button
                key={i}
                onClick={() => goTo(i, i > current ? "next" : "prev")}
                className="rounded-full transition-all duration-200"
                style={{
                  width: i === current ? 16 : 6,
                  height: 6,
                  background: i === current ? "hsl(var(--primary))" : "hsl(var(--muted-foreground) / 0.3)",
                }}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
