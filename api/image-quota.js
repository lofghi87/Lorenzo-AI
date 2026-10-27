const DAILY_IMAGE_LIMIT = 5;
const SUPABASE_URL = 'https://bknkgctmpgiuxvahbbzs.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_rZEaUwMU4CCl7kUPdUlvuw_cuX2n9hB';

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Metodo non consentito.' });
  }

  const accessToken = String(req.headers.authorization || '')
    .replace(/^Bearer\\s+/i, '');
  if (!accessToken) {
    return res.status(401).json({ error: 'Accedi per vedere il tuo utilizzo.' });
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return res.status(503).json({ error: 'Configurazione utilizzo non disponibile.' });
  }

  try {
    const authResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${accessToken}`
      }
    });

    if (!authResponse.ok) {
      return res.status(401).json({ error: 'Sessione scaduta. Accedi nuovamente.' });
    }

    const user = await authResponse.json();
    if (!user.id) {
      return res.status(401).json({ error: 'Non è stato possibile verificare l’account.' });
    }

    const now = new Date();
    const todayUtc = now.toISOString().slice(0, 10);
    const resetAt = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1
    )).toISOString();

    const query = new URLSearchParams({
      select: 'generation_count',
      user_id: `eq.${user.id}`,
      usage_date: `eq.${todayUtc}`,
      limit: '1'
    });

    const usageResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/image_generation_daily_usage?${query.toString()}`,
      {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`
        }
      }
    );

    if (!usageResponse.ok) {
      console.error('Errore lettura quota immagini:', usageResponse.status);
      return res.status(503).json({
        error: 'Non riesco a leggere il tuo utilizzo. Riprova più tardi.'
      });
    }

    const rows = await usageResponse.json();
    const rawUsed = Number(rows?.[0]?.generation_count || 0);
    const used = Math.max(0, Math.min(DAILY_IMAGE_LIMIT, rawUsed));

    return res.status(200).json({
      limit: DAILY_IMAGE_LIMIT,
      used,
      remaining: Math.max(0, DAILY_IMAGE_LIMIT - used),
      resetsAt: resetAt
    });
  } catch (error) {
    console.error('Errore endpoint utilizzo immagini:', error.message);
    return res.status(500).json({
      error: 'Errore durante il caricamento dell’utilizzo.'
    });
  }
};
