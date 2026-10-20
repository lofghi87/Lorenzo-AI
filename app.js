
const SUPABASE_URL = 'https://bknkgctmpgiuxvahbbzs.supabase.co';
const SUPABASE_KEY = 'sb_publishable_rZEaUwMU4CCl7kUPdUlvuw_cuX2n9hB';

const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_KEY
);

const $ = s => document.querySelector(s);
const messagesEl = $('#messages');
const welcome = $('#welcome');
const promptEl = $('#prompt');
const sendBtn = $('#sendBtn');
const fileInput = $('#fileInput');
const attachBtn = $('#attachBtn');
const attachmentsPreview = $('#attachmentsPreview');

const STORE_KEY = 'lorenzo-ai-chats-v1';
const MAX_FILE_SIZE = 2 * 1024 * 1024;
const MAX_TOTAL_SIZE = 3 * 1024 * 1024;
const MAX_FILES = 4;

const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf'
]);

let chats = [];
let activeId = null;
let busy = false;
let toastTimer;
let currentUser = null;
let authReady = false;
let selectedAttachments = [];

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

  clearSelectedAttachments();
  renderHistory();
  resizeInput();
  promptEl.focus();

  $('#sidebar').classList.remove('open');
}

function openChat(chatId) {
  const c = chats.find(x => x.id === chatId);
  if (!c) return;

  activeId = chatId;
  messagesEl.replaceChildren();

  c.messages.forEach(m => {
    addMessage(m.role, m.content, false, m.attachmentNames);
  });

  welcome.hidden = c.messages.length > 0;

  clearSelectedAttachments();
  renderHistory();

  $('#sidebar').classList.remove('open');
  scrollBottom();
}

function renderMarkdown(el, text) {
  if (!window.marked || !window.DOMPurify) {
    el.textContent = text;
    return;
  }

  const html = window.marked.parse(text, {
    gfm: true,
    breaks: true
  });

  el.innerHTML = window.DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true }
  });

  el.querySelectorAll('a[href]').forEach(link => {
    const url = new URL(link.href, window.location.origin);

    if (url.protocol === 'http:' || url.protocol === 'https:') {
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    } else {
      link.removeAttribute('href');
    }
  });
}

function addMessage(role, content, scroll = true, attachmentNames = []) {
  const wrap = document.createElement('div');
  wrap.className = 'message ' + role;

  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.textContent = role === 'user' ? 'L' : '✳';

  const bubble = document.createElement('div');
  bubble.className = 'bubble';

  if (role === 'assistant') {
    renderMarkdown(bubble, content || '');
  } else {
    bubble.textContent = content || '';
  }

  if (Array.isArray(attachmentNames) && attachmentNames.length) {
    const list = document.createElement('div');

    list.style.cssText =
      'display:flex;flex-wrap:wrap;gap:6px;margin-top:8px';

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

  wrap.append(avatar, bubble);
  messagesEl.append(wrap);

  if (scroll) scrollBottom();

  return bubble;
}

function scrollBottom() {
  const a = $('#chatArea');

  requestAnimationFrame(() => {
    a.scrollTop = a.scrollHeight;
  });
}

function resizeInput() {
  promptEl.style.height = 'auto';
  promptEl.style.height = Math.min(promptEl.scrollHeight, 180) + 'px';

  const hasContent =
    Boolean(promptEl.value.trim()) || selectedAttachments.length > 0;

  sendBtn.disabled = busy || !hasContent || !authReady;
  promptEl.disabled = busy || !authReady;

  if (attachBtn) {
    attachBtn.disabled = busy || !authReady;
  }
}

function renderAssistantText(el, text) {
  renderMarkdown(el, text);
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

    btn.onclick = () => {
      window.location.href = '/login.html';
    };
  }
}

async function saveChat(chat) {
  if (!chat) return;

  if (!currentUser) {
    saveLocalChats();
    return;
  }

  const record = {
    user_id: currentUser.id,
    title: chat.title,
    messages: chat.messages,
    updated_at: new Date().toISOString()
  };

  let result;

  if (chat.dbId) {
    result = await supabaseClient
      .from('chats')
      .update(record)
      .eq('id', chat.dbId)
      .eq('user_id', currentUser.id)
      .select('id')
      .single();
  } else {
    result = await supabaseClient
      .from('chats')
      .insert(record)
      .select('id')
      .single();

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
  const { data, error } = await supabaseClient
    .from('chats')
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

  if (chats.length) {
    openChat(chats[0].id);
  } else {
    newChat();
  }
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

    $('#connectionStatus').textContent =
      'Chat salvate su questo dispositivo';

    renderHistory();

    if (chats.length) {
      openChat(chats[0].id);
    } else {
      newChat();
    }
  }

  resizeInput();
}

/* Converte un file in base64 per inviarlo a Gemini. */
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

    reader.onerror = () => {
      reject(new Error('Errore durante la lettura del file.'));
    };

    reader.readAsDataURL(file);
  });
}

