# Verification record

Each result below must be supported by a completed check. Website deployment, generated contract execution, proof generation and network settlement are separate milestones.

## Current implementation

- Official Compact 0.36.0 compilation produces the ledger 9 `mint` and `donate` bindings, proving material and integrity manifest.
- The local browser lab uses generated Compact code and actual Midnight WebAssembly. It does not generate proofs or submit transactions.
- The Preview client uses Midnight.js 5.0.0 and Lace API 4.1. A successful build does not establish a working extension or accepted payment.
- The authority view checks a deliberately disclosed commitment opening. It is not an official tax service and does not create a separate zero-knowledge tax proof.

## Checks before the Preview reset

On 6 November 2026, the official compiler generated both circuits and their proving/verifier material. All 25 native contract, disclosure and network-boundary tests passed locally on Node.js 24.18.0. These cover shielded output effects, asset/amount/time constraints, duplicate receipts and nonces, altered identity/amount/recipient data, private export boundaries, wallet/network restrictions, verifier-key mismatches, mutable contracts and fabricated initial receipts.

Chromium 156.0.8078.4 completed the browser journey with zero page errors and zero unsolicited external requests: donation, anonymous recipient view, public/private downloads, explicit authority sharing, tampered amount and identity rejection, a second donor, private-state storage checks, reset, and network startup without a wallet. Landing, browser and testnet layouts were checked at 1440, 390 and 320 pixels. The first run found a missing browser Buffer polyfill for native shielded-output execution; the production bundler now supplies the actual browser polyfill, and the complete journey passed afterward.

The browser test's sanitized JSON and screenshots are generated under ignored `artifacts/browser/`; CI retains that directory. They establish local execution and UI behavior, not proof generation, a Lace interaction or an accepted network payment. No historical result from BallotLab, Agent AI Wallet or ReviewLab is evidence of this application's transaction acceptance.

The published Quiet Giving site also passed a Chromium smoke check: donation and deliberate disclosure, no donor label in the recipient view, wallet-free network startup, the support QR and copy control, and the correct repository links. No page errors were recorded. The README infographic was rendered and visually reviewed, published to GitHub, and retrieved successfully from its public URL.

## Earlier WASM proof generation

The separate `npm run test:proofs` harness generated both circuit proofs in a dedicated Chromium 156 Web Worker using official `@midnight-ntwrk/zkir-v2` 2.1.1 and the generated compiler material. The mint proof was 4,501 bytes in 22.1 seconds; the donation proof was 4,501 bytes in 78.5 seconds on the tested desktop. These timings are observations, not performance promises.

The harness checked actual circuit preimages, rejected a wrong token and duplicate donation before proving, and rejected a mismatched-circuit preimage in ZKIR. It recorded no page errors or external browser requests, 5,036 main-thread heartbeats and a largest heartbeat gap of 33 ms. Donation proving used roughly 1.00 GB of WASM memory. The [sanitized evidence](browser-proof-evidence.json) records asset hashes, proof hashes and sizes, and timings. Synthetic witnesses remained inside the test worker.

This establishes proof generation, not independent proof verification, wallet/DUST proving, a Lace interaction or network settlement.

## Independent Lace 2.5.1

The requested route is a disposable GitHub runner with the official signed Lace package, a fresh test wallet and Preview test funds. The test must record the actual extension version and selected internal WASM setting, inspect extension traffic, and distinguish any accepted network transactions from earlier setup steps. Earlier Lace 2.5.0 source inspection is not a test of 2.5.1.

