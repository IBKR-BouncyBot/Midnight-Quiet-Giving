# Preview with Lace

This app targets the **ledger 9 Preview chain**, which restarted on **6 November 2026**. The reset removed old balances, DUST registrations, contracts and transaction history. The network name and public endpoints stayed the same. See the [official reset guidance](https://docs.midnight.network/relnotes/ledger-9).

## Prepare the two sides

Use a ledger 9 compatible official [Lace extension](https://www.lace.io/). In its Midnight settings select **Preview**, then **On this device → Run in this app (WASM)**. Confirm the same setting on the application's connect screen. Keep the browser open while it proves transactions.

Request fresh test NIGHT for the wallet's current Preview address through the [Midnight Preview faucet](https://midnight-tmnight-preview.nethermind.dev/) listed in the [official endpoints guide](https://docs.midnight.network/relnotes/network). Register that NIGHT for DUST again and wait for Lace to synchronize and show usable DUST. DUST pays network fees; it is not the donation token and cannot be transferred like an ordinary asset. Never send mainnet funds to this prototype.

An application connection only grants wallet access; it does not establish that Lace is synchronized or funded. The app's public-service check also does not test every service used by Lace. If Lace cannot synchronize, wait for its configured wallet services to recover before attempting a transaction.

The recipient provides its shielded coin public key and shielded encryption public key. These are public receiving details, not wallet secrets. Use a separate test recipient to demonstrate a transfer between two participants. The campaign's receiving key is fixed once deployed.

## Run the flow

1. Open `network.html` in the browser where Lace is installed.
2. Select Lace, confirm internal WASM proving, choose the application storage password and connect on Preview.
3. Enter the recipient's public receiving keys and create a new donation campaign, or import a join file for a campaign deployed on the new Preview chain. Pre-reset contracts and join files no longer work. After deployment, choose **Lock the rules** and approve the separate Lace transaction that permanently disables maintenance authority.
4. Mint valueless campaign test tokens to the donor wallet, approving the wallet operation. Wait for confirmation and wallet synchronization.
5. Enter a fictional taxpayer reference and a whole-number test amount. Submit the donation and approve the requested operations in Lace.
6. Wait for the application to report indexed confirmation. Retain the public receipt and explicitly download the private disclosure if needed.
7. Send that disclosure to the **local authority demo** for commitment and indexed-record checks. This shares nothing with a real tax authority.

## Proving and evidence

The contract and wallet/DUST proofs are requested through Lace. The app rejects a reported HTTP proof server and does not silently fall back to one. DApp Connector API 4.1 does not attest its internal proving mode, so a missing URL alone is insufficient evidence. A real extension test must inspect its setting and relevant traffic.

The UI distinguishes connection, proving, wallet approval, submission and confirmation. A long proof is not a confirmed donation. An interrupted submission may still land; use recovery/check controls before retrying. Save needed private material before closing the tab.

As of **7 November 2026**, a complete donation through Lace on the new Preview chain remains unverified. The tested Lace 2.5.1 bundle includes ledger 9 support, but its configured wallet indexer returned HTTP 500 while the canonical public Preview services responded. This prevented wallet synchronization and transaction acceptance testing. Earlier browser and proof-generation passes do not establish new-chain settlement. See the [verification record](VERIFICATION.md) for current evidence.

## Limitations

Preview can be reset and public services can be unavailable. Receipts depend on the configured indexer's state observations and do not include an independently verified chain-inclusion proof. The test asset has no money value. The recipient registry, taxpayer identity and tax eligibility are not authenticated by this demonstration.
