
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({
      error: 'Metodo non consentito.'
    });
  }

  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;

  if (!accountId || !apiToken) {
    return res.status(503).json({
      error: 'Mancano CLOUDFLARE_ACCOUNT_ID o CLOUDFLARE_API_TOKEN nelle variabili di Vercel.'
    });
  }

  const prompt = String(req.body?.prompt || '').trim();

  if (!prompt || prompt.length > 2048) {
    return res.status(400).json({
      error: 'La descrizione deve contenere da 1 a 2048 caratteri.'
    });
  }

  try {
    const response = await fetch(
      'https://api.cloudflare.com/client/v4/accounts/' +
        encodeURIComponent(accountId) +
        '/ai/run/@cf/black-forest-labs/flux-1-schnell',
      {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + apiToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          prompt,
          steps: 4
        })
      }
    );

    const data = await response.json();

    if (!response.ok || data.success === false) {
      console.error(
        'Errore Cloudflare immagini:',
        response.status,
        data.errors
      );

      return res.status(502).json({
        error: 'Cloudflare API (' + response.status + '): ' +
          String(
            data.errors?.[0]?.message ||
            'Impossibile generare l’immagine.'
          ).slice(0, 400)
      });
    }

    const image = data.result?.image;

    if (!image || typeof image !== 'string') {
      console.error('Risposta Cloudflare senza immagine.');

      return res.status(502).json({
        error: 'Il servizio non ha restituito un’immagine valida.'
      });
    }

    return res.status(200).json({
      image: 'data:image/jpeg;base64,' + image
    });
  } catch (error) {
    console.error('Errore di connessione Cloudflare:', error.message);

    return res.status(502).json({
      error: 'Errore di connessione al servizio immagini.'
    });
  }
};
