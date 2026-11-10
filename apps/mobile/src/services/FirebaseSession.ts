/**
 * FirebaseSession — guarantees a Firebase Auth session whose uid equals the
 * StrideClash user id before any Storage upload.
 *
 * Google users usually already have one. Email/password users get a custom
 * token from the backend (POST /api/auth/firebase-token), which verifies the
 * backend JWT first. Storage rules then enforce `request.auth.uid == userId`.
 */
import { signInWithCustomToken, signOut } from 'firebase/auth';
import { auth } from '@/config/firebase';
import { apiFetch } from '@/config/api';

export class UploadsUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UploadsUnavailableError';
  }
}

let pending: Promise<void> | null = null;

export async function ensureFirebaseSession(userId: string): Promise<void> {
  if (auth?.currentUser?.uid === userId) return;
  if (pending) return pending;
  pending = (async () => {
    if (auth?.currentUser && auth.currentUser.uid !== userId) {
      await signOut(auth).catch(() => {});
    }
    const res = await apiFetch('/api/auth/firebase-token', { method: 'POST' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body?.firebaseToken) {
      if (body?.code === 'FIREBASE_ADMIN_NOT_CONFIGURED') {
        throw new UploadsUnavailableError('Photo uploads are not enabled on the server yet. Please try again later.');
      }
      throw new Error(body?.error || 'Could not start an upload session.');
    }
    const cred = await signInWithCustomToken(auth, body.firebaseToken);
    if (cred.user.uid !== userId) throw new Error('Upload session mismatch. Please log in again.');
  })().finally(() => { pending = null; });
  return pending;
}

export async function clearFirebaseSession(): Promise<void> {
  try {
    if (auth?.currentUser) await signOut(auth);
  } catch {}
}
