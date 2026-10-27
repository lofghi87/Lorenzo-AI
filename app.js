
const SUPABASE_URL = 'https://bknkgctmpgiuxvahbbzs.supabase.co';
const SUPABASE_KEY = 'sb_publishable_rZEaUwMU4CCl7kUPdUlvuw_cuX2n9hB';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const $ = s => document.querySelector(s);
const messagesEl = $('#messages');
const welcome = $('#welcome');
const promptEl = $('#prompt');
const sendBtn = $('#sendBtn');
const fileInput = $('#fileInput');
const attachBtn = $('#attachBtn');
const attachmentsPreview = $('#attachmentsPreview');
const imageModeBtn = $('#imageModeBtn');

const STORE_KEY = 'lorenzo-ai-chats-v1';
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_TOTAL_SIZE = 20 * 1024 * 1024;
const MAX_FILES = 5;
const LOCAL_MAX_FILE_SIZE = 2 * 1024 * 1024;
const LOCAL_MAX_TOTAL_SIZE = 3 * 1024 * 1024;
const LOCAL_MAX_FILES = 4;
const BUCKET = 'lorenzo-attachments';

const ALLOWED_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp',
  'image/heic', 'image/heif', 'application/pdf'
]);

let chats = [];
let activeId = null;
let busy = false;
let toastTimer;
let currentUser = null;
let authReady = false;
let selectedAttachments = [];
let imageMode = false;

function id() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function current() {
  return chats.find(c => c.id === activeId);
}

function showToast(msg) {
  const t = $('#toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3500);
}

function loadLocalChats() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
    return Array.isArray(saved)
      ? saved.filter(c => c && c.id && Array.isArray(c.messages))
      : [];
  } catch {
    return [];
  }
}

function saveLocalChats() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(chats));
  } catch {
    showToast('Impossibile salvare le chat su questo dispositivo.');
  }
}

function renderHistory() {
  const h = $('#history');
  if (!h) return;
  h.replaceChildren();

  chats.slice().reverse().forEach(c => {
    const b = document.createElement('button');
    b.className = 'history-item' + (c.id === activeId ? ' active' : '');
    b.textContent = '◷ ' + (c.title || 'Nuova conversazione');
    b.title = c.title || '';
    b.onclick = () => openChat(c.id);
    h.append(b);
  });
}

function resetImageMode() {
  imageMode = false;
  if (imageModeBtn) {
    imageModeBtn.setAttribute('aria-pressed', 'false');
    imageModeBtn.classList.remove('active');
    imageModeBtn.style.borderColor = '';
  }
  promptEl.placeholder = 'Scrivi a Lorenzo AI…';
}

function clearSelectedAttachments() {
  selectedAttachments = [];
  renderAttachmentsPreview();
  if (fileInput) fileInput.value = '';
  resizeInput();
}

function newChat() {
  activeId = null;
  messagesEl.replaceChildren();
  welcome.hidden = false;
  promptEl.value = '';
  resetImageMode();
  clearSelectedAttachments();
  renderHistory();
  resizeInput();
  promptEl.focus();
  $('#sidebar')?.classList.remove('open');
}

function openChat(chatId) {
  const c = chats.find(x => x.id === chatId);
  if (!c) return;

  activeId = chatId;
  messagesEl.replaceChildren();
  c.messages.forEach((m, index) => {
    const bubble = addMessage(m.role, m.content, false, m.attachmentNames);
    if (m.role === 'assistant' && String(m.content || '').trim()) {
      addMessageActions(bubble, c.id, index);
    }
  });

  welcome.hidden = c.messages.length > 0;
  resetImageMode();
  clearSelectedAttachments();
  renderHistory();
  $('#sidebar')?.classList.remove('open');
  scrollBottom();
}

function renderMarkdown(el, text, renderMath = true) {
  if (!window.marked || !window.DOMPurify) {
    el.textContent = text;
    return;
  }

  el.innerHTML = window.DOMPurify.sanitize(
    window.marked.parse(text, { gfm: true, breaks: true }),
    { USE_PROFILES: { html: true } }
  );

  // Renderizza formule matematiche con fallback se KaTeX non è disponibile.
  if (renderMath && typeof window.renderMathInElement === 'function') {
    try {
      window.renderMathInElement(el, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '\\[', right: '\\]', display: true },
          { left: '\\(', right: '\\)', display: false },
          { left: '$', right: '$', display: false }
        ],
        throwOnError: false,
        ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code']
      });
    } catch (error) {
      console.warn('Impossibile renderizzare una formula:', error);
    }
  }

  el.querySelectorAll('a[href]').forEach(link => {
    try {
      const url = new URL(link.href, window.location.origin);
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
      } else {
        link.removeAttribute('href');
      }
    } catch {
      link.removeAttribute('href');
    }
  });
}

