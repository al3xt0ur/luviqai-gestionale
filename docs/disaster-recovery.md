# Disaster recovery — backup LuviqAI

## Obiettivo

Il backup applicativo viene esportato dal database, cifrato **prima** di essere caricato come artifact esterno e poi ripristinato in un database temporaneo per verificare che sia realmente utilizzabile.

La prima attivazione riguarda esclusivamente lo **staging**. La produzione va abilitata solo dopo una prova completa e con segreti separati.

## Segreti GitHub necessari

- `STAGING_DATABASE_URL`: stringa di connessione del database Supabase di staging.
- `BACKUP_ENCRYPTION_KEY`: chiave casuale di 32 byte codificata base64url.

La chiave di cifratura non deve essere salvata nel repository, nei log o insieme al backup. Se viene persa, il backup cifrato non è recuperabile.

## Procedura

Il workflow **Backup staging cifrato**:

1. legge il database staging in transazione consistente;
2. crea il backup JSON applicativo con checksum;
3. cifra il file con AES-256-GCM;
4. elimina il file in chiaro;
5. decifra il backup in una directory temporanea;
6. esegue le migrazioni su un database PGlite vuoto;
7. prova il restore completo;
8. carica su GitHub Actions soltanto il file cifrato.

I backup staging restano disponibili come artifact per 7 giorni.

## Limiti e segreti applicativi

Il backup contiene dati applicativi, hash password e segreti MFA **già cifrati nel database**, ma non contiene le variabili d'ambiente del servizio. Per un disaster recovery completo devono essere conservate separatamente e in modo sicuro almeno le chiavi applicative stabili, in particolare `MFA_SECRET_KEY` e le credenziali dei servizi esterni.

## Produzione

Non usare automaticamente questo workflow contro la produzione. Prima:
- completare una prova su staging;
- definire retention e destinazione esterna di lungo periodo;
- usare una `BACKUP_ENCRYPTION_KEY` distinta e stabile;
- documentare dove sono custodite le variabili d'ambiente necessarie al ripristino.
