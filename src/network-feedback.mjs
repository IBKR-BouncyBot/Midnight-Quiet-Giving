/** Visible action feedback; never stores wallet errors, identities or inputs. */
export function createActionFeedback(globalStatus, { slowAfterMs = 15000 } = {}) {
  let active = null;
  function clearTimer() { if (active?.timer) clearTimeout(active.timer); }
  return {
    begin(source, label = 'Working…') {
      clearTimer();
      const panel = source?.closest('.network-panel');
      const output = panel?.querySelector('[data-action-feedback]');
      const button = source?.matches('button') ? source : source?.querySelector('button[type="submit"]');
      active = { panel, output, button, originalNodes: button ? [...button.childNodes] : [], timer: null };
      if (output) { output.hidden = false; output.replaceChildren(); output.dataset.kind = 'progress'; }
      panel?.setAttribute('aria-busy', 'true');
      if (button) { button.textContent = label; button.setAttribute('aria-busy', 'true'); }
    },
    update(message, kind = 'progress') {
      globalStatus.textContent = message;
      globalStatus.dataset.kind = kind;
      clearTimer();
      if (!active?.output) return;
      active.output.textContent = message;
      active.output.dataset.kind = kind;
      active.output.hidden = false;
      if (kind === 'error') active.output.setAttribute('role', 'alert');
      else active.output.setAttribute('role', 'status');
      if (kind === 'progress') {
        const current = active;
        current.timer = setTimeout(() => {
          if (active !== current) return;
          const hint = document.createElement('span'); hint.className = 'action-wait-hint';
          hint.textContent = 'Still waiting for Lace or Preview. Check any open Lace request and keep this tab open. Do not submit the action again while it is running.';
          current.output.append(hint);
        }, slowAfterMs);
      }
    },
    finish() {
      clearTimer();
      if (active?.button) { active.button.replaceChildren(...active.originalNodes); active.button.removeAttribute('aria-busy'); }
      active?.panel?.removeAttribute('aria-busy');
      active = null;
    },
  };
}
