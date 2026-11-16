import { groth16, zKey } from 'snarkjs';
process.once('message', async (workerData: {
    input: Parameters<typeof groth16.fullProve>[0];
    expectedPublicInputs: string[];
    wasm: string;
    zkey: string;
}) => {
    let stage = 'prove';
    try {
        const result = await groth16.fullProve(workerData.input, workerData.wasm, workerData.zkey);
        if (JSON.stringify(result.publicSignals.slice(1)) !== JSON.stringify(workerData.expectedPublicInputs))
            throw new Error();
        stage = 'key';
        const vk = await zKey.exportVerificationKey(workerData.zkey);
        stage = 'verify';
        if (!await groth16.verify(vk, result.publicSignals, result.proof))
            throw new Error();
        process.send!(result);
    }
    catch {
        process.send!({ error: true, stage });
    }
});
