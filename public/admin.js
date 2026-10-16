// Navigation, filtering and updates are standard links and forms, usable without JavaScript.
document.querySelectorAll('[data-admin-save]').forEach(form => {
  form.addEventListener('submit', event => {
    const button = event.submitter;
    if (!button || button.type !== 'submit') return;
    button.disabled = true;
    button.textContent = form.action.endsWith('/login') ? 'Signing in…' : 'Saving…';
    form.setAttribute('aria-busy', 'true');
  });
});
document.querySelector('[data-password-toggle]')?.addEventListener('click', event => {
  const button = event.currentTarget;
  const input = document.getElementById(button.getAttribute('aria-controls'));
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  button.textContent = show ? 'Hide' : 'Show';
  button.setAttribute('aria-pressed', String(show));
});
// Restore form controls when navigating back through the browser's page cache.
window.addEventListener('pageshow', event => {
  if (event.persisted && document.querySelector('[data-admin-save][aria-busy]')) location.reload();
});
