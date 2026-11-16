import { fork } from 'node:child_process';
import { resolve } from 'node:path';
import { actionCode, circuitVersionNumber, type Action, type Turn } from './protocol.js';
import { publicInputsHash, publicInputValues } from './public-inputs.js';
export type Evidence = {
    proof: Record<string, unknown>;
    publicSignals: string[];
};
export type Prover = (t: Turn, a: Action, timeoutMs: number) => Promise<Evidence>;
export function createProver(params: bigint[], salt: bigint): Prover {
    return (t, a, timeoutMs) => new Promise((res, rej) => {
        // Compute the audit hash before any proof work, from the same input values.
        publicInputsHash(t, a);
        const input = { strategyParams: params.map(String), salt: String(salt), commitment: BigInt(t.strategyCommitment.hash).toString(), matchId: BigInt('0x' + t.matchId.replaceAll('-', '')).toString(), turnNumber: t.turn, selfBalance: t.state.selfBalance, opponentBalance: t.state.opponentBalance, action: actionCode(a), amount: a.type === 'EXTRACT' ? a.amount : 0, circuitVersion: circuitVersionNumber(t).toString() };
        // snarkjs's web-worker dependency cannot run inside an arbitrary Node Worker.
        // A disposable process keeps the HTTP event loop free and can be killed on timeout.
        const worker = fork(new URL('./proof-worker.js', import.meta.url), [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], execArgv: [], env: { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, NODE_ENV: process.env.NODE_ENV } });
        const timer = setTimeout(() => { worker.kill('SIGKILL'); rej(new Error('Proof timeout')); }, timeoutMs);
        worker.once('message', (v: Evidence & {
            error?: boolean;
            stage?: string;
        }) => { clearTimeout(timer); worker.kill('SIGKILL'); if (v.error)
            rej(new Error('Proof failed at ' + v.stage));
        else
            res(v); });
        worker.once('error', () => { clearTimeout(timer); worker.kill('SIGKILL'); rej(new Error('Proof worker failed')); });
        worker.once('exit', () => { clearTimeout(timer); rej(new Error('Proof worker exited')); });
        worker.send({ input, expectedPublicInputs: publicInputValues(t, a).map(String), wasm: resolve('circuits/vfy-policy.wasm'), zkey: resolve('circuits/vfy-policy_final.zkey') });
    });
}
