// Copyright © 2026 Alen Pepa
export const profileStorageKey = "aelvor-profile-v1";
export type UserProfile = { version: 1; username: string; setupPending?: true };
export type UsernameIssue = "required" | "length" | "characters";

export function usernameIssue(value: string): UsernameIssue | null {
  const name = value.trim().normalize("NFC"), length = Array.from(name).length;
  if (!name) return "required";
  if (length < 2 || length > 24) return "length";
  return /^[\p{L}\p{N}][\p{L}\p{M}\p{N}._-]*$/u.test(name) ? null : "characters";
}

export function validUsername(value: unknown): string | null {
  return typeof value === "string" && !usernameIssue(value) ? value.trim().normalize("NFC") : null;
}

export function usernameInitials(value: string): string {
  const name = validUsername(value);
  if (!name) return "U";
  const parts = name.split(/[._-]+/u).filter(Boolean);
  const initials = parts.length > 1 ? `${Array.from(parts[0])[0]}${Array.from(parts[1])[0]}` : Array.from(name).slice(0, 2).join("");
  return Array.from(initials.toUpperCase()).slice(0, 2).join("");
}

export function readUserProfile(storage?: Pick<Storage, "getItem">): UserProfile | null {
  try {
    const raw = (storage ?? globalThis.localStorage).getItem(profileStorageKey);
    if (!raw || raw.length > 4096) return null;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value) || !("version" in value) || value.version !== 1 || !("username" in value)) return null;
    const username = validUsername(value.username);
    return username ? { version: 1, username, ...("setupPending" in value && value.setupPending !== false ? { setupPending: true as const } : {}) } : null;
  } catch { return null; }
}

export function saveUserProfile(value: string, storage?: Pick<Storage, "setItem">, options?: { setupPending?: boolean }): { profile: UserProfile; persisted: boolean } {
  const username = validUsername(value);
  if (!username) throw new Error("invalid_username");
  const profile: UserProfile = { version: 1, username, ...(options?.setupPending ? { setupPending: true as const } : {}) };
  try { (storage ?? globalThis.localStorage).setItem(profileStorageKey, JSON.stringify(profile)); return { profile, persisted: true }; }
  catch { return { profile, persisted: false }; }
}
