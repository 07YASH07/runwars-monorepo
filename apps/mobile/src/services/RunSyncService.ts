/**
 * RunSyncService — durable, offline-tolerant run submission.
 *
 * A finished run is written to AsyncStorage FIRST, then submitted to
 * POST /api/runs. It is removed from the queue only after the server confirms.
 * The endpoint is idempotent (keyed by the run's first GPS timestamp + point
 * count), so retries after a dropped response never create duplicates.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiFetch, getAuthToken } from '@/config/api';

const QUEUE_KEY = '@strideclash:pendingRuns:v1';

export interface PendingRun {
  localId: string;
  userId: string;
  routePoints: { latitude: number; longitude: number; timestamp: number; accuracy?: number }[];
  activityType: 'run' | 'walk' | 'cycle';
  claim: { runSessionId: string; color: string } | null;
  createdAt: number;
  attempts: number;
  lastError?: string;
}

export interface SubmitResult {
  status: 'synced' | 'queued';
  claim?: 'claimed' | 'rejected' | 'lost' | null;
  claimReason?: string | null;
  claimArea?: number;
  distanceMeters?: number;
  error?: string;
}

let flushing: Promise<void> | null = null;

async function readQueue(): Promise<PendingRun[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

async function writeQueue(q: PendingRun[]) {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(q));
}

async function submitOne(run: PendingRun): Promise<{ ok: boolean; retryable: boolean; body?: any; error?: string }> {
  try {
    const res = await apiFetch('/api/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        routePoints: run.routePoints,
        activityType: run.activityType,
        claim: run.claim,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) return { ok: true, retryable: false, body };
    // 4xx (other than auth/rate limit) = the run itself is invalid → don't retry forever.
    // 404 = endpoint not deployed yet; 401 = re-login needed; keep the run and retry later.
    const retryable = res.status >= 500 || [401, 404, 408, 429].includes(res.status);
    return { ok: false, retryable, error: body?.error || `Server error ${res.status}` };
  } catch (e: any) {
    return { ok: false, retryable: true, error: e?.message || 'Network error' };
  }
}

export const RunSyncService = {
  /** Persists the run, then tries to submit it right away. */
  async submit(run: Omit<PendingRun, 'localId' | 'createdAt' | 'attempts'>): Promise<SubmitResult> {
    const entry: PendingRun = {
      ...run,
      localId: `${run.userId}_${run.routePoints[0]?.timestamp ?? Date.now()}_${run.routePoints.length}`,
      createdAt: Date.now(),
      attempts: 0,
    };
    const q = await readQueue();
    if (!q.some(r => r.localId === entry.localId)) q.push(entry);
    await writeQueue(q);

    const result = await submitOne(entry);
    const after = await readQueue();
    if (result.ok) {
      await writeQueue(after.filter(r => r.localId !== entry.localId));
      return {
        status: 'synced',
        claim: result.body?.claim ?? null,
        claimReason: result.body?.claimReason ?? null,
        claimArea: result.body?.claimArea ?? 0,
        distanceMeters: result.body?.distanceMeters,
      };
    }
    if (!result.retryable) {
      await writeQueue(after.filter(r => r.localId !== entry.localId));
      return { status: 'queued', error: result.error };
    }
    await writeQueue(after.map(r => (r.localId === entry.localId ? { ...r, attempts: r.attempts + 1, lastError: result.error } : r)));
    return { status: 'queued', error: result.error };
  },

  /** Retries everything in the queue for the signed-in user. Safe to call often. */
  async flush(userId: string | null | undefined): Promise<void> {
    if (!userId || !getAuthToken()) return;
    if (flushing) return flushing;
    flushing = (async () => {
      const q = await readQueue();
      const remaining: PendingRun[] = [];
      for (const run of q) {
        if (run.userId !== userId) { remaining.push(run); continue; }
        const r = await submitOne(run);
        if (r.ok || !r.retryable) continue;
        remaining.push({ ...run, attempts: run.attempts + 1, lastError: r.error });
      }
      await writeQueue(remaining);
    })().finally(() => { flushing = null; });
    return flushing;
  },

  async pendingCount(userId: string | null | undefined): Promise<number> {
    if (!userId) return 0;
    return (await readQueue()).filter(r => r.userId === userId).length;
  },
};
