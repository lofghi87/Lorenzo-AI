
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

const STORE_KEY = 'lorenzo-ai-chats-v1';

let chats = [];
let activeId = null;
let busy = false;
let toastTimer;
let currentUser = null;
let authReady = false;

function id() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function current() {
  return chats.find(c => c.id === activeId);
}

function showToast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
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

function newChat() {
  activeId = null;
  messagesEl.replaceChildren();
  welcome.hidden = false;
  renderHistory();
  promptEl.value = '';
  resizeInput();
  promptEl.focus();
  $('#sidebar').classList.remove('open');
}

function openChat(chatId) {
  const c = chats.find(x => x.id === chatId);
  if (!c) return;

  activeId = chatId;
  messagesEl.replaceChildren();

  c.messages.forEach(m => addMessage(m.role, m.content, false));
  welcome.hidden = c.messages.length > 0;

  renderHistory();
  $('#sidebar').classList.remove('open');
  scrollBottom();
}

function addMessage(role, content, scroll = true) {
  const wrap = document.createElement('div');
  wrap.className = 'message ' + role;

  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.textContent = role === 'user' ? 'L' : '✳';

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = content;

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

  // La chat è utilizzabile anche senza effettuare l'accesso.
  sendBtn.disabled = busy || !promptEl.value.trim();
  promptEl.disabled = busy;
}

function renderAssistantText(el, text) {
  el.textContent = text;
}

function setupAccountButton() {
  const profile = $('.profile');
  if (!profile) return;

  // Riutilizza il pulsante già presente nell'HTML.
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

  // Senza account, le conversazioni vengono salvate nel browser.
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

  // Evita di ricaricare le chat se la sessione è la stessa.
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

    if (chats.length) {
      openChat(chats[0].id);
    } else {
      newChat();
    }
  }

  resizeInput();
}

async function sendMessage(text) {
  text = text.trim();

  if (!text || busy || !authReady) return;

  let c = current();

  if (!c) {
    c = {
      id: id(),
      title: text.slice(0, 42) + (text.length > 42 ? '…' : ''),
      messages: []
    };

    chats.push(c);
    activeId = c.id;
  }

  c.messages.push({ role: 'user', content: text });

  welcome.hidden = true;
  addMessage('user', text);
  renderHistory();

  promptEl.value = '';
  busy = true;
  resizeInput();

  const thinking = addMessage('assistant', '', false);
  thinking.textContent = 'Sto pensando…';
  scrollBottom();

  let reply = '';

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: c.messages.slice(-40) })
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Errore del servizio AI');
    }

    reply = data.reply || 'Non è arrivata una risposta.';
    $('#connectionStatus').textContent = 'AI collegata';
  } catch (e) {
    reply = 'Non sono riuscito a contattare il modello AI.\n\n' + e.message;
  }

  renderAssistantText(thinking, reply);
  c.messages.push({ role: 'assistant', content: reply });

  await saveChat(c);

  busy = false;
  resizeInput();
  renderHistory();
  scrollBottom();
}

$('#chatForm').addEventListener('submit', e => {
  e.preventDefault();
  sendMessage(promptEl.value);
});

promptEl.addEventListener('input', resizeInput);

promptEl.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (!sendBtn.disabled) sendMessage(promptEl.value);
  }
});

$('#newChat').onclick = newChat;
$('#menuBtn').onclick = () => $('#sidebar').classList.add('open');
$('#closeSidebar').onclick = () => $('#sidebar').classList.remove('open');

document.querySelectorAll('.suggestion').forEach(b => {
  b.addEventListener('click', () => sendMessage(b.dataset.prompt));
});

$('#attachBtn').onclick = () => {
  showToast('Gli allegati saranno disponibili in una versione futura.');
};

$('#settingsBtn').onclick = async () => {
  const { data } = await supabaseClient.auth.getSession();
  const session = data.session;

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

// Inizializza la pagina senza inserire moduli di accesso nella chat.
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
