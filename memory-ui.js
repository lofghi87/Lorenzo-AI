(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);
  const MAX_PROFILE_LENGTH = 8000;
  let loading = false;
  let loadedProfile = '';

  function getToken() {
    return supabaseClient.auth.getSession().then(({ data, error }) => {
      if (error || !data?.session?.access_token) throw new Error('Sessione scaduta. Accedi nuovamente.');
      return data.session.access_token;
    });
  }

  function showStatus(message, isError = false) {
    const el = $('#memoryStatus');
    if (!el) return;
    el.textContent = message;
    el.classList.toggle('error', isError);
  }

  async function memoryRequest(method = 'GET', body = null, query = '') {
    const token = await getToken();
    const headers = { Authorization: 'Bearer ' + token };
    if (body) headers['Content-Type'] = 'application/json';
    const response = await fetch('/api/memory' + query, {
      method, headers, ...(body ? { body: JSON.stringify(body) } : {})
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Operazione sulla memoria non riuscita.');
    return data;
  }

  async function loadMemories() {
    const editor = $('#memoryProfileInput');
    const save = $('#memorySaveBtn');
    const clear = $('#memoryClearBtn');
    const login = $('#memoryLoginBtn');
    if (!editor || loading) return;

    if (!currentUser) {
      editor.value = '';
      editor.disabled = true;
      if (save) save.disabled = true;
      if (clear) clear.hidden = true;
      if (login) login.hidden = false;
      loadedProfile = '';
      showStatus('Accedi per attivare il profilo personale. La memoria è privata e sincronizzata con il tuo account.');
      return;
    }

    if (login) login.hidden = true;
    editor.disabled = false;
    if (save) save.disabled = false;
    loading = true;
    showStatus('Caricamento del profilo personale…');
    try {
      const data = await memoryRequest('GET');
      const profile = String(data.profile?.profile_text || '').slice(0, MAX_PROFILE_LENGTH);
      editor.value = profile;
      loadedProfile = profile;
      if (clear) clear.hidden = !profile && !(Array.isArray(data.memories) && data.memories.length);
      showStatus(profile
        ? 'Profilo aggiornato. Lorenzo AI lo userà quando sarà utile alla conversazione.'
        : 'Il profilo è ancora vuoto. Con il tempo si aggiornerà dalle informazioni utili che condividi nelle chat.');
      const count = $('#memoryProfileCount');
      if (count) count.textContent = profile.length.toLocaleString('it-IT') + ' / ' + MAX_PROFILE_LENGTH.toLocaleString('it-IT');
    } catch (error) {
      showStatus(error.message, true);
    } finally {
      loading = false;
    }
  }

  async function saveProfile() {
    if (!currentUser || loading) return;
    const editor = $('#memoryProfileInput');
    const save = $('#memorySaveBtn');
    const profileText = String(editor?.value || '').trim();
    if (profileText.length > MAX_PROFILE_LENGTH) {
      showStatus('Il profilo può contenere al massimo 8.000 caratteri.', true);
      return;
    }
    if (save) save.disabled = true;
    loading = true;
    showStatus('Salvataggio del profilo…');
    try {
      const data = await memoryRequest('POST', { action: 'saveProfile', profile_text: profileText });
      loadedProfile = String(data.profile?.profile_text ?? profileText);
      if (editor) editor.value = loadedProfile;
      const count = $('#memoryProfileCount');
      if (count) count.textContent = loadedProfile.length.toLocaleString('it-IT') + ' / ' + MAX_PROFILE_LENGTH.toLocaleString('it-IT');
      showStatus('Profilo personale salvato.');
      showToast('Memoria personale aggiornata.');
    } catch (error) {
      showStatus(error.message, true);
    } finally {
      loading = false;
      if (save) save.disabled = false;
    }
  }

  function updateCount() {
    const editor = $('#memoryProfileInput');
    const count = $('#memoryProfileCount');
    if (!editor || !count) return;
    count.textContent = editor.value.length.toLocaleString('it-IT') + ' / ' + MAX_PROFILE_LENGTH.toLocaleString('it-IT');
  }

  function addCommandToChat(userText, assistantText) {
    let chat = current();
    if (!chat) {
      chat = { id: id(), title: 'Memoria personale', messages: [] };
      chats.push(chat);
      activeId = chat.id;
    }
    chat.messages.push({ role: 'user', content: userText });
    chat.messages.push({ role: 'assistant', content: assistantText });
    welcome.hidden = true;
    addMessage('user', userText);
    addMessage('assistant', assistantText);
    renderHistory();
    saveChat(chat).then(() => {
      renderHistory();
      if (activeId === chat.id) scrollBottom();
    }).catch(() => showToast('Memoria aggiornata, ma non riesco a salvare la conferma nella chat.'));
  }

  async function wrappedSendMessage(text) {
    const value = String(text || '').trim();
    if (!value || selectedAttachments.length) return originalSendMessage(value);
    if (/^(?:dimentica|cancella)\s+(?:tutte le memorie|tutto quello che ricordi)\.?$/i.test(value)) {
      if (!currentUser) {
        showToast('Accedi per cancellare la memoria personale.');
        return true;
      }
      if (busy || !authReady) return true;
      busy = true;
      promptEl.value = '';
      resizeInput();
      try {
        await memoryRequest('DELETE', null, '?all=true');
        loadedProfile = '';
        const editor = $('#memoryProfileInput');
        if (editor) editor.value = '';
        updateCount();
        if ($('#settingsDialog')?.open) await loadMemories();
        addCommandToChat(value, 'Ho cancellato il tuo profilo personale e le vecchie note salvate.');
        showToast('Memoria personale cancellata.');
      } catch (error) {
        showToast(error.message || 'Non sono riuscito a cancellare la memoria.');
        promptEl.value = value;
        resizeInput();
      } finally {
        busy = false;
      }
      return true;
    }
    // Le richieste normali, incluse "ricorda che..." e "dimentica che...",
    // passano alla chat: il backend aggiorna il profilo riassuntivo.
    return originalSendMessage(value);
  }

  const originalSendMessage = sendMessage;
  sendMessage = wrappedSendMessage;

  $('#memoryBtn')?.addEventListener('click', () => {
    $('#settingsBtn')?.click();
    window.setTimeout(() => {
      $('#memorySection')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      $('#memoryProfileInput')?.focus({ preventScroll: true });
    }, 120);
  });
  $('#settingsBtn')?.addEventListener('click', () => window.setTimeout(loadMemories, 0));
  $('#memorySaveBtn')?.addEventListener('click', saveProfile);
  $('#memoryProfileInput')?.addEventListener('input', updateCount);
  $('#memoryClearBtn')?.addEventListener('click', async () => {
    if (!currentUser || loading) return;
    if (!window.confirm('Vuoi cancellare il profilo personale e tutte le vecchie note salvate?')) return;
    try {
      await memoryRequest('DELETE', null, '?all=true');
      loadedProfile = '';
      const editor = $('#memoryProfileInput');
      if (editor) editor.value = '';
      updateCount();
      await loadMemories();
      showToast('Memoria personale cancellata.');
    } catch (error) {
      showStatus(error.message, true);
    }
  });
  $('#memoryLoginBtn')?.addEventListener('click', () => { window.location.href = '/login.html'; });
  supabaseClient.auth.onAuthStateChange(() => {
    window.setTimeout(() => {
      if (!currentUser) {
        loadedProfile = '';
        const editor = $('#memoryProfileInput');
        if (editor) editor.value = '';
      }
      if ($('#settingsDialog')?.open) loadMemories();
    }, 0);
  });
})();