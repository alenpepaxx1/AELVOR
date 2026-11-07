// Copyright © 2026 Alen Pepa
export function errorMessage(value: unknown, fallback = "unknown"): string {
  if (typeof value === "string" && value.trim()) return value;
  if (value && typeof value === "object" && "message" in value && typeof value.message === "string" && value.message.trim()) return value.message;
  return fallback;
}

export function asError(value: unknown, fallback = "unknown"): Error {
  return value instanceof Error ? value : new Error(errorMessage(value, fallback));
}
