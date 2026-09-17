# Verifica della demo

## Sincronizzazione GitHub e Supabase — 17 settembre 2026

- Copia locale allineata con `origin/main` al commit `c3fa262`, incluse le modifiche di Sol alla gestione fatture.
- Connessione in sola lettura al progetto Supabase indicato verificata; schema versioni 1–7 e tabella fatture presenti. Nessuna migrazione o modifica ai dati eseguita durante questa verifica.
- Build TypeScript/Vite riuscita; suite esistente: 47 test superati, zero errori. Connessione remota esclusa esplicitamente durante i test con `DATABASE_URL` vuota; email in anteprima.
- Questa verifica non certifica un flusso completo delle nuove fatture: non sono presenti test dedicati alle fatture nella suite corrente.
- Backup precedente alla migrazione escluso da Git insieme a configurazioni riservate e database locali.

## Amministrazione piattaforma — 15 settembre 2026

Ripresa del 16 settembre: server locale riavviato e accesso dei due amministratori personali verificato sulle API effettive, senza cambiare le password iniziali. Entrambi vedono le due imprese esistenti.

- 25 verifiche automatiche superate, comprese le regressioni delle funzioni esistenti.
- Due amministratori equivalenti, separati dai responsabili aziendali. Le API amministrative rifiutano utenti non autorizzati e i tentativi di promozione al ruolo globale.
- Accesso a più imprese mantenendo identità e storico dell’amministratore, con RLS attiva sulle operazioni aziendali.
- Sospensione/riattivazione imprese, revoca sessioni, reset delle password aziendali senza esposizione delle password nello storico, modifica profilo e password personali verificati.
- Percorso browser dedicato completato: login di entrambi gli admin, nuova impresa, modifica cliente, cambio impresa, sospensione/riattivazione, interfaccia mobile. Richieste da scheda vecchia respinte per token CSRF o contesto aziendale non coerente.
- Build TypeScript e Vite riuscita. Schermate in test-results/piattaforma-admin.png e test-results/piattaforma-mobile.png, escluse da Git.

## Prima consegna per più imprese — 15 settembre 2026

- 19 verifiche automatiche superate fra test principali e sottotest, usando PostgreSQL/PGlite e il database SQLite storico per le regressioni di importazione.
- Isolamento verificato attraverso sessioni, API e query RLS senza filtro: aziende con ID cliente sovrapposti restano separate. Tentativi di alterare tenant_id e riferimenti ad altre imprese respinti.
- Password con hash e salt, sessioni revocate alla disattivazione/cambio password, recupero monouso, limite tentativi e controllo CSRF verificati.
- Approvazioni duplicate concorrenti: un solo addebito e una sola voce di storico. Inserimenti concorrenti rispettano la disponibilità.
- Processo HTTP arrestato e riavviato: saldi, storico, sessioni e idempotenza conservati.
- Backup logico ripristinato in un nuovo database, saldi/storico/account confrontati e coincidenti; backup alterato e ripristino sopra dati esistenti rifiutati.
- Due percorsi browser Chrome completati: flusso completo pacchetti/interventi, login, archivio e ripristino, personalizzazione azienda, creazione operatore, uscita e isolamento seconda impresa. Nessun errore JavaScript rilevato.
- Controlli desktop e mobile a 390 px completati; schermate in test-results, esclusa da Git.
- Build TypeScript/Vite riuscita. Nessuna verifica su PostgreSQL remoto: hosting non ancora scelto e lavoro mantenuto locale su richiesta dell’utente.

## Prima demo SQLite — riferimento storico

Eseguita il 14 settembre 2026 con Node.js 24.19.0 su Windows.

- Compilazione TypeScript senza errori e build Vite riuscita.
- 9 test automatici superati: conteggio operatore/squadra, minuti interi, importazione, pagamento, disponibilità, idempotenza, rettifiche, annullamenti, completamento e date future, rinnovo, storico e persistenza.
- Test HTTP: 12 richieste di approvazione simultanee con la stessa chiave producono un solo addebito e una sola voce di storico; 8 successive con chiavi diverse sono respinte. Su 6 richieste simultanee per la stessa disponibilità, una sola viene accettata.
- Riavvio reale del processo: dati e chiavi idempotenti conservati, senza nuova inizializzazione della demo.
- Percorso nel browser Chrome completato: creazione e modifica cliente, importazione di 60 minuti, rifiuto di intervento oltre disponibilità, pianificazione, completamento, approvazione, rettifica motivata, annullamento con restituzione, rinnovo e download CSV.
- Interfaccia controllata a 1440 px e 390 px; nessuno sconfinamento orizzontale della pagina mobile e nessun errore JavaScript. Tabelle scorrevoli orizzontalmente su telefono.
- Riepilogo cliente generato in PDF tramite il motore di stampa del browser.

Le prove usano database temporanei isolati. I file di prova visuali sono in `test-results`, esclusi dal repository. La demo operativa rimane con i quattro clienti fittizi iniziali.
