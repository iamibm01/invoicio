import type { ConfigService } from '@nestjs/config';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LocalStorageService } from './local-storage.service.js';

describe('LocalStorageService', () => {
  let root: string;
  let storage: LocalStorageService;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'invoicio-storage-'));
    storage = new LocalStorageService({ getOrThrow: () => root } as unknown as ConfigService);
  });

  afterEach(() => rm(root, { recursive: true, force: true }));

  it('round-trips a file by key', async () => {
    await storage.put('biz/abc.pdf', Buffer.from('hello'));
    const chunks: Buffer[] = [];
    for await (const chunk of await storage.getStream('biz/abc.pdf')) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks).toString()).toBe('hello');
  });

  it('refuses to overwrite an existing key', async () => {
    await storage.put('biz/abc.pdf', Buffer.from('one'));
    await expect(storage.put('biz/abc.pdf', Buffer.from('two'))).rejects.toThrow();
  });

  it.each(['../escape.pdf', 'biz/../../escape.pdf', '/etc/passwd', 'biz//x.pdf', ''])(
    'rejects unsafe key %j',
    async (key) => {
      await expect(storage.put(key, Buffer.from('x'))).rejects.toThrow(/storage key/i);
    },
  );

  it('deletes idempotently', async () => {
    await storage.put('biz/abc.pdf', Buffer.from('x'));
    await storage.delete('biz/abc.pdf');
    await storage.delete('biz/abc.pdf');
    await expect(storage.getStream('biz/abc.pdf')).rejects.toThrow();
  });
});
