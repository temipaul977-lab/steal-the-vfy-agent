import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { groth16, zKey } from 'snarkjs';
import { commitment, decide, parseParams, parseSalt } from '../src/strategy.js';
import { createProver, type Evidence } from '../src/prover.js';
import { buildApp, sign } from '../src/app.js';
import { Store } from '../src/store.js';
import { type Turn } from '../src/protocol.js';
import { publicInputValues, publicInputsHash } from '../src/public-inputs.js';
after(async () => { await (globalThis as typeof globalThis & {
    curve_bn128?: {
        terminate(): Promise<void>;
    };
}).curve_bn128?.terminate(); });
// Public test fixtures, never production configuration.
const params = [7n, 0n, 0n, 0n, 0n, 0n, 0n, 0n], salt = 123456n;
const secret = 'public-test-fixture-secret';
async function envelope(): Promise<Turn> { const stamp = Date.now(); return { protocolVersion: 'v1', eventId: 'steal-the-vfy', mode: 'practice', matchId: '9f4e1b2a-1234-4abc-8def-123456789abc', turn: 3, issuedAt: new Date(stamp).toISOString(), deadlineAt: new Date(stamp + 120000).toISOString(), state: { selfBalance: '95', opponentBalance: '105', selfFortifiedUntilTurn: null, opponentFortifiedUntilTurn: null }, strategyCommitment: { hash: await commitment(params, salt) }, resolverVersion: 'v1', nonce: 'public-test-nonce' }; }
test('deterministic policy and private configuration validation', async () => {
    const t = await envelope();
    assert.deepEqual(decide(t, params), { type: 'EXTRACT', amount: 7 });
    assert.deepEqual(decide(t, params), decide(t, params));
    assert.deepEqual(decide({ ...t, state: { ...t.state, selfBalance: '0', opponentBalance: '1' } }, params), { type: 'EXTRACT', amount: 7 });
    assert.deepEqual(decide({ ...t, state: { ...t.state, opponentBalance: '0' } }, params), { type: 'HOLD' });
    assert.throws(() => decide(t, [0n, ...params.slice(1)]));
    assert.throws(() => parseParams('[1]'));
    assert.throws(() => parseSalt('-1'));
});
test('real circuit: Poseidon commitment, fullProve, and signed HTTP turns', { timeout: 180000 }, async () => {
    const t = await envelope();
    const prover = createProver(params, salt);
    const evidence = await prover(t, decide(t, params), 60000);
    await assert.rejects(() => prover(t, { type: 'HOLD' }, 60000), 'Circuit must reject a HOLD that deviates from the committed policy');
    const vk = await zKey.exportVerificationKey('circuits/vfy-policy_final.zkey');
    assert.equal(await groth16.verify(vk, evidence.publicSignals, evidence.proof as any), true);
    assert.ok(evidence.publicSignals.includes(BigInt(t.strategyCommitment.hash).toString()), 'Poseidon commitment must appear in circuit public signals');
    const inputs = publicInputValues(t, decide(t, params));
    // Preserve the circuit's computed output at index 0; the eight public inputs follow.
    assert.equal(evidence.publicSignals.length, 9);
    assert.deepEqual(evidence.publicSignals.slice(1), inputs.map(String));
    const dir = await mkdtemp(join(tmpdir(), 'vfy-test-'));
    const app = await buildApp({ secret, params, commitment: t.strategyCommitment.hash, prover, store: new Store(dir) });
    try {
        const pre = JSON.stringify({ type: 'agent-games.preflight.v1', agent_id: 'test-agent', issued_at: new Date().toISOString(), nonce: 'preflight-test' });
        const address = await app.listen({ host: '127.0.0.1', port: 0 });
        const pr = await fetch(address + '/agent', { method: 'POST', headers: { 'content-type': 'application/json', 'x-agent-games-signature': sign(pre, secret) }, body: pre });
        const preBody = await pr.text();
        assert.equal(pr.status, 200);
        assert.deepEqual(JSON.parse(preBody), { ok: true, protocolVersion: 'v1' });
        assert.equal(pr.headers.get('x-agent-games-signature'), sign(preBody, secret));
        const payload = JSON.stringify(t);
        const request = { method: 'POST' as const, url: '/agent', headers: { 'content-type': 'application/json', 'x-agent-games-signature': sign(payload, secret) }, payload };
        const result = await app.inject(request);
        assert.equal(result.statusCode, 200);
        assert.equal(result.headers['x-agent-games-signature'], sign(result.body, secret));
        const body = result.json();
        assert.deepEqual(Object.keys(body).sort(), ['action', 'agentTimestamp', 'idempotencyKey', 'matchId', 'policyProof', 'turn'].sort());
        assert.equal(body.matchId, t.matchId);
        assert.equal(body.turn, t.turn);
        assert.deepEqual(body.action, { type: 'EXTRACT', amount: 7 });
        assert.deepEqual(Object.keys(body.policyProof).sort(), ['circuitVersion', 'proof', 'public_signals', 'publicInputsHash'].sort());
        assert.equal(body.policyProof.circuitVersion, 'v1');
        assert.equal(await groth16.verify(vk, body.policyProof.public_signals, body.policyProof.proof), true);
        assert.equal(body.policyProof.publicInputsHash, publicInputsHash(t, decide(t, params)));
        const retry = await app.inject(request);
        assert.equal(retry.body, result.body);
        assert.equal(retry.headers['x-agent-games-signature'], result.headers['x-agent-games-signature']);
        const holdTurn = { ...t, turn: 4, state: { ...t.state, opponentBalance: '0' } };
        const holdPayload = JSON.stringify(holdTurn);
        const holdResult = await app.inject({ method: 'POST', url: '/agent', headers: { 'content-type': 'application/json', 'x-agent-games-signature': sign(holdPayload, secret) }, payload: holdPayload });
        assert.equal(holdResult.statusCode, 200);
        assert.deepEqual(holdResult.json().action, { type: 'HOLD' });
        assert.equal(await groth16.verify(vk, holdResult.json().policyProof.public_signals, holdResult.json().policyProof.proof), true);
        assert.equal(holdResult.headers['x-agent-games-signature'], sign(holdResult.body, secret));
        await app.close();
        const restarted = await buildApp({ secret, params, commitment: t.strategyCommitment.hash, prover: async () => { throw new Error('Cache must avoid reproving'); }, store: new Store(dir) });
        try {
            const cached = await restarted.inject(request);
            assert.equal(cached.body, result.body);
            assert.equal(cached.headers['x-agent-games-signature'], result.headers['x-agent-games-signature']);
        }
        finally {
            await restarted.close();
        }
    }
    finally {
        await app.close();
        await rm(dir, { recursive: true, force: true });
    }
});
test('authentication, stale requests, conflicts, and proven HOLD fallback', async () => {
    const t = await envelope();
    t.state.opponentBalance = '0';
    const dir = await mkdtemp(join(tmpdir(), 'vfy-errors-'));
    const evidence: Evidence = { proof: { fixture: true }, publicSignals: ['1'] };
    let calls = 0;
    const app = await buildApp({ secret, params, commitment: t.strategyCommitment.hash, store: new Store(dir), prover: async () => { calls++; return evidence; }, policy: () => { throw new Error('test failure'); } });
    const send = (v: unknown, signed = true) => { const payload = typeof v === 'string' ? v : JSON.stringify(v); return app.inject({ method: 'POST', url: '/agent', headers: { 'content-type': 'application/json', 'x-agent-games-signature': signed ? sign(payload, secret) : '0'.repeat(64) }, payload }); };
    try {
        assert.equal((await send('{bad', false)).statusCode, 401);
        assert.equal(calls, 0);
        assert.equal((await send('{bad')).statusCode, 400);
        assert.equal(calls, 0);
        assert.equal((await send({ ...t, deadlineAt: new Date(Date.now() - 1).toISOString() })).statusCode, 400);
        assert.equal((await send({ ...t, strategyCommitment: { hash: '0x' + '0'.repeat(64) } })).statusCode, 409);
        assert.equal((await send({ ...t, circuitVersion: 'v2' })).statusCode, 422);
        assert.equal((await app.inject({ method: 'GET', url: '/health' })).body, '{"ok":true}');
        const r = await send(t);
        assert.equal(r.statusCode, 200);
        assert.deepEqual(r.json().action, { type: 'HOLD' });
        assert.equal('amount' in r.json().action, false);
        assert.equal(r.headers['x-agent-games-signature'], sign(r.body, secret));
        assert.equal((await send({ ...t, nonce: 'changed' })).statusCode, 409);
    }
    finally {
        await app.close();
        await rm(dir, { recursive: true, force: true });
    }
});
