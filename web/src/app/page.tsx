"use client";

import { useState } from "react";
import { ThemeProvider } from "@/_comps/providers/ThemeProvider";
import { useAuth } from "@/_comps/providers/AuthProvider";
import Header from "@/_comps/Header";
import SearchBox from "@/_comps/SearchBox";
import DashboardView from "@/_comps/dashboard/DashboardView";
import SignInModal from "@/_comps/SignInModal";
import AnimatedBackground from "@/_comps/AnimatedBackground";
import { HISTORY } from "@/_comps/dashboard/data";

// Нэвтэрсэн хэрэглэгч dashboard-д орох үед урьдчилан сонгогдох видео.
const DEFAULT_VIDEO_URL = `https://www.youtube.com/watch?v=${HISTORY[0].id}`;

export default function Home() {
  const { user, loading, logout } = useAuth();
  const [videoUrl, setVideoUrl] = useState("");
  const [showSignIn, setShowSignIn] = useState(false);

  const handleSearch = (url: string) => setVideoUrl(url);

  // Firebase эхний auth төлвийг тодорхойлох хүртэл юу ч рендэрлэхгүй.
  // Сервер дээр auth тодорхойгүй тул full-screen div рендэрлэвэл hydration зөрүү
  // (+ browser extension) улмаас тэр хар div DOM-д үлдэж 2 давхар болдог байсан.
  if (loading) {
    return null;
  }

  // Нэвтэрсэн хэрэглэгч → шууд dashboard (видео + түүх + тэмдэглэл).
  // dashboard shell нь өөрийн header/background-тай тул target Header-ийг харуулахгүй.
  if (user) {
    return (
      <ThemeProvider>
        <DashboardView
          videoUrl={videoUrl || DEFAULT_VIDEO_URL}
          onBack={() => setVideoUrl("")}
          onSearch={handleSearch}
          onLogout={() => logout()}
        />
      </ThemeProvider>
    );
  }

  // Нэвтрээгүй → landing. Хайлт хийх/dashboard руу орохын тулд эхлээд нэвтрэх
  // шаардлагатай (backend /process нь auth шаарддаг).
  return (
    <ThemeProvider>
      <div className="min-h-screen bg-background text-foreground transition-colors duration-300">
        <Header onSignIn={() => setShowSignIn(true)} />

        <main className="min-h-screen flex flex-col items-center justify-center pt-20 pb-12 px-4">
          <div className="w-full flex flex-col items-center justify-center">
            <AnimatedBackground />
            <div className="relative w-full flex flex-col items-center">
              <SearchBox onSubmit={() => setShowSignIn(true)} />
            </div>
          </div>
        </main>

        {showSignIn && <SignInModal onClose={() => setShowSignIn(false)} />}
      </div>
    </ThemeProvider>
  );
}
