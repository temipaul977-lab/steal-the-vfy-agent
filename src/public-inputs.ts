import { keccak_256 } from '@noble/hashes/sha3';
import { actionCode, circuitVersionNumber, type Action, type Turn } from './protocol.js';
export function publicInputValues(t: Turn, a: Action): bigint[] {
    return [BigInt(t.strategyCommitment.hash), BigInt('0x' + t.matchId.replaceAll('-', '')), BigInt(t.turn), BigInt(t.state.selfBalance), BigInt(t.state.opponentBalance), BigInt(actionCode(a)), BigInt(a.type === 'EXTRACT' ? a.amount : 0), circuitVersionNumber(t)];
}
// Eight uint256 values, in protocol order, each 32 bytes big-endian; no ABI offsets.
export function publicInputsHash(t: Turn, a: Action): string {
    const packed = Buffer.concat(publicInputValues(t, a).map(value => {
        if (value < 0n || value >= 1n << 256n)
            throw new Error('Invalid public input');
        return Buffer.from(value.toString(16).padStart(64, '0'), 'hex');
    }));
    return '0x' + Buffer.from(keccak_256(packed)).toString('hex');
}
