import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicInputValues, publicInputsHash } from '../src/public-inputs.js';
import type { Turn } from '../src/protocol.js';
const t: Turn = { protocolVersion: 'v1', eventId: 'steal-the-vfy', mode: 'practice', matchId: '9f4e1b2a-1234-4abc-8def-123456789abc', turn: 3, issuedAt: '2026-11-16T00:00:00Z', deadlineAt: '2026-11-16T00:01:00Z', state: { selfBalance: '95', opponentBalance: '105', selfFortifiedUntilTurn: null, opponentFortifiedUntilTurn: null }, strategyCommitment: { hash: '0x' + '0'.repeat(63) + '1' }, circuitVersion: 'v1', resolverVersion: 'v1', nonce: 'public-hash-test' };
test('public-inputs hash matches independent ethers uint256 packing vector', () => {
    assert.deepEqual(publicInputValues(t, { type: 'EXTRACT', amount: 7 }), [1n, BigInt('0x9f4e1b2a12344abc8def123456789abc'), 3n, 95n, 105n, 2n, 7n, 1n]);
    assert.equal(publicInputsHash(t, { type: 'EXTRACT', amount: 7 }), '0x831549547a5cb8966833efc2f85a2a08e251a9efc3685f93e677201e9fb2f243');
    assert.equal(publicInputValues(t, { type: 'HOLD' })[6], 0n);
    assert.equal(publicInputValues(t, { type: 'FORTIFY' })[6], 0n);
    assert.notEqual(publicInputsHash(t, { type: 'HOLD' }), publicInputsHash(t, { type: 'FORTIFY' }));
});
