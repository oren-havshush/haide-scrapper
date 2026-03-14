interface ApiError extends Error {
  code?: string;
  status?: number;
}

/**
 * Shared fetch helper for API calls.
 * proxy.ts requires Bearer token for ALL /api/* routes.
 * For MVP: expose token via NEXT_PUBLIC_API_TOKEN env variable.
 */
export async function apiFetch(url: string, options?: RequestInit) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options?.headers as Record<string, string>),
  };

  const token =
    typeof window !== "undefined"
      ? process.env.NEXT_PUBLIC_API_TOKEN
      : undefined;
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(url, { ...options, headers });

  if (!res.ok) {
    const errorBody = await res.json().catch(() => null);
    const error: ApiError = Object.assign(
      new Error(
        errorBody?.error?.message ?? `Request failed with status ${res.status}`
      ),
      {
        code: errorBody?.error?.code as string | undefined,
        status: res.status,
      },
    );
    throw error;
  }

  // Handle 204 No Content (e.g., DELETE responses)
  if (res.status === 204) return null;

  return res.json();
}
