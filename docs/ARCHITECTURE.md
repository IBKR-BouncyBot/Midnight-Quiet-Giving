# Donation and disclosure design

## Contract

`contracts/donations.compact` pins a campaign identifier and a recipient shielded coin public key at construction. Each deployment defines its own test-token color. The faucet is deliberately unlimited and the tokens are valueless.

`mint` creates bounded positive quantities of the campaign token. `donate` accepts a fresh coin of that color funded by wallet balancing, receives it into the contract, and immediately transfers its full value to the fixed recipient. The receipt is inserted in the same constrained operation as that payment. Amount bounds, a short validity window, nonzero private inputs, unique receipt identifiers and unique coin nonces are enforced by Compact.

The network client disables maintenance authority before enabling donation operations and verifies that state when joining. Otherwise a deployer could replace the circuit rules and manufacture receipts. The recipient's encryption public key is also supplied to wallet balancing so the receiving wallet can discover the shielded output.

## Receipt commitment

The receipt commits to the purpose domain, campaign, contract address, receipt identifier, recipient coin public key, token color, amount, validity-window start and end, a digest of the taxpayer reference, and a donor secret. A fresh secret salt provides hiding. Binding the contract and campaign prevents reusing a receipt as evidence for a different recipient or deployment.

The public receipt contains the identifier, commitment and contract/campaign/recipient context. In network mode it can include the transaction identifier and block height. It excludes the taxpayer reference, donor secret and opening salt.

The private disclosure contains the public receipt plus the opening fields. The verifier recomputes the actual Compact commitment and compares it with the recorded commitment. A private packet that checks against itself is only internally consistent; authoritative inclusion must be checked separately against the intended contract. The browser lab reads its actual in-memory native contract record. The network path reads state from the configured Preview indexer and checks the pinned campaign, recipient and immutable rules.

The validity window limits when a network transaction can be accepted. Its start is not an independently observed exact settlement timestamp. In production, derive legal accounting dates from accepted transaction/block evidence and the relevant jurisdiction's rules.

## Three views

- **Donor:** chooses a donation, retains its private opening, and decides whether to disclose it.
- **Recipient:** receives the payment; the application does not send it the taxpayer reference or donor opening.
- **Authority demo:** receives a deliberately shared opening and verifies it. It is a local browser role, with no government API or legal acceptance claim.

The tax demonstration uses private evidence sharing, not a second zero-knowledge circuit hiding selected opening fields from the authority. An actual institution would require authenticated submission, its own verifier, trusted recipient registration and evidence policies. The network transaction's zero-knowledge proof and the later private opening check are distinct operations.

## Browser and wallet

The local demo executes generated Compact JavaScript backed by actual Midnight WebAssembly. Its coin-flow checks are native execution, but wallet balances, received totals and local state are illustrative. There is no consensus or proof generation in that mode.

The testnet bundle uses Midnight.js 4.1.1 and DApp Connector API 4. It accepts Preview, rejects mainnet, checks the connected account before sensitive calls, and requires explicit confirmation of Lace's internal WASM setting. Reported external prover URLs are rejected. API 4 cannot independently attest internal proving mode; the setting and extension traffic must be inspected during a real Lace test.

## Hosting

All frontend assets, compiled circuit material and WASM are served from ordinary GitHub Pages with relative paths. Secrets, private wallets and private receipts are never included in the static build or CI artifacts. The authority server drawn in the interface is explanatory, not a hosted backend.
