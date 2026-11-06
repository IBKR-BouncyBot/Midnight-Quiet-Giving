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

The first runner attempt verified the official 2.5.1 CRX3 developer and Web Store signatures, loaded the real extension and created a fresh ephemeral wallet. It then timed out navigating to Preview settings, before connecting the wallet or sending a transaction. The setup failure is being corrected; no full Lace donation is claimed from that run.

Until an end-to-end run completes, a full Lace donation is unverified. Do not substitute an SDK adapter or a simulated successful wallet response for this result.
