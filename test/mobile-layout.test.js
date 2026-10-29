const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const html = read('index.html');
const pwa = read('pwa.js');
const appPwaCss = read('app-pwa.css');
const premiumCss = read('premium.css');

test('mobile top bar gives the app name and install/account actions separate grid areas', () => {
  const start = premiumCss.lastIndexOf('/* Ultimi override mobile');
  assert.notEqual(start, -1, 'final mobile overrides must be present in the last stylesheet');
  const css = premiumCss.slice(start);
  assert.match(css, /\.topbar\s*\{[^}]*display:\s*grid/s);
  assert.match(css, /\.topbar\s+\.model-pill\s*\{[^}]*position:\s*static/s);
  assert.match(css, /\.topbar\s+\.top-actions\s*\{[^}]*grid-column:\s*3/s);
});

test('installed chat composer stays in the flex layout rather than using a stale fixed viewport', () => {
  const start = premiumCss.lastIndexOf('body.is-standalone .composer-wrap');
  assert.notEqual(start, -1);
  const rule = premiumCss.slice(start, premiumCss.indexOf('}', start) + 1);
  assert.match(rule, /position:\s*relative/);
  assert.doesNotMatch(rule, /position:\s*fixed/);
  assert.doesNotMatch(appPwaCss, /padding-bottom:\s*calc\(190px/);
  assert.match(premiumCss.slice(-1800), /\.app\s*\{[^}]*min-height:\s*0/s);
});

test('standalone mode syncs the visible viewport and handles the on-screen keyboard', () => {
  assert.match(pwa, /root\.classList\.add\('is-standalone'\)/);
  assert.match(pwa, /window\.visualViewport\?\.addEventListener\('resize',\s*syncViewportHeight/);
  assert.match(pwa, /const keyboardOpen = editing/);
  assert.match(pwa, /height = keyboardOpen \? Math\.min\(layoutHeight, visibleHeight\) : layoutHeight/);
});

test('zoom prevention is limited to installed mode; regular Safari retains its normal viewport', () => {
  assert.match(pwa, /if \(standalone\)\s*\{/);
  assert.match(pwa, /maximum-scale=1, user-scalable=no/);
  assert.match(pwa, /addEventListener\('gesturestart', preventZoomGesture/);
  const defaultViewport = html.match(/<meta\s+name="viewport"[^>]+>/i)?.[0] || '';
  assert.match(defaultViewport, /initial-scale=1/);
  assert.doesNotMatch(defaultViewport, /user-scalable=no|maximum-scale=1/);
});

test('service worker uses a versioned app-shell cache so mobile fixes can replace stale assets', () => {
  const sw = read('sw.js');
  assert.match(sw, /const CACHE_NAME = 'lorenzo-ai-shell-v\d+'/);
  assert.match(sw, /'\/app-pwa\.css'/);
  assert.match(sw, /'\/premium\.css'/);
  assert.match(sw, /'\/pwa\.js'/);
});
