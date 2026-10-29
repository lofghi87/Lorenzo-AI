const { createHash } = require('crypto');

const DAILY_CHAT_LIMIT = 40;
const GUEST_CHAT_LIMIT = 5;
const SUPABASE_URL = 'https://bknkgctmpgiuxvahbbzs.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_rZEaUwMU4CCl7kUPdUlvuw_cuX2n9hB';

function guestClientKey(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  const clientIp = String(forwarded[forwarded.length - 1] || 'unknown').slice(0, 100);
  return 'anon:' + createHash('sha256').update(clientIp).digest('hex');
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Authorization');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Metodo non consentito.' });
  }

  const authorization = String(req.headers.authorization || '');
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  const accessToken = match ? match[1].trim() : '';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return res.status(503).json({ error: 'Configurazione utilizzo chat non disponibile.' });
  }

  try {
    let clientKey;
    let guest = false;

    if (accessToken) {
      const authResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: {
          apikey: SUPABASE_PUBLISHABLE_KEY,
          Authorization: 'Bearer ' + accessToken
        },
        signal: AbortSignal.timeout(15000)
      });

      if (!authResponse.ok) {
        return res.status(401).json({ error: 'Sessione scaduta. Accedi nuovamente.' });
      }

      const user = await authResponse.json();
      if (!user?.id) {
        return res.status(401).json({ error: 'Account non verificabile.' });
      }
      clientKey = user.id;
    } else {
      clientKey = guestClientKey(req);
      guest = true;
    }

    const now = new Date();
    const todayUtc = now.toISOString().slice(0, 10);
    const resetsAt = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1
    )).toISOString();

    const query = new URLSearchParams({
      select: 'request_count',
      client_key: 'eq.' + clientKey,
      usage_date: 'eq.' + todayUtc,
      limit: '1'
    });

    const usageResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/ai_chat_daily_usage?${query.toString()}`,
      {
        headers: {
          apikey: serviceKey,
          Authorization: 'Bearer ' + serviceKey
        },
        signal: AbortSignal.timeout(15000)
      }
    );

    if (!usageResponse.ok) {
      console.error('Lettura quota chat non riuscita:', usageResponse.status);
      return res.status(503).json({
        error: 'Il contatore persistente della chat non è pronto. Completa la migration indicata nel progetto.'
      });
    }

    const rows = await usageResponse.json();
    const limit = guest ? GUEST_CHAT_LIMIT : DAILY_CHAT_LIMIT;
    const used = Math.max(0, Math.min(limit, Number(rows?.[0]?.request_count || 0)));

    return res.status(200).json({
      limit,
      used,
      remaining: Math.max(0, limit - used),
      guest,
      resetsAt
    });
  } catch (error) {
    console.error('Errore quota chat:', error.message);
    return res.status(500).json({ error: 'Errore durante il caricamento del limite chat.' });
  }
};
