import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parse } from 'dotenv';
import { commitment, parseSalt } from '../src/strategy.js';
test('CLI persists missing salt and prints only a stable public hash', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vfy-commit-'));
    const params = ['6', '0', '0', '0', '0', '0', '0', '0'];
    await writeFile(join(dir, '.env'), 'STRATEGY_PARAMS=' + JSON.stringify(params) + '\nSTRATEGY_SALT=\n');
    const env = { ...process.env };
    delete env.STRATEGY_PARAMS;
    delete env.STRATEGY_SALT;
    try {
        const run = () => promisify(execFile)(process.execPath, [resolve('dist/src/commit.js')], { cwd: dir, env, timeout: 30000 });
        const first = await run();
        assert.match(first.stdout, /^0x[0-9a-f]{64}\r?\n$/);
        assert.equal(first.stderr, '');
        const saved = parse(await readFile(join(dir, '.env'), 'utf8'));
        const salt = parseSalt(saved.STRATEGY_SALT);
        assert.equal(first.stdout.trim(), await commitment(params.map(BigInt), salt));
        const second = await run();
        assert.equal(first.stdout, second.stdout);
    }
    finally {
        await rm(dir, { recursive: true, force: true });
    }
});
