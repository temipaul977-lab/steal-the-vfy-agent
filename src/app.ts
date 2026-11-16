import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { createHmac, timingSafeEqual, createHash, randomUUID } from 'node:crypto';
import { preflightSchema, turnSchema, actionSchema, circuitVersionOf, circuitVersionNumber, type Action, type Turn } from './protocol.js';
import { publicInputsHash } from './public-inputs.js';
import { decide } from './strategy.js';
import type { Prover, Evidence } from './prover.js';
import { Store, type CachedResponse } from './store.js';
export const sign = (body: string | Buffer, secret: string) => createHmac('sha256', secret).update(body).digest('hex');
type Options = {
    secret: string;
    commitment: string;
    params: bigint[];
    prover: Prover;
    store: Store;
    now?: () => number;
    policy?: (t: Turn, p: bigint[]) => Action;
    proofBudgetMs?: number;
};
export async function buildApp(o: Options) {
    const now = o.now ?? Date.now;
    const app = Fastify({ logger: false, bodyLimit: 64 * 1024, requestTimeout: 65000, connectionTimeout: 70000, keepAliveTimeout: 5000 });
    await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });
    app.removeContentTypeParser('application/json');
    app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));
    app.addHook('onSend', async (_req, reply, payload) => { if (typeof payload === 'string' || Buffer.isBuffer(payload))
        reply.header('x-agent-games-signature', sign(payload, o.secret)); return payload; });
    app.setErrorHandler((_error, _request, reply) => { reply.code(400).send({ error: 'REQUEST_FAILED' }); });
    app.get('/healthz', async () => ({ ok: true }));
    app.get('/health', async () => ({ ok: true }));
    app.get('/readyz', async () => ({ ok: true, protocolVersion: 'v1' }));
    let busy = false;
    const completed = new Map<string, CachedResponse>();
    app.post('/agent', async (req, reply) => {
        const raw = req.body;
        const signature = req.headers['x-agent-games-signature'];
        if (!Buffer.isBuffer(raw) || typeof signature !== 'string')
            return reply.code(401).send({ error: 'UNAUTHORIZED' });
        const hex = signature.replace(/^sha256=/, '');
        if (!/^[a-fA-F0-9]{64}$/.test(hex) || !timingSafeEqual(Buffer.from(hex, 'hex'), Buffer.from(sign(raw, o.secret), 'hex')))
            return reply.code(401).send({ error: 'UNAUTHORIZED' });
        let value: unknown;
        try {
            value = JSON.parse(raw.toString('utf8'));
        }
        catch {
            return reply.code(400).send({ error: 'INVALID_JSON' });
        }
        const preflight = preflightSchema.safeParse(value);
        const fresh = (stamp: string) => { const age = now() - Date.parse(stamp); return age >= -30000 && age <= 300000; };
        if (preflight.success) {
            if (!fresh(preflight.data.issued_at))
                return reply.code(400).send({ error: 'STALE_REQUEST' });
            return { ok: true, protocolVersion: 'v1' };
        }
        const parsed = turnSchema.safeParse(value);
        if (!parsed.success)
            return reply.code(400).send({ error: 'INVALID_ENVELOPE' });
        const t = parsed.data;
        if (!fresh(t.issuedAt) || Date.parse(t.deadlineAt) <= now() + 1000 || Date.parse(t.deadlineAt) <= Date.parse(t.issuedAt))
            return reply.code(400).send({ error: 'STALE_REQUEST' });
        if (t.strategyCommitment.hash.toLowerCase() !== o.commitment.toLowerCase())
            return reply.code(409).send({ error: 'COMMITMENT_MISMATCH' });
        try {
            circuitVersionNumber(t);
        }
        catch {
            return reply.code(422).send({ error: 'UNSUPPORTED_CIRCUIT_VERSION' });
        }
        const key = t.matchId + ':' + t.turn;
        const digest = createHash('sha256').update(raw).digest('hex');
        const sendCached = (cached: CachedResponse) => {
            if (cached.digest !== digest)
                return reply.code(409).send({ error: 'TURN_CONFLICT' });
            if (cached.signature !== sign(cached.payload, o.secret))
                return reply.code(409).send({ error: 'CACHED_SIGNATURE_MISMATCH' });
            return reply.type('application/json; charset=utf-8').header('x-agent-games-signature', cached.signature).send(cached.payload);
        };
        const inMemory = completed.get(key);
        if (inMemory)
            return sendCached(inMemory);
        if (busy)
            return reply.code(503).header('retry-after', '1').send({ error: 'BUSY' });
        busy = true;
        let holdEvidence: Evidence | undefined;
        const responseFor = (action: Action, evidence: Evidence): CachedResponse => {
            const idempotencyKey = randomUUID();
            const response = { matchId: t.matchId, turn: t.turn, action: actionSchema.parse(action), policyProof: { circuitVersion: circuitVersionOf(t), proof: evidence.proof, public_signals: evidence.publicSignals, publicInputsHash: publicInputsHash(t, action) }, agentTimestamp: new Date(now()).toISOString(), idempotencyKey };
            const payload = JSON.stringify(response);
            return { digest, payload, signature: sign(payload, o.secret), idempotencyKey };
        };
        const remember = (cached: CachedResponse) => { if (completed.size >= 4096)
            completed.delete(completed.keys().next().value!); completed.set(key, cached); };
        try {
            const previous = await o.store.get(key);
            if (previous) {
                remember(previous);
                return sendCached(previous);
            }
            const end = Math.min(Date.parse(t.deadlineAt) - 500, now() + (o.proofBudgetMs ?? 55000));
            const budget = () => Math.max(1, end - now());
            // A fallback must satisfy the committed circuit. HOLD is provable only when
            // the committed policy itself permits HOLD for this state.
            const expected = decide(t, o.params);
            const hold: Action = { type: 'HOLD' };
            const holdProof = expected.type === 'HOLD' ? await o.prover(t, hold, Math.min(25000, budget())) : undefined;
            holdEvidence = holdProof;
            let action: Action = hold;
            let evidence: Evidence | undefined = holdProof;
            try {
                const candidate = actionSchema.parse((o.policy ?? decide)(t, o.params));
                if (JSON.stringify(candidate) !== JSON.stringify(expected))
                    throw new Error('Policy mismatch');
                if (candidate.type !== 'HOLD' && budget() > 2000) {
                    const proof = await o.prover(t, candidate, Math.max(1, budget() - 1000));
                    action = candidate;
                    evidence = proof;
                }
            }
            catch { /* Return the already verified HOLD proof. */ }
            if (!evidence)
                throw new Error('No valid policy proof');
            const response = responseFor(action, evidence);
            await o.store.put(key, response);
            remember(response);
            return sendCached(response);
        }
        catch {
            if (holdEvidence) {
                const fallback = responseFor({ type: 'HOLD' }, holdEvidence);
                remember(fallback);
                return sendCached(fallback);
            }
            return reply.code(503).send({ error: 'PROOF_UNAVAILABLE' });
        }
        finally {
            busy = false;
        }
    });
    return app;
}