/* Messaggi senza avatar o iniziali. */
function addMessage(role, content, scroll = true, attachmentNames = []) {
  const wrap = document.createElement('div');
  wrap.className = 'message ' + role;

  const bubble = document.createElement('div');
  bubble.className = 'bubble';

  if (role === 'assistant') renderMarkdown(bubble, content || '');
  else bubble.textContent = content || '';

  if (Array.isArray(attachmentNames) && attachmentNames.length) {
    const list = document.createElement('div');
    list.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-top:8px';

    attachmentNames.forEach(name => {
      const chip = document.createElement('div');
      chip.textContent = '📎 ' + name;
      chip.style.cssText =
        'font-size:12px;padding:6px 9px;border-radius:10px;' +
        'background:rgba(127,127,127,.15);overflow-wrap:anywhere';
      list.append(chip);
    });

    bubble.append(list);
  }

  wrap.append(bubble);
  messagesEl.append(wrap);
  if (scroll) scrollBottom();
  return bubble;
}

function canRegenerateResponse(chatId, messageIndex) {
  const chat = chats.find(item => item.id === chatId);
  if (!chat || messageIndex !== chat.messages.length - 1) return false;

  const response = chat.messages[messageIndex];
  const request = chat.messages[messageIndex - 1];

  if (!response || response.role !== 'assistant' || !request || request.role !== 'user') {
    return false;
  }

  if (Array.isArray(request.attachmentNames) && request.attachmentNames.length) {
    return false;
  }

  if (String(request.content || '').startsWith('Crea un’immagine:') ||
      String(response.content || '').startsWith('Immagine generata per:')) {
    return false;
  }

  return true;
}

function addMessageActions(bubble, chatId, messageIndex) {
  const wrap = bubble?.closest('.message');
  const chat = chats.find(item => item.id === chatId);
  const message = chat?.messages?.[messageIndex];

  if (!wrap || wrap.querySelector('.message-actions') ||
      wrap.classList.contains('user') || !message) return;

  const actions = document.createElement('div');
  actions.className = 'message-actions';

  const copyButton = document.createElement('button');
  copyButton.type = 'button';
  copyButton.className = 'message-action-btn';
  copyButton.setAttribute('aria-label', 'Copia risposta');
  copyButton.title = 'Copia risposta';
  copyButton.innerHTML = '<span aria-hidden="true">⧉</span><span>Copia</span>';
  copyButton.addEventListener('click', async () => {
    try {
      await copyText(message.content || '');
      copyButton.classList.add('copied');
      copyButton.innerHTML = '<span aria-hidden="true">✓</span><span>Copiato</span>';
      showToast('Risposta copiata.');
      setTimeout(() => {
        if (!copyButton.isConnected) return;
        copyButton.classList.remove('copied');
        copyButton.innerHTML = '<span aria-hidden="true">⧉</span><span>Copia</span>';
      }, 1600);
    } catch {
      showToast('Non riesco a copiare il testo. Selezionalo e copia manualmente.');
    }
  });
  actions.append(copyButton);

  if (canRegenerateResponse(chatId, messageIndex)) {
    const regenerateButton = document.createElement('button');
    regenerateButton.type = 'button';
    regenerateButton.className = 'message-action-btn';
    regenerateButton.setAttribute('aria-label', 'Rigenera risposta');
    regenerateButton.title = 'Rigenera risposta';
    regenerateButton.innerHTML = '<span aria-hidden="true">↻</span><span>Rigenera</span>';
    regenerateButton.addEventListener('click', () => regenerateResponse(chatId, messageIndex));
    actions.append(regenerateButton);
  }

  wrap.append(actions);
}

async function copyText(text) {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    await navigator.clipboard.writeText(String(text || ''));
    return;
  }

  const field = document.createElement('textarea');
  field.value = String(text || '');
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.opacity = '0';
  field.style.pointerEvents = 'none';
  document.body.append(field);
  field.select();
  const copied = document.execCommand('copy');
  field.remove();
  if (!copied) throw new Error('Copia non riuscita.');
}

