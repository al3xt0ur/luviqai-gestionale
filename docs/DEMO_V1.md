# My Clean · Pacchetti ore

Demo locale realizzata da **luviqAI** per My Clean Multiservice. Interfaccia React e TypeScript, backend HTTP Node.js e database SQLite persistente. Tutti i testi e i flussi operativi sono in italiano.

## Avvio su Windows

Richiede **Node.js 24 LTS** e npm (incluso nell’installazione standard di Node). Da PowerShell nella cartella del progetto:

```powershell
npm.cmd install
npm.cmd run build
npm.cmd start
```

Aprire **http://localhost:3000**. Per ricompilare e avviare con un unico comando usare `npm.cmd run dev` (non è un server con hot reload). Arrestare con Ctrl+C. L’app serve esclusivamente sull’interfaccia locale 127.0.0.1 e non viene pubblicata online.

In questo ambiente le dipendenze sono state installate con pnpm; è incluso `pnpm-lock.yaml`. Per un’installazione riproducibile usare pnpm 11 e `pnpm install --frozen-lockfile`, quindi `pnpm run build` e `pnpm start`. Se npm non è nel PATH ma Node e le dipendenze sono già disponibili, si può avviare direttamente:

```powershell
node scripts/start.mjs
```

## Prova guidata

1. Nella **Panoramica**, osservare Casa Aurora con 4 ore residue e Condominio Magnolia con pagamento da confermare.
2. In **Interventi**, filtrare “Da approvare”: l’intervento di Studio Levante dura 150 minuti con 2 operatori, ma il pacchetto conta per squadra, quindi consuma 2,5 ore. “Approva” mostra prima il saldo risultante.
3. Rettificare l’intervento approvato con durata e motivazione; poi annullarlo con motivazione e verificare la restituzione delle ore.
4. Creare un intervento pianificato con data passata o attuale, completarlo con la durata effettiva e approvarlo. Gli appuntamenti futuri restano pianificati fino alla loro data e ora.
5. In **Pacchetti ore**, confermare il pagamento di Condominio Magnolia, creare un appuntamento e osservare le ore impegnate e libere. Provare una durata superiore alla disponibilità per vedere il blocco.
6. Rinnovare un pacchetto: ne viene creato uno nuovo, lasciando invariati i dati del precedente. Aprire una scheda in **Clienti** per vedere pacchetti, interventi e storico, oppure stampare il riepilogo / salvarlo in PDF dalla finestra di stampa del browser.
7. Consultare **Storico attività** ed esportare il CSV completo. Riavviare il server: tutte le modifiche rimangono.

## Database e backup

Il database si trova in **`data/myclean.sqlite`**, relativo alla cartella del progetto (anche quando il server parte da un’altra directory). SQLite può creare i file `myclean.sqlite-wal` e `myclean.sqlite-shm` durante l’uso. I dati dimostrativi vengono inseriti soltanto al primo avvio di un database nuovo. Non esiste un comando di reset automatico.

Per un backup coerente, **arrestare il server**, quindi copiare l’intera cartella `data` in un luogo sicuro. Per ripristinare, arrestare il server e sostituire l’intera cartella `data` con quella del backup. Non mescolare database e file WAL di backup diversi. L’esportazione CSV è un riepilogo per consultazione, non un backup ripristinabile.

È possibile scegliere un altro database con `$env:DB_PATH = 'C:\percorso\myclean.sqlite'` e una porta con `$env:PORT = '3001'` prima dell’avvio. Non eseguire più istanze sul database operativo durante backup o ripristino.

## Regole del saldo

- Tutte le quantità sono minuti interi. Le ore mostrate sono arrotondate a due decimali solo per la visualizzazione.
- Ogni pacchetto conserva taglio originario e saldo iniziale importato. I consumi visualizzati sono quelli registrati in questa app, successivi all’importazione.
- Conteggio immutabile per operatore (`durata × operatori`) oppure per squadra (`durata`).
- Pianificati e da approvare impegnano minuti; approvati li consumano; annullati non incidono sul saldo. Libere = iniziali − consumate − impegnate.
- Ogni modifica avviene in una transazione SQLite `BEGIN IMMEDIATE`. Il controllo della disponibilità include tutti gli altri impegni e addebiti.
- La chiave di idempotenza conserva il risultato delle richieste già eseguite; un controllo sullo stato impedisce la seconda approvazione anche con chiavi diverse. Rettifiche e annullamenti richiedono una motivazione e registrano prima/dopo.
- Le date dipendono dall’orologio del computer. Si inseriscono nell’ora locale, si salvano in UTC e si visualizzano nell’ora del browser.

## Verifiche

```powershell
npm.cmd test
npm.cmd run build
```

I test usano database temporanei separati e coprono regole di conteggio, importazione, pagamenti, disponibilità, completamento, vincolo sulle date future, approvazioni duplicate, rettifiche, annullamenti, rinnovi, audit e persistenza. Il test HTTP invia richieste concorrenti e verifica un riavvio reale del processo server. La porta 3137 deve essere libera per il test HTTP.

È incluso anche `tests/browser.mjs`, un percorso end-to-end con Playwright e Chrome che usa un database temporaneo sulla porta 3138. Con Playwright disponibile, eseguire `node tests/browser.mjs`; in alternativa passare come primo argomento il percorso assoluto al suo `index.mjs`. Produce schermate desktop/mobile e un PDF di prova in `test-results` (esclusa da Git). Verifica creazione/modifica cliente, importazione pacchetto, blocco disponibilità, completamento, approvazione, rettifica, annullamento, rinnovo ed esportazione CSV. Queste prove non alterano i quattro clienti della demo.

## Limiti della demo

Un solo responsabile locale, senza account, password o separazione di ruoli. L’autore dello storico è sempre “Responsabile locale”; questo non costituisce identificazione personale o audit certificato. Chi ha accesso al computer e al database può modificarli. Non esporre questa demo su Internet o su una rete condivisa senza una successiva fase di autenticazione, autorizzazione e messa in sicurezza.

Nessun collegamento a pagamenti, email o WhatsApp reali. I quattro clienti iniziali sono fittizi e usano indirizzi example.com. L’interfaccia si adatta agli schermi mobili, ma il server ascolta solo sul computer locale: non è accessibile da altri telefoni in rete. Non sono incluse sincronizzazione cloud, tariffe/fatture, ricorrenze o modifiche della pianificazione: un appuntamento errato si annulla con motivazione e si reinserisce. Non è prevista cancellazione dello storico.

I sorgenti sono conservati con Git locale; database, dipendenze, build e credenziali sono esclusi dal repository.
