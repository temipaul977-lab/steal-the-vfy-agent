import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildApp, sign } from '../src/app.js';
import { Store } from '../src/store.js';
test('proof timeout fails closed when the circuit cannot permit HOLD', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vfy-fallback-'));
    let calls = 0;
    const hash = '0x' + '0'.repeat(63) + '1', secret = 'public-fallback-test-secret';
    const proof = { proof: { testOnly: true }, publicSignals: ['1'] };
    const app = await buildApp({ secret, commitment: hash, params: [6n, 0n, 0n, 0n, 0n, 0n, 0n, 0n], store: new Store(dir), prover: async () => { calls++; throw new Error('simulated timeout'); } });
    try {
        const payload = JSON.stringify({ protocolVersion: 'v1', eventId: 'steal-the-vfy', mode: 'practice', matchId: '9f4e1b2a-1234-4abc-8def-123456789abc', turn: 1, issuedAt: new Date().toISOString(), deadlineAt: new Date(Date.now() + 120000).toISOString(), state: { selfBalance: '100', opponentBalance: '100', selfFortifiedUntilTurn: null, opponentFortifiedUntilTurn: null }, strategyCommitment: { hash }, resolverVersion: 'v1', nonce: 'fallback-test' });
        const result = await app.inject({ method: 'POST', url: '/agent', headers: { 'content-type': 'application/json', 'x-agent-games-signature': sign(payload, secret) }, payload });
        assert.equal(result.statusCode, 503);
        assert.equal(calls, 1);
        assert.deepEqual(result.json(), { error: 'PROOF_UNAVAILABLE' });
        assert.equal(result.headers['x-agent-games-signature'], sign(result.body, secret));
    }
    finally {
        await app.close();
        await rm(dir, { recursive: true, force: true });
    }
});
