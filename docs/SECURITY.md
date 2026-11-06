# Privacy and trust boundaries

This is a test-token research prototype. It is not a tax filing service, an identity system or an audited payment product.

## What remains private

Taxpayer references, donor secrets and receipt salts are private Compact inputs. Public record export omits these fields. Network submission must never write private disclosure contents to public state. A new random donor secret and salt are generated per donation to avoid a stable public donor identifier.

The recipient and other observers can still learn information from the public contract, circuit calls, timing, disclosed ledger effects and outside clues. A distinctive amount, identifying message, funding trail or voluntarily shared receipt may undermine anonymity. The prototype does not claim complete traffic-analysis resistance or unlinkability from every observer.

## What the proof establishes

A commitment opening establishes that its supplied data matches a particular receipt. Inclusion in the correctly pinned immutable contract ties the record to the donation circuit. A public JSON file by itself is not an authenticated chain record. An indexer observation relies on the configured service; this app does not verify an independent chain-inclusion proof.

The taxpayer identifier is self-entered and not authenticated. An opening can be copied or shared; possession is not non-transferable legal identity. A recipient key is not certified charitable status. The app does not prove fiat valuation, absence of benefits in exchange, eligibility for a deduction, or official acceptance. Duplicate receipt rejection in the contract is not a cross-authority tax-claim registry.

The later authority check uses an explicit private opening. That disclosure exposes the selected donation's opening material to its verifier. There is no separate zero-knowledge tax-presentation feature in this version.

## Storage and recovery

Browser-lab private material stays in session memory until an explicit download. Refreshing or resetting the demo loses that session. Use fictional identifiers.

The network providers use encrypted SDK browser storage for application signing material. Lace keeps wallet keys, while donation openings are held by the application. Save the private receipt deliberately when needed. A Lace recovery phrase cannot reconstruct an application's lost receipt salt or donor secret. Keep the wallet phrase out of the app and out of source control.

Downloaded private disclosures are unencrypted JSON and must be handled as private documents. Public export and private export have different purposes. Imported JSON is schema- and bounds-checked, with commitment verification before acceptance, and user text is rendered without HTML interpretation.

## Transaction uncertainty

Wallet rejection before submission differs from a connection failure after submission. Pending operations must be checked against indexed state before retrying a donation. A connection, proof, balance call or submission response alone is not a confirmed payment. Refreshing the page must not be described as cancelling an already submitted transaction.

## Independent Lace tests

The CI route uses a disposable runner, the official signed extension package and a fresh test wallet. No personal wallet is used. Test wallet secrets and browser profiles must remain in runner temporary storage; no screenshots of recovery phrases, traces, state dumps or private receipts may be uploaded. Version/package verification, internal WASM selection, wallet funding, proof generation and chain confirmation must be reported separately. A failure at any stage must not be upgraded to success by using a simulated connector.
