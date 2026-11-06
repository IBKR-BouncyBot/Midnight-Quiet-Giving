# Preview with Lace

## Prepare the two sides

Use the current official [Lace extension](https://www.lace.io/). In its Midnight settings select **Preview**, then **On this device → Run in this app (WASM)**. Confirm the same setting on the application's connect screen. Keep the browser open while it proves transactions.

The donor needs Preview test NIGHT registered for usable DUST. DUST pays network fees; it is not the donation token and cannot be transferred like an ordinary asset. Obtain test funding through the [Midnight Preview faucet](https://midnight-tmnight-preview.nethermind.dev/) listed in the [official endpoints guide](https://docs.midnight.network/relnotes/network). Never send mainnet funds to this prototype.

The recipient provides its shielded coin public key and shielded encryption public key. These are public receiving details, not wallet secrets. Use a separate test recipient to demonstrate a transfer between two participants. The campaign's receiving key is fixed once deployed.

## Run the flow

1. Open `network.html` in the browser where Lace is installed.
2. Select Lace, confirm internal WASM proving, choose the application storage password and connect on Preview.
3. Enter the recipient's public receiving keys and create a donation campaign, or import its public join file. After deployment, choose **Lock the rules** and approve the separate Lace transaction that permanently disables maintenance authority.
4. Mint valueless campaign test tokens to the donor wallet, approving the wallet operation. Wait for confirmation and wallet synchronization.
5. Enter a fictional taxpayer reference and a whole-number test amount. Submit the donation and approve the requested operations in Lace.
6. Wait for the application to report indexed confirmation. Retain the public receipt and explicitly download the private disclosure if needed.
7. Send that disclosure to the **local authority demo** for commitment and indexed-record checks. This shares nothing with a real tax authority.

## Proving and evidence

The contract and wallet/DUST proofs are requested through Lace. The app rejects a reported HTTP proof server and does not silently fall back to one. Lace API 4 does not attest its internal proving mode, so a missing URL alone is insufficient evidence. A real extension test must inspect its setting and relevant traffic.

The UI distinguishes connection, proving, wallet approval, submission and confirmation. A long proof is not a confirmed donation. An interrupted submission may still land; use recovery/check controls before retrying. Save needed private material before closing the tab.

## Limitations

Preview can be reset and public services can be unavailable. Receipts depend on the configured indexer's state observations and do not include an independently verified chain-inclusion proof. The test asset has no money value. The recipient registry, taxpayer identity and tax eligibility are not authenticated by this demonstration.
