// Copyright © 2026 Alen Pepa
import { restoreWorkspace } from "./workspace-state.ts";

export const workspaceStorageKey = "aegis-workspace-v1";
export type WorkspaceSnapshot = Omit<ReturnType<typeof restoreWorkspace>, "repaired">;
export type WorkspaceStorageIssue = { kind: "invalid" | "unavailable"; raw: string | null };
type StorageHost = Pick<Storage, "getItem" | "setItem">;
type WorkspaceRead = { data: ReturnType<typeof restoreWorkspace>; issue: null } | { data: null; issue: WorkspaceStorageIssue };

/** Failed reads must never authorize an automatic write over existing data. */
export class WorkspaceStorage {
  private allowed = false;
  private readonly host: () => StorageHost;
  constructor(host: () => StorageHost = () => localStorage) { this.host = host; }

  get writable() { return this.allowed; }

  read(): WorkspaceRead {
    this.allowed = false;
    let raw: string | null;
    try { raw = this.host().getItem(workspaceStorageKey); }
    catch { return { data: null, issue: { kind: "unavailable", raw: null } }; }
    try {
      const input: unknown = raw === null ? null : JSON.parse(raw);
      if (raw !== null) {
        if (!input || typeof input !== "object" || Array.isArray(input)) throw Error("workspace_shape");
        for (const key of ["chats", "projects"] as const) {
          if (key in input && !Array.isArray((input as Record<string, unknown>)[key])) throw Error("workspace_shape");
        }
      }
      const data = restoreWorkspace(input);
      this.allowed = true;
      return { data, issue: null };
    } catch { return { data: null, issue: { kind: "invalid", raw } }; }
  }

  save(snapshot: WorkspaceSnapshot): boolean {
    return this.allowed && this.persist(snapshot);
  }

  /** Only the explicit recovery action may replace an unreadable snapshot. */
  replace(snapshot: WorkspaceSnapshot): boolean {
    if (!this.persist(snapshot)) return false;
    this.allowed = true;
    return true;
  }

  private persist(snapshot: WorkspaceSnapshot): boolean {
    try { this.host().setItem(workspaceStorageKey, JSON.stringify(snapshot)); return true; }
    catch { return false; }
  }
}
