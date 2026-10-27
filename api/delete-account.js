const SUPABASE_URL = 'https://bknkgctmpgiuxvahbbzs.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_rZEaUwMU4CCl7kUPdUlvuw_cuX2n9hB';
const BUCKET = 'lorenzo-attachments';

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Metodo non consentito.' });
  }

  const authorization = String(req.headers.authorization || '');
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  const accessToken = match ? match[1].trim() : '';
  if (!accessToken) {
    return res.status(401).json({ error: 'Accedi per eliminare il tuo account.' });
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return res.status(503).json({ error: 'Eliminazione account non configurata sul server.' });
  }

  const headers = {
    apikey: serviceKey,
    Authorization: 'Bearer ' + serviceKey
  };

  try {
    const authResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: 'Bearer ' + accessToken
      },
      signal: AbortSignal.timeout(15000)
    });

    if (!authResponse.ok) {
      return res.status(401).json({ error: 'La sessione è scaduta. Accedi nuovamente.' });
    }

    const user = await authResponse.json();
    if (!user?.id) {
      return res.status(401).json({ error: 'Account non verificabile.' });
    }

    // Elimina prima i file privati dell'utente. Non elimina file appartenenti
    // a percorsi diversi dal suo identificativo.
    const objects = [];
    let offset = 0;
    const pageSize = 1000;

    while (true) {
      const listResponse = await fetch(
        `${SUPABASE_URL}/storage/v1/object/list/${BUCKET}`,
        {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prefix: user.id + '/',
            limit: pageSize,
            offset,
            sortBy: { column: 'name', order: 'asc' }
          }),
          signal: AbortSignal.timeout(20000)
        }
      );

      if (!listResponse.ok) {
        console.error('Eliminazione account: impossibile elencare i file.', listResponse.status);
        return res.status(503).json({
          error: 'Non riesco a completare in sicurezza la cancellazione dei file. Riprova più tardi.'
        });
      }

      const page = await listResponse.json();
      const files = Array.isArray(page)
        ? page.filter(item => item && item.name && item.id).map(item => user.id + '/' + item.name)
        : [];
      objects.push(...files);

      if (!Array.isArray(page) || page.length < pageSize) break;
      offset += pageSize;
      if (offset >= 10000) {
        return res.status(503).json({
          error: 'L’account contiene molti file. La cancellazione automatica è stata interrotta in sicurezza.'
        });
      }
    }

    if (objects.length) {
      const removeResponse = await fetch(
        `${SUPABASE_URL}/storage/v1/object/${BUCKET}`,
        {
          method: 'DELETE',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ prefixes: objects }),
          signal: AbortSignal.timeout(30000)
        }
      );

      if (!removeResponse.ok) {
        console.error('Eliminazione account: rimozione file non riuscita.', removeResponse.status);
        return res.status(503).json({
          error: 'Non riesco a eliminare tutti i file dell’account. Nessun account è stato eliminato; riprova più tardi.'
        });
      }
    }

    const chatsResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/chats?user_id=eq.${encodeURIComponent(user.id)}`,
      {
        method: 'DELETE',
        headers: { ...headers, Prefer: 'return=minimal' },
        signal: AbortSignal.timeout(20000)
      }
    );

    if (!chatsResponse.ok) {
      console.error('Eliminazione account: rimozione chat non riuscita.', chatsResponse.status);
      return res.status(503).json({
        error: 'Non riesco a eliminare tutte le conversazioni. L’account non è stato eliminato; riprova più tardi.'
      });
    }

    // Rimuovi il contatore giornaliero associato all'account prima di
    // cancellare l'utente. Se la migration non esiste ancora, è compatibile
    // con progetti non ancora aggiornati; errori diversi non vengono ignorati.
    const quotaDeleteResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/ai_chat_daily_usage?client_key=eq.${encodeURIComponent(user.id)}`,
      {
        method: 'DELETE',
        headers: { ...headers, Prefer: 'return=minimal' },
        signal: AbortSignal.timeout(15000)
      }
    );
    if (!quotaDeleteResponse.ok && quotaDeleteResponse.status !== 404 && quotaDeleteResponse.status !== 400) {
      console.error('Eliminazione account: rimozione quota chat non riuscita.', quotaDeleteResponse.status);
      return res.status(503).json({
        error: 'Non riesco a completare la cancellazione dei dati di utilizzo. L’account non è stato eliminato; riprova più tardi.'
      });
    }

    const deleteUserResponse = await fetch(
      `${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(user.id)}`,
      {
        method: 'DELETE',
        headers,
        signal: AbortSignal.timeout(20000)
      }
    );

    if (!deleteUserResponse.ok) {
      console.error('Eliminazione account: cancellazione Auth non riuscita.', deleteUserResponse.status);
      return res.status(503).json({
        error: 'Le conversazioni e i file sono stati eliminati, ma non è stato possibile eliminare l’account. Contatta l’assistenza del sito.'
      });
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Errore eliminazione account:', error.message);
    return res.status(500).json({
      error: 'Si è verificato un errore durante l’eliminazione. Riprova più tardi.'
    });
  }
};
