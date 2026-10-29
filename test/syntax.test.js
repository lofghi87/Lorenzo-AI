const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const files = [
  'app.js',
  'features.js',
  'voice-input.js',
  'memory-ui.js',
  'pwa.js',
  'sw.js',
  'api/chat.js',
  'api/chat-quota.js',
  'api/memory.js',
  'api/generate-image.js'
];

for (const file of files) {
  test('JavaScript syntax: ' + file, () => {
    const result = spawnSync(process.execPath, ['--check', path.join(root, file)], {
      cwd: root,
      encoding: 'utf8'
    });
    assert.equal(result.status, 0, result.stderr || result.stdout || (file + ' did not parse'));
  });
}