The isolated runner verified the official 2.5.1 CRX3 developer and Web Store signatures, loaded the actual extension, created a fresh ephemeral wallet and selected Preview. In [run 42286743580](https://github.com/IBKR-BouncyBot/Midnight-Quiet-Giving/actions/runs/42286743580), it saved internal WASM proving, closed and reopened the settings sheet, and verified the selected marker after clearing focus and hover. That run then stopped at wallet discovery. The harness subsequently corrected its case-sensitive match for Lace's lowercase connector name and waits for actual API-4 injection before refreshing the wallet list.

The repeat [run 42287700555](https://github.com/IBKR-BouncyBot/Midnight-Quiet-Giving/actions/runs/42287700555) did not retain the internal-WASM selected marker when the saved settings were reopened, so it stopped before connecting. No accepted Preview transaction, funded wallet or completed Lace donation is established by these runs. The [curated public evidence](lace-preview-evidence.json) records both results, exact source commits and package hashes; their private profiles were removed and no recovery phrase or private receipt was exported.

A subsequent local test on 6 November used the same verified, unmodified Lace 2.5.1 package in a separate Chromium 156 profile with a fresh Preview wallet. It saved internal WASM using Lace's ordinary Save control, required the settings sheet to close automatically, reopened it and verified the selected marker without hover or focus. Quiet Giving then connected through the real injected API. The runner now follows this observed save sequence instead of manually closing a sheet whose Save may not have completed.

The regular browser also received Lace's normal vendor configuration and applied its current Preview service URLs after all extension views closed and reopened. Its actual wallet indexer returned HTTP 200; the app's separate public-service check returned block 1,629,652. An earlier headless attempt received an empty feature-flag response, while the headed browser received 43 flags. The cause of that difference was not established. No response, wallet identity, adapter or service configuration was injected to obtain the successful connection. Public evidence omits service query values.

That pre-reset local test stopped before funding: the official faucet presented human verification. Deployment, rule locking, minting, donation acceptance and the indexed private-disclosure check did not run. Its disposable browser session subsequently ended. This was a successful wallet setup and connection check, not a completed donation test.

## Preview reset and ledger 9 migration

On 7 November, the resumed test encountered a new Preview chain. The [official reset notice](https://docs.midnight.network/relnotes/network) confirms that Preview was replaced on 6 November and retained no old contracts, balances or DUST registrations. The requested transfer from the older ReviewLab test balance therefore could not be made; no sponsor transaction was submitted. The replacement chain was independently identified through its public RPC as ledger `crate-ledger-9.1.0.1`, runtime spec version `2001100`, with genesis hash `0x3c096de209e06a1a8c52be7bda109ee8c891a42288c0a9db5495f9616dd13796`.

Quiet Giving now targets the [supported ledger 9 versions](https://docs.midnight.network/relnotes/support-matrix): Compact 0.36.0, runtime 0.21.0, Midnight.js 5.0.0 and connector API 4.1.0. Its contract was recompiled. All 32 native, privacy and network-boundary tests passed, including current-era state decoding, refusing ledger 8 transactions, compiler-manifest integrity checks and serialized concurrent contract calls. The old-chain checks above remain historical evidence.

A replacement fresh wallet was created in the same verified, unmodified Lace 2.5.1 extension. Preview and persisted internal WASM were checked again. Its configured wallet indexer returned HTTP 500, while the canonical Preview indexer returned the new chain's much lower block height. A connection permission is not proof that the wallet is synchronized. That local wallet session was then stopped at the project owner's request. Further wallet and browser acceptance runs use isolated GitHub runners. The earlier local funding address is not the address for the remote test.

## Remote checks after migration

[GitHub run 42358887025](https://github.com/IBKR-BouncyBot/Midnight-Quiet-Giving/actions/runs/42358887025), at source `fe0ed900d9b8d9bfc9e1195756e892a9a205c699`, passed official compilation, all 32 tests, production builds, and the complete Chromium browser journey on the ledger 9 toolchain. The real network bundle and WebAssembly initialized without a wallet; unavailable-wallet actions remained disabled.

The final [layout and browser run 42359565640](https://github.com/IBKR-BouncyBot/Midnight-Quiet-Giving/actions/runs/42359565640), at source `b76f69d8bc12242e364189e1cf933b23ba719122`, passed after fixing two clipped mobile connector labels. Its desktop, 390-pixel and 320-pixel screenshots were visually reviewed, including the front-page mode choices, donor/recipient/verifier graphics and support QR/copy section. No page errors or horizontal overflow were recorded. These browser checks used no wallet and submitted no network transaction.

## Isolated internal-wallet acceptance

The internal-wallet test uses fresh SDK 2 wallets in a disposable GitHub runner. It publishes a public Preview funding address while waiting for faucet tokens. Seeds, signing keys and private receipt openings stay in the runner process; only curated public progress and transaction evidence may be retained. The test checks the Preview genesis before using the application contract and public disclosure verifier.

This is a separate SDK integration test. Even a completed SDK donation does not establish that the Lace extension can complete the same journey. The public application continues to offer its browser demo and real Lace testnet connection. A remote funding request or synchronized wallet is not accepted donation evidence.

**The browser demo is tested; the Preview + Lace flow is implemented but not verified end to end.** A successful build, generated proof or one successful settings check must not substitute for accepted donation evidence. Do not substitute an SDK adapter or a simulated successful wallet response for the real extension result.
