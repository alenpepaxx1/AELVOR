"use client";
// Copyright © 2026 Alen Pepa
import { useEffect, useRef, useState } from "react";
import { addProjectVersion, mergeProjectVersions, readProjectVersions, validateProjectVersions, writeProjectVersions, type ProjectVersion } from "../lib/project-versions";
import type { CodeProject } from "../lib/code-projects";
export function useProjectVersions() {
  const [versions, setVersions] = useState<ProjectVersion[]>([]), [persisted, setPersisted] = useState(true), [loadError, setLoadError] = useState(false), [ready, setReady] = useState(false);
  const current = useRef<ProjectVersion[]>([]), initialized = useRef(false);
  function ensure() { if (initialized.current) return; const result = readProjectVersions(); current.current = result.versions; initialized.current = true; setVersions(result.versions); setLoadError(result.error); setPersisted(!result.error); setReady(true); }
  useEffect(ensure, []);
  function save(next: ProjectVersion[]) { const checked = validateProjectVersions(next); current.current = checked; setVersions(checked); const saved = writeProjectVersions(checked); setPersisted(saved); setLoadError(false); return saved; }
  function capture(project: CodeProject, label: string) { ensure(); const result = addProjectVersion(current.current, project, label, crypto.randomUUID()); const saved = save(result.versions); return { ...result, persisted: saved }; }
  function remove(id: string) { ensure(); return save(current.current.filter(version => version.id !== id)); }
  function merge(incoming: ProjectVersion[]) { ensure(); const result = mergeProjectVersions(current.current, incoming, () => crypto.randomUUID()); return { ...result, persisted: save(result.versions) }; }
  function retry() { ensure(); return save(current.current); }
  return { versions, ready, persisted, loadError, capture, remove, merge, retry };
}
export type ProjectVersionStore = ReturnType<typeof useProjectVersions>;
