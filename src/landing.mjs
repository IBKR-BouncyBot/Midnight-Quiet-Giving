// Optional development support. No wallet connection or payment is initiated.
const button = document.getElementById('copy-support-address');
const address = document.getElementById('support-address');
const status = document.getElementById('support-copy-status');
if (button && address && status && globalThis.isSecureContext && navigator.clipboard?.writeText) {
  button.hidden = false;
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      await navigator.clipboard.writeText(address.textContent.trim());
      status.textContent = 'Cardano mainnet address copied.';
    } catch {
      status.textContent = 'Copy was unavailable. Select the address above and copy it manually.';
      address.focus();
    } finally { button.disabled = false; }
  });
}
