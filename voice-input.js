/* Migliora la dettatura senza dipendere dal listener legacy di app.js. */
(() => {
  const originalButton = document.getElementById('voiceInputBtn');
  const prompt = document.getElementById('prompt');
  if (!originalButton || !prompt) return;

  // Sostituire il nodo elimina in modo sicuro il vecchio listener già registrato.
  const button = originalButton.cloneNode(true);
  originalButton.replaceWith(button);

  let recognition = null;
  let listening = false;
  let baseText = '';
  let finalText = '';

  function updateButton(active) {
    listening = active;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
    button.title = active ? 'Termina dettatura' : 'Dettatura vocale';
    button.setAttribute('aria-label', button.title);
    button.innerHTML = active
      ? '<span aria-hidden="true">■</span><span>Stop</span>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true" class="tool-icon"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11v1a7 7 0 0 0 14 0v-1M12 19v3M8 22h8"/></svg><span>Voce</span>';
  }

  function notify(message) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    window.clearTimeout(window.__lorenzoVoiceToastTimer);
    window.__lorenzoVoiceToastTimer = window.setTimeout(() => toast.classList.remove('show'), 3500);
  }

  function composeText(transcript) {
    const separator = baseText && transcript && !/\s$/.test(baseText) ? ' ' : '';
    const maxLength = Number(prompt.maxLength) > 0 ? Number(prompt.maxLength) : 12000;
    return (baseText + separator + transcript).slice(0, maxLength);
  }

  function startVoiceInput() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      notify('La dettatura vocale non è supportata da questo browser. Prova Safari aggiornato o Chrome.');
      return;
    }

    if (listening) {
      recognition?.stop();
      return;
    }

    try {
      baseText = prompt.value;
      finalText = '';
      recognition = new Recognition();
      recognition.lang = 'it-IT';
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;

      recognition.onresult = event => {
        let complete = '';
        let interim = '';
        for (let i = 0; i < event.results.length; i += 1) {
          const result = event.results[i];
          const words = result?.[0]?.transcript || '';
          if (result.isFinal) complete += words + ' ';
          else interim += words;
        }
        finalText = complete.trim();
        prompt.value = composeText((finalText + (interim ? ' ' + interim : '')).trim());
        prompt.dispatchEvent(new Event('input', { bubbles: true }));
      };

      recognition.onerror = event => {
        const messages = {
          'not-allowed': 'Consenti l’accesso al microfono nelle impostazioni del browser.',
          'service-not-allowed': 'Il browser o il dispositivo non consente la dettatura vocale.',
          'no-speech': 'Non ho rilevato parole. Premi Voce e riprova.',
          'audio-capture': 'Non trovo un microfono disponibile.',
          'network': 'La dettatura richiede una connessione funzionante. Controlla Internet e riprova.'
        };
        if (event.error !== 'aborted') notify(messages[event.error] || 'Dettatura interrotta. Riprova.');
      };

      recognition.onend = () => {
        // Conserva soltanto le parole confermate, non il testo provvisorio.
        prompt.value = composeText(finalText);
        prompt.dispatchEvent(new Event('input', { bubbles: true }));
        updateButton(false);
        recognition = null;
        prompt.focus();
      };

      recognition.start();
      updateButton(true);
      notify('Ti ascolto… Premi Stop quando hai finito.');
    } catch (error) {
      updateButton(false);
      recognition = null;
      notify('Non riesco ad avviare la dettatura. Controlla i permessi del microfono e riprova.');
    }
  }

  button.addEventListener('click', startVoiceInput);
  document.getElementById('chatForm')?.addEventListener('submit', () => {
    if (listening) recognition?.stop();
  });
})();