import { useRef, useState } from "react";
import { ChevronRight, ChevronLeft, X } from "lucide-react";

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

export default function OnThisDayReel({ photos, onDismiss }: OnThisDayReelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);
  const [dismissed, setDismissed] = useState(false);

  const updateScrollButtons = () => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 8);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 8);
  };

  const scroll = (dir: "left" | "right") => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: dir === "right" ? 340 : -340, behavior: "smooth" });
  };

  const handleDismiss = () => {
    setDismissed(true);
    setTimeout(onDismiss, 250);
  };

  const today = new Date();
  const dayName = today.toLocaleDateString("en-US", { weekday: "long" });

  return (
    <div
      className="mb-6 transition-all duration-250"
      style={{ opacity: dismissed ? 0 : 1, transform: dismissed ? "translateY(-8px)" : "translateY(0)" }}
    >
      {/* Section header */}
      <div className="flex items-center justify-between mb-2.5 px-0.5">
        <div>
          <h2 className="text-base font-semibold text-foreground">On {dayName}s</h2>
          <p className="text-xs text-muted-foreground">Past {dayName}s · Over the years</p>
        </div>
        <button
          onClick={handleDismiss}
          className="p-1.5 rounded-full hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          title="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Horizontal card strip */}
      <div className="relative group">
        {/* Left arrow */}
        {canScrollLeft && (
          <button
            onClick={() => scroll("left")}
            className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-3 z-10
                       w-9 h-9 rounded-full bg-white shadow-lg flex items-center justify-center
                       text-gray-700 hover:bg-gray-50 hover:shadow-xl transition-all
                       opacity-0 group-hover:opacity-100"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
        )}

        {/* Right arrow */}
        {canScrollRight && (
          <button
            onClick={() => scroll("right")}
            className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-3 z-10
                       w-9 h-9 rounded-full bg-white shadow-lg flex items-center justify-center
                       text-gray-700 hover:bg-gray-50 hover:shadow-xl transition-all
                       opacity-0 group-hover:opacity-100"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        )}

        {/* Scrollable row */}
        <div
          ref={scrollRef}
          onScroll={updateScrollButtons}
          className="flex gap-3 overflow-x-auto scroll-smooth"
          style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
        >
          {/* First card: wider "header" card */}
          <div
            className="relative flex-shrink-0 rounded-2xl overflow-hidden cursor-pointer hover:scale-[1.02] transition-transform duration-200"
            style={{ width: 220, height: 160 }}
          >
            <img
              src={photos[0].thumbnailUrl || photos[0].url}
              alt={photos[0].filename}
              className="w-full h-full object-cover"
              draggable={false}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent" />
            <div className="absolute bottom-0 left-0 p-3.5">
              <p className="text-white font-bold text-base leading-tight">
                {dayName} memories
              </p>
              <p className="text-white/75 text-xs mt-0.5 font-medium">Over the years</p>
            </div>
          </div>

          {/* Remaining cards */}
          {photos.slice(1).map((photo) => {
            const year = getYear(photo);
            return (
              <div
                key={photo.id}
                className="relative flex-shrink-0 rounded-2xl overflow-hidden cursor-pointer hover:scale-[1.02] transition-transform duration-200"
                style={{ width: 200, height: 160 }}
              >
                <img
                  src={photo.thumbnailUrl || photo.url}
                  alt={photo.filename}
                  className="w-full h-full object-cover"
                  draggable={false}
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
                <div className="absolute bottom-0 left-0 p-3">
                  <p className="text-white font-semibold text-sm leading-tight">Revisit the moment</p>
                  {year && (
                    <p className="text-white/70 text-xs mt-0.5">{year}</p>
                  )}
                </div>
              </div>
            );
          })}

          {/* Spacer so last card isn't flush against edge */}
          <div className="flex-shrink-0 w-1" />
        </div>
      </div>
    </div>
  );
}
