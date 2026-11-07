# GitHub Pages deployment

Source: https://github.com/IBKR-BouncyBot/Midnight-Quiet-Giving

Frontend: https://ibkr-bouncybot.github.io/Midnight-Quiet-Giving/

The `pages.yml` workflow installs the official pinned Compact compiler, installs the committed npm graph, compiles the donation contract and proof material, runs meaningful contract/privacy tests, builds native and network bundles, exercises the browser journey, and publishes `dist/` using GitHub Pages.

The SDK 5 network build preserves dynamic ESM chunks and packages every generated module. Before publication, a remote Chromium check loads the unmodified production bundle and prepares a real deployment up to a synthetic connector that refuses wallet approval. It catches SDK initialization failures without connecting a wallet or submitting a transaction; it is separate from full Lace acceptance.

Use **GitHub Actions** as the repository's Pages build source. The workflow grants Pages deployment permission only to the deployment job. Public artifacts contain static frontend files, public circuit material, dependencies and documentation. They must not contain wallet profiles, seeds, passwords, private state or private disclosure downloads.

The separate manually dispatched Lace workflow is for independent extension testing on a disposable GitHub runner. Its results are separate from successful website publication. Downloading a signed extension establishes neither wallet setup nor a successful transaction.

The internal-wallet acceptance workflow uses fresh SDK wallets entirely on a disposable GitHub runner. Its public funding artifact is available while the runner waits for Preview faucet tokens. Wallet secrets and private disclosure openings are never uploaded. This test is separate from the Lace extension workflow; SDK acceptance must not be reported as a completed Lace test. Manual runs of `pages.yml` also generate actual circuit proofs in a browser worker on the runner.

GitHub Pages has no application backend. It does not host the illustrated tax authority, a prover or a Midnight node. Each visitor's Lace wallet handles its approvals and proving; the frontend connects to public Preview services.
