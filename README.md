# Steal the VFY agent

TypeScript / Node.js 22+ HTTP service implementing the [official Agent Games interface](https://agentgames.zkverify.io/build). The platform calls the full `/agent` URL. TLS must terminate at your hosting ingress.

## Layout

```
src/app.ts           raw-body HMAC, schemas, deadlines, signed responses
src/protocol.ts      tournament envelopes and action types
src/public-inputs.ts exact Keccak-256 input packing
src/strategy.ts      deterministic policy and Poseidon commitment
src/commit.ts        private configuration / public commitment CLI
src/prover.ts        bounded worker lifecycle
src/proof-worker.ts  fullProve and local Groth16 verification
src/store.ts         persisted idempotent turn responses
src/main.ts          configuration, startup, graceful shutdown
test/agent.test.ts   real circuit and HTTP integration tests
circuits/           supplied WASM and proving key
```

## Run

1. `npm ci`
2. Copy `.env.example` to `.env` if it does not exist. Set your dashboard HMAC secret and private `STRATEGY_PARAMS`: exactly eight decimal values in a JSON array (safe integers or quoted decimal strings). The requested policy has already been saved locally in the ignored `.env`. Do not overwrite it or commit it.
3. Run `npm run commit`. This prints only the public 32-byte hexadecimal commitment and safely saves a missing random salt in `.env`. The repository's `.npmrc` suppresses npm script banners. Register that hash with circuit version `v1` in the dashboard before pairing.
4. `npm test` runs compilation, deterministic policy checks, actual fullProve/verification, and signed HTTP tests.
5. `npm run build` then `npm start`. Register `https://your-host/agent`, rotate the dashboard secret as needed, restart, and run platform preflight/practice.

`GET /health` returns `{"ok":true}`; `/healthz` is an alias. `/readyz` exposes protocol readiness. Errors are generic; request bodies and circuit diagnostics are never logged. The secret is required at startup; there are no production defaults for private configuration.

## Policy and proofs

The isolated `policy(state, params)` implements the requested extraction profile: the configured maximum extraction amount while the opponent has a positive balance, otherwise HOLD. This profile requires the remaining parameter slots to be zero; unsupported profiles fail at startup rather than silently using different circuit semantics. The chosen values remain in private configuration. All eight parameters followed by the salt enter `Poseidon(9)`; field values must be below the BN254 scalar modulus. Circuit input names are taken from the supplied WASM, including `turnNumber`.

The service computes `publicInputsHash` before proof generation: Keccak-256 over eight 32-byte big-endian fields, in order: commitment, UUID as integer, turn, self balance, opponent balance, action code, amount (zero for HOLD/FORTIFY), numeric circuit version. The supplied circuit has one computed output followed by these eight public inputs; snarkjs's original signal order is preserved. Every proof is verified locally against the verification key exported from the supplied proving key. Raw `proof` and `public_signals` are nested inside `policyProof`; no on-chain finalization blocks the response.

The published turn example omits `circuitVersion`. Explicit top-level or commitment circuit versions are accepted, must agree when both are supplied, and are echoed exactly. When absent, the example's inbound `resolverVersion` is used. Only the supplied artifact version is supported; unknown versions receive signed 422 rather than a proof for a different circuit.

The circuit rejects HOLD when this committed policy requires EXTRACT. A universally valid HOLD fallback would contradict the commitment. When HOLD is permitted, its proof is generated first and can survive a subsequent policy or persistence error; `amount` is omitted. If an extraction proof cannot be generated, or no valid HOLD proof is available, the service returns signed 503. Invalid signatures, envelopes, expired requests, and commitment mismatches are rejected before proof work. A disposable proving process keeps the HTTP event loop responsive and is killed on timeout; its output streams and inherited private environment are suppressed.

## Deployment

Build with `docker build -t vfy-agent .`; run with a private environment file, port 3000, and a persistent volume at `/app/data`. Generate the commitment in the development checkout before building the production image. Use one replica per data directory: concurrency is bounded to one active proof pipeline; additional uncached requests receive a signed 503 with Retry-After. The cache stores the exact serialized response string, signature, request digest, and idempotency key; retries reuse those bytes, including after restart. Changing an envelope for an already recorded turn yields 409. If persistence fails on a valid HOLD turn, a bounded in-memory cache preserves retries during that process lifetime. Use a shared transactional store before deploying multiple replicas. Place ingress request limits in front of the service; its local limit is 120 requests/minute per client address. Only trust forwarded addresses after explicitly configuring trusted ingress ranges.

Allow up to 60 seconds upstream response time. The service budgets at most 55 seconds and reserves time for fallback. Turn responses are persisted before sending and can be retained for disputes; monitor disk usage and archive old matches. Keep configuration immutable during a tournament. Protect `.env` with account-level file permissions on Windows (POSIX mode bits alone do not define Windows ACLs). Do not expose this repository, data volume, proving diagnostics, or environment through a static file server.
