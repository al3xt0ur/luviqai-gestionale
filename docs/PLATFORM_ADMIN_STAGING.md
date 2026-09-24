# Platform admin — verifica staging

Branch: `codex/platform-admin-redesign`.

Riallineato tramite cherry-pick del redesign `c22d41e` sopra `develop` (`f982bdd`). Conservate le funzioni MFA con QR e sessioni attive nel profilo. Il calendario mantiene l’integrazione a eventi di develop, senza aggiungere voci nella sidebar globale.

Il redesign riusa colori, tipografia, sidebar, card e controlli del gestionale aziendale. Le cinque sezioni sono Home piattaforma, Aziende, Accessi, Monitoraggio e Registro. Privacy e relativo export si trovano nel Registro; invii e comunicazioni rimangono in Monitoraggio. Le azioni account e sospensione sono nel menu di ogni azienda.

Nessuna migrazione dati. I comandi amministrativi, i permessi, CSRF e il cambio contesto aziendale mantengono le API esistenti. L’endpoint di monitoraggio aggiunge soltanto metadati in lettura: ambiente, versione, commit e disponibilità delle copie locali. Il calendario si inserisce solo nella navigazione aziendale.

## Preparazione

- Integrare questo branch nel branch usato dallo staging (il processo di release corrente indica `develop`).
- Conservare la configurazione staging separata: database di test e `MAIL_MODE=preview`.
- Eseguire installazione con lockfile, `npm run build`, quindi `node server/index.mjs`.
- `RENDER_GIT_COMMIT` è letto dal monitoraggio; per altri ambienti usare `GIT_COMMIT`. Se assente, l’interfaccia mostra “Non disponibile”.
- I backup esterni non sono interrogati: con `BOOTSTRAP_DEMO=0` è indicata la gestione esterna da verificare. La presenza di una copia locale non certifica integrità o ripristinabilità.

Le modifiche di configurazione staging già presenti nella directory prima del redesign sono state preservate e non fanno parte del commit del pannello. Nessun deploy o cambiamento alla produzione viene eseguito da questa consegna.

## Collaudo

1. Accedere come amministratore globale e controllare KPI, priorità e attività recenti.
2. Cercare aziende per nome/codice; filtrare attive/sospese e verificare il caso senza risultati.
3. Aprire un’azienda, tornare al pannello e aprirne un’altra verificando il contesto.
4. Dal menu azienda verificare account, sospensione con motivazione e riattivazione.
5. Controllare profilo/password in Accessi; email simulate, servizi, backup, ambiente e commit in Monitoraggio.
6. Controllare storico e richieste privacy nel Registro; mantenere la verifica dell’identità prima dell’export.
7. Verificare tutte le sezioni a 390 px, navigazione da tastiera, Escape e focus nelle modali.

Comandi di validazione: `npm test`, `npm run build`, `node tests/browser-platform.mjs <percorso-playwright/index.mjs>`.
Il test browser usa solo database temporanei ed email simulate; verifica anche isolamento, cambio contesto, creazione, sospensione/riattivazione e divieto API ai responsabili. Screenshot in `test-results/` (esclusi da Git).

Per rollback ripristinare il precedente commit applicativo e ricostruire: non ci sono migrazioni da annullare.

## Verifica dopo il riallineamento

Build completata; 71 test superati; collaudo Chrome a 1440 px e 390 px superato. Il test browser verifica anche salvataggio profilo, configurazione QR MFA e visualizzazione della sessione corrente. Nessun merge su develop.
