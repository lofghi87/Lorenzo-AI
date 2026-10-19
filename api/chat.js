const OpenAI = require('openai');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Metodo non consentito.' });
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).json({
      error: 'Chiave API non configurata su Vercel.'
    });
  }

  const messages = req.body?.messages;

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({
      error: 'Nessun messaggio ricevuto.'
    });
  }

  const safeMessages = messages.slice(-40).map(m => ({
    role: ['user', 'assistant'].includes(m.role)
      ? m.role : 'user',
    content: String(m.content || '').slice(0, 12000)
  }));

  try {
    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });

    const result = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'Sei Lorenzo AI, un assistente utile e chiaro. Rispondi in italiano quando l’utente scrive in italiano.'
        },
        ...safeMessages
      ],
      max_tokens: 1200
    });

    return res.status(200).json({
      reply: result.choices[0].message.content
    });
  } catch (error) {
    console.error('Errore AI:', error.message);
    return res.status(502).json({
      error: 'Errore AI. Controlla la chiave, il modello e la fatturazione API.'
    });
  }
};
