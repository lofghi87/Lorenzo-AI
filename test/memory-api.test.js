const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
const memoryHandler = require('../api/memory');

const TEST_USER_ID = '00000000-0000-4000-8000-000000000001';

function createResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
}

async function invoke(method, options = {}) {
  const res = createResponse();
  await memoryHandler({
    method,
    headers: options.headers || {},
    body: options.body,
    query: options.query || {}
  }, res);
  return res;
}

test('memory API requires a valid logged-in session', async () => {
  const res = await invoke('GET');
  assert.equal(res.statusCode, 401);
  assert.match(res.body.error, /Accedi/i);
});

test('memory API returns only the authenticated user memories', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes('/auth/v1/user')) {
      return {
        ok: true,
        status: 200,
        async json() { return { id: TEST_USER_ID }; }
      };
    }
    assert.match(String(url), /user_memories/);
    assert.match(String(url), new RegExp('user_id=eq\\.' + TEST_USER_ID));
    return {
      ok: true,
      status: 200,
      async json() {
        return [{ id: 'memory-id', content: 'Preferisco esempi chiari' }];
      }
    };
  };

  try {
    const res = await invoke('GET', {
      headers: { authorization: 'Bearer test-access-token' }
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.memories.length, 1);
    assert.equal(res.body.memories[0].content, 'Preferisco esempi chiari');
  } finally {
    global.fetch = originalFetch;
  }
});

test('memory API rejects notes longer than 400 characters', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    assert.match(String(url), /auth\/v1\/user/);
    return {
      ok: true,
      status: 200,
      async json() { return { id: TEST_USER_ID }; }
    };
  };

  try {
    const res = await invoke('POST', {
      headers: { authorization: 'Bearer test-access-token' },
      body: { action: 'add', content: 'x'.repeat(401) }
    });
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /400 caratteri/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('memory API does not accept unknown methods', async () => {
  const res = await invoke('PATCH');
  assert.equal(res.statusCode, 405);
  assert.match(res.body.error, /Metodo non consentito/);
});
