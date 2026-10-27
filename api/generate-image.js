const SUPABASE_URL = 'https://bknkgctmpgiuxvahbbzs.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_rZEaUwMU4CCl7kUPdUlvuw_cuX2n9hB';
const DAILY_IMAGE_LIMIT = 5;

async function refundImageGeneration(userId, serviceKey) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/refund_image_generation`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: 'Bearer ' + serviceKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ p_user_id: userId })
    });
  } catch (error) {
    console.error('Impossibile restituire il credito immagine:', error.message);
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Metodo non consentito.' });
  }

  const authHeader = req.headers.authorization || '';
  const accessToken = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : '';

  if (!accessToken) {
    return res.status(401).json({
      error: 'Accedi al tuo account per creare immagini.'
    });
  }

  try {
    const authResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      method: 'GET',
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: 'Bearer ' + accessToken
      },
      signal: AbortSignal.timeout(10000)
    });

    if (!authResponse.ok) {
      return res.status(401).json({
        error: 'Sessione non valida. Accedi nuovamente.'
      });
    }

    const user = await authResponse.json();

    if (!user || !user.id) {
      return res.status(401).json({ error: 'Utente non autenticato.' });
    }

    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const apiToken = process.env.CLOUDFLARE_API_TOKEN;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!accountId || !apiToken) {
      return res.status(503).json({
        error: 'Configurazione Cloudflare incompleta su Vercel.'
      });
    }

    if (!serviceKey) {
      return res.status(503).json({
        error: 'Manca SUPABASE_SERVICE_ROLE_KEY nelle variabili di Vercel.'
      });
    }

    const prompt = String(req.body?.prompt || '').trim();

    if (!prompt || prompt.length > 2048) {
      return res.status(400).json({
        error: 'La descrizione deve contenere da 1 a 2048 caratteri.'
      });
    }

    // Prenotazione atomica: impedisce richieste simultanee oltre il limite.
    const quotaResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/rpc/consume_image_generation`,
      {
        method: 'POST',
        headers: {
          apikey: serviceKey,
          Authorization: 'Bearer ' + serviceKey,
          'Content-Type': 'application/json'
        },
        signal: AbortSignal.timeout(15000),
        body: JSON.stringify({
          p_user_id: user.id,
          p_daily_limit: DAILY_IMAGE_LIMIT
        })
      }
    );

    if (!quotaResponse.ok) {
      console.error(
        'Errore controllo quota immagini:',
        quotaResponse.status,
        (await quotaResponse.text()).slice(0, 500)
      );
      return res.status(503).json({
        error: 'Impossibile verificare il limite giornaliero. Riprova più tardi.'
      });
    }

    const quotaRows = await quotaResponse.json();
    const quota = Array.isArray(quotaRows) ? quotaRows[0] : quotaRows;

    if (!quota || quota.allowed !== true) {
      return res.status(429).json({
        error: `Hai raggiunto il limite di ${DAILY_IMAGE_LIMIT} immagini al giorno. Riprova domani (UTC).`,
        limit: DAILY_IMAGE_LIMIT,
        remaining: 0,
        resetsAt: quota?.resets_at || null
      });
    }

    let reservationActive = true;
    const refundReservation = async () => {
      if (!reservationActive) return;
      reservationActive = false;
      await refundImageGeneration(user.id, serviceKey);
    };

    try {
      const response = await fetch(
        'https://api.cloudflare.com/client/v4/accounts/' +
          encodeURIComponent(accountId) +
          '/ai/run/@cf/black-forest-labs/flux-1-schnell',
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + apiToken,
            'Content-Type': 'application/json'
          },
          signal: AbortSignal.timeout(90000),
          body: JSON.stringify({ prompt, steps: 4 })
        }
      );

      let data;
      try {
        data = await response.json();
      } catch {
        await refundReservation();
        return res.status(502).json({
          error: 'Cloudflare ha restituito una risposta non valida.'
        });
      }

      if (!response.ok || data.success === false) {
        console.error(
          'Errore Cloudflare immagini:',
          response.status,
          data.errors
        );

        // Un errore del provider non consuma il credito giornaliero.
        await refundReservation();

        return res.status(502).json({
          error: 'Errore Cloudflare (' + response.status + '): ' +
            String(
              data.errors?.[0]?.message ||
              'Impossibile generare l’immagine.'
            ).slice(0, 400)
        });
      }

      const image = data.result?.image;

      if (!image || typeof image !== 'string') {
        await refundReservation();
        return res.status(502).json({
          error: 'Il servizio non ha restituito un’immagine valida.'
        });
      }

      // La richiesta è riuscita: il credito rimane consumato.
      reservationActive = false;

      return res.status(200).json({
        image: 'data:image/jpeg;base64,' + image,
        limit: DAILY_IMAGE_LIMIT,
        remaining: Math.max(0, Number(quota.remaining ?? 0))
      });
    } catch (error) {
      await refundReservation();
      throw error;
    }
  } catch (error) {
    console.error('Errore generazione immagini:', error.message);
    return res.status(502).json({
      error: 'Errore durante la verifica dell’accesso o la generazione.'
    });
  }
};