function formatSize(bytes) {
  if (bytes < 1024 * 1024) {
    return Math.max(1, Math.round(bytes / 1024)) + ' KB';
  }

  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

/* Anteprime e rimozione degli allegati selezionati. */
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

async function handleFiles(fileList) {
  if (busy || !authReady) return;

  const files = Array.from(fileList || []);

  if (!files.length) return;

  let totalSize = selectedAttachments.reduce(
    (sum, file) => sum + file.size,
    0
  );

  for (const file of files) {
    if (selectedAttachments.length >= MAX_FILES) {
      showToast('Puoi allegare al massimo 4 file per messaggio.');
      break;
    }

    const type = String(file.type || '').toLowerCase();

    if (!ALLOWED_TYPES.has(type)) {
      showToast('Formato non supportato. Usa JPG, PNG, WebP, HEIC, HEIF o PDF.');
      continue;
    }

    if (file.size > MAX_FILE_SIZE) {
      showToast('Ogni file deve essere inferiore a 2 MB.');
      continue;
    }

    if (totalSize + file.size > MAX_TOTAL_SIZE) {
      showToast('Il totale degli allegati non può superare 3 MB.');
      continue;
    }

    if (selectedAttachments.some(
      item => item.name === file.name && item.size === file.size
    )) {
      continue;
    }

    try {
      const data = await readFileAsBase64(file);

      selectedAttachments.push({
        name: file.name,
        size: file.size,
        type,
        data
      });

      totalSize += file.size;
    } catch (error) {
      showToast(error.message || 'Impossibile leggere un allegato.');
    }
  }

  renderAttachmentsPreview();
  resizeInput();
}

async function sendMessage(text) {
  text = String(text || '').trim();

  if (
    (!text && selectedAttachments.length === 0) ||
    busy ||
    !authReady
  ) {
    return;
  }

  const attachments = selectedAttachments.slice();

  let c = current();

  if (!c) {
    const titleSource = text || attachments[0]?.name || 'Allegato';

    c = {
      id: id(),
      title: titleSource.slice(0, 42) +
        (titleSource.length > 42 ? '…' : ''),
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
  thinking.textContent = 'Sto pensando…';
  scrollBottom();

  let reply = '';

  try {
    /*
     * I file vengono aggiunti solo al messaggio appena inviato.
     * Le chat salvate contengono i nomi dei file, non il loro contenuto.
     */
    const apiMessages = c.messages.slice(-40).map(message => {
      const outgoing = {
        role: message.role,
        content: message.content || ''
      };

      if (message === userMessage && attachments.length) {
        outgoing.attachments = attachments.map(file => ({
          mimeType: file.type,
          data: file.data
        }));
      }

      return outgoing;
    });

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: apiMessages })
    });

    let data;

    try {
      data = await res.json();
    } catch {
      throw new Error('Il server ha restituito una risposta non valida.');
    }

    if (!res.ok) {
      throw new Error(data.error || 'Errore del servizio AI.');
    }

    reply = data.reply || 'Non è arrivata una risposta.';
    $('#connectionStatus').textContent = 'AI collegata';
  } catch (error) {
    reply =
      'Non sono riuscito a completare la richiesta.\n\n' +
      (error.message || 'Controlla la connessione e riprova.');
  }

  renderAssistantText(thinking, reply);

  c.messages.push({
    role: 'assistant',
    content: reply
  });

  await saveChat(c);

  busy = false;
  resizeInput();
  renderHistory();
  scrollBottom();
}

/* Invio del messaggio. */
$('#chatForm').addEventListener('submit', event => {
  event.preventDefault();
  sendMessage(promptEl.value);
});

promptEl.addEventListener('input', resizeInput);

promptEl.addEventListener('keydown', event => {
  if (
    event.key === 'Enter' &&
    !event.shiftKey &&
    !event.isComposing
  ) {
    event.preventDefault();

    if (!sendBtn.disabled) {
      sendMessage(promptEl.value);
    }
  }
});

/* Selezione degli allegati. */
attachBtn.onclick = () => {
  if (busy || !authReady) return;
  fileInput.click();
};

fileInput.addEventListener('change', async () => {
  await handleFiles(fileInput.files);
  fileInput.value = '';
});

$('#newChat').onclick = newChat;
$('#menuBtn').onclick = () => $('#sidebar').classList.add('open');
$('#closeSidebar').onclick = () => $('#sidebar').classList.remove('open');

document.querySelectorAll('.suggestion').forEach(button => {
  button.addEventListener('click', () => {
    sendMessage(button.dataset.prompt);
  });
});

$('#settingsBtn').onclick = async () => {
  const { data, error } = await supabaseClient.auth.getSession();

  if (error) {
    showToast('Impossibile controllare la sessione.');
  }

  const session = data?.session;

  $('#settingsStatus').textContent = session
    ? 'Account connesso: ' + session.user.email
    : 'Le chat senza account sono salvate solo su questo dispositivo.';

  $('#settingsTag').textContent = session ? 'Connessa' : 'Locale';
  $('#settingsDialog').showModal();
};

$('#themeBtn').onclick = () => {
  document.body.classList.toggle('light');

  try {
    localStorage.setItem(
      'lorenzo-ai-theme',
      document.body.classList.contains('light') ? 'light' : 'dark'
    );
  } catch {}
};

try {
  if (localStorage.getItem('lorenzo-ai-theme') === 'light') {
    document.body.classList.add('light');
  }
} catch {}

setupAccountButton();

supabaseClient.auth.onAuthStateChange((_event, session) => {
  setTimeout(() => handleAuthChange(session), 0);
});

supabaseClient.auth.getSession().then(({ data, error }) => {
  if (error) showToast('Errore di autenticazione.');

  if (!authReady) {
    handleAuthChange(data?.session || null);
  }
});
