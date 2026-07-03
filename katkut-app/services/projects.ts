// Local project persistence — drafts (timelines not yet exported) and the library
// (exported reels). File-system backed (expo-file-system), no server, no native module.
// One JSON index holds every project incl. its EDL + cached analyses so a draft can be
// fully reopened (edit + export) without re-analyzing. See CLAUDE.md (on-device only).
import { Directory, File, Paths } from 'expo-file-system';
import * as LegacyFS from 'expo-file-system/legacy';
import { AnalysisClip, Edl } from '../core';

export type ProjectStatus = 'draft' | 'exported';

export interface Project {
  id: string;
  status: ProjectStatus;
  title: string;
  vibeId: string;
  createdAt: number;
  updatedAt: number;
  durationSec: number;
  clipCount: number;
  thumbUri?: string;
  /** set once the reel has been exported — path to the saved MP4 */
  exportedPath?: string;
  edl: Edl;
  analyses: AnalysisClip[];
}

const DIR = new Directory(Paths.document, 'katkut-projects');
const INDEX = new File(DIR, 'projects.json');

function ensureDir() {
  try {
    if (!DIR.exists) DIR.create({ intermediates: true });
  } catch {
    // already exists / race — ignore
  }
}

async function loadAll(): Promise<Project[]> {
  try {
    if (!INDEX.exists) return [];
    const text = await INDEX.text();
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? (parsed as Project[]) : [];
  } catch {
    return [];
  }
}

async function saveAll(projects: Project[]): Promise<void> {
  ensureDir();
  try {
    if (!INDEX.exists) INDEX.create();
  } catch {
    // exists — ignore
  }
  await INDEX.write(JSON.stringify(projects));
}

function durationOf(edl: Edl): number {
  return edl.timeline.reduce((s, t) => s + Math.max(0, t.out - t.in), 0);
}

// ---- durable media ----
// Picked clips/photos live in the app CACHE dir (expo-image-picker copies them there), which the
// OS may purge at any time — a draft that references cache URIs silently breaks later (preview
// falls back to nothing, export fails at setDataSource). So on every draft save we copy each
// source into the project's own folder under the DOCUMENT dir and rewrite the stored URIs.
// Same for the exported MP4 (kept only in cache otherwise) and the thumbnail.

function projectDir(id: string): Directory {
  return new Directory(DIR, id);
}

function extOf(uri: string, fallback: string): string {
  const m = /\.([A-Za-z0-9]{1,5})(?:[?#].*)?$/.exec(uri);
  return m ? m[1].toLowerCase() : fallback;
}

/**
 * Copy a file into the project's folder and return its durable URI.
 * Idempotent (skips if already copied) and best-effort: any failure returns the original URI —
 * a draft with a cache URI is still better than a failed save.
 */
async function persistFile(id: string, srcUri: string, baseName: string): Promise<string> {
  try {
    const dir = projectDir(id);
    if (!dir.exists) dir.create({ intermediates: true });
    const dest = new File(dir, `${baseName}.${extOf(srcUri, 'bin')}`);
    if (dest.uri === srcUri) return srcUri; // already durable
    if (!dest.exists) {
      // legacy async copy — non-blocking, unlike the new API's sync File.copy (a 40-clip save
      // would freeze the JS thread for seconds)
      await LegacyFS.copyAsync({ from: srcUri, to: dest.uri });
    }
    return dest.uri;
  } catch {
    return srcUri;
  }
}

/** Rewrite every analysis source URI to a durable copy inside the project folder. */
async function persistAnalyses(id: string, analyses: AnalysisClip[]): Promise<AnalysisClip[]> {
  const out: AnalysisClip[] = [];
  for (const a of analyses) {
    if (!a.uri) {
      out.push(a);
      continue;
    }
    const durable = await persistFile(id, a.uri, a.clipId);
    out.push(durable === a.uri ? a : { ...a, uri: durable });
  }
  return out;
}

function defaultTitle(now: number): string {
  const d = new Date(now);
  return `Reel · ${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

function makeId(): string {
  return `proj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function listDrafts(): Promise<Project[]> {
  const all = await loadAll();
  return all.filter((p) => p.status === 'draft').sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function listExports(): Promise<Project[]> {
  const all = await loadAll();
  return all.filter((p) => p.status === 'exported').sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getProject(id: string): Promise<Project | null> {
  const all = await loadAll();
  return all.find((p) => p.id === id) ?? null;
}

export interface SaveDraftInput {
  id?: string;
  vibeId: string;
  edl: Edl;
  analyses: AnalysisClip[];
  title?: string;
  thumbUri?: string;
}

/** Upsert a project as a draft (the app-abandonment auto-save). Returns the stored project.
 *  Sources + thumbnail are copied into durable per-project storage (see persistFile). */
export async function saveDraft(input: SaveDraftInput): Promise<Project> {
  const all = await loadAll();
  const now = Date.now();
  const existing = input.id ? all.find((p) => p.id === input.id) : undefined;
  const id = existing?.id ?? input.id ?? makeId();

  const analyses = await persistAnalyses(id, input.analyses);
  const inputThumb = input.thumbUri ?? existing?.thumbUri;
  const thumbUri = inputThumb ? await persistFile(id, inputThumb, 'thumb') : undefined;

  const project: Project = {
    id,
    // keep it in the library if it was already exported, otherwise it's a draft
    status: existing?.status === 'exported' ? 'exported' : 'draft',
    title: input.title ?? existing?.title ?? defaultTitle(now),
    vibeId: input.vibeId,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    durationSec: durationOf(input.edl),
    clipCount: input.edl.timeline.length,
    thumbUri,
    exportedPath: existing?.exportedPath,
    edl: input.edl,
    analyses,
  };

  const next = existing ? all.map((p) => (p.id === project.id ? project : p)) : [...all, project];
  await saveAll(next);
  return project;
}

/** Promote a project to the library once its reel is exported.
 *  The MP4 is copied out of cache into the project folder so the Library entry survives
 *  cache purges (the gallery copy is separate and already safe). */
export async function markExported(id: string, exportedPath: string): Promise<Project | null> {
  const all = await loadAll();
  const idx = all.findIndex((p) => p.id === id);
  if (idx < 0) return null;
  const durablePath = await persistFile(id, exportedPath, 'export');
  const updated: Project = {
    ...all[idx],
    status: 'exported',
    exportedPath: durablePath,
    updatedAt: Date.now(),
  };
  all[idx] = updated;
  await saveAll(all);
  return updated;
}

export async function deleteProject(id: string): Promise<void> {
  const all = await loadAll();
  await saveAll(all.filter((p) => p.id !== id));
  // remove the project's durable media folder too
  try {
    const dir = projectDir(id);
    if (dir.exists) dir.delete();
  } catch {
    // best-effort cleanup
  }
}

/** A fresh project id for a new session — generated up front so the draft auto-save can use it. */
export function newProjectId(): string {
  return makeId();
}
