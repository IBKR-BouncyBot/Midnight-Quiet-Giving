# GitHub Pages deployment

Source: https://github.com/IBKR-BouncyBot/Midnight-Private-but-tax-compliant-donations

Frontend: https://ibkr-bouncybot.github.io/Midnight-Private-but-tax-compliant-donations/

The `pages.yml` workflow installs the official pinned Compact compiler, installs the committed npm graph, compiles the donation contract and proof material, runs meaningful contract/privacy tests, builds native and network bundles, exercises the browser journey, and publishes `dist/` using GitHub Pages.

Use **GitHub Actions** as the repository's Pages build source. The workflow grants Pages deployment permission only to the deployment job. Public artifacts contain static frontend files, public circuit material, dependencies and documentation. They must not contain wallet profiles, seeds, passwords, private state or private disclosure downloads.

The separate manually dispatched Lace workflow is for independent extension testing on a disposable GitHub runner. Its results are separate from successful website publication. Downloading a signed extension establishes neither wallet setup nor a successful transaction.

GitHub Pages has no application backend. It does not host the illustrated tax authority, a prover or a Midnight node. Each visitor's Lace wallet handles its approvals and proving; the frontend connects to public Preview services.
