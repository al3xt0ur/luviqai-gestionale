# Percorso verso staging e deploy controllati

## Fase 1: controlli automatici

Il workflow `.github/workflows/ci.yml` compila TypeScript/Vite ed esegue la suite backend su Linux e Windows con Node 24 e pnpm fissato, usando `pnpm install --frozen-lockfile`. Parte sulle pull request verso `main`/`develop` e sui push dei rami indicati nel file. Non contiene segreti, deploy hook, migrazioni remote o passaggi che pubblicano l'app.

Su Windows: `npm.cmd run build` e `npm.cmd test`. Non occorre più disattivare manualmente DATABASE_URL. Il runner avvia i test con un ambiente ridotto e senza credenziali applicative. Ogni ingresso di test, inclusi i percorsi browser, importa la protezione anche quando avviato direttamente. I processi server figli ignorano `.env` e `.env.mail`; l'adattatore database rifiuta URL esterni e directory fuori dall'area temporanea quando `LUVIQ_TEST_MODE=1`.

Questa protezione previene l'uso accidentale della configurazione operativa; non è una sandbox per codice ostile. I test dei provider usano trasporti simulati. Non configurare `LUVIQ_TEST_MODE` su Render: serve soltanto ai test. La pipeline non esegue ancora browser test né integrazione con un server PostgreSQL autonomo; PGlite esercita schema e RLS senza accesso a Supabase.

## Come leggere l'esito

GitHub → repository → Pull requests → proposta → Checks. Sono previsti due controlli: `Build e test (ubuntu-latest)` e `Build e test (windows-latest)`. Aprire il controllo fallito per leggere il passaggio e il log. Nessun artefatto con database, backup o configurazioni viene pubblicato.

La presenza del workflow non blocca da sola un merge: dopo il primo esito valido configurare nelle regole del repository una pull request obbligatoria e i due controlli richiesti su `main`. Verificare disponibilità delle regole con il piano GitHub utilizzato. Non usare `pull_request_target` per eseguire codice delle proposte con segreti.

Non unire automaticamente questa fase: verificare prima le impostazioni Render perché il merge su `main` può avviare il deploy esistente. Render e le protezioni GitHub non sono modificati dal workflow. Dopo aver attivato i controlli si può impostare su Render `After CI Checks Pass`; durante il passaggio usare deploy manuale se necessario per evitare pubblicazioni prima dell'esito.

## Fasi successive, ancora da configurare

1. Un solo ramo di integrazione `develop`, servizio Render separato e progetto Supabase di test con soli dati fittizi.
2. `NODE_ENV=production` anche in staging, origini HTTPS dell'ambiente di test, `MAIL_MODE=preview`, nessuna chiave Resend operativa.
3. Inizialmente usare l'indirizzo Render del nuovo servizio. Il record OVH `test.luviqai.it` non è ancora creato: aggiungerlo successivamente usando il valore esatto fornito da Render.
4. Consolidare migrazioni, backup esterni e prove di ripristino; includere le nuove richieste privacy nel backup applicativo.
5. Estendere i controlli ai moduli recenti e a PostgreSQL reale, aggiungere controlli di disponibilità e monitoraggio esterno.

Produzione resta `main` → servizio Render esistente → `app.luviqai.it` → database Supabase operativo. Nessun dato o segreto deve essere copiato automaticamente nell'ambiente di test.
