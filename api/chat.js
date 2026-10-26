
const MAX_MESSAGES = 40;
const MAX_TEXT_LENGTH = 12000;
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_TOTAL_FILES = 20 * 1024 * 1024;
const MAX_FILES = 5;

// Limiti mantenuti per gli allegati inviati direttamente in Base64.
const LEGACY_MAX_FILE_SIZE = 2 * 1024 * 1024;
const LEGACY_MAX_TOTAL_SIZE = 3 * 1024 * 1024;

const SUPABASE_URL = 'https://bknkgctmpgiuxvahbbzs.supabase.co';
const SUPABASE_PUBLISHABLE_KEY =
  'sb_publishable_rZEaUwMU4CCl7kUPdUlvuw_cuX2n9hB';
const BUCKET = 'lorenzo-attachments';

const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf'
]);

function errorMessage(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

async function uploadToGemini(apiKey, buffer, mimeType, name) {
  const start = await fetch(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: {
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': String(buffer.length),
        'X-Goog-Upload-Header-Content-Type': mimeType,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        file: { display_name: name }
      })
    }
  );

  if (!start.ok) {
    throw new Error('Non riesco ad avviare il caricamento del file su Gemini.');
  }

  const uploadUrl = start.headers.get('x-goog-upload-url');

  if (!uploadUrl) {
    throw new Error('Gemini non ha restituito l’indirizzo di caricamento.');
  }

  const finish = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize',
      'Content-Type': mimeType,
      'Content-Length': String(buffer.length)
    },
    body: buffer
  });

  const result = await finish.json();

  if (!finish.ok || !result.file?.uri || !result.file?.name) {
    throw new Error('Gemini non è riuscito a ricevere il file.');
  }

  return result.file;
}

async function verifyUser(accessToken) {
  if (!accessToken) {
    throw errorMessage(
      'Per usare allegati fino a 10 MB devi accedere al tuo account.'
    );
  }

  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    throw errorMessage('Sessione scaduta. Accedi nuovamente.');
  }

  const user = await response.json();

  if (!user.id) {
    throw errorMessage('Non è stato possibile verificare il tuo account.');
  }

  return user.id;
}

