
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
  welcome.hidden = false;
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
  requestAnimationFrame(() => a.scrollTop = a.scrollHeight);
}

function resizeInput() {
  promptEl.style.height = 'auto';
  promptEl.style.height = Math.min(promptEl.scrollHeight, 180) + 'px';
  sendBtn.disabled = busy || !promptEl.value.trim() || !currentUser;
}

function renderAssistantText(el, text) {
  el.textContent = text;
}

async function saveChat(chat) {
  if (!currentUser || !chat) return;

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
    }
  }

  if (result.error) {
    console.error(result.error);
    showToast('Chat non salvata: ' + result.error.message);
  }
}

async function loadCloudChats() {
  const { data, error } = await supabaseClient
    .from('chats')
    .select('id,title,messages,created_at,updated_at')
    .eq('user_id', currentUser.id)
    .order('updated_at', { ascending: false });

  if (error) {
    showToast('Errore nel caricamento delle chat: ' + error.message);
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

function showAuth() {
  let panel = $('#authPanel');

  if (!panel) {
    panel = document.createElement('section');
    panel.id = 'authPanel';
    panel.style.cssText =
      'max-width:420px;margin:24px auto;padding:24px;border:1px solid #5555;border-radius:18px';

    panel.innerHTML = `
      <h2>Accedi a Lorenzo AI</h2>
      <p>Accedi per salvare e ritrovare le tue conversazioni.</p>
      <form id="authForm">
        <label for="authEmail">Email</label>
        <input id="authEmail" type="email" required autocomplete="email"
          style="display:block;width:100%;margin:8px 0 16px;padding:12px">
        <label for="authPassword">Password</label>
        <input id="authPassword" type="password" required minlength="6"
          autocomplete="current-password"
          style="display:block;width:100%;margin:8px 0 16px;padding:12px">
        <button type="submit">Accedi</button>
        <button type="button" id="signupBtn">Crea account</button>
        <button type="button" id="logoutBtn" hidden>Esci</button>
        <p id="authMessage" role="status"></p>
      </form>`;

    document.querySelector('.main').prepend(panel);

    $('#authForm').addEventListener('submit', async e => {
      e.preventDefault();

      const email = $('#authEmail').value.trim();
      const password = $('#authPassword').value;
      $('#authMessage').textContent = 'Accesso in corso…';

      const { error } = await supabaseClient.auth.signInWithPassword({
        email,
        password
      });

      $('#authMessage').textContent = error
        ? error.message
        : 'Accesso effettuato.';
    });

    $('#signupBtn').onclick = async () => {
      const email = $('#authEmail').value.trim();
      const password = $('#authPassword').value;

      if (!email || password.length < 6) {
        $('#authMessage').textContent =
          'Inserisci un’email valida e una password di almeno 6 caratteri.';
        return;
      }

      $('#authMessage').textContent = 'Creazione account in corso…';

      const { data, error } = await supabaseClient.auth.signUp({
        email,
        password
      });

      $('#authMessage').textContent = error
        ? error.message
        : data.session
          ? 'Account creato!'
          : 'Controlla la tua email per confermare la registrazione.';
    };

    $('#logoutBtn').onclick = async () => {
      const { error } = await supabaseClient.auth.signOut();
      if (error) showToast(error.message);
    };
  }

  panel.hidden = false;
  updateAuthPanel();
}

function updateAuthPanel() {
  const panel = $('#authPanel');
  if (!panel) return;

  panel.hidden = false;
  $('#authMessage').textContent = currentUser
    ? 'Connesso: ' + currentUser.email
    : 'Accedi o crea un account per continuare.';

  $('#authEmail').hidden = !!currentUser;
  $('#authPassword').hidden = !!currentUser;
  $('#signupBtn').hidden = !!currentUser;
  $('#authForm button[type="submit"]').hidden = !!currentUser;
  $('#logoutBtn').hidden = !currentUser;
  promptEl.disabled = !currentUser;
  sendBtn.disabled = !currentUser || busy || !promptEl.value.trim();
}

async function handleAuthChange(session) {
  currentUser = session?.user || null;
  chats = [];
  activeId = null;
  messagesEl.replaceChildren();
  renderHistory();

  if (currentUser) {
    await loadCloudChats();
    $('#connectionStatus').textContent = 'Account connesso';
  } else {
    newChat();
    $('#connectionStatus').textContent = 'Accedi per salvare le chat';
  }

  updateAuthPanel();
  resizeInput();
}

async function sendMessage(text) {
  text = text.trim();

  if (!text || busy || !currentUser) return;

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
  resizeInput();
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

    if (!res.ok) throw new Error(data.error || 'Errore del servizio AI');

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

document.querySelectorAll('.suggestion').forEach(b =>
  b.addEventListener('click', () => sendMessage(b.dataset.prompt))
);

$('#attachBtn').onclick = () =>
  showToast('Gli allegati saranno disponibili in una versione futura.');

$('#settingsBtn').onclick = async () => {
  const { data } = await supabaseClient.auth.getSession();
  const session = data.session;

  $('#settingsStatus').textContent = session
    ? 'Account connesso: ' + session.user.email
    : 'Accedi per salvare le tue conversazioni.';

  $('#settingsTag').textContent = session ? 'Connessa' : 'Accesso richiesto';
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

showAuth();

supabaseClient.auth.onAuthStateChange((_event, session) => {
  setTimeout(() => handleAuthChange(session), 0);
});

supabaseClient.auth.getSession().then(({ data, error }) => {
  if (error) showToast(error.message);
  handleAuthChange(data.session);
});
