const SUPABASE_URL = 'https://bknkgctmpgiuxvahbbzs.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_rZEaUwMU4CCl7kUPdUlvuw_cuX2n9hB';
const TABLE = 'user_memories';
const MAX_MEMORIES = 30;
const MAX_MEMORY_LENGTH = 400;

function jsonError(res, status, message) {
  return res.status(status).json({ error: message });
}

function normalizeContent(value) {
  return String(value || '')
    .normalize('NFC')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_MEMORY_LENGTH);
}

async function verifyUser(req) {
  const authorization = String(req.headers.authorization || '');
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  const accessToken = match ? match[1].trim() : '';
  if (!accessToken) {
    const error = new Error('Accedi al tuo account per usare la memoria personale.');
    error.statusCode = 401;
    throw error;
  }

  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: 'Bearer ' + accessToken
    },
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) {
    const error = new Error('Sessione scaduta. Accedi nuovamente.');
    error.statusCode = 401;
    throw error;
  }
  const user = await response.json();
  if (!user?.id) {
    const error = new Error('Account non verificabile.');
    error.statusCode = 401;
    throw error;
  }
  return user.id;
}

function serviceHeaders(serviceKey, prefer) {
  return {
    apikey: serviceKey,
    Authorization: 'Bearer ' + serviceKey,
    'Content-Type': 'application/json',
    ...(prefer ? { Prefer: prefer } : {})
  };
}

async function readMemories(userId, serviceKey) {
  const query = new URLSearchParams({
    select: 'id,content,created_at,updated_at',
    user_id: 'eq.' + userId,
    order: 'updated_at.desc',
    limit: String(MAX_MEMORIES)
  });
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${TABLE}?${query}`, {
    headers: serviceHeaders(serviceKey),
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) {
    const error = new Error(response.status === 404
      ? 'La tabella della memoria non è ancora configurata. Applica la migration Supabase inclusa nel progetto.'
      : 'Non riesco a caricare la memoria. Riprova più tardi.');
    error.statusCode = 503;
    throw error;
  }
  return response.json();
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (!['GET', 'POST', 'DELETE'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST, DELETE');
    return jsonError(res, 405, 'Metodo non consentito.');
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return jsonError(res, 503, 'Configurazione Supabase non disponibile.');
  }

  try {
    const userId = await verifyUser(req);

    if (req.method === 'GET') {
      const memories = await readMemories(userId, serviceKey);
      return res.status(200).json({ memories });
    }

    if (req.method === 'POST') {
      const action = String(req.body?.action || 'add');
      if (action !== 'add') return jsonError(res, 400, 'Azione non valida.');
      const content = normalizeContent(req.body?.content);
      if (content.length < 2) {
        return jsonError(res, 400, 'La memoria deve contenere almeno 2 caratteri.');
      }
      if (String(req.body?.content || '').trim().length > MAX_MEMORY_LENGTH) {
        return jsonError(res, 400, `Ogni memoria può contenere al massimo ${MAX_MEMORY_LENGTH} caratteri.`);
      }

      const current = await readMemories(userId, serviceKey);
      const duplicate = current.find(item =>
        normalizeContent(item.content).toLocaleLowerCase() === content.toLocaleLowerCase()
      );
      if (duplicate) return res.status(200).json({ memory: duplicate, duplicate: true });
      if (current.length >= MAX_MEMORIES) {
        return jsonError(res, 429, `Puoi salvare al massimo ${MAX_MEMORIES} memorie. Elimina una nota prima di aggiungerne un'altra.`);
      }

      const response = await fetch(`${SUPABASE_URL}/rest/v1/${TABLE}`, {
        method: 'POST',
        headers: serviceHeaders(serviceKey, 'return=representation'),
        body: JSON.stringify({ user_id: userId, content }),
        signal: AbortSignal.timeout(12000)
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        if (response.status === 409) {
          const refreshed = await readMemories(userId, serviceKey);
          const found = refreshed.find(item =>
            normalizeContent(item.content).toLocaleLowerCase() === content.toLocaleLowerCase()
          );
          if (found) return res.status(200).json({ memory: found, duplicate: true });
        }
        console.error('Scrittura memoria non riuscita:', response.status, detail.slice(0, 300));
        return jsonError(res, 503, 'Non sono riuscito a salvare la memoria. Verifica la migration Supabase.');
      }
      const rows = await response.json();
      return res.status(201).json({ memory: Array.isArray(rows) ? rows[0] : rows, duplicate: false });
    }

    const id = String(req.query?.id || '');
    const content = normalizeContent(req.body?.content);
    const clearAll = String(req.query?.all || '') === 'true';

    if (clearAll) {
      const response = await fetch(
        `${SUPABASE_URL}/rest/v1/${TABLE}?user_id=eq.${encodeURIComponent(userId)}`,
        { method: 'DELETE', headers: serviceHeaders(serviceKey), signal: AbortSignal.timeout(12000) }
      );
      if (!response.ok) return jsonError(res, 503, 'Non sono riuscito a cancellare la memoria.');
      return res.status(200).json({ deleted: true, all: true });
    }

    let targetId = id;
    if (!targetId && content) {
      const current = await readMemories(userId, serviceKey);
      const match = current.find(item =>
        normalizeContent(item.content).toLocaleLowerCase() === content.toLocaleLowerCase()
      );
      if (!match) return res.status(200).json({ deleted: false, message: 'Non ho trovato una memoria identica da cancellare.' });
      targetId = match.id;
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(targetId)) {
      return jsonError(res, 400, 'Identificativo memoria non valido.');
    }

    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/${TABLE}?id=eq.${encodeURIComponent(targetId)}&user_id=eq.${encodeURIComponent(userId)}`,
      { method: 'DELETE', headers: serviceHeaders(serviceKey, 'return=representation'), signal: AbortSignal.timeout(12000) }
    );
    if (!response.ok) return jsonError(res, 503, 'Non sono riuscito a cancellare questa memoria.');
    const rows = await response.json().catch(() => []);
    return res.status(200).json({ deleted: Array.isArray(rows) ? rows.length > 0 : true });
  } catch (error) {
    return jsonError(res, error.statusCode || 500, error.message || 'Errore durante la gestione della memoria.');
  }
};