async function readStreamingReply(response, onUpdate) {
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'Errore del servizio AI.');
  }

  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('text/event-stream')) {
    const data = await response.json().catch(() => ({}));
    if (data.error) throw new Error(data.error);
    const fallback = String(data.reply || '').trim();
    if (!fallback) throw new Error('Non è arrivata una risposta.');
    onUpdate?.(fallback);
    return fallback;
  }

  if (!response.body || typeof response.body.getReader !== 'function') {
    throw new Error('Questo browser non supporta la risposta in tempo reale.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let answer = '';
  let streamError = '';

  const processEvent = eventText => {
    const dataText = eventText
      .split(/\r?\n/)
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trimStart())
      .join('\n');

    if (!dataText || dataText === '[DONE]') return;

    let payload;
    try {
      payload = JSON.parse(dataText);
    } catch {
      return;
    }

    if (payload.error) {
      streamError = String(payload.error);
      return;
    }

    if (typeof payload.text === 'string' && payload.text) {
      answer += payload.text;
      onUpdate?.(answer);
    }
  };

  const consumeEvents = final => {
    let match;
    while ((match = /\r?\n\r?\n/.exec(buffer))) {
      const eventText = buffer.slice(0, match.index);
      buffer = buffer.slice(match.index + match[0].length);
      processEvent(eventText);
    }
    if (final && buffer.trim()) {
      processEvent(buffer);
      buffer = '';
    }
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      consumeEvents(false);
      if (streamError) {
        try { await reader.cancel(); } catch {}
        break;
      }
    }
    buffer += decoder.decode();
    consumeEvents(true);
  } finally {
    try { reader.releaseLock(); } catch {}
  }

  if (streamError && !answer.trim()) throw new Error(streamError);
  if (streamError && answer.trim()) answer += '\n\n' + streamError;
  if (!answer.trim()) throw new Error('Gemini non ha restituito una risposta testuale.');
  return answer.trim();
}

function scrollBottom() {
  const a = $('#chatArea');
  if (a) requestAnimationFrame(() => { a.scrollTop = a.scrollHeight; });
}

function resizeInput() {
  if (!promptEl || !sendBtn) return;

  promptEl.style.height = 'auto';
  promptEl.style.height = Math.min(promptEl.scrollHeight, 180) + 'px';

  const hasContent = Boolean(promptEl.value.trim()) || selectedAttachments.length > 0;
  sendBtn.disabled = busy || !hasContent || !authReady;
  promptEl.disabled = busy || !authReady;

  if (attachBtn) attachBtn.disabled = busy || !authReady;
  if (imageModeBtn) imageModeBtn.disabled = busy || !authReady;
}

function renderAssistantText(el, text, animate = false) {
  renderMarkdown(el, text);

  // Anima i blocchi già formattati: evita di mostrare Markdown o formule a metà.
  if (animate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    Array.from(el.children).forEach((node, index) => {
      node.classList.add('response-reveal');
      node.style.animationDelay = Math.min(index * 55, 275) + 'ms';
    });
  }
}

function setThinkingState(el, label) {
  if (!el) return;
  el.replaceChildren();

  const state = document.createElement('span');
  state.className = 'thinking-state';

  const message = document.createElement('span');
  message.textContent = label;

  const dots = document.createElement('span');
  dots.className = 'thinking-dots';
  dots.setAttribute('aria-hidden', 'true');

  for (let i = 0; i < 3; i += 1) {
    dots.append(document.createElement('span'));
  }

  state.append(message, dots);
  el.append(state);
}

function setupAccountButton() {
  const profile = $('.profile');
  if (!profile) return;

  profile.id = 'accountBtn';
  profile.style.cssText =
    'width:auto;min-width:76px;padding:0 16px;border-radius:24px;' +
    'white-space:nowrap;font-size:14px;cursor:pointer';

  updateAccountButton();
}

function updateAccountButton() {
  const btn = $('#accountBtn');
  if (!btn) return;

  if (currentUser) {
    btn.textContent = 'Esci';
    btn.title = currentUser.email || 'Esci dal tuo account';
    btn.onclick = async () => {
      const { error } = await supabaseClient.auth.signOut();
      if (error) showToast(error.message);
    };
  } else {
    btn.textContent = 'Accedi';
    btn.title = 'Accedi o crea un account';
    btn.onclick = () => { window.location.href = '/login.html'; };
  }
}

