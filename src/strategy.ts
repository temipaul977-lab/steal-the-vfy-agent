import { randomBytes } from 'node:crypto';
import { buildPoseidon } from 'circomlibjs';
import { FIELD, type Action, type Turn } from './protocol.js';
let poseidonPromise: ReturnType<typeof buildPoseidon> | undefined;
export function parseParams(value: string | undefined): bigint[] {
    if (!value)
        throw new Error('Missing private policy configuration');
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.length !== 8 || !parsed.every(v => (typeof v === 'string' && /^(0|[1-9][0-9]*)$/.test(v) && BigInt(v) < FIELD) || (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0)))
        throw new Error('Invalid private policy configuration');
    const params = parsed.map(BigInt);
    validatePolicyParams(params);
    return params;
}
export function parseSalt(value: string | undefined): bigint { if (!value || !/^(0|[1-9][0-9]*)$/.test(value) || BigInt(value) >= FIELD)
    throw new Error('Invalid salt configuration'); return BigInt(value); }
export function randomSalt(): bigint { let n: bigint; do {
    n = BigInt('0x' + randomBytes(32).toString('hex'));
} while (n >= FIELD); return n; }
async function poseidonFieldHash(values: readonly bigint[]): Promise<bigint> { const p = await (poseidonPromise ??= buildPoseidon()); return BigInt(p.F.toString(p([...values]))); }
export async function commitment(params: bigint[], salt: bigint): Promise<string> { return '0x' + (await poseidonFieldHash([...params, salt])).toString(16).padStart(64, '0'); }
function validatePolicyParams(params: readonly bigint[]) {
    // This service supports the requested extraction-only circuit profile.
    // Other circuit profiles require independently implementing their decision branches.
    if (params.length !== 8 || params[0] < 1n || params[0] > 10n || params.slice(1).some(v => v !== 0n))
        throw new Error('Unsupported private policy configuration');
}
export function policy(state: Turn['state'], params: readonly bigint[]): Action {
    validatePolicyParams(params);
    if (BigInt(state.opponentBalance) <= params[2])
        return { type: 'HOLD' };
    const amount = Number(params[0]);
    if (!Number.isInteger(amount) || amount < 1 || amount > 10)
        throw new Error('Invalid policy configuration');
    return { type: 'EXTRACT', amount };
}
export const decide = (t: Turn, params: readonly bigint[]) => policy(t.state, params);
