import axios, { type AxiosRequestConfig } from "axios";
import { firebaseAuth } from "@/lib/firebase";

// Single shared axios instance pointed at the FastAPI backend.
// - baseURL: the deployed backend (falls back to localhost for dev).
// - withCredentials: sends the httponly guest `session_id` cookie cross-site,
//   so unauthenticated/guest requests still authenticate.
const api = axios.create({
  baseURL: (
    process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000"
  ).replace(/\/+$/, ""),
  withCredentials: true,
});

// Attach the Firebase ID token on every request when a user is signed in.
// Runs per-request (not at import) so it always uses the current user.
api.interceptors.request.use(async (config) => {
  const user = firebaseAuth.currentUser;
  if (user) {
    const token = await user.getIdToken();
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Surface FastAPI's `{ "detail": "..." }` as the error message so callers can
// show something useful instead of a generic "Request failed with status 500".
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const detail = error?.response?.data?.detail;
    if (typeof detail === "string") {
      error.message = detail;
    }
    return Promise.reject(error);
  },
);

/**
 * Thin typed wrapper around the shared instance.
 *
 * `data`   = the request BODY (JSON). Its shape must match the FastAPI
 *            endpoint's Pydantic model (snake_case keys). axios serializes it
 *            and sets Content-Type for you. Omit it when the request has no body.
 * `params` = the URL query string, e.g. { limit: 30 } -> "?limit=30".
 *
 *   // GET, no body:
 *   const user = await apifetch<UserProfile>("/auth/me");
 *
 *   // GET with query string:
 *   const history = await apifetch<VideoHistoryRecord[]>("/videos/history", {
 *     params: { limit: 30 },
 *   });
 *
 *   // POST with a JSON body (matches ProcessRequest{ video_id }):
 *   const result = await apifetch<ProcessResult>("/process", {
 *     method: "POST",
 *     data: { video_id: videoId },
 *   });
 *
 *   // POST with no body (e.g. /auth/guest): just omit `data`.
 *   const guest = await apifetch<UserProfile>("/auth/guest", { method: "POST" });
 *
 * Returns the parsed JSON body (response.data) directly, and throws on non-2xx
 * with the backend's `detail` as the message.
 */
export async function apifetch<T = unknown>(
  path: string,
  config: AxiosRequestConfig = {},
): Promise<T> {
  const response = await api.request<T>({
    url: path,
    method: config.method ?? "GET",
    ...config,
  });
  return response.data;
}

export default api;
