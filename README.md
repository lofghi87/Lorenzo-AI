# Lorenzo AI

Lorenzo AI è un assistente web costruito come progetto indipendente. L'app permette conversazioni testuali con risposta in streaming, analisi di immagini e PDF, cronologia su account, copia/rigenerazione delle risposte e generazione di immagini per utenti autenticati.

## Componenti

- **Frontend:** HTML, CSS e JavaScript; interfaccia responsive per telefono e computer.
- **Autenticazione, database e Storage:** Supabase.
- **Risposte e analisi di allegati:** Google Gemini, tramite endpoint server-side in `api/chat.js`.
- **Generazione immagini:** Cloudflare Workers AI, tramite `api/generate-image.js`.
- **Hosting:** Vercel Functions e pagine statiche.
- **Test:** Node.js `node --test`, eseguiti automaticamente da GitHub Actions.

## Variabili d'ambiente su Vercel

Configura queste variabili nel progetto Vercel, in tutti gli ambienti appropriati:

- `GEMINI_API_KEY`: chiave server-side di Google Gemini.
- `SUPABASE_SERVICE_ROLE_KEY`: chiave amministrativa server-side di Supabase. **Non inserirla nel frontend, in file pubblici o in messaggi.**
- `CLOUDFLARE_ACCOUNT_ID`: identificativo dell'account Cloudflare.
- `CLOUDFLARE_API_TOKEN`: token Cloudflare con i permessi minimi necessari per Workers AI.

La chiave Supabase publishable presente nel frontend è una chiave pubblica destinata a essere esposta. Le tabelle e i bucket devono comunque avere policy Row Level Security/Storage corrette: una chiave pubblica non sostituisce le policy di accesso.

## Database: migrazioni richieste

Le migrazioni SQL in `supabase/migrations/` vanno eseguite nel **SQL Editor** del progetto Supabase, nell'ordine del nome file:

1. `202610270001_image_generation_daily_limits.sql` — contatore immagini giornaliero.
2. `202610270002_ai_chat_daily_limits.sql` — contatore persistente delle richieste chat per account o visitatore anonimo.
3. `202610270003_private_chat_and_storage_policies.sql` — policy di accesso alla cronologia e agli allegati privati.

La seconda migrazione è necessaria per i limiti persistenti e per il pannello di utilizzo chat. Se la tabella non è stata creata, l'API usa temporaneamente limiti in memoria per non bloccare del tutto il servizio, ma il contatore non è persistente tra tutte le istanze/serverless e il pannello mostra un errore. Prima di condividere il sito pubblicamente, applica tutte e tre le migrazioni e verifica il risultato.

## Test

Con Node.js 18 o successivo:

```sh
npm test
```

I test automatici controllano che l'endpoint della chat rifiuti metodi non supportati, conversazioni vuote o troppo grandi, ruoli non ammessi, contenuti non validi e un numero eccessivo di allegati.

GitHub Actions esegue i test su ogni pull request verso `main` e a ogni push su `main`.

## Checklist prima di invitare il pubblico

1. Applica le tre migrazioni SQL sopra, nell'ordine indicato.
2. Verifica su Vercel che le quattro variabili d'ambiente server-side siano impostate; dopo ogni modifica delle variabili, esegui un nuovo deployment.
3. La terza migration ricrea le policy della tabella `chats` in modo che ogni utente legga e modifichi soltanto le proprie conversazioni e aggiunge policy per il bucket `lorenzo-attachments`. Prima di eseguirla, controlla le policy già presenti su `storage.objects`: rimuovi manualmente eventuali policy generiche troppo permissive che si applicano a tutti i bucket, perché la tabella Storage è condivisa nel progetto Supabase. Il bucket `lorenzo-attachments` deve essere privato e gli oggetti devono trovarsi in cartelle che iniziano con l'ID del proprietario.
4. Completa e fai controllare le pagine `privacy.html` e `terms.html`: sono bozze iniziali, non un parere legale. Prima del lancio serve un canale di contatto adatto a un servizio pubblico e devono essere verificate le condizioni dei provider AI.
5. Esegui i test manuali elencati in basso usando un account di prova, poi prova una seconda registrazione per controllare la separazione dei dati.

## Test manuale consigliato

- Creare un account, uscire e accedere nuovamente.
- Inviare messaggi brevi e lunghi e verificare lo streaming.
- Copiare e rigenerare una risposta; simulare un errore e verificare che la risposta precedente resti disponibile.
- Caricare immagini e PDF, rimuovere un allegato prima dell'invio e verificare i messaggi di errore.
- Generare un'immagine, aggiornare la pagina e riaprire la chat per verificare che immagine e cronologia siano ancora disponibili.
- Eliminare una chat, controllare il contatore d'uso e visualizzare l'orario del reset.
- Eliminare un account di prova e verificare che non possa più accedere e che i dati collegati siano stati rimossi.
- Ripetere i controlli da iPhone e da un browser desktop, sia con tema scuro sia con tema chiaro.

## Limiti noti

- Le risposte AI possono essere inesatte; il servizio mostra un promemoria per verificare le informazioni importanti.
- Le quote in memoria sono limiti di contenimento e non un sistema anti-abuso distribuito; la migration SQL fornisce la quota giornaliera persistente.
- Una cancellazione su servizi esterni può fallire per un errore del provider. Il sito prova a mostrare un errore e non deve dichiarare i dati rimossi quando la cancellazione non è confermata.
- Nessun insieme di test automatici garantisce che tutto funzioni in ogni browser, account e configurazione. Il collaudo manuale sul deployment reale resta necessario.
