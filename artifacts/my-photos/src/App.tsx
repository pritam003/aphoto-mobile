import { Switch, Route, Router as WouterRouter, useLocation, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import Sidebar from "@/components/Sidebar";
import UploadModal from "@/components/UploadModal";
import LibraryPage from "@/pages/library";
import FavoritesPage from "@/pages/favorites";
import AlbumsPage from "@/pages/albums";
import AlbumDetailPage from "@/pages/album-detail";
import TrashPage from "@/pages/trash";
import LoginPage from "@/pages/login";
import SharePage from "@/pages/share";
import NotFound from "@/pages/not-found";
import { useAuth } from "@/hooks/useAuth";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 2 * 60 * 1000,
      retry: (count, err: any) => {
        if (err?.status === 401 || err?.response?.status === 401) return false;
        return count < 2;
      },
    },
  },
});

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const [location] = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Redirect to="/login" />;
  }

  return <>{children}</>;
}

function AppLayout() {
  const [showUpload, setShowUpload] = useState(false);
  const [darkMode, setDarkMode] = useState(() => {
    return document.documentElement.classList.contains("dark") ||
      window.matchMedia("(prefers-color-scheme: dark)").matches;
  });

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
  }, [darkMode]);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar
        onUploadClick={() => setShowUpload(true)}
        darkMode={darkMode}
        onToggleDark={() => setDarkMode(d => !d)}
      />
      <main className="flex-1 flex flex-col overflow-hidden">
        <Switch>
          <Route path="/" component={LibraryPage} />
          <Route path="/favorites" component={FavoritesPage} />
          <Route path="/albums" component={AlbumsPage} />
          <Route path="/albums/:id" component={AlbumDetailPage} />
          <Route path="/trash" component={TrashPage} />
          <Route component={NotFound} />
        </Switch>
      </main>
      {showUpload && <UploadModal onClose={() => setShowUpload(false)} />}
    </div>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={LoginPage} />
      <Route path="/share/:token" component={SharePage} />
      <Route>
        <AuthGuard>
          <AppLayout />
        </AuthGuard>
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
        <Router />
      </WouterRouter>
    </QueryClientProvider>
  );
}

export default App;