async function saveChat(chat) {
  if (!chat) return;
  if (!currentUser) {
    saveLocalChats();
    return;
  }

  // Salva soltanto testo e nomi, mai oggetti File o dati binari.
  const safeMessages = chat.messages.map(m => ({
    role: m.role,
    content: m.content || '',
    ...(Array.isArray(m.attachmentNames)
      ? { attachmentNames: m.attachmentNames }
      : {})
  }));

  const record = {
    user_id: currentUser.id,
    title: chat.title,
    messages: safeMessages,
    updated_at: new Date().toISOString()
  };

  let result;

  if (chat.dbId) {
    result = await supabaseClient.from('chats').update(record)
      .eq('id', chat.dbId)
      .eq('user_id', currentUser.id)
      .select('id').single();
  } else {
    result = await supabaseClient.from('chats').insert(record)
      .select('id').single();

    if (!result.error && result.data) {
      chat.dbId = result.data.id;
      chat.id = result.data.id;
      activeId = result.data.id;
    }
  }

  if (result.error) {
    console.error(result.error);
    showToast('Errore nel salvataggio della chat.');
  }
}

async function loadCloudChats() {
  const { data, error } = await supabaseClient.from('chats')
    .select('id,title,messages,created_at,updated_at')
    .eq('user_id', currentUser.id)
    .order('updated_at', { ascending: false });

  if (error) {
    console.error(error);
    showToast('Errore nel caricamento delle chat.');
    return;
  }

  chats = (data || []).map(row => ({
    id: row.id,
    dbId: row.id,
    title: row.title || 'Nuova conversazione',
    messages: Array.isArray(row.messages) ? row.messages : []
  }));

  renderHistory();
  if (chats.length) openChat(chats[0].id);
  else newChat();
}

async function handleAuthChange(session) {
  const nextUser = session?.user || null;
  const previousId = currentUser?.id || null;
  const nextId = nextUser?.id || null;

  currentUser = nextUser;
  authReady = true;
  updateAccountButton();

  if (previousId === nextId) {
    resizeInput();
    return;
  }

  chats = [];
  activeId = null;
  messagesEl.replaceChildren();
  welcome.hidden = false;

  if (currentUser) {
    $('#connectionStatus').textContent = 'Account connesso';
    await loadCloudChats();
  } else {
    chats = loadLocalChats();
    $('#connectionStatus').textContent = 'Chat salvate su questo dispositivo';
    renderHistory();
    if (chats.length) openChat(chats[0].id);
    else newChat();
  }

  resizeInput();
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      if (comma < 0) {
        reject(new Error('Impossibile leggere il file.'));
        return;
      }
      resolve(result.slice(comma + 1));
    };

    reader.onerror = () => reject(new Error('Errore durante la lettura del file.'));
    reader.readAsDataURL(file);
  });
}

