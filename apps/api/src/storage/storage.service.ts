import type { Readable } from 'node:stream';

/**
 * Where original documents live. Callers only ever deal in opaque keys, never
 * filesystem paths, so the local implementation can be swapped for S3 later
 * without touching them.
 */
export abstract class StorageService {
  /** Stores `data` under `key`. Fails if the key already exists. */
  abstract put(key: string, data: Buffer): Promise<void>;
  abstract getStream(key: string): Promise<Readable>;
  /** Deletes `key`; does nothing if it doesn't exist. */
  abstract delete(key: string): Promise<void>;
}
