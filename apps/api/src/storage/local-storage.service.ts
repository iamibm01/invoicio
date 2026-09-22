import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createReadStream } from 'node:fs';
import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { StorageService } from './storage.service.js';

// Keys are generated server-side, but are still validated so a bad key can
// never resolve outside the storage root.
const KEY_PATTERN = /^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*(\.[a-z0-9]+)?$/;

@Injectable()
export class LocalStorageService extends StorageService {
  private readonly root: string;

  constructor(config: ConfigService) {
    super();
    this.root = path.resolve(config.getOrThrow<string>('STORAGE_DIR'));
  }

  async put(key: string, data: Buffer): Promise<void> {
    const filePath = this.resolve(key);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, data, { flag: 'wx' }); // 'wx' = fail if it exists
  }

  async getStream(key: string): Promise<Readable> {
    const filePath = this.resolve(key);
    await access(filePath); // surface a missing file as an error here, not mid-stream
    return createReadStream(filePath);
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }

  private resolve(key: string): string {
    if (!KEY_PATTERN.test(key)) throw new Error(`Invalid storage key: ${key}`);
    const filePath = path.resolve(this.root, key);
    if (!filePath.startsWith(this.root + path.sep)) {
      throw new Error(`Storage key escapes root: ${key}`);
    }
    return filePath;
  }
}
