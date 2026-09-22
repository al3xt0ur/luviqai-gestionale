# Processo di release luviqAI

## Ambienti

- `develop`: integrazione e sviluppo.
- staging: servizio Render separato collegato a `develop`, con database separato e dati fittizi.
- `main`: codice stabile destinato alla produzione.
- produzione: servizio Render attuale collegato a `main` e a `app.luviqai.it`.

## Flusso ordinario

1. Le modifiche vengono integrate in `develop`.
2. GitHub Actions esegue build e test su Linux e Windows.
3. Se la release introduce uno schema nuovo, si sospende l'auto-deploy, si completa backup/restore e si applica la migrazione esplicita sul database staging verificato.
4. Render staging pubblica `develop` o lo SHA candidato concordato.
5. Si verifica `/api/health.release` e si collaudano login, aziende, preventivi, fatture, PDF, email in preview, calendario, monitoraggio, privacy e AI.
6. Si apre una pull request `develop -> main`.
7. La PR deve superare i controlli automatici.
8. Solo dopo l'approvazione si effettua il merge.
9. Per la produzione si ripetono backup e predisposizione migrazione prima che Render distribuisca il nuovo `main`.

## Regole di sicurezza

- Staging e produzione non devono condividere `DATABASE_URL`.
- Staging usa `MAIL_MODE=preview`: nessuna email reale.
- Non copiare dati clienti reali nello staging.
- Non configurare nello staging chiavi SMTP/Resend operative.
- `APP_ORIGIN` e `PUBLIC_APP_URL` dello staging non devono mai essere `https://app.luviqai.it`.
- Prima di collegare Render, eseguire `pnpm run check:staging` con le variabili dello staging.
- Nessun deploy automatico deve partire da feature branch direttamente verso la produzione.
- Un health 200 senza lo SHA atteso non certifica la release collaudata.

## Rollback

In caso di problema dopo una release, individuare l'ultimo commit stabile di `main` e ripristinare quella versione tramite Git/Render. Non correggere manualmente i file direttamente sul server. Se è stata applicata una migrazione, il rollback del solo codice non equivale al rollback dei dati: verificare la compatibilità su un clone e usare il backup pre-migrazione solo con una procedura controllata.

## Passaggi amministrativi esterni da verificare

1. GitHub: rendere obbligatorie PR e verifiche CI su `main`.
2. Render: confermare secondo Web Service, branch e politica di auto-deploy.
3. Supabase: confermare tramite identificativo/host il progetto staging separato.
4. Render staging: ricontrollare le variabili basandosi su `config/staging.env.example`.
5. OVH/Render: verificare che `staging.luviqai.it` risolva verso il servizio corretto.
6. Render produzione: abilitare il deploy solo dopo controlli CI, quando disponibile/configurato.
