import { User } from "lucide-react";
import { Link } from "wouter";

interface PersonCardProps {
  id: string;
  name: string | null;
  coverUrl: string | null;
  faceCount: number;
}

export default function PersonCard({ id, name, coverUrl, faceCount }: PersonCardProps) {
  return (
    <Link href={`/people/${id}`}>
      <a className="group flex flex-col items-center gap-2 cursor-pointer">
        <div className="w-24 h-24 rounded-full overflow-hidden bg-muted ring-2 ring-transparent group-hover:ring-primary/50 transition-all shadow-md">
          {coverUrl ? (
            <img
              src={coverUrl}
              alt={name ?? "Unknown person"}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/20 to-primary/5">
              <User className="w-10 h-10 text-primary/40" />
            </div>
          )}
        </div>
        <div className="text-center max-w-[96px]">
          <p className="text-sm font-medium truncate text-foreground">
            {name ?? "Unknown"}
          </p>
          <p className="text-xs text-muted-foreground">{faceCount} photo{faceCount !== 1 ? "s" : ""}</p>
        </div>
      </a>
    </Link>
  );
}
