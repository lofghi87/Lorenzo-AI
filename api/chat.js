
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

  const messages = req.body?.messages;

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({
      error: 'Nessun messaggio ricevuto.'
    });
  }

  const contents = messages
    .slice(-40)
    .filter(m =>
      ['user', 'assistant'].includes(m.role) &&
      String(m.content || '').trim()
    )
    .map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{
        text: String(m.content).slice(0, 12000)
      }]
    }));

  if (!contents.length) {
    return res.status(400).json({
      error: 'Nessun messaggio valido.'
    });
  }

  try {
    const response = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{
              text: 'Sei Lorenzo AI, un assistente utile e chiaro. Rispondi in italiano quando l’utente scrive in italiano.'
            }]
          },
          contents,
          generationConfig: {
            maxOutputTokens: 1200
          }
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error('Errore Gemini:', response.status, data.error);
      const message = response.status === 429
        ? 'Limite di utilizzo Gemini raggiunto. Riprova più tardi.'
        : response.status === 403
        ? 'Gemini ha rifiutato la richiesta. Controlla chiave e autorizzazioni.'
        : 'Gemini non ha accettato la richiesta. Controlla i log di Vercel.';

      return res.status(502).json({ error: message });
    }

    const reply = (data.candidates?.[0]?.content?.parts || [])
      .map(part => part.text || '')
      .join('')
      .trim();

    if (!reply) {
      return res.status(502).json({
        error: 'Gemini non ha restituito una risposta testuale.'
      });
    }

    return res.status(200).json({ reply });
  } catch (error) {
    console.error('Errore di connessione Gemini:', error.message);
    return res.status(502).json({
      error: 'Impossibile contattare Gemini. Riprova più tardi.'
    });
  }
};
