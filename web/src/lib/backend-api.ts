const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";

export type UserProfile = {
  id: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  is_guest: boolean;
  created_at: string;
  updated_at: string;
  last_login_at: string;
};

export type Segment = {
  start: number;
  duration: number;
  text: string;
  source: "youtube_captions" | "whisper";
  translated_text: string | null;
  audio_path: string | null;
  audio_ms: number | null;
};

export type ProcessResult = {
  video_id: string;
  segments: Segment[];
};

export async function syncFirebaseUser(idToken: string): Promise<UserProfile> {
  const response = await fetch(`${API_BASE_URL}/auth/sync`, {
    method: "POST",
    credentials: "include",
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Backend auth sync failed: ${detail}`);
  }

  return response.json();
}

// Creates a guest/tester session: backend issues an httponly session cookie
// and we get back a guest UserProfile. Used whenever Firebase auth isn't
// available or fails, so the app stays usable without signing in.
export async function createGuestSession(): Promise<UserProfile> {
  const response = await fetch(`${API_BASE_URL}/auth/guest`, {
    method: "POST",
    credentials: "include",
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Guest session creation failed: ${detail}`);
  }

  return response.json();
}

// Restores whichever session is active: a Firebase ID token (pass it in
// when a Firebase user is signed in client-side) or the session_id cookie
// set by createGuestSession. Throws (401) if neither is present/valid.
export async function getCurrentUser(idToken?: string): Promise<UserProfile> {
  const headers: HeadersInit = {};
  if (idToken) {
    headers.Authorization = `Bearer ${idToken}`;
  }

  const response = await fetch(`${API_BASE_URL}/auth/me`, {
    credentials: "include",
    headers,
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Fetching current user failed: ${detail}`);
  }

  return response.json();
}

export async function processVideo(videoId: string): Promise<ProcessResult> {
  const response = await fetch(`${API_BASE_URL}/process`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ video_id: videoId }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Video processing failed: ${detail}`);
  }

  return response.json();
}
