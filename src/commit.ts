import { readFile, writeFile, open, unlink, rename } from 'node:fs/promises';
import { config, parse } from 'dotenv';
import { commitment, parseParams, parseSalt, randomSalt } from './strategy.js';
config({ quiet: true });
try {
    const params = parseParams(process.env.STRATEGY_PARAMS);
    const lock = await open('.env.commit.lock', 'wx', 0o600);
    try {
        let current = '';
        try {
            current = await readFile('.env', 'utf8');
        }
        catch (e) {
            if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
                throw e;
        }
        let salt = parse(current).STRATEGY_SALT;
        if (salt && process.env.STRATEGY_SALT && salt !== process.env.STRATEGY_SALT)
            throw new Error();
        if (!salt) {
            salt = process.env.STRATEGY_SALT || randomSalt().toString();
            parseSalt(salt);
            await writeFile('.env.commit.tmp', current.replace(/^STRATEGY_SALT=.*(?:\r?\n|$)/gm, '') + '\nSTRATEGY_SALT=' + salt + '\n', { mode: 0o600, flag: 'wx' });
            await rename('.env.commit.tmp', '.env');
        }
        console.log(await commitment(params, parseSalt(salt)));
    }
    finally {
        await lock.close();
        await unlink('.env.commit.lock');
    }
}
catch {
    console.error('Commitment failed: check private configuration and .env file access.');
    process.exitCode = 1;
}
