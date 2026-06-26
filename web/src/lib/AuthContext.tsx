"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { createGuestSession, getCurrentUser, type UserProfile } from "@/lib/backend-api";
import { firebaseAuth } from "@/lib/firebase";

type AuthContextType = {
  currentUser: UserProfile | null;
  isLoading: boolean;
  setCurrentUser: (user: UserProfile | null) => void;
};

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    // onAuthStateChanged fires once immediately with whatever Firebase has
    // already restored from its own persistence (or null), then again on
    // future sign-in/out. Using it (instead of reading firebaseAuth.currentUser
    // synchronously) avoids a race where that restoration hasn't finished yet.
    const unsubscribe = onAuthStateChanged(firebaseAuth, async (firebaseUser) => {
      try {
        const idToken = firebaseUser ? await firebaseUser.getIdToken() : undefined;
        const user = await getCurrentUser(idToken);
        if (!cancelled) setCurrentUser(user);
      } catch {
        try {
          const guest = await createGuestSession();
          if (!cancelled) setCurrentUser(guest);
        } catch (error) {
          console.error("[auth] Could not restore session or create a guest session", error);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return (
    <AuthContext.Provider value={{ currentUser, isLoading, setCurrentUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
