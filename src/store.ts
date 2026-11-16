import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
export type CachedResponse = {
    digest: string;
    payload: string;
    signature: string;
    idempotencyKey: string;
};
export class Store {
    constructor(private dir: string) { }
    private path(key: string) { return join(this.dir, createHash('sha256').update(key).digest('hex') + '.json'); }
    async get(key: string): Promise<CachedResponse | undefined> { try {
        const v = JSON.parse(await readFile(this.path(key), 'utf8'));
        if (!v || !['digest', 'payload', 'signature', 'idempotencyKey'].every(k => typeof v[k] === 'string'))
            throw new Error('Invalid cached response');
        return v;
    }
    catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT')
            return;
        throw e;
    } }
    async put(key: string, value: CachedResponse) { await mkdir(this.dir, { recursive: true, mode: 0o700 }); const path = this.path(key); await writeFile(path + '.tmp', JSON.stringify(value), { mode: 0o600 }); await rename(path + '.tmp', path); }
}
