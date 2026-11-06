# Verification record

Each result below must be supported by a completed check. Website deployment, generated contract execution, proof generation and network settlement are separate milestones.

## Current implementation

- Official Compact 0.31.1 compilation produces the `mint` and `donate` bindings and proving material.
- The local browser lab uses generated Compact code and actual Midnight WebAssembly. It does not generate proofs or submit transactions.
- The Preview client uses the actual Midnight.js SDK and Lace API 4. A successful build does not establish a working extension or accepted payment.
- The authority view checks a deliberately disclosed commitment opening. It is not an official tax service and does not create a separate zero-knowledge tax proof.

## Checks

On 6 November 2026, the official compiler generated both circuits and their proving/verifier material. All 25 native contract, disclosure and network-boundary tests passed locally on Node.js 24.18.0. These cover shielded output effects, asset/amount/time constraints, duplicate receipts and nonces, altered identity/amount/recipient data, private export boundaries, wallet/network restrictions, verifier-key mismatches, mutable contracts and fabricated initial receipts.

Chromium 156.0.8078.4 completed the browser journey with zero page errors and zero unsolicited external requests: donation, anonymous recipient view, public/private downloads, explicit authority sharing, tampered amount and identity rejection, a second donor, private-state storage checks, reset, and network startup without a wallet. Landing, browser and testnet layouts were checked at 1440, 390 and 320 pixels. The first run found a missing browser Buffer polyfill for native shielded-output execution; the production bundler now supplies the actual browser polyfill, and the complete journey passed afterward.

The browser test's sanitized JSON and screenshots are generated under ignored `artifacts/browser/`; CI retains that directory. They establish local execution and UI behavior, not proof generation, a Lace interaction or an accepted network payment. No historical result from BallotLab, Agent AI Wallet or ReviewLab is evidence of this application's transaction acceptance.

The published Quiet Giving site also passed a Chromium smoke check: donation and deliberate disclosure, no donor label in the recipient view, wallet-free network startup, the support QR and copy control, and the correct repository links. No page errors were recorded. The README infographic was rendered and visually reviewed, published to GitHub, and retrieved successfully from its public URL.

## Real WASM proof generation

The separate `npm run test:proofs` harness generated both circuit proofs in a dedicated Chromium 156 Web Worker using official `@midnight-ntwrk/zkir-v2` 2.1.1 and the generated compiler material. The mint proof was 4,501 bytes in 22.1 seconds; the donation proof was 4,501 bytes in 78.5 seconds on the tested desktop. These timings are observations, not performance promises.

The harness checked actual circuit preimages, rejected a wrong token and duplicate donation before proving, and rejected a mismatched-circuit preimage in ZKIR. It recorded no page errors or external browser requests, 5,036 main-thread heartbeats and a largest heartbeat gap of 33 ms. Donation proving used roughly 1.00 GB of WASM memory. The [sanitized evidence](browser-proof-evidence.json) records asset hashes, proof hashes and sizes, and timings. Synthetic witnesses remained inside the test worker.

This establishes proof generation, not independent proof verification, wallet/DUST proving, a Lace interaction or network settlement.

## Independent Lace 2.5.1

The requested route is a disposable GitHub runner with the official signed Lace package, a fresh test wallet and Preview test funds. The test must record the actual extension version and selected internal WASM setting, inspect extension traffic, and distinguish any accepted network transactions from earlier setup steps. Earlier Lace 2.5.0 source inspection is not a test of 2.5.1.

The isolated runner verified the official 2.5.1 CRX3 developer and Web Store signatures, loaded the actual extension, created a fresh ephemeral wallet and selected Preview. In [run 42286743580](https://github.com/IBKR-BouncyBot/Midnight-Quiet-Giving/actions/runs/42286743580), it saved internal WASM proving, closed and reopened the settings sheet, and verified the selected marker after clearing focus and hover. That run then stopped at wallet discovery. The harness subsequently corrected its case-sensitive match for Lace's lowercase connector name and waits for actual API-4 injection before refreshing the wallet list.

The repeat [run 42287700555](https://github.com/IBKR-BouncyBot/Midnight-Quiet-Giving/actions/runs/42287700555) did not retain the internal-WASM selected marker when the saved settings were reopened, so it stopped before connecting. No accepted Preview transaction, funded wallet or completed Lace donation is established by these runs. The [curated public evidence](lace-preview-evidence.json) records both results, exact source commits and package hashes; their private profiles were removed and no recovery phrase or private receipt was exported.

A subsequent local test on 6 November used the same verified, unmodified Lace 2.5.1 package in a separate Chromium 156 profile with a fresh Preview wallet. It saved internal WASM using Lace's ordinary Save control, required the settings sheet to close automatically, reopened it and verified the selected marker without hover or focus. Quiet Giving then connected through the real injected API. The runner now follows this observed save sequence instead of manually closing a sheet whose Save may not have completed.

The regular browser also received Lace's normal vendor configuration and applied its current Preview service URLs after all extension views closed and reopened. Its actual wallet indexer returned HTTP 200; the app's separate public-service check returned block 1,629,652. An earlier headless attempt received an empty feature-flag response, while the headed browser received 43 flags. The cause of that difference was not established. No response, wallet identity, adapter or service configuration was injected to obtain the successful connection. Public evidence omits service query values.

The local test is **awaiting test funding**: the official faucet presented human verification, and the fresh wallet has no NIGHT or DUST. Deployment, rule locking, minting, donation acceptance and the indexed private-disclosure check have not run. Its isolated private profile is retained locally for continuation; no recovery phrase, password or private receipt is published. This is a successful wallet setup and connection check, not a completed donation test.

**The browser demo is tested; the Preview + Lace flow is implemented but not verified end to end.** A successful build, generated proof or one successful settings check must not substitute for accepted donation evidence. Do not substitute an SDK adapter or a simulated successful wallet response for the real extension result.
