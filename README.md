# BBBFi TapeGuard on X Layer

Noncustodial V2 swaps with transaction limits evaluated by a real TapeOut circuit.

- Product: https://www.bbbfi.com/xlayer
- Interactive on-chain circuit: https://www.bbbfi.com/xlayer/about
- Event: [Build X · TapeOut Accelerate](https://web3.okx.com/zh-hans/xlayer/build-x-series)
- Network: X Layer mainnet, chain ID **196**, native gas token **OKB**.

## What is new during the event

Development began on 16 October 2026. This entry extends the existing BBBFi V2 DEX to X Layer and adds a dedicated TapeOut processor, a six-NAND combinational circuit, an immutable guarded swap entry point, and an interactive live-chain circuit verifier. The original XDC/BNB Chain products are prior work; this submission concerns the X Layer extension and TapeGuard.

The guard computes four predicates from on-chain state and calls the TapeOut processor's `eval(circuitId, inputs)` during the same transaction:

1. Fee-inclusive execution impact is within the user's cap (at most 5%), measured against the **same pool's** reserve ratio.
2. Minimum received is positive, achievable at the current quote, and within the user's slippage limit (hard cap 1%; UI uses 0.5%).
3. The quote is no more than 30 blocks old and the deadline is valid and no more than 600 seconds ahead.
4. The trader retains at least 0.0001 OKB after native input value is deducted. This is a fixed balance floor, not a guarantee of any number of future transactions.

Inputs are bit-packed LSB first. Only `0x0f` produces `0x01`; all other inputs produce `0x00`. The guard pins the exact netlist, processor, circuit ID, circuit beacon implementation and implementation code hash. A changed TapeOut circuit implementation stops guarded execution. The underlying TapeOut protocol is third-party, upgradeable and unaudited; this dependency is disclosed in the product.

The guard has no owner, upgrade function or administrative withdrawal. User assets flow through only during an atomic swap. Token input approvals to the base router are exact and cleared after use. Transfer-tax tokens are unsupported. Ordinary base-router transactions remain possible; users must select the guarded entry point to obtain this policy.

## Product, users and business

Target users are individual X Layer traders and community treasury operators who need explicit, inspectable trade limits while retaining custody. Distribution starts with BBBFi's existing product entry points, builder communities and reproducible public verification examples.

The current guard adds **no platform fee**. V2 pools charge a 0.3% LP fee. Planned revenue is optional team policy management and developer API subscriptions, which are not launched; no earned revenue is claimed. Users would pay for shared operational controls and integrations, and return for predictable transaction boundaries and verifiable execution.

## Verification

Requires Node.js 20+, npm, and Foundry supporting Solidity 0.8.23. No private key is needed for tests.

```sh
npm ci
forge test
```

Twenty Solidity tests cover arbitrary pairs, multihop liquidity, swaps in each direction, deadline and minimum enforcement, exact approvals, zero custody residue, quote freshness, insufficient gas reserve, changed TapeOut implementations and failing circuit outputs. Seven additional frontend-builder tests are recorded with the application release.

For a full rehearsal against real TapeOut and WOKB contracts, start a **local fork** with synthetic accounts, deploy the candidate, then execute the smoke test:

```sh
anvil --fork-url https://rpc.xlayer.tech --port 8596 --auto-impersonate --chain-id 196 --gas-price 20000001 --base-fee 0
node scripts/deploy-xlayer.mjs --fork --deploy
node scripts/test-xlayer-fork.mjs
```

`deployments/fork-smoke.json` explicitly marks fork-only execution and synthetic funding. Fork transactions are **not mainnet trades**. New mainnet pools have no liquidity until an LP funds them; no volume, TVL, price, profit, or circulating supply is invented.

`verification/` contains the exact standard compiler input and metadata used for deployment. Compiler: `0.8.23+commit.f704f362`; optimizer 200 runs, viaIR, Shanghai EVM. These inputs reproduce creation bytecode exactly, including metadata. The deployment script checks runtime bytecode with immutable slots normalized and independently checks each immutable getter. This is reproducibility evidence, not an independent security audit.

## Limits

Reserve-relative impact is **not a market-price oracle**. It cannot detect manipulated starting reserves, scams, token administrators, or every MEV scenario. Quotes can expire or transactions can revert if pool state changes. Liquidity provision is handled by the V2 router and is outside the guarded swap path.

The live circuit test switches are test inputs, not a representation of a user's wallet or a certified trade. Actual transaction predicates are computed inside the guard.

## References and license

- [TapeKit network configuration](https://github.com/TapeOutProtocol/TapeKit/blob/main/kernel/src/config.js)
- [TapeOut X Layer integration reference](https://github.com/NetLayerLabs/Cerebr/blob/main/TAPEOUT.md), independently exercised on a fork and checked on mainnet for this release.
- [OKX canonical token list](https://github.com/okx/xlayer-tokenlist)

BBBFi contract code is MIT licensed. OpenZeppelin Contracts retain their MIT license. TapeOut is an external protocol, not authored by BBBFi. Participation does not imply endorsement by OKX, X Layer or TapeOut.
