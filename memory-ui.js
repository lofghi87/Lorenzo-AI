(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);
  const MAX_MEMORY_LENGTH = 400;
  let memories = [];
  let loading = false;

  function getToken() {
    return supabaseClient.auth.getSession().then(({ data, error }) => {
      if (error || !data?.session?.access_token) {
        throw new Error('Sessione scaduta. Accedi nuovamente.');
      }
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
      method,
      headers,
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || 'Operazione sulla memoria non riuscita.');
    }
    return data;
  }

  function renderMemoryList() {
    const list = $('#memoryList');
    const clear = $('#memoryClearBtn');
    if (!list) return;
    list.replaceChildren();

    if (!memories.length) {
      const empty = document.createElement('p');
      empty.className = 'memory-empty';
      empty.textContent = 'Non hai ancora salvato note. Scrivi “Ricorda che…” in chat o aggiungine una qui.';
      list.append(empty);
      if (clear) clear.hidden = true;
      return;
    }

    if (clear) clear.hidden = false;
    memories.forEach(memory => {
      const row = document.createElement('div');
      row.className = 'memory-item';

      const text = document.createElement('p');
      text.className = 'memory-item-text';
      text.textContent = memory.content;

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'memory-delete';
      remove.textContent = 'Elimina';
      remove.setAttribute('aria-label', 'Elimina memoria: ' + memory.content);
      remove.addEventListener('click', async () => {
        if (loading) return;
        remove.disabled = true;
        try {
          await memoryRequest('DELETE', null, '?id=' + encodeURIComponent(memory.id));
          memories = memories.filter(item => item.id !== memory.id);
          renderMemoryList();
          showStatus('Memoria eliminata.');
        } catch (error) {
          showStatus(error.message, true);
          remove.disabled = false;
        }
      });

      row.append(text, remove);
      list.append(row);
    });
  }

  async function loadMemories() {
    const input = $('#memoryInput');
    const save = $('#memorySaveBtn');
    const clear = $('#memoryClearBtn');
    const login = $('#memoryLoginBtn');
    if (!input || loading) return;

    if (!currentUser) {
      memories = [];
      renderMemoryList();
      input.disabled = true;
      if (save) save.disabled = true;
      if (clear) clear.hidden = true;
      if (login) login.hidden = false;
      showStatus('Accedi per usare la memoria personale. Le chat senza account non hanno memoria sincronizzata.');
      return;
    }

    if (login) login.hidden = true;
    input.disabled = false;
    if (save) save.disabled = false;
    loading = true;
    showStatus('Caricamento delle memorie…');
    try {
      const data = await memoryRequest('GET');
      memories = Array.isArray(data.memories) ? data.memories.slice(0, 30) : [];
      renderMemoryList();
      showStatus(memories.length
        ? memories.length + ' di 30 note salvate. Le note vengono usate solo quando pertinenti.'
        : 'Nessuna memoria salvata. Puoi aggiungere fino a 30 note.');
    } catch (error) {
      memories = [];
      renderMemoryList();
      showStatus(error.message, true);
    } finally {
      loading = false;
    }
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
    const answer = addMessage('assistant', assistantText);
    renderHistory();
    saveChat(chat).then(() => {
      renderHistory();
      if (activeId === chat.id) scrollBottom();
    }).catch(() => showToast('Nota salvata, ma non riesco a salvare la conferma nella chat.'));
  }

  async function executeMemoryCommand(text, type, content) {
    if (!currentUser) {
      showToast('Accedi per usare la memoria personale. La nota è rimasta nel campo di testo.');
      return true;
    }
    if (busy || !authReady) return true;
    if (selectedAttachments.length) {
      showToast('Invia o rimuovi gli allegati prima di usare un comando di memoria.');
      return true;
    }

    busy = true;
    promptEl.value = '';
    resizeInput();
    try {
      let answer;
      if (type === 'add') {
        const result = await memoryRequest('POST', { action: 'add', content });
        const saved = result.memory?.content || content;
        answer = result.duplicate
          ? 'Questa nota è già presente nella tua memoria personale.'
          : 'Ho salvato nella tua memoria personale: “' + saved + '”. La userò nelle prossime conversazioni quando sarà utile.';
        showToast(result.duplicate ? 'Nota già presente nella memoria.' : 'Memoria salvata.');
      } else if (type === 'clear') {
        await memoryRequest('DELETE', null, '?all=true');
        answer = 'Ho cancellato tutte le note della tua memoria personale.';
        showToast('Memoria personale cancellata.');
      } else {
        const result = await memoryRequest('DELETE', { content }, '');
        answer = result.deleted
          ? 'Ho rimosso dalla memoria personale la nota richiesta.'
          : 'Non ho trovato una nota identica da rimuovere. Puoi controllare le memorie dalle impostazioni.';
        showToast(result.deleted ? 'Memoria eliminata.' : 'Non ho trovato una nota identica.');
      }
      addCommandToChat(text, answer);
      if ($('#settingsDialog')?.open) await loadMemories();
    } catch (error) {
      showToast(error.message || 'Non sono riuscito ad aggiornare la memoria.');
      promptEl.value = text;
      resizeInput();
    } finally {
      busy = false;
    }
    return true;
  }

  async function wrappedSendMessage(text) {
    const value = String(text || '').trim();
    if (!value || selectedAttachments.length) return originalSendMessage(value);

    const clearMatch = value.match(/^(?:dimentica|cancella)\s+(?:tutte le memorie|tutto quello che ricordi)\.?$/i);
    if (clearMatch) return executeMemoryCommand(value, 'clear', '');

    const addMatch = value.match(/^(?:ricorda(?:ti)?(?:\s+che)?|memorizza(?:\s+che)?|tieni a mente(?:\s+che)?)\s+(.+)$/i);
    if (addMatch) {
      const content = addMatch[1].trim();
      if (content.length > MAX_MEMORY_LENGTH) {
        showToast('Ogni memoria può contenere al massimo 400 caratteri.');
        return;
      }
      return executeMemoryCommand(value, 'add', content);
    }

    const deleteMatch = value.match(/^(?:dimentica(?:ti)?(?:\s+che)?|rimuovi dalla memoria(?:\s+che)?)\s+(.+)$/i);
    if (deleteMatch) return executeMemoryCommand(value, 'delete', deleteMatch[1].trim());

    return originalSendMessage(value);
  }

  const originalSendMessage = sendMessage;
  sendMessage = wrappedSendMessage;

  $('#memoryBtn')?.addEventListener('click', () => {
    $('#settingsBtn')?.click();
    window.setTimeout(() => {
      $('#memorySection')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      $('#memoryInput')?.focus({ preventScroll: true });
    }, 120);
  });

  $('#settingsBtn')?.addEventListener('click', () => {
    window.setTimeout(() => loadMemories(), 0);
  });

  $('#memorySaveBtn')?.addEventListener('click', async () => {
    if (!currentUser) {
      showStatus('Accedi per salvare le tue note.', true);
      return;
    }
    const input = $('#memoryInput');
    const content = String(input?.value || '').trim();
    if (content.length < 2) {
      showStatus('Scrivi una nota di almeno 2 caratteri.', true);
      input?.focus();
      return;
    }
    if (content.length > MAX_MEMORY_LENGTH) {
      showStatus('Ogni memoria può contenere al massimo 400 caratteri.', true);
      return;
    }
    const button = $('#memorySaveBtn');
    if (button) button.disabled = true;
    try {
      const result = await memoryRequest('POST', { action: 'add', content });
      if (input) input.value = '';
      await loadMemories();
      showToast(result.duplicate ? 'Questa nota è già salvata.' : 'Memoria personale aggiornata.');
    } catch (error) {
      showStatus(error.message, true);
    } finally {
      if (button) button.disabled = false;
    }
  });

  $('#memoryInput')?.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      $('#memorySaveBtn')?.click();
    }
  });

  $('#memoryClearBtn')?.addEventListener('click', async () => {
    if (!currentUser || loading || !memories.length) return;
    if (!window.confirm('Vuoi cancellare tutte le note della memoria personale?')) return;
    try {
      await memoryRequest('DELETE', null, '?all=true');
      memories = [];
      renderMemoryList();
      showStatus('Memoria personale cancellata.');
      showToast('Tutte le memorie sono state cancellate.');
    } catch (error) {
      showStatus(error.message, true);
    }
  });

  $('#memoryLoginBtn')?.addEventListener('click', () => {
    window.location.href = '/login.html';
  });

  supabaseClient.auth.onAuthStateChange(() => {
    window.setTimeout(() => {
      if (!currentUser) {
        memories = [];
        renderMemoryList();
      }
      if ($('#settingsDialog')?.open) loadMemories();
    }, 0);
  });
})();