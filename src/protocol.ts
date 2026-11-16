import { z } from 'zod';
export const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const balance = z.string().regex(/^(0|[1-9][0-9]{0,19})$/);
export const preflightSchema = z.object({ type: z.literal('agent-games.preflight.v1'), agent_id: z.string().min(1), issued_at: z.iso.datetime(), nonce: z.string().min(1).max(256) });
const version = z.string().regex(/^v[1-9][0-9]*$/).max(16);
export const turnSchema = z.object({ protocolVersion: z.literal('v1'), eventId: z.literal('steal-the-vfy'), mode: z.enum(['practice', 'competition']), matchId: z.uuid(), turn: z.number().int().min(1).max(20), issuedAt: z.iso.datetime(), deadlineAt: z.iso.datetime(), state: z.object({ selfBalance: balance, opponentBalance: balance, selfFortifiedUntilTurn: z.number().int().nonnegative().nullable(), opponentFortifiedUntilTurn: z.number().int().nonnegative().nullable() }), strategyCommitment: z.object({ hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/).refine(v => BigInt(v) < FIELD), circuitVersion: version.optional() }), circuitVersion: version.optional(), resolverVersion: z.literal('v1'), nonce: z.string().min(1).max(256) }).refine(t => !t.circuitVersion || !t.strategyCommitment.circuitVersion || t.circuitVersion === t.strategyCommitment.circuitVersion);
export type Turn = z.infer<typeof turnSchema>;
export type Action = {
    type: 'HOLD';
} | {
    type: 'FORTIFY';
} | {
    type: 'EXTRACT';
    amount: number;
};
export const actionCode = (a: Action) => ({ HOLD: 0, FORTIFY: 1, EXTRACT: 2 }[a.type]);
// The published envelope omits circuitVersion; its v1 example uses resolverVersion.
// Explicit circuit versions take precedence and are echoed verbatim after validation.
export const circuitVersionOf = (t: Turn) => t.circuitVersion ?? t.strategyCommitment.circuitVersion ?? t.resolverVersion;
export function circuitVersionNumber(t: Turn): bigint {
    const version = circuitVersionOf(t);
    if (version !== 'v1')
        throw new Error('Unsupported circuit artifacts');
    return BigInt(version.slice(1));
}
export const actionSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('HOLD') }).strict(),
    z.object({ type: z.literal('FORTIFY') }).strict(),
    z.object({ type: z.literal('EXTRACT'), amount: z.number().int().min(1).max(10) }).strict(),
]);
