import 'dotenv/config';
import { access } from 'node:fs/promises';
import { buildApp } from './app.js';
import { commitment, parseParams, parseSalt } from './strategy.js';
import { createProver } from './prover.js';
import { Store } from './store.js';
try {
    const secret = process.env.AGENT_GAMES_HMAC_SECRET;
    if (!secret || secret.length < 16)
        throw new Error();
    const params = parseParams(process.env.STRATEGY_PARAMS), salt = parseSalt(process.env.STRATEGY_SALT);
    await access('circuits/vfy-policy.wasm');
    await access('circuits/vfy-policy_final.zkey');
    const port = Number(process.env.PORT || 3000);
    if (!Number.isInteger(port) || port < 1 || port > 65535)
        throw new Error();
    const app = await buildApp({ secret, params, commitment: await commitment(params, salt), prover: createProver(params, salt), store: new Store(process.env.DATA_DIR || 'data') });
    const stop = async () => { await app.close(); };
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
    await app.listen({ port, host: process.env.HOST || '0.0.0.0' });
    console.error('Agent service ready');
}
catch {
    console.error('Agent startup failed; check configuration and circuit artifacts.');
    process.exitCode = 1;
}
