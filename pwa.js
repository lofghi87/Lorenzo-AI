(() => {
  'use strict';

  const isIOS = () =>
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  const isStandalone = () =>
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;

  // Safari iOS changes the visible viewport height when its keyboard opens.
  // Keep the chat and composer aligned with the actually visible area.
  let viewportFrame = 0;
  function syncViewportHeight() {
    if (viewportFrame) cancelAnimationFrame(viewportFrame);
    viewportFrame = requestAnimationFrame(() => {
      viewportFrame = 0;
      const height = window.visualViewport?.height || window.innerHeight;
      document.documentElement.style.setProperty('--app-viewport-height', height + 'px');
    });
  }

  syncViewportHeight();
  window.addEventListener('resize', syncViewportHeight, { passive: true });
  window.addEventListener('orientationchange', syncViewportHeight, { passive: true });
  window.visualViewport?.addEventListener('resize', syncViewportHeight, { passive: true });

  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    showInstallButton(false);
  });

  function showInstallButton(iosMode) {
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
      if (iosMode) {
        alert('Per aggiungere Lorenzo AI su iPhone o iPad: in Safari tocca Condividi (il quadrato con la freccia verso l’alto), scegli “Aggiungi alla schermata Home” e conferma. Se non trovi la voce, apri il menu “Altro”.');
      }
    });

    // Keep Accedi/Esci as the last control, at the top-right corner.
    actions.insertBefore(button, actions.firstChild);
  }

  // iPadOS may identify itself as desktop Safari, so isIOS also checks touch support.
  if (!isStandalone() && isIOS()) {
    window.addEventListener('load', () => showInstallButton(true), { once: true });
  }

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
        // The app remains usable even if service worker registration fails.
      });
    }, { once: true });
  }
})();
