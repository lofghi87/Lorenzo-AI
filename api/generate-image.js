
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
      error: 'Manca GEMINI_API_KEY nelle variabili di Vercel.'
    });
  }

  const prompt = String(req.body?.prompt || '').trim();

  if (!prompt || prompt.length > 2000) {
    return res.status(400).json({
      error: 'La descrizione deve contenere da 1 a 2000 caratteri.'
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
            mime_type: 'image/jpeg',
            aspect_ratio: '1:1',
            image_size: '1K'
          }
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error('Errore API immagini:', response.status, data);

      const apiMessage =
        data?.error?.message ||
        data?.message ||
        'Il servizio Google non ha fornito dettagli.';

      return res.status(502).json({
        error: 'Google API (' + response.status + '): ' +
          String(apiMessage).slice(0, 500)
      });
    }

    const image = data.output_image;

    if (!image?.data) {
      console.error(
        'Risposta senza output_image:',
        JSON.stringify(data).slice(0, 1500)
      );

      return res.status(502).json({
        error: 'La richiesta è stata accettata, ma non è arrivata un’immagine.'
      });
    }

    const mimeType = image.mime_type || 'image/png';

    if (!['image/png', 'image/jpeg', 'image/webp'].includes(mimeType)) {
      return res.status(502).json({
        error: 'Formato immagine restituito non supportato.'
      });
    }

    return res.status(200).json({
      image: 'data:' + mimeType + ';base64,' + image.data
    });
  } catch (error) {
    console.error('Errore di connessione:', error.message);

    return res.status(502).json({
      error: 'Errore di connessione al servizio immagini.'
    });
  }
};
