# Percorso verso staging e deploy controllati

## Fase 1: controlli automatici

Il workflow `.github/workflows/ci.yml` compila TypeScript/Vite ed esegue la suite backend su Linux e Windows con Node 24 e pnpm fissato, usando `pnpm install --frozen-lockfile`. Parte sulle pull request verso `main`/`develop` e sui push dei rami indicati nel file. Non contiene segreti, deploy hook, migrazioni remote o passaggi che pubblicano l'app.

Su Windows: `npm.cmd run build` e `npm.cmd test`. Non occorre più disattivare manualmente DATABASE_URL. Il runner avvia i test con un ambiente ridotto e senza credenziali applicative. Ogni ingresso di test, inclusi i percorsi browser, importa la protezione anche quando avviato direttamente. I processi server figli ignorano `.env` e `.env.mail`; l'adattatore database rifiuta URL esterni e directory fuori dall'area temporanea quando `LUVIQ_TEST_MODE=1`.

Questa protezione previene l'uso accidentale della configurazione operativa; non è una sandbox per codice ostile. I test dei provider usano trasporti simulati. Non configurare `LUVIQ_TEST_MODE` su Render: serve soltanto ai test. Sul runner Linux la pipeline installa Chromium ed esegue `tests/browser-operations.mjs`; Linux e Windows eseguono build e suite backend. Non è ancora presente un test CI con un server PostgreSQL autonomo: PGlite esercita schema e RLS senza accesso a Supabase.

## Come leggere l'esito

GitHub → repository → Pull requests → proposta → Checks. Sono previsti due controlli: `Build e test (ubuntu-latest)` e `Build e test (windows-latest)`. Aprire il controllo fallito per leggere il passaggio e il log. Nessun artefatto con database, backup o configurazioni viene pubblicato.

La presenza del workflow non blocca da sola un merge: dopo il primo esito valido configurare nelle regole del repository una pull request obbligatoria e i due controlli richiesti su `main`. Verificare disponibilità delle regole con il piano GitHub utilizzato. Non usare `pull_request_target` per eseguire codice delle proposte con segreti.

Non unire automaticamente questa fase: verificare prima le impostazioni Render perché il merge su `main` può avviare il deploy esistente. Render e le protezioni GitHub non sono modificati dal workflow. Dopo aver attivato i controlli si può impostare su Render `After CI Checks Pass`; durante il passaggio usare deploy manuale se necessario per evitare pubblicazioni prima dell'esito.

## Configurazione da verificare prima di ogni collaudo

1. Confermare che il servizio Render staging segua `develop` o lo SHA candidato previsto e che non punti a `main`.
2. Confermare con identificativi di progetto/host che il database sia distinto dalla produzione. `pnpm run check:staging` valida forma e origini delle variabili, ma non dimostra l'identità del database.
3. Usare `NODE_ENV=production`, origini `https://staging.luviqai.it`, `MAIL_MODE=preview`, dati fittizi e nessuna chiave SMTP/Resend operativa.
4. Prima dello schema 20 eseguire un backup cifrato e il restore automatico; attendere il completamento del workflow. Il restore automatico usa PGlite e non sostituisce una prova periodica su un clone PostgreSQL.
5. Applicare `node scripts/database.mjs migrate` al database staging verificato **prima** dell'avvio del candidato. PostgreSQL esterno non viene migrato all'avvio.
6. Distribuire lo SHA candidato e verificare che `/api/health.release` coincida con lo SHA completo. Il controllo uptime pianificato verifica salute e database, non da solo l'identità della release.
7. Eseguire la matrice S01–S10 in `docs/PR1-VERIFICATION.md` e registrare gli esiti.

Produzione resta `main` → servizio Render esistente → `app.luviqai.it` → database Supabase operativo. Nessun dato o segreto deve essere copiato automaticamente nell'ambiente di test. La presenza del dominio staging nel repository non certifica che servizio, branch e variabili correnti siano corretti: vanno verificati nel pannello del provider.
