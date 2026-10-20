
const MAX_MESSAGES = 40;
const MAX_TEXT_LENGTH = 12000;
const MAX_FILE_SIZE = 2 * 1024 * 1024;
const MAX_TOTAL_FILES = 3 * 1024 * 1024;

const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf'
]);

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

  let totalBytes = 0;

  try {
    const contents = messages
      .slice(-MAX_MESSAGES)
      .filter(m =>
        m &&
        ['user', 'assistant'].includes(m.role) &&
        (
          String(m.content || '').trim() ||
          (m.role === 'user' &&
            Array.isArray(m.attachments) &&
            m.attachments.length > 0)
        )
      )
      .map(m => {
        const parts = [];
        const text = String(m.content || '').slice(0, MAX_TEXT_LENGTH);

        if (text.trim()) {
          parts.push({ text });
        }

        // Solo i messaggi dell'utente possono contenere allegati.
        if (m.role === 'user' && Array.isArray(m.attachments)) {
          if (m.attachments.length > 4) {
            throw new Error('Puoi allegare al massimo 4 file per messaggio.');
          }

          for (const file of m.attachments) {
            if (!file || typeof file.data !== 'string') {
              throw new Error('Un allegato non è valido.');
            }

            const mimeType = String(file.mimeType || '').toLowerCase();

            if (!ALLOWED_TYPES.has(mimeType)) {
              throw new Error(
                'Formato non supportato. Usa immagini JPG, PNG, WebP, HEIC o PDF.'
              );
            }

            // Accetta solo base64 standard, senza prefisso data:.
            const base64 = file.data;

            if (
              !base64 ||
              base64.length % 4 !== 0 ||
              !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)
            ) {
              throw new Error('Un allegato non contiene dati validi.');
            }

            const estimatedBytes =
              Math.floor(base64.length * 3 / 4) -
              (base64.endsWith('==') ? 2 :
                base64.endsWith('=') ? 1 : 0);

            if (estimatedBytes > MAX_FILE_SIZE) {
              throw new Error('Ogni file deve essere inferiore a 2 MB.');
            }

            totalBytes += estimatedBytes;

            if (totalBytes > MAX_TOTAL_FILES) {
              throw new Error('Gli allegati superano il limite totale di 3 MB.');
            }

            parts.push({
              inlineData: {
                mimeType,
                data: base64
              }
            });
          }
        }

        return {
          role: m.role === 'assistant' ? 'model' : 'user',
          parts
        };
      });

    if (!contents.length) {
      return res.status(400).json({
        error: 'Nessun messaggio valido.'
      });
    }

    const response = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{
              text: 'Sei Lorenzo AI, un assistente utile e chiaro. Rispondi in italiano quando l’utente scrive in italiano. Quando ricevi immagini o PDF, analizza il contenuto fornito e rispondi alla domanda dell’utente.'
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
    return res.status(400).json({
      error: error.message || 'Allegato non valido.'
    });
  }
};
