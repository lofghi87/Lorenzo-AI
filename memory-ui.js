(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);
  const MAX_PROFILE_LENGTH = 8000;
  let loading = false;
  let loadedProfile = '';
  let memoryEnabled = true;
  let profileUpdatedAt = null;
  let summaryGenerating = false;

  function getToken() {
    return supabaseClient.auth.getSession().then(({ data, error }) => {
      if (error || !data?.session?.access_token) throw new Error('Sessione scaduta. Accedi nuovamente.');
      return data.session.access_token;
    });
  }

  function showStatus(message, isError = false) {
    const el = $('#memorySummaryStatus');
    if (el) {
      el.textContent = message;
      el.classList.toggle('error', isError);
    }
  }

  function memoryRequest(method = 'GET', body = null, query = '') {
    return getToken().then(async token => {
      const headers = { Authorization: 'Bearer ' + token };
      if (body) headers['Content-Type'] = 'application/json';
      const response = await fetch('/api/memory' + query, {
        method,
        headers,
        ...(body ? { body: JSON.stringify(body) } : {})
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Operazione sulla memoria non riuscita.');
      return data;
    });
  }

  function setPage(pageName) {
    document.querySelectorAll('[data-settings-page]').forEach(page => {
      const active = page.dataset.settingsPage === pageName;
      page.hidden = !active;
      page.classList.toggle('active', active);
    });
    closeMemoryMenu();
    const body = document.querySelector('#settingsDialog .settings');
    if (body) body.scrollTop = 0;
  }

  function updateSettingsThemeText() {
    const isLight = document.body.classList.contains('light');
    const status = $('#settingsThemeStatus');
    const action = $('#settingsThemeAction');
    if (status) status.textContent = isLight ? 'Tema chiaro attivo' : 'Tema scuro attivo';
    if (action) action.textContent = isLight ? 'Usa tema scuro' : 'Usa tema chiaro';
  }

  function updateMemoryControls() {
    const toggle = $('#memoryEnabledToggle');
    const description = $('#memoryToggleDescription');
    const note = $('#memoryDisabledNote');
    const input = $('#memoryEditPrompt');
    const send = $('#memoryEditSendBtn');
    const navStatus = $('#memoryNavStatus');
    const summarySubtitle = $('#memorySummarySubtitle');

    if (toggle) {
      toggle.checked = memoryEnabled;
      toggle.disabled = !currentUser || loading;
    }
    if (description) {
      description.textContent = memoryEnabled
        ? 'Lorenzo AI può ricordare informazioni utili tra le conversazioni.'
        : 'Memoria disattivata: il profilo è conservato ma non viene usato né aggiornato.';
    }
    if (note) note.hidden = memoryEnabled;
    if (input) input.disabled = !currentUser || !memoryEnabled || summaryGenerating;
    if (send) send.disabled = !currentUser || !memoryEnabled || summaryGenerating;
    if (navStatus) navStatus.textContent = memoryEnabled
      ? 'Gestisci cosa Lorenzo AI ricorda di te'
      : 'Memoria disattivata';
    if (summarySubtitle) summarySubtitle.textContent = memoryEnabled
      ? 'Visualizza o modifica ciò che Lorenzo AI ricorda'
      : 'Visualizza il profilo salvato o riattiva la memoria';
    updateSettingsThemeText();
  }

  function formatUpdatedAt(value) {
    if (!value) return 'Profilo personale';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Profilo personale';
    return 'Aggiornato ' + date.toLocaleString('it-IT', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function renderProfile(profile) {
    loadedProfile = String(profile?.profile_text || '').slice(0, MAX_PROFILE_LENGTH);
    profileUpdatedAt = profile?.updated_at || null;
    if (typeof profile?.memory_enabled === 'boolean') memoryEnabled = profile.memory_enabled;

    const summary = $('#memorySummaryText');
    const updated = $('#memorySummaryUpdated');
    if (summary) {
      summary.textContent = loadedProfile ||
        (memoryEnabled
          ? 'Non c’è ancora un riepilogo. Aggiorna il riepilogo dal menu in alto per creare una panoramica delle informazioni utili che hai condiviso nelle conversazioni.'
          : 'Il profilo è vuoto. Riattiva la memoria e aggiorna il riepilogo per creare una panoramica.');
    }
    if (updated) updated.textContent = formatUpdatedAt(profileUpdatedAt);
    updateMemoryControls();
  }

  async function loadMemories() {
    const toggle = $('#memoryEnabledToggle');
    const summary = $('#memorySummaryText');
    if (!currentUser) {
      memoryEnabled = false;
      loadedProfile = '';
      profileUpdatedAt = null;
      if (toggle) {
        toggle.checked = false;
        toggle.disabled = true;
      }
      if (summary) summary.textContent = 'Accedi al tuo account per attivare e gestire la memoria personale.';
      showStatus('Accedi per usare la memoria personale.', true);
      const signIn = $('#settingsSignInBtn');
      if (signIn) signIn.hidden = false;
      updateMemoryControls();
      return;
    }

    loading = true;
    if (toggle) toggle.disabled = true;
    showStatus('Caricamento del profilo…');
    try {
      const data = await memoryRequest('GET');
      renderProfile(data.profile || {});
      if (Array.isArray(data.memories) && data.memories.length && !loadedProfile) {
        const refreshHint = $('#memorySummarySubtitle');
        if (refreshHint) refreshHint.textContent = 'Sono presenti note salvate da integrare nel riepilogo';
      }
      showStatus(memoryEnabled
        ? 'Memoria attiva. Il riepilogo può essere aggiornato dall’AI e corretto da te.'
        : 'Memoria disattivata. Il profilo salvato non viene usato nelle risposte.');
    } catch (error) {
      showStatus(error.message || 'Non riesco a caricare la memoria.', true);
      if (summary) summary.textContent = error.message || 'Non riesco a caricare la memoria.';
    } finally {
      loading = false;
      updateMemoryControls();
    }
  }

  async function refreshSummary(showFeedback = true) {
    if (!currentUser) {
      showStatus('Accedi per aggiornare il riepilogo.', true);
      return;
    }
    if (!memoryEnabled) {
      showStatus('Riattiva la memoria prima di aggiornare il riepilogo.', true);
      return;
    }
    if (summaryGenerating) return;

    summaryGenerating = true;
    const refresh = $('#memoryRefreshBtn');
    if (refresh) refresh.disabled = true;
    showStatus('L’AI sta preparando il riepilogo dalle informazioni disponibili…');
    const summary = $('#memorySummaryText');
    if (summary && !loadedProfile) summary.textContent = 'Sto preparando il riepilogo…';
    updateMemoryControls();

    try {
      const data = await memoryRequest('POST', { action: 'refreshProfile' });
      renderProfile(data.profile || {});
      showStatus('Riepilogo aggiornato dall’AI.');
      if (showFeedback) showToast('Riepilogo della memoria aggiornato.');
    } catch (error) {
      showStatus(error.message || 'Non sono riuscito ad aggiornare il riepilogo.', true);
      if (summary && !loadedProfile) summary.textContent = 'Non sono riuscito a generare il riepilogo. Riprova dal menu in alto.';
    } finally {
      summaryGenerating = false;
      if (refresh) refresh.disabled = false;
      updateMemoryControls();
    }
  }

  function openMemoryMenu() {
    const menu = $('#memoryMenu');
    const button = $('#memoryMenuBtn');
    if (!menu || !button) return;
    menu.hidden = false;
    button.setAttribute('aria-expanded', 'true');
  }

  function closeMemoryMenu() {
    const menu = $('#memoryMenu');
    const button = $('#memoryMenuBtn');
    if (menu) menu.hidden = true;
    if (button) button.setAttribute('aria-expanded', 'false');
  }

  async function setMemoryEnabled(enabled) {
    const toggle = $('#memoryEnabledToggle');
    if (!currentUser) {
      if (toggle) toggle.checked = false;
      showToast('Accedi al tuo account per attivare la memoria.');
      return;
    }
    const previous = memoryEnabled;
    memoryEnabled = Boolean(enabled);
    loading = true;
    updateMemoryControls();
    showStatus(enabled ? 'Attivazione della memoria…' : 'Disattivazione della memoria…');
    try {
      const data = await memoryRequest('POST', { action: 'setEnabled', enabled: Boolean(enabled) });
      renderProfile(data.profile || { profile_text: loadedProfile, memory_enabled: enabled });
      showStatus(memoryEnabled
        ? 'Memoria attivata. Lorenzo AI potrà usare il riepilogo nelle conversazioni.'
        : 'Memoria disattivata. Il profilo è conservato ma non sarà usato né aggiornato.');
      showToast(memoryEnabled ? 'Memoria attivata.' : 'Memoria disattivata.');
    } catch (error) {
      memoryEnabled = previous;
      if (toggle) toggle.checked = previous;
      showStatus(error.message || 'Non sono riuscito a modificare la memoria.', true);
      showToast(error.message || 'Non sono riuscito a modificare la memoria.');
    } finally {
      loading = false;
      updateMemoryControls();
    }
  }

  async function editProfile(instruction) {
    if (!instruction || !instruction.trim()) return;
    if (!currentUser) {
      showStatus('Accedi per modificare il riepilogo.', true);
      return;
    }
    if (!memoryEnabled) {
      showStatus('La memoria è disattivata. Riattivala per modificare il riepilogo.', true);
      return;
    }
    if (summaryGenerating) return;

    summaryGenerating = true;
    const input = $('#memoryEditPrompt');
    const send = $('#memoryEditSendBtn');
    const value = instruction.trim().slice(0, 1200);
    if (send) send.disabled = true;
    if (input) input.disabled = true;
    showStatus('L’AI sta aggiornando il riepilogo…');
    try {
      const data = await memoryRequest('POST', { action: 'editProfile', instruction: value });
      renderProfile(data.profile || {});
      if (input) {
        input.value = '';
        input.style.height = '';
      }
      showStatus('Riepilogo modificato e salvato.');
      showToast('Modifiche alla memoria salvate.');
    } catch (error) {
      showStatus(error.message || 'Non sono riuscito a modificare il riepilogo.', true);
    } finally {
      summaryGenerating = false;
      updateMemoryControls();
    }
  }

  async function clearAndDisableMemory() {
    if (!currentUser || loading || summaryGenerating) {
      if (!currentUser) showToast('Accedi per gestire la memoria personale.');
      return;
    }
    const accepted = window.confirm(
      'Eliminare definitivamente il profilo e tutte le vecchie note della memoria e disattivarla? Non verranno eliminate le conversazioni.'
    );
    if (!accepted) return;
    closeMemoryMenu();
    loading = true;
    updateMemoryControls();
    showStatus('Eliminazione del profilo e delle note…');
    try {
      const data = await memoryRequest('DELETE', null, '?all=true&disable=true');
      memoryEnabled = false;
      loadedProfile = '';
      profileUpdatedAt = data.profile?.updated_at || null;
      renderProfile(data.profile || { profile_text: '', memory_enabled: false });
      showStatus('Memoria eliminata e disattivata.');
      showToast('Profilo e note eliminati. Memoria disattivata.');
      setPage('memory');
    } catch (error) {
      showStatus(error.message || 'Non sono riuscito a eliminare la memoria.', true);
    } finally {
      loading = false;
      updateMemoryControls();
    }
  }

  $('#settingsCloseBtn')?.addEventListener('click', () => $('#settingsDialog')?.close());
  $('#openMemorySettings')?.addEventListener('click', () => {
    setPage('memory');
    void loadMemories();
  });
  $('#openLimitsPage')?.addEventListener('click', () => {
    setPage('limits');
    void refreshImageUsage();
    void refreshChatUsage();
  });
  $('#openAccountPage')?.addEventListener('click', () => {
    setPage('account');
    const title = $('#accountPageTitle');
    const description = $('#accountPageDescription');
    const deleteButton = $('#deleteAccountBtn');
    const signIn = $('#settingsSignInBtn');
    if (title) title.textContent = currentUser ? 'Account connesso' : 'Account non connesso';
    if (description) description.textContent = currentUser
      ? (currentUser.email || 'Il tuo account Lorenzo AI è attivo.')
      : 'Accedi per sincronizzare chat e gestire il tuo account.';
    if (deleteButton) {
      deleteButton.hidden = !currentUser;
      deleteButton.disabled = false;
    }
    if (signIn) signIn.hidden = Boolean(currentUser);
  });
  $('#settingsThemeRow')?.addEventListener('click', () => {
    if (typeof window.toggleTheme === 'function') window.toggleTheme();
    updateSettingsThemeText();
  });
  $('#memoryBackBtn')?.addEventListener('click', () => setPage('home'));
  $('#openMemorySummaryButton')?.addEventListener('click', async () => {
    setPage('memory-summary');
    if (!currentUser) {
      showStatus('Accedi per visualizzare e aggiornare la memoria.', true);
      const summary = $('#memorySummaryText');
      if (summary) summary.textContent = 'Accedi al tuo account per gestire la memoria personale.';
      return;
    }
    if (!loadedProfile) {
      const data = await memoryRequest('GET').catch(() => null);
      if (data?.profile) renderProfile(data.profile);
    }
    if (memoryEnabled) void refreshSummary(false);
    else showStatus('Memoria disattivata. Puoi leggere il profilo salvato e riattivarla dalla schermata precedente.');
  });
  $('#memorySummaryBackBtn')?.addEventListener('click', () => {
    setPage('memory');
    void loadMemories();
  });
  $('#memoryMenuBtn')?.addEventListener('click', () => {
    const menu = $('#memoryMenu');
    if (menu?.hidden) openMemoryMenu();
    else closeMemoryMenu();
  });
  $('#memoryInfoBtn')?.addEventListener('click', () => setPage('memory-info'));
  $('#memoryInfoBackBtn')?.addEventListener('click', () => setPage('memory-summary'));
  $('#memoryRefreshBtn')?.addEventListener('click', () => {
    closeMemoryMenu();
    void refreshSummary(true);
  });
  $('#memoryDeleteDisableBtn')?.addEventListener('click', () => void clearAndDisableMemory());
  $('#memoryEnabledToggle')?.addEventListener('change', event => void setMemoryEnabled(event.currentTarget.checked));
  $('#memoryEditForm')?.addEventListener('submit', event => {
    event.preventDefault();
    void editProfile($('#memoryEditPrompt')?.value || '');
  });
  $('#memoryEditPrompt')?.addEventListener('input', event => {
    const input = event.currentTarget;
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 140) + 'px';
  });
  $('#limitsBackBtn')?.addEventListener('click', () => setPage('home'));
  $('#accountBackBtn')?.addEventListener('click', () => setPage('home'));
  $('#settingsSignInBtn')?.addEventListener('click', () => { window.location.href = '/login.html'; });

  document.addEventListener('click', event => {
    const menu = $('#memoryMenu');
    if (!menu || menu.hidden) return;
    if (!menu.contains(event.target) && !$('#memoryMenuBtn')?.contains(event.target)) closeMemoryMenu();
  });

  // Il comando testuale "dimentica tutte le memorie" resta disponibile anche dalla chat.
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
        profileUpdatedAt = null;
        if ($('#settingsDialog')?.open) await loadMemories();
        addCommandToChat(value, 'Ho cancellato il profilo personale e le vecchie note salvate. La memoria resta attiva.');
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
    return originalSendMessage(value);
  }

  const originalSendMessage = sendMessage;
  sendMessage = wrappedSendMessage;
  window.openSettingsPage = setPage;
  window.loadMemorySettings = loadMemories;

  supabaseClient.auth.onAuthStateChange(() => {
    window.setTimeout(() => {
      if (!currentUser) {
        loadedProfile = '';
        profileUpdatedAt = null;
        memoryEnabled = false;
        const editor = $('#memoryEditPrompt');
        if (editor) editor.value = '';
      }
      if ($('#settingsDialog')?.open) {
        if ($('#memorySettingsPage') && !$('#memorySettingsPage').hidden) void loadMemories();
        if (!$('#accountPage')?.hidden) $('#openAccountPage')?.dispatchEvent(new Event('click'));
      }
    }, 0);
  });

  updateSettingsThemeText();
})();
