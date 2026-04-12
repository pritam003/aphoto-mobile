import { Link, useLocation } from "wouter";
import { Images, Heart, BookImage, Trash2, LogOut, Sun, Moon, Upload, EyeOff } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useAuthLogout, useGetPhotoStats } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { formatBytes } from "@/lib/api";
import { useState } from "react";

interface SidebarProps {
  onUploadClick: () => void;
  darkMode: boolean;
  onToggleDark: () => void;
}

export default function Sidebar({ onUploadClick, darkMode, onToggleDark }: SidebarProps) {
  const [location] = useLocation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const logout = useAuthLogout();
  const { data: stats } = useGetPhotoStats();

  const handleLogout = async () => {
    await logout.mutateAsync();
    queryClient.clear();
    window.location.href = "/login";
  };

  const navItems = [
    { href: "/", icon: Images, label: "Photos", count: stats?.total },
    { href: "/favorites", icon: Heart, label: "Favorites", count: stats?.favorites },
    { href: "/albums", icon: BookImage, label: "Albums", count: stats?.albums },
    { href: "/archive", icon: EyeOff, label: "Archive", count: (stats as any)?.hidden },
    { href: "/trash", icon: Trash2, label: "Trash", count: stats?.trashed },
  ];

  return (
    <div className="flex flex-col h-full bg-sidebar border-r border-sidebar-border w-64 shrink-0">
      <div className="p-5 border-b border-sidebar-border">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center">
            <Images className="w-4 h-4 text-primary" />
          </div>
          <span className="text-base font-semibold text-sidebar-foreground">My Photos</span>
        </div>
      </div>

      <div className="p-3">
        <button
          onClick={onUploadClick}
          data-testid="button-upload"
          className="w-full flex items-center gap-2.5 px-3 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          <Upload className="w-4 h-4" />
          Upload Photos
        </button>
      </div>

      <nav className="flex-1 px-3 py-2 space-y-0.5 overflow-y-auto">
        {navItems.map(({ href, icon: Icon, label, count }) => {
          const isActive = href === "/" ? location === "/" || location === "" : location.startsWith(href);
          return (
            <Link key={href} href={href}>
              <a
                data-testid={`nav-${label.toLowerCase()}`}
                className={`flex items-center justify-between gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors group ${
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Icon className={`w-4 h-4 ${isActive ? "text-primary" : "text-sidebar-foreground/70 group-hover:text-primary/70"}`} />
                  {label}
                </div>
                {count !== undefined && count > 0 && (
                  <span className="text-xs text-muted-foreground tabular-nums">{count}</span>
                )}
              </a>
            </Link>
          );
        })}
      </nav>

      {stats && stats.totalSize > 0 && (
        <div className="px-5 py-3 border-t border-sidebar-border">
          <p className="text-xs text-muted-foreground">{formatBytes(stats.totalSize)} used</p>
          <div className="mt-1.5 h-1 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-primary/40 rounded-full w-1/4" />
          </div>
        </div>
      )}

      <div className="p-3 border-t border-sidebar-border space-y-1">
        <button
          onClick={onToggleDark}
          data-testid="button-toggle-theme"
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-sidebar-foreground hover:bg-sidebar-accent/60 transition-colors"
        >
          {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          {darkMode ? "Light mode" : "Dark mode"}
        </button>

        {user && (
          <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg">
            <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-xs font-semibold shrink-0">
              {user.name?.[0]?.toUpperCase() ?? "U"}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-sidebar-foreground truncate">{user.name}</p>
              <p className="text-xs text-muted-foreground truncate">{user.email}</p>
            </div>
            <button
              onClick={handleLogout}
              data-testid="button-logout"
              title="Sign out"
              className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
