module.exports = function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Metodo non consentito.' });
  }

  const serviceKey = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  return res.status(200).json({
    configured: Boolean(process.env.GEMINI_API_KEY && serviceKey),
    chatConfigured: Boolean(process.env.GEMINI_API_KEY && serviceKey),
    imageGenerationConfigured: Boolean(
      process.env.CLOUDFLARE_ACCOUNT_ID &&
      process.env.CLOUDFLARE_API_TOKEN &&
      serviceKey
    ),
    model: 'gemini-3.5-flash-lite'
  });
};
