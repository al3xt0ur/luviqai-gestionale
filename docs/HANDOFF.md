# Riprendere lo sviluppo

Il repository contiene sorgenti e cronologia Git. Database, password, configurazione email e allegati di prova restano esclusi. Caricare il codice su GitHub non pubblica l'applicazione.

## Nuova copia del progetto

Richiede Node.js 24 e pnpm 11. Dalla cartella del repository, su Windows:

```powershell
pnpm install --frozen-lockfile
npm.cmd run build
npm.cmd test
npm.cmd start
```

Aprire http://localhost:3000. Il primo avvio genera nuovi accessi in `data/accessi-locali.txt`. Senza il vecchio `data/myclean.sqlite`, le due imprese locali partono senza clienti, interventi o pacchetti importati. Per creare gli amministratori, arrestare il server e usare `node scripts/admins.mjs`; poi riavviare.

Per trasferire anche i dati, usare un backup logico e la procedura del README su un database vuoto, prima del primo avvio. Il backup va condiviso attraverso un canale riservato, mai in Git, issue o chat. Configurare separatamente l'email secondo `docs/EMAIL.md`.

## Stato funzionale

- Imprese separate, amministratori della piattaforma, responsabili e operatori con permessi nel backend.
- Clienti archiviabili, catalogo pacchetti personalizzabile, disponibilità in minuti, interventi, rettifiche motivate, storico e backup.
- Preventivi con importi in centesimi, PDF con logo aziendale e layout rivisto con Sol, documenti immutabili dopo l'invio.
- Email con PDF e pagina di risposta cliente, accettazione/rifiuto, note e notifiche. Modalità predefinita di anteprima; SMTP predisposto, nessun invio reale necessario ai test.
- Trattativa: «Rivedi proposta» su un preventivo rifiutato prepara una nuova bozza numerata e collegata al precedente; rifiuto e storico originali restano consultabili.
- Da realizzare: fatture, conversione automatica in pacchetti/interventi, assistente AI, account clienti, abbonamenti e hosting.

## Codice e vincoli da mantenere

- `src/`: React e TypeScript; `server/http.mjs`: API e sessioni; `server/domain.mjs`: operazioni aziendali.
- `server/storage.mjs` e `server/schema.sql`: PostgreSQL/PGlite, transazioni, migrazioni e isolamento RLS.
- `server/quotes.mjs`, `server/quote-pdf.mjs`, `src/quotes.tsx`: preventivi e PDF. Conservare il layout di stampa approvato.
- `server/mail.mjs` e `src/mail.tsx`: coda email, token e risposte. Visitare un link non deve mai accettare o rifiutare un preventivo: serve l'invio esplicito del modulo. Non riprovare automaticamente invii SMTP dall'esito incerto.
- `tests/*.test.mjs`: test isolati. `tests/browser-*.mjs`: percorsi Chrome/Playwright; README descrive il percorso opzionale del modulo.

Non aprire due processi sullo stesso database PGlite. Mantenere storico, controlli backend, chiavi idempotenti, versioni concorrenti e isolamento aziendale. Non inserire password, token, database, backup o file `.env` nel repository.

## Passaggio di lavoro

Controllare `git status`, leggere README, questo documento e `docs/EMAIL.md`; aggiornare con `git pull --ff-only` quando il lavoro locale è salvato. Usare rami `codex/<argomento>`, eseguire i controlli pertinenti e salvare commit descrittivi. Con `git push` le modifiche diventano disponibili all'altro collaboratore. Evitare modifiche contemporanee sulla stessa copia e sullo stesso file.

Prompt suggerito: «Leggi README.md e docs/HANDOFF.md. Esamina lo stato Git e continua dalla versione corrente, conservando layout PDF, storico, isolamento delle imprese e test. Non pubblicare online né inviare email reali senza una richiesta esplicita.»
