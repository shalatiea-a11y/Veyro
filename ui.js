// Shared button-feedback helper. Used everywhere a button triggers a
// network write, so every important action gets real state (Saving… ->
// Saved ✓ / error) instead of looking identical before, during, and after
// a tap — and the disabled state during the call IS the double-submit
// guard (a second tap while busy is a no-op, not a second request).
function withBusyButton(button, fn, { busyText = "Saving…", doneText = "Saved ✓" } = {}) {
  if (!button || button.disabled) return Promise.resolve();
  const original = button.textContent;
  button.disabled = true;
  button.textContent = busyText;
  return Promise.resolve()
    .then(fn)
    .then((result) => {
      button.textContent = doneText;
      setTimeout(() => {
        button.disabled = false;
        button.textContent = original;
      }, 900);
      return result;
    })
    .catch((err) => {
      button.disabled = false;
      button.textContent = original;
      throw err;
    });
}
