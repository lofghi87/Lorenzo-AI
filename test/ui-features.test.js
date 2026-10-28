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
