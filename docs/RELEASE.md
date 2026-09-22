# Processo di release luviqAI

## Ambienti

- `develop`: integrazione e sviluppo.
- staging: servizio Render separato collegato a `develop`, con database separato e dati fittizi.
- `main`: codice stabile destinato alla produzione.
- produzione: servizio Render attuale collegato a `main` e a `app.luviqai.it`.

## Flusso ordinario

1. Le modifiche vengono integrate in `develop`.
2. GitHub Actions esegue build e test su Linux e Windows.
3. Render staging pubblica `develop`.
4. Si verificano manualmente login, aziende, preventivi, fatture, PDF, email in preview, calendario, monitoraggio, privacy e AI.
5. Si apre una pull request `develop -> main`.
6. La PR deve superare i controlli automatici.
7. Solo dopo l'approvazione si effettua il merge.
8. Render produzione distribuisce il nuovo `main`.

## Regole di sicurezza

- Staging e produzione non devono condividere `DATABASE_URL`.
- Staging usa `MAIL_MODE=preview`: nessuna email reale.
- Non copiare dati clienti reali nello staging.
- Non configurare nello staging chiavi SMTP/Resend operative.
- `APP_ORIGIN` e `PUBLIC_APP_URL` dello staging non devono mai essere `https://app.luviqai.it`.
- Prima di collegare Render, eseguire `pnpm run check:staging` con le variabili dello staging.
- Nessun deploy automatico deve partire da feature branch direttamente verso la produzione.

## Rollback

In caso di problema dopo una release, individuare l'ultimo commit stabile di `main` e ripristinare quella versione tramite Git/Render. Non correggere manualmente i file direttamente sul server.

## Passaggi amministrativi esterni ancora necessari

1. GitHub: rendere obbligatorie PR e verifiche CI su `main`.
2. Render: creare un secondo Web Service collegato a `develop`.
3. Supabase: creare un database/progetto staging separato.
4. Render staging: inserire le variabili basandosi su `config/staging.env.example`.
5. OVH: quando lo staging Render funziona, creare il sottodominio `staging.luviqai.it` (o `test.luviqai.it`) con il target indicato da Render.
6. Render produzione: abilitare il deploy solo dopo controlli CI, quando disponibile/configurato.
