import { getToken } from "./auth";
import type { ApiErrorResponse } from "./types";

// Use 127.0.0.1 by default to avoid localhost port collisions
// with extension dev tooling that may bind IPv6 localhost.
const API_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:3000";

export class AuthError extends Error {
  constructor(message: string = "Not authenticated. Configure your API token in extension settings.") {
    super(message);
    this.name = "AuthError";
  }
}

async function parseJsonSafe<T>(response: Response): Promise<T | null> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = await getToken();
  if (!token) {
    throw new AuthError();
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
      ...options.headers,
    },
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new AuthError("Invalid API token. Check your token in extension settings.");
    }
    const errorData = await parseJsonSafe<ApiErrorResponse>(response);
    throw new Error(errorData?.error?.message || `API error: ${response.status}`);
  }

  // Some endpoints may legitimately return empty body (e.g. 204).
  if (response.status === 204) return null as T;

  const data = await parseJsonSafe<T>(response);
  if (data === null) {
    throw new Error("Connection failed: server returned an empty or invalid JSON response.");
  }
  return data;
}
