(() => {
  'use strict';
  const isStandalone = () =>
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;

  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    showInstallButton(false);
  });

  function showInstallButton(isIOS) {
    if (isStandalone() || document.getElementById('pwaInstallButton')) return;
    const actions = document.querySelector('.top-actions');
    if (!actions) return;
    const button = document.createElement('button');
    button.id = 'pwaInstallButton';
    button.type = 'button';
    button.className = 'pwa-install-button';
    button.textContent = 'Installa';
    button.setAttribute('aria-label', 'Installa Lorenzo AI sul dispositivo');
    button.addEventListener('click', async () => {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        await deferredPrompt.userChoice.catch(() => null);
        deferredPrompt = null;
        button.remove();
        return;
      }
      if (isIOS) {
        const isItalian = document.documentElement.lang === 'it';
        alert(isItalian
          ? 'Per installare Lorenzo AI: tocca Condividi in Safari, poi “Aggiungi alla schermata Home” e conferma con “Aggiungi”.'
          : 'To install Lorenzo AI, tap Share in Safari, choose “Add to Home Screen”, then tap Add.');
      }
    });
    actions.insertBefore(button, actions.firstChild);
  }

  if (!isStandalone() && /iphone|ipad|ipod/i.test(navigator.userAgent)) {
    window.addEventListener('load', () => showInstallButton(true), { once: true });
  }

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
        // L'app resta utilizzabile anche se il service worker non si registra.
      });
    }, { once: true });
  }
})();