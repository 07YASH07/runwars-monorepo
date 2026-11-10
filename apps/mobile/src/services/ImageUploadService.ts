/**
 * ImageUploadService — uploads a local image URI (as returned by
 * expo-image-picker) to Firebase Storage and returns a public download
 * URL suitable for storing in `posts.image_url`.
 *
 * Requirements enforced here:
 *   - MIME type is whitelisted (jpeg | png | webp | heic).
 *   - Size is capped at 5 MB.
 *   - Content path is namespaced by user id to allow Storage Security Rules
 *     like `request.auth.uid == userId`.
 *   - Upload uses resumable upload so we can report progress.
 *   - Failures surface the HTTP / Firebase error message to the caller.
 */
import { storage } from '@/config/firebase';
import { ensureFirebaseSession } from '@/services/FirebaseSession';
import {
  ref as storageRef,
  uploadBytesResumable,
  getDownloadURL,
  UploadTaskSnapshot,
} from 'firebase/storage';

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

export interface LocalImage {
  uri: string;
  mimeType?: string | null;
  fileSize?: number | null;
  width?: number | null;
  height?: number | null;
}

export interface UploadResult {
  url: string;
  path: string;
  mimeType: string;
  bytes: number;
}

export interface UploadOptions {
  userId: string;
  kind?: 'post' | 'avatar' | 'cover';
  onProgress?: (fraction: number) => void;
}

function guessMime(uri: string, declared?: string | null): string {
  if (declared && ALLOWED_MIME.has(declared.toLowerCase())) return declared.toLowerCase();
  const lower = uri.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.heic')) return 'image/heic';
  if (lower.endsWith('.heif')) return 'image/heif';
  return 'image/jpeg';
}

function extForMime(mime: string): string {
  switch (mime) {
    case 'image/png': return 'png';
    case 'image/webp': return 'webp';
    case 'image/heic': return 'heic';
    case 'image/heif': return 'heif';
    default: return 'jpg';
  }
}

export async function uploadPostImage(image: LocalImage, opts: UploadOptions): Promise<UploadResult> {
  if (!image?.uri) throw new Error('No image selected');
  if (!opts?.userId) throw new Error('userId required for upload path');

  const mime = guessMime(image.uri, image.mimeType);
  if (!ALLOWED_MIME.has(mime)) {
    throw new Error(`Unsupported image type: ${mime}`);
  }

  // 1. Read the local file as a Blob. React Native's fetch supports file://
  //    and content:// URIs returned by expo-image-picker.
  const resp = await fetch(image.uri);
  if (!resp.ok) throw new Error(`Could not read local image (${resp.status})`);
  const blob = await resp.blob();

  const sizeBytes = image.fileSize ?? blob.size ?? 0;
  if (sizeBytes > MAX_BYTES) {
    throw new Error(
      `Image is ${(sizeBytes / 1024 / 1024).toFixed(1)} MB — max ${(MAX_BYTES / 1024 / 1024).toFixed(0)} MB.`
    );
  }

  // 2. Make sure Firebase Auth uid === our user id (Storage rules check this).
  await ensureFirebaseSession(opts.userId);

  // 3. Build a user-scoped path so Storage rules can gate writes by uid.
  const kind = opts.kind || 'post';
  const filename = `${Date.now()}.${extForMime(mime)}`;
  const path = `${kind}-images/${opts.userId}/${filename}`;
  const ref = storageRef(storage, path);

  // 3. Resumable upload with progress reporting.
  const task = uploadBytesResumable(ref, blob, { contentType: mime });
  await new Promise<void>((resolve, reject) => {
    task.on(
      'state_changed',
      (snap: UploadTaskSnapshot) => {
        if (opts.onProgress && snap.totalBytes > 0) {
          opts.onProgress(snap.bytesTransferred / snap.totalBytes);
        }
      },
      (err: any) => {
        const code = String(err?.code || '');
        const friendly =
          code === 'storage/unauthorized' ? 'Upload was not permitted. Please log out and back in, then try again.' :
          code === 'storage/canceled' ? 'Upload cancelled.' :
          code === 'storage/retry-limit-exceeded' ? 'Upload timed out. Check your connection and try again.' :
          code === 'storage/quota-exceeded' ? 'Storage quota exceeded. Please try again later.' :
          (err?.message || 'Upload failed.');
        reject(new Error(friendly));
      },
      () => resolve()
    );
  });

  // 4. Get the long-lived public download URL with Firebase token.
  const url = await getDownloadURL(ref);
  return { url, path, mimeType: mime, bytes: sizeBytes || blob.size || 0 };
}

export function isRemoteImageUrl(u: string | null | undefined): boolean {
  if (!u) return false;
  return /^https?:\/\//i.test(u);
}