function formatSize(bytes) {
  return bytes < 1024 * 1024
    ? Math.max(1, Math.round(bytes / 1024)) + ' KB'
    : (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function renderAttachmentsPreview() {
  if (!attachmentsPreview) return;

  attachmentsPreview.replaceChildren();
  attachmentsPreview.style.cssText =
    'display:flex;flex-wrap:wrap;gap:8px;margin-bottom:' +
    (selectedAttachments.length ? '10px' : '0');

  selectedAttachments.forEach((item, index) => {
    const card = document.createElement('div');
    card.style.cssText =
      'display:flex;align-items:center;gap:8px;max-width:100%;' +
      'padding:8px 10px;border:1px solid rgba(127,127,127,.35);' +
      'border-radius:12px;font-size:12px;overflow:hidden';

    const info = document.createElement('div');
    info.style.cssText = 'min-width:0;overflow:hidden';

    const name = document.createElement('div');
    name.textContent = (item.type.startsWith('image/') ? '▧ ' : '▤ ') + item.name;
    name.style.cssText =
      'max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';

    const size = document.createElement('small');
    size.textContent = formatSize(item.size);
    size.style.cssText = 'display:block;opacity:.65;margin-top:3px';

    info.append(name, size);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '×';
    remove.setAttribute('aria-label', 'Rimuovi ' + item.name);
    remove.title = 'Rimuovi allegato';
    remove.style.cssText =
      'border:0;background:transparent;color:inherit;cursor:pointer;' +
      'font-size:20px;padding:0 3px;flex-shrink:0';

    remove.onclick = () => {
      selectedAttachments.splice(index, 1);
      renderAttachmentsPreview();
      resizeInput();
    };

    card.append(info, remove);
    attachmentsPreview.append(card);
  });
}

/* Selezione degli allegati: Storage per gli utenti autenticati,
   Base64 con limiti ridotti per gli utenti senza account. */
async function handleFiles(fileList) {
  if (busy || !authReady) return;

  const files = Array.from(fileList || []);
  if (!files.length) return;

  const loggedIn = Boolean(currentUser);
  const maxFiles = loggedIn ? MAX_FILES : LOCAL_MAX_FILES;
  const maxFileSize = loggedIn ? MAX_FILE_SIZE : LOCAL_MAX_FILE_SIZE;
  const maxTotalSize = loggedIn ? MAX_TOTAL_SIZE : LOCAL_MAX_TOTAL_SIZE;

  let totalSize = selectedAttachments.reduce((sum, f) => sum + f.size, 0);

  for (const file of files) {
    if (selectedAttachments.length >= maxFiles) {
      showToast(`Puoi allegare al massimo ${maxFiles} file per messaggio.`);
      break;
    }

    const type = String(file.type || '').toLowerCase();

    if (!ALLOWED_TYPES.has(type)) {
      showToast('Formato non supportato. Usa JPG, PNG, WebP, HEIC, HEIF o PDF.');
      continue;
    }

    if (file.size > maxFileSize) {
      showToast(loggedIn
        ? 'Ogni file deve essere massimo 10 MB.'
        : 'Senza accesso, ogni file deve essere massimo 2 MB.');
      continue;
    }

    if (totalSize + file.size > maxTotalSize) {
      showToast(loggedIn
        ? 'Il totale degli allegati non può superare 20 MB.'
        : 'Senza accesso, il totale degli allegati non può superare 3 MB.');
      continue;
    }

    if (selectedAttachments.some(item => item.name === file.name && item.size === file.size)) {
      continue;
    }

    try {
      if (loggedIn) {
        selectedAttachments.push({
          name: file.name,
          size: file.size,
          type,
          file
        });
      } else {
        const data = await readFileAsBase64(file);
        selectedAttachments.push({ name: file.name, size: file.size, type, data });
      }

      totalSize += file.size;
    } catch (error) {
      showToast(error.message || 'Impossibile leggere il file.');
    }
  }

  renderAttachmentsPreview();
  resizeInput();
}

async function uploadAttachmentToStorage(file) {
  const { data, error: sessionError } = await supabaseClient.auth.getSession();

  if (sessionError || !data.session?.access_token || !currentUser) {
    throw new Error('Accedi nuovamente per caricare allegati grandi.');
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${currentUser.id}/${id()}-${safeName}`;

  const { error } = await supabaseClient.storage.from(BUCKET).upload(path, file, {
    contentType: file.type,
    upsert: false
  });

  if (error) {
    console.error('Errore upload Supabase:', error);
    throw new Error('Caricamento su Supabase non riuscito: ' + error.message);
  }

  return { name: file.name, size: file.size, mimeType: file.type, path };
}

/* Visualizzazione dell'immagine generata. */
function addGeneratedImage(imageData, promptText) {
  const wrap = document.createElement('div');
  wrap.className = 'message assistant';

  const bubble = document.createElement('div');
  bubble.className = 'bubble';

  const caption = document.createElement('p');
  caption.textContent = 'Immagine generata';
  bubble.append(caption);

  const img = document.createElement('img');
  img.src = imageData;
  img.alt = promptText || 'Immagine generata da Lorenzo AI';
  img.loading = 'lazy';
  img.style.cssText =
    'display:block;width:100%;max-width:512px;height:auto;' +
    'border-radius:14px;margin-top:8px';
  bubble.append(img);

  const download = document.createElement('a');
  download.href = imageData;
  download.download = 'lorenzo-ai-immagine.' +
    (imageData.startsWith('data:image/jpeg') ? 'jpg' :
      imageData.startsWith('data:image/webp') ? 'webp' : 'png');
  download.textContent = 'Scarica immagine';
  download.style.cssText = 'display:inline-block;margin-top:10px';
  bubble.append(download);

  wrap.append(bubble);
  messagesEl.append(wrap);
  scrollBottom();
}

/* Generazione immagini: richiede sempre una sessione autenticata. */
async function generateImage(promptText) {
  if (busy || !authReady) return;

  if (!currentUser) {
    showToast('Accedi al tuo account per creare immagini.');
    window.location.href = '/login.html';
    return;
  }

  let c = current();
  if (!c) {
    c = {
      id: id(),
      title: ('Immagine: ' + promptText).slice(0, 42),
      messages: []
    };
    chats.push(c);
    activeId = c.id;
  }

  const userContent = 'Crea un’immagine: ' + promptText;
  c.messages.push({ role: 'user', content: userContent });
  welcome.hidden = true;
  addMessage('user', userContent);
  renderHistory();
  promptEl.value = '';
  resetImageMode();
  busy = true;
  resizeInput();

  const status = addMessage('assistant', '');
  setThinkingState(status, 'Sto creando la tua immagine');
  let reply = '';

  try {
    const { data: sessionData, error: sessionError } =
      await supabaseClient.auth.getSession();

    const accessToken = sessionData?.session?.access_token;

    if (sessionError || !currentUser || !accessToken) {
      throw new Error('Accedi nuovamente per creare immagini.');
    }

    const response = await fetch('/api/generate-image', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify({ prompt: promptText })
    });

    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error('Il server ha restituito una risposta non valida.');
    }

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('Sessione scaduta. Accedi nuovamente.');
      }
      throw new Error(data.error || 'Generazione non riuscita.');
    }

    if (
      typeof data.image !== 'string' ||
      !/^data:image\/(png|jpeg|webp);base64,/.test(data.image)
    ) {
      throw new Error('Il server non ha restituito un’immagine valida.');
    }

    status.remove();
    addGeneratedImage(data.image, promptText);
    reply = 'Immagine generata per: ' + promptText;
    $('#connectionStatus').textContent = 'Generatore immagini collegato';
  } catch (error) {
    status.textContent =
      'Non sono riuscito a generare l’immagine: ' +
      (error.message || 'Errore sconosciuto.');
    reply = status.textContent;
  }

  c.messages.push({ role: 'assistant', content: reply });
  await saveChat(c);
  busy = false;
  resizeInput();
  renderHistory();
  scrollBottom();
}

async function regenerateResponse(chatId, messageIndex) {
  if (busy || !authReady) return;

  const chat = chats.find(item => item.id === chatId);
  if (!chat || !canRegenerateResponse(chatId, messageIndex)) {
    showToast('Puoi rigenerare solo l’ultima risposta senza allegati.');
    return;
  }

  // La rigenerazione sostituisce l’ultima risposta senza duplicare la domanda.
  chat.messages.pop();
  if (activeId !== chatId) activeId = chatId;
  openChat(chatId);
  welcome.hidden = false;
  busy = true;
  resizeInput();

  const thinking = addMessage('assistant', '', false);
  setThinkingState(thinking, 'Sto preparando una nuova risposta');
  scrollBottom();

  let reply = '';
  try {
    const apiMessages = chat.messages.slice(-40).map(message => ({
      role: message.role,
      content: message.content || ''
    }));

    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: apiMessages, stream: true })
    });

    reply = await readStreamingReply(response, partial => {
      const area = $('#chatArea');
      const keepAtBottom = area &&
        area.scrollHeight - area.scrollTop - area.clientHeight < 140;
      renderMarkdown(thinking, partial, false);
      if (keepAtBottom) scrollBottom();
    });
    $('#connectionStatus').textContent = 'AI collegata';
  } catch (error) {
    console.error('Errore rigenerazione risposta:', error);
    reply = 'Non sono riuscito a rigenerare la risposta.\\n\\n' +
      (error.message || 'Riprova tra poco.');
  }

  renderAssistantText(thinking, reply, true);
  chat.messages.push({ role: 'assistant', content: reply });
  addMessageActions(thinking, chat.id, chat.messages.length - 1);
  await saveChat(chat);
  busy = false;
  resizeInput();
  renderHistory();
  scrollBottom();
}

async function sendMessage(text) {
  text = String(text || '').trim();

  if ((!text && selectedAttachments.length === 0) || busy || !authReady) return;

  if (imageMode) {
    if (!currentUser) {
      showToast('Accedi al tuo account per creare immagini.');
      window.location.href = '/login.html';
      return;
    }

    if (!text) {
      showToast('Scrivi una descrizione per l’immagine.');
      return;
    }
    if (selectedAttachments.length) {
      showToast('Rimuovi gli allegati prima di generare un’immagine.');
      return;
    }
    if (text.length > 2000) {
      showToast('La descrizione non può superare 2000 caratteri.');
      return;
    }
    await generateImage(text);
    return;
  }

  const attachments = selectedAttachments.slice();
  const loggedIn = Boolean(currentUser);
  let c = current();

  if (!c) {
    const titleSource = text || attachments[0]?.name || 'Allegato';
    c = {
      id: id(),
      title: titleSource.slice(0, 42) + (titleSource.length > 42 ? '…' : ''),
      messages: []
    };
    chats.push(c);
    activeId = c.id;
  }

  const userMessage = {
    role: 'user',
    content: text,
    attachmentNames: attachments.map(file => file.name)
  };

  c.messages.push(userMessage);
  welcome.hidden = true;
  addMessage(
    'user',
    text || (attachments.length ? 'Analizza gli allegati.' : ''),
    true,
    userMessage.attachmentNames
  );

  renderHistory();
  promptEl.value = '';
  clearSelectedAttachments();
  busy = true;
  resizeInput();

  const thinking = addMessage('assistant', '', false);
  setThinkingState(thinking, attachments.length ? 'Sto caricando gli allegati' : 'Sto pensando');
  scrollBottom();

  let reply = '';

  try {
    let outgoingAttachments = [];
    let accessToken = null;

    if (attachments.length && loggedIn) {
      const { data, error } = await supabaseClient.auth.getSession();
      if (error || !data.session?.access_token) {
        throw new Error('Sessione scaduta. Accedi nuovamente.');
      }

      accessToken = data.session.access_token;

      for (const attachment of attachments) {
        if (attachment.file) {
          const uploaded = await uploadAttachmentToStorage(attachment.file);
          outgoingAttachments.push({
            name: uploaded.name,
            mimeType: uploaded.mimeType,
            path: uploaded.path
          });
        } else if (attachment.path) {
          outgoingAttachments.push({
            name: attachment.name,
            mimeType: attachment.type || attachment.mimeType,
            path: attachment.path
          });
        } else {
          throw new Error('Un allegato selezionato non è valido.');
        }
      }
    } else if (attachments.length) {
      outgoingAttachments = attachments.map(file => ({
        name: file.name,
        mimeType: file.type,
        data: file.data
      }));
    }

    const apiMessages = c.messages.slice(-40).map(message => {
      const outgoing = {
        role: message.role,
        content: message.content || ''
      };

      if (message === userMessage && outgoingAttachments.length) {
        outgoing.attachments = outgoingAttachments;
      }

      return outgoing;
    });

    setThinkingState(thinking, 'Sto pensando');

    const headers = { 'Content-Type': 'application/json' };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers,
      body: JSON.stringify({ messages: apiMessages, stream: true })
    });

    reply = await readStreamingReply(res, partial => {
      const area = $('#chatArea');
      const keepAtBottom = area &&
        area.scrollHeight - area.scrollTop - area.clientHeight < 140;
      renderMarkdown(thinking, partial, false);
      if (keepAtBottom) scrollBottom();
    });
    $('#connectionStatus').textContent = 'AI collegata';
  } catch (error) {
    console.error('Errore invio messaggio:', error);
    reply =
      'Non sono riuscito a completare la richiesta.\n\n' +
      (error.message || 'Controlla la connessione e riprova.');
  }

  renderAssistantText(thinking, reply, true);
  c.messages.push({ role: 'assistant', content: reply });
  addMessageActions(thinking, c.id, c.messages.length - 1);
  await saveChat(c);
  busy = false;
  resizeInput();
  renderHistory();
  scrollBottom();
}

/* Eventi del compositore. */
$('#chatForm').addEventListener('submit', event => {
  event.preventDefault();
  sendMessage(promptEl.value);
});

promptEl.addEventListener('input', resizeInput);
promptEl.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    if (!sendBtn.disabled) sendMessage(promptEl.value);
  }
});

attachBtn.onclick = () => {
  if (busy || !authReady) return;
  fileInput.click();
};

fileInput.addEventListener('change', async () => {
  await handleFiles(fileInput.files);
  fileInput.value = '';
});

if (imageModeBtn) {
  imageModeBtn.setAttribute('aria-pressed', 'false');
  imageModeBtn.onclick = () => {
    if (busy || !authReady) return;

    if (!currentUser) {
      showToast('Accedi al tuo account per creare immagini.');
      window.location.href = '/login.html';
      return;
    }

    if (!imageMode && selectedAttachments.length) {
      showToast('Invia o rimuovi gli allegati prima di creare un’immagine.');
      return;
    }

    imageMode = !imageMode;
    imageModeBtn.setAttribute('aria-pressed', String(imageMode));
    imageModeBtn.classList.toggle('active', imageMode);
    imageModeBtn.style.borderColor = imageMode ? 'var(--accent, #8b7cff)' : '';
    promptEl.placeholder = imageMode
      ? 'Descrivi l’immagine che vuoi creare…'
      : 'Scrivi a Lorenzo AI…';

    showToast(imageMode
      ? 'Modalità creazione immagini attivata.'
      : 'Modalità chat normale attivata.');

    resizeInput();
    promptEl.focus();
  };
}

$('#newChat').onclick = newChat;
$('#menuBtn').onclick = () => $('#sidebar').classList.add('open');
$('#closeSidebar').onclick = () => $('#sidebar').classList.remove('open');

document.querySelectorAll('.suggestion').forEach(button => {
  button.addEventListener('click', () => sendMessage(button.dataset.prompt));
});

async function refreshImageUsage() {
  const count = $('#imageUsageCount');
  const fill = $('#imageUsageFill');
  const meter = $('#imageUsageMeter');
  const reset = $('#imageUsageReset');
  const detail = $('#imageUsageDetail');
  const refresh = $('#refreshUsageBtn');
  if (!count || !fill || !meter || !reset || !detail) return;

  if (!currentUser) {
    count.textContent = '—';
    fill.style.width = '0%';
    meter.setAttribute('aria-valuenow', '0');
    detail.textContent = 'Accedi al tuo account per visualizzare il limite giornaliero.';
    reset.textContent = 'Il limite è collegato al tuo account.';
    return;
  }

  if (refresh) refresh.disabled = true;
  detail.textContent = 'Caricamento utilizzo…';

  try {
    const { data: sessionData, error: sessionError } =
      await supabaseClient.auth.getSession();
    const accessToken = sessionData?.session?.access_token;
    if (sessionError || !accessToken) {
      throw new Error('Sessione scaduta. Accedi nuovamente.');
    }

    const response = await fetch('/api/image-quota', {
      headers: { Authorization: 'Bearer ' + accessToken }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Limite non disponibile.');

    const limit = Math.max(1, Number(data.limit) || 5);
    const used = Math.max(0, Math.min(limit, Number(data.used) || 0));
    const remaining = Math.max(0, Math.min(limit, Number(data.remaining)));

    count.textContent = remaining + ' di ' + limit;
    fill.style.width = (used / limit * 100) + '%';
    meter.setAttribute('aria-valuenow', String(used));
    meter.setAttribute('aria-valuemax', String(limit));
    detail.textContent = used + ' ' + (used === 1 ? 'immagine generata' : 'immagini generate') +
      ' oggi (UTC).';
    if (data.resetsAt) {
      const time = new Date(data.resetsAt);
      reset.textContent = 'Si azzera alle ' + time.toLocaleTimeString('it-IT', {
        hour: '2-digit', minute: '2-digit'
      }) + ' ora locale.';
    } else {
      reset.textContent = 'Il limite si azzera ogni giorno.';
    }
  } catch (error) {
    count.textContent = '—';
    fill.style.width = '0%';
    meter.setAttribute('aria-valuenow', '0');
    detail.textContent = error.message || 'Impossibile caricare l’utilizzo.';
    reset.textContent = 'Riprova con il pulsante Aggiorna.';
  } finally {
    if (refresh) refresh.disabled = false;
  }
}

$('#settingsBtn').onclick = async () => {
  const { data, error } = await supabaseClient.auth.getSession();
  if (error) showToast('Impossibile controllare la sessione.');

  const session = data?.session;
  $('#settingsStatus').textContent = session
    ? 'Account connesso: ' + session.user.email
    : 'Le chat senza account sono salvate solo su questo dispositivo.';
  $('#settingsTag').textContent = session ? 'Connessa' : 'Locale';
  $('#settingsDialog').showModal();
  refreshImageUsage();
};

$('#refreshUsageBtn')?.addEventListener('click', refreshImageUsage);

function toggleTheme() {
  document.body.classList.toggle('light');
  try {
    localStorage.setItem(
      'lorenzo-ai-theme',
      document.body.classList.contains('light') ? 'light' : 'dark'
    );
  } catch {}
  const themeStatus = $('#settingsThemeStatus');
  const themeSettingBtn = $('#settingsThemeBtn');
  if (themeStatus) themeStatus.textContent = document.body.classList.contains('light') ? 'Tema chiaro attivo' : 'Tema scuro attivo';
  if (themeSettingBtn) themeSettingBtn.textContent = document.body.classList.contains('light') ? 'Usa tema scuro' : 'Usa tema chiaro';
}

$('#themeBtn').onclick = toggleTheme;
$('#settingsThemeBtn')?.addEventListener('click', toggleTheme);

try {
  if (localStorage.getItem('lorenzo-ai-theme') === 'light') {
    document.body.classList.add('light');
  }
} catch {}

const themeStatus = $('#settingsThemeStatus');
const themeSettingBtn = $('#settingsThemeBtn');
if (themeStatus) themeStatus.textContent = document.body.classList.contains('light') ? 'Tema chiaro attivo' : 'Tema scuro attivo';
if (themeSettingBtn) themeSettingBtn.textContent = document.body.classList.contains('light') ? 'Usa tema scuro' : 'Usa tema chiaro';

setupAccountButton();

supabaseClient.auth.onAuthStateChange((_event, session) => {
  setTimeout(() => handleAuthChange(session), 0);
});

supabaseClient.auth.getSession().then(({ data, error }) => {
  if (error) showToast('Errore di autenticazione.');
  if (!authReady) handleAuthChange(data?.session || null);
});
