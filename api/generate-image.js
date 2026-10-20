
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({
      error: 'Metodo non consentito.'
    });
  }

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(503).json({
      error: 'GEMINI_API_KEY non configurata su Vercel.'
    });
  }

  const prompt = String(req.body?.prompt || '').trim();

  if (!prompt) {
    return res.status(400).json({
      error: 'Scrivi una descrizione per l’immagine.'
    });
  }

  if (prompt.length > 2000) {
    return res.status(400).json({
      error: 'La descrizione non può superare 2000 caratteri.'
    });
  }

  try {
    const response = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/interactions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey
        },
        body: JSON.stringify({
          model: 'gemini-3.1-flash-image',
          input: prompt,
          response_format: {
            type: 'image',
            mime_type: 'image/png',
            aspect_ratio: '1:1',
            image_size: '1K'
          }
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error(
        'Errore generazione immagine:',
        response.status,
        data.error
      );

      const message = response.status === 429
        ? 'Limite di utilizzo raggiunto. Riprova più tardi.'
        : response.status === 403
        ? 'Accesso al modello non autorizzato. Controlla chiave e autorizzazioni.'
        : 'Non è stato possibile generare l’immagine. Controlla i log di Vercel.';

      return res.status(502).json({ error: message });
    }

    const image = data.output_image;

    if (!image?.data) {
      return res.status(502).json({
        error: 'Il modello non ha restituito un’immagine.'
      });
    }

    const mimeType = image.mime_type || 'image/png';

    if (!['image/png', 'image/jpeg', 'image/webp'].includes(mimeType)) {
      return res.status(502).json({
        error: 'Il modello ha restituito un formato immagine non supportato.'
      });
    }

    return res.status(200).json({
      image: `data:${mimeType};base64,${image.data}`
    });
  } catch (error) {
    console.error('Errore di connessione:', error.message);

    return res.status(502).json({
      error: 'Impossibile contattare il servizio immagini. Riprova più tardi.'
    });
  }
};
