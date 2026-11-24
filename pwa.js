(() => {
  'use strict';

  const root = document.documentElement;
  const body = document.body;

  const isIOS = () =>
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  const isStandalone = () =>
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    window.navigator.standalone === true;

  const standalone = isStandalone();

  if (standalone) {
    root.classList.add('is-standalone');
    body?.classList.add('is-standalone');

    // Impedisci pinch/double-tap zoom solo nella web app installata.
    // Il Safari normale mantiene la possibilità di ingrandire le pagine.
    const viewportMeta = document.querySelector('meta[name="viewport"]');
    if (viewportMeta) {
      viewportMeta.setAttribute(
        'content',
        'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover'
      );
    }
    root.style.touchAction = 'pan-x pan-y';
    if (body) body.style.touchAction = 'pan-x pan-y';

    const preventZoomGesture = event => {
      if (event.cancelable) event.preventDefault();
    };
    document.addEventListener('gesturestart', preventZoomGesture, { passive: false });
    document.addEventListener('gesturechange', preventZoomGesture, { passive: false });
    document.addEventListener('gestureend', preventZoomGesture, { passive: false });
    document.addEventListener('touchmove', event => {
      if (event.touches && event.touches.length > 1 && event.cancelable) {
        event.preventDefault();
      }
    }, { passive: false });
  } else {
    root.classList.remove('is-standalone');
    body?.classList.remove('is-standalone');
  }

  // Su iOS la tastiera riduce la visual viewport e può anche spostarla.
  // Non ridimensioniamo l'intera app: manteniamo stabile la viewport di layout
  // e solleviamo soltanto il compositore sopra la tastiera.
  const iosKeyboardLayout = isIOS();
  if (iosKeyboardLayout) body?.classList.add('ios-keyboard-layout');

  let stableLayoutHeight = Math.max(
    1,
    Number(window.innerHeight) || 0,
    Number(root.clientHeight) || 0
  );
  let viewportFrame = 0;

  function syncViewportHeight() {
    if (viewportFrame) cancelAnimationFrame(viewportFrame);
    viewportFrame = requestAnimationFrame(() => {
      viewportFrame = 0;

      const measuredHeight = Math.max(
        1,
        Number(window.innerHeight) || 0,
        Number(root.clientHeight) || 0
      );
      const visualViewport = window.visualViewport;
      const visibleHeight = Number(visualViewport?.height) || measuredHeight;
      const visualOffsetTop = Number(visualViewport?.offsetTop) || 0;
      const focusedElement = document.activeElement;
      const editing = Boolean(focusedElement?.matches?.(
        'input, textarea, select, [contenteditable="true"]'
      ));
      const keyboardThreshold = Math.max(100, stableLayoutHeight * 0.16);
      const keyboardViewportReduced =
        visibleHeight < stableLayoutHeight - keyboardThreshold;
      const keyboardOpen = editing && keyboardViewportReduced;

      // Non sostituire l'altezza di riferimento con quella ridotta dalla
      // tastiera: altrimenti body, header e chat vengono traslati insieme.
      if (!keyboardViewportReduced) {
        stableLayoutHeight = measuredHeight;
      }

      const layoutHeight = Math.max(1, stableLayoutHeight);
      const height = iosKeyboardLayout
        ? layoutHeight
        : (visibleHeight > 0 ? visibleHeight : layoutHeight);
      const keyboardInset = iosKeyboardLayout && keyboardViewportReduced
        ? Math.max(0, layoutHeight - visibleHeight)
        : 0;

      root.style.setProperty('--app-viewport-height', Math.round(height) + 'px');
      root.style.setProperty('--app-keyboard-inset', Math.round(keyboardInset) + 'px');
      root.style.setProperty(
        '--app-visual-offset-top',
        Math.round(keyboardOpen && iosKeyboardLayout ? visualOffsetTop : 0) + 'px'
      );
      body?.classList.toggle('keyboard-open', keyboardOpen);
    });
  }

  syncViewportHeight();
  window.addEventListener('resize', syncViewportHeight, { passive: true });
  window.addEventListener('orientationchange', () => {
    syncViewportHeight();
    setTimeout(syncViewportHeight, 180);
  }, { passive: true });
  window.visualViewport?.addEventListener('resize', syncViewportHeight, { passive: true });
  window.visualViewport?.addEventListener('scroll', syncViewportHeight, { passive: true });
  document.addEventListener('focusin', () => setTimeout(syncViewportHeight, 60));
  document.addEventListener('focusout', () => {
    setTimeout(syncViewportHeight, 180);
    setTimeout(syncViewportHeight, 420);
  });
  window.addEventListener('pageshow', syncViewportHeight);

  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', event => {
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
        alert('Per aggiungere Lorenzo AI su iPhone o iPad: in Safari tocca Condividi, scegli “Aggiungi alla schermata Home” e conferma.');
      }
    });

    // Inserisci il pulsante prima di Accedi/Esci: il CSS assegna a ogni controllo
    // uno spazio proprio, evitando che si sovrapponga al nome dell'app.
    actions.insertBefore(button, actions.firstChild);
  }

  if (!standalone && isIOS()) {
    window.addEventListener('load', () => showInstallButton(true), { once: true });
  }

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
        // Il sito resta utilizzabile anche se il service worker non si registra.
      });
    }, { once: true });
  }
})();
