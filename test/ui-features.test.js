const test = require('node:test');
const assert = require('node:assert/strict');
const features = require('../features');

test('conversation search matches titles, message content and attachment names', () => {
  const chat = {
    title: 'Appunti di storia',
    messages: [{ content: 'Rivoluzione francese', attachmentNames: ['timeline.pdf'] }]
  };
  assert.equal(features.matchesChat(chat, 'STORIA'), true);
  assert.equal(features.matchesChat(chat, 'francese'), true);
  assert.equal(features.matchesChat(chat, 'timeline.pdf'), true);
  assert.equal(features.matchesChat(chat, 'matematica'), false);
  assert.equal(features.matchesChat(chat, '   '), true);
});

test('Markdown export preserves message order and attachment names', () => {
  const text = features.toMarkdown({
    title: 'Ricerca',
    messages: [
      { role: 'user', content: 'Ciao', attachmentNames: ['foto.png'] },
      { role: 'assistant', content: 'Risposta' }
    ]
  });
  assert.ok(text.indexOf('## Tu') < text.indexOf('## Lorenzo AI'));
  assert.match(text, /Allegati: foto\.png/);
  assert.match(text, /Risposta/);
});

test('export filename is safe and has a non-empty fallback', () => {
  assert.equal(features.safeFilename('Città & idee'), 'Citta-idee');
  assert.equal(features.safeFilename('***'), 'conversazione');
});

test('dictation appends within the input character limit', () => {
  assert.equal(features.appendTranscript('Buongiorno', 'come va?', 40), 'Buongiorno come va?');
  assert.equal(features.appendTranscript('abc', 'defgh', 6), 'abc de');
  assert.equal(features.appendTranscript('abc', '   ', 6), 'abc');
});

test('browser application scripts parse successfully', () => {
  const { execFileSync } = require('node:child_process');
  const path = require('node:path');
  execFileSync(process.execPath, ['--check', path.join(__dirname, '..', 'features.js')]);
  execFileSync(process.execPath, ['--check', path.join(__dirname, '..', 'app.js')]);
});

test('restyle adds accessible navigation, profile controls and response cancellation', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.resolve(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'restyle.css'), 'utf8');
  assert.match(html, /id="desktopSidebarBtn"/);
  assert.match(html, /id="sidebarBackdrop"/);
  assert.match(html, /id="profileMenu"/);
  assert.match(html, /id="stopBtn"/);
  assert.match(css, /#sendBtn\[hidden\]/);
  assert.match(app, /sendBtn\.hidden = Boolean\(activeRequestController\)/);
  assert.match(app, /new AbortController\(\)/);
  assert.match(app, /signal: requestController\.signal/);
  assert.match(app, /Interruzione della generazione/);
  assert.match(app, /function closeSidebar\(\)/);
  assert.match(app, /function toggleProfileMenu\(\)/);
  assert.match(css, /body\.sidebar-collapsed \.sidebar/);
  assert.match(css, /\.profile-menu/);
});

test('theme preference supports dark, light and system automatic mode', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert.match(app, /\['dark', 'light', 'auto'\]/);
  assert.match(app, /prefers-color-scheme: light/);
  assert.match(app, /applyTheme\(nextTheme\)/);
});


test('latest plain-text user message can be edited and response feedback is persisted', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(app, /function canEditUserMessage\(/);
  assert.match(app, /function setEditingMessage\(/);
  assert.match(app, /c\.messages\.splice\(editRef\.messageIndex \+ 1\)/);
  assert.match(app, /data-feedback/);
  assert.match(app, /feedback: m\.feedback/);
  assert.match(html, /id="editMessageBar"/);
  assert.match(html, /id="cancelEditMessage"/);
});

test('latest response can be continued through the streaming chat API', () => {
  const fs = require('node:fs');
  const app = fs.readFileSync(require('node:path').join(__dirname, '..', 'app.js'), 'utf8');
  assert.match(app, /function canContinueResponse\(/);
  assert.match(app, /async function continueResponse\(/);
  assert.match(app, /Continua la risposta precedente/);
  assert.ok(app.includes('message.content = original'));
  assert.ok(app.includes('addition.trim()'));
});


test('conversation archive filter and per-chat archive action are wired', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(app, /function archivedStorageKey\(/);
  assert.match(app, /function toggleChatArchive\(/);
  assert.match(app, /data-history-action="archive"/);
  assert.match(app, /showingArchived \? archived\.has\(chat\.id\)/);
  assert.match(html, /id="archivedFilterBtn"/);
});

test('account data settings export loaded conversations as JSON', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(app, /function exportAllChats\(/);
  assert.match(app, /lorenzo-ai-export-v1/);
  assert.match(html, /id="exportAllChatsBtn"/);
});


test('conversation sharing uses native share when available and clipboard fallback', () => {
  const fs = require('node:fs');
  const app = fs.readFileSync(require('node:path').join(__dirname, '..', 'app.js'), 'utf8');
  assert.match(app, /async function shareChat\(/);
  assert.match(app, /typeof navigator\\.share === 'function'/);
  assert.match(app, /copyText\(text\)/);
  assert.match(app, /data-history-action="share"/);
});

test('appearance settings expose explicit dark, light and automatic choices', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const memory = fs.readFileSync(path.join(__dirname, '..', 'memory-ui.js'), 'utf8');
  assert.match(html, /id="themeModeOptions"/);
  assert.match(html, /data-theme-mode="dark"/);
  assert.match(html, /data-theme-mode="light"/);
  assert.match(html, /data-theme-mode="auto"/);
  assert.match(memory, /applyLorenzoTheme\(button\.dataset\.themeMode\)/);
});

test('global search can be focused with the platform search shortcut', () => {
  const fs = require('node:fs');
  const app = fs.readFileSync(require('node:path').join(__dirname, '..', 'app.js'), 'utf8');
  assert.match(app, /event\.metaKey \|\| event\.ctrlKey/);
  assert.match(app, /historySearch.*focus/);
});