async function downloadFromStorage(path, userId, serviceKey) {
  if (
    typeof path !== 'string' ||
    path.length > 1024 ||
    path.startsWith('/') ||
    path.split('/').some(part =>
      !part || part === '.' || part === '..'
    ) ||
    path.split('/')[0] !== userId
  ) {
    throw errorMessage('Percorso allegato non valido.');
  }

  const encodedPath = path
    .split('/')
    .map(encodeURIComponent)
    .join('/');

  const response = await fetch(
    `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${encodedPath}`,
    {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`
      }
    }
  );

  if (!response.ok) {
    throw errorMessage(
      'Non riesco a leggere un allegato da Supabase Storage.'
    );
  }

  const buffer = Buffer.from(await response.arrayBuffer());

  if (buffer.length > MAX_FILE_SIZE) {
    throw errorMessage('Ogni file deve essere massimo 10 MB.');
  }

  return buffer;
}

async function deleteGeminiFile(apiKey, fileName) {
  try {
    await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${encodeURIComponent(apiKey)}`,
      { method: 'DELETE' }
    );
  } catch (error) {
    console.error('Pulizia file Gemini non riuscita:', error.message);
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({
      error: 'Metodo non consentito.'
    });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!apiKey) {
    return res.status(503).json({
      error: 'GEMINI_API_KEY non configurata su Vercel.'
    });
  }

  const messages = req.body?.messages;

  if (!Array.isArray(messages) || !messages.length) {
    return res.status(400).json({
      error: 'Nessun messaggio ricevuto.'
    });
  }

  const accessToken = String(
    req.headers.authorization || ''
  ).replace(/^Bearer\s+/i, '');

  const uploadedGeminiFiles = [];

  try {
    const hasStorageAttachments = messages.some(message =>
      message?.role === 'user' &&
      Array.isArray(message.attachments) &&
      message.attachments.some(file =>
        file && typeof file.path === 'string'
      )
    );

    let userId = null;

    if (hasStorageAttachments) {
      if (!serviceKey) {
        return res.status(503).json({
          error: 'Configurazione Supabase mancante su Vercel.'
        });
      }

      userId = await verifyUser(accessToken);
    }

    let totalBytes = 0;
    let legacyTotalBytes = 0;
    const contents = [];

    for (const message of messages.slice(-MAX_MESSAGES)) {
      if (
        !message ||
        !['user', 'assistant'].includes(message.role)
      ) {
        continue;
      }

      const text = String(message.content || '')
        .slice(0, MAX_TEXT_LENGTH);

      const attachments =
        message.role === 'user' &&
        Array.isArray(message.attachments)
          ? message.attachments
          : [];

      if (!text.trim() && !attachments.length) {
        continue;
      }

      if (attachments.length > MAX_FILES) {
        throw errorMessage(
          'Puoi allegare al massimo 5 file per messaggio.'
        );
      }

      const parts = [];

      if (text.trim()) {
        parts.push({ text });
      }

      for (const file of attachments) {
        if (!file || typeof file !== 'object') {
          throw errorMessage('Un allegato non è valido.');
        }

        const mimeType = String(file.mimeType || '')
          .toLowerCase();

        if (!ALLOWED_TYPES.has(mimeType)) {
          throw errorMessage(
            'Formato non supportato. Usa JPG, PNG, WebP, HEIC, HEIF o PDF.'
          );
        }

        let buffer;

        if (typeof file.path === 'string') {
          if (!userId || !serviceKey) {
            throw errorMessage(
              'Accedi per utilizzare gli allegati grandi.'
            );
          }

          buffer = await downloadFromStorage(
            file.path,
            userId,
            serviceKey
          );

          totalBytes += buffer.length;

          if (totalBytes > MAX_TOTAL_FILES) {
            throw errorMessage(
              'Gli allegati superano il limite totale di 20 MB.'
            );
          }
        } else if (typeof file.data === 'string') {
          const base64 = file.data;

          if (
            !base64 ||
            base64.length % 4 !== 0 ||
            !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)
          ) {
            throw errorMessage('Un allegato non contiene dati validi.');
          }

          buffer = Buffer.from(base64, 'base64');

          if (buffer.toString('base64') !== base64) {
            throw errorMessage('I dati dell’allegato non sono validi.');
          }

          if (buffer.length > LEGACY_MAX_FILE_SIZE) {
            throw errorMessage(
              'Per allegati grandi, accedi al tuo account e caricali su Supabase.'
            );
          }

          legacyTotalBytes += buffer.length;

          if (legacyTotalBytes > LEGACY_MAX_TOTAL_SIZE) {
            throw errorMessage(
              'Gli allegati inviati direttamente superano 3 MB.'
            );
          }
        } else {
          throw errorMessage('Un allegato non è valido.');
        }

        if (buffer.length > MAX_FILE_SIZE) {
          throw errorMessage('Ogni file deve essere massimo 10 MB.');
        }

        const fileName = String(file.name || 'allegato')
          .replace(/[^a-zA-Z0-9._-]/g, '_')
          .slice(0, 100);

        const uploaded = await uploadToGemini(
          apiKey,
          buffer,
          mimeType,
          fileName
        );

        uploadedGeminiFiles.push(uploaded.name);

        parts.push({
          fileData: {
            mimeType,
            fileUri: uploaded.uri
          }
        });
      }

      contents.push({
        role: message.role === 'assistant' ? 'model' : 'user',
        parts
      });
    }

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
    text: `Sei Lorenzo AI, un assistente utile, chiaro e cordiale.

IDENTITÀ E ORIGINI
Sei Lorenzo AI, un assistente sviluppato da Lorenzo Poletti, uno studente italiano che ha creato questo progetto per hobby, per passione verso la tecnologia e per sperimentare con l'intelligenza artificiale.

Quando l'utente ti chiede chi ti ha creato, chi è il tuo sviluppatore, chi c'è dietro Lorenzo AI o fa una domanda equivalente, rispondi in modo naturale e attribuisci correttamente la creazione del progetto a Lorenzo Poletti.

Puoi spiegare che Lorenzo ha realizzato Lorenzo AI come progetto personale per imparare, sperimentare e costruire un assistente AI con funzioni di conversazione, analisi di immagini e documenti e generazione di immagini.

Se l'utente chiede altre informazioni su Lorenzo, puoi condividere queste informazioni generali: è uno studente italiano appassionato di tecnologia e intelligenza artificiale e sviluppa il progetto nel tempo libero.

Non inventare dettagli biografici, risultati, qualifiche o informazioni personali che non conosci. Non divulgare né chiedere di divulgare indirizzi, contatti privati, credenziali, dati familiari o altre informazioni sensibili. Se non conosci la risposta a una domanda su Lorenzo, dillo chiaramente.

Non affermare di conoscere personalmente Lorenzo o di avere accesso alla sua vita privata. Distingui sempre le informazioni note dalle supposizioni.

COMPORTAMENTO GENERALE
Rispondi nella lingua dell'utente, usando un tono amichevole e chiaro. Se l'utente scrive in italiano, rispondi in italiano. Quando ricevi immagini o PDF, analizzane il contenuto e rispondi alla domanda dell'utente.`
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
    console.error('Errore /api/chat:', error);

    return res.status(error.statusCode || 500).json({
      error: error.message || 'Si è verificato un errore durante la richiesta.'
    });
  } finally {
    await Promise.all(
      uploadedGeminiFiles.map(fileName =>
        deleteGeminiFile(apiKey, fileName)
      )
    );
  }
};
