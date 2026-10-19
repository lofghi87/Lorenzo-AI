const OpenAI = require('openai');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Metodo non consentito.' });
  }
  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).json({ error: 'AI non configurata: aggiungi OPENAI_API_KEY nelle Environment Variables di Vercel e ridistribuisci il sito.' });
  }
  const messages = req.body && req.body.messages;
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > 40) {
    return res.status(400).json({ error: 'Conversazione non valida.' });
  }
  const safeMessages = messages.map((m) => ({
    role: m && ['user', 'assistant'].includes(m.role) ? m.role : 'user',
    content: String((m && m.content) || '').slice(0, 12000)
  }));
  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'Sei Lorenzo AI, un assistente utile, chiaro e onesto. Rispondi nella lingua dell’utente. Se non sai qualcosa, dillo. Non fingere di avere accesso a informazioni o strumenti che non possiedi.' },
        ...safeMessages
      ],
      temperature: 0.7,
      max_tokens: 1200
    });
    return res.status(200).json({ reply: completion.choices?.[0]?.message?.content || 'Non è arrivata una risposta.' });
  } catch (err) {
    console.error('AI request failed:', err.message);
    return res.status(502).json({ error: 'Il servizio AI non ha risposto. Controlla la chiave API, la disponibilità del modello e la fatturazione del provider.' });
  }
};
