# Lorenzo AI — pacchetto per Vercel

Questa versione usa le Vercel Functions (`/api/status` e `/api/chat`) e non richiede un server Express sempre acceso.

## Pubblicazione da telefono

**Nota:** Vercel normalmente importa un progetto da Git. Se la dashboard non offre un caricamento ZIP diretto, carica i file estratti in un repository GitHub usando il sito GitHub dal browser del telefono, poi in Vercel scegli Add New → Project e importa quel repository.

1. Crea un repository GitHub nuovo, per esempio `lorenzo-ai`.
2. Carica il contenuto di questo ZIP nel repository mantenendo `api/`, `public/`, `package.json` e `vercel.json` nella cartella principale del repository. Non caricare un file ZIP annidato: Vercel deve vedere i file e le cartelle.
3. In Vercel importa il repository e premi Deploy.
4. Nel progetto Vercel apri Settings → Environment Variables e aggiungi `OPENAI_API_KEY` con la tua chiave API. Puoi aggiungere anche `OPENAI_MODEL` (facoltativo; predefinito `gpt-4o-mini`).
5. Salva e fai un nuovo Deploy affinché la variabile venga caricata.
6. Apri il dominio Vercel assegnato e prova a inviare un messaggio.

## API AI

Le API di OpenAI sono separate dall'abbonamento ChatGPT e possono richiedere un account API con fatturazione attiva. Non inserire mai la chiave in `public/` né condividerla in chat.

## Limiti attuali

- La chat e il tema sono salvati nel browser del dispositivo (`localStorage`). Non c'è ancora un sistema di account, né sincronizzazione delle chat tra dispositivi.
- Gli allegati non sono ancora implementati.
- Prima di aprire il servizio al pubblico servono autenticazione, limiti d'uso e protezioni anti-abuso.
