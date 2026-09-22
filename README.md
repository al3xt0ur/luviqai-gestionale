# Verifica PR operativa

Per le modifiche in questo ramo, migrazione esplicita a schema 20 e collaudo, vedere [PR #1 — verifica operativa](docs/PR1-VERIFICATION.md). Le sezioni storiche sotto non sostituiscono questa procedura.

# luviqAI · Gestionale servizi

Per il nuovo percorso di sviluppo con test isolati, controlli GitHub e staging consultare [Staging e controlli automatici](docs/STAGING.md). `npm.cmd test` isola automaticamente la configurazione operativa.

Prima consegna della versione rivendibile a più imprese. My Clean è la prima azienda configurata. React + TypeScript, backend Node.js, PostgreSQL. Il codice è condiviso su GitHub e il database operativo è PostgreSQL su Supabase. L’applicazione viene avviata localmente; non è stato attivato un incasso automatico.

## Avvio su Windows

Per riprendere il progetto da GitHub o con un altro modello, leggere anche [Guida al passaggio di lavoro](docs/HANDOFF.md). Git trasferisce codice e cronologia; dati e accessi locali restano separati.

Richiede Node.js 24. Per un’installazione riproducibile: `pnpm install --frozen-lockfile` con pnpm 11. In alternativa è possibile usare `npm.cmd install`.

```powershell
npm.cmd run build
npm.cmd start
```

Aprire **http://localhost:3000**. Con Node e dipendenze già disponibili si può usare direttamente `node scripts/start.mjs`, che ricompila e avvia. Non dispone di hot reload. Arrestare con Ctrl+C.

Il database operativo usa Supabase, progetto `yxothpsgfddmcqawgzhx`, tramite `DATABASE_URL` nel file riservato `.env`. Il server carica `.env` e poi `.env.mail`. La connessione è stata verificata in sola lettura il 17 settembre 2026. PGlite resta disponibile quando `DATABASE_URL` è assente, per nuove prove locali e test isolati. Per lavorare sul database condiviso verificare sempre che la configurazione Supabase sia presente.

## Accessi personali

Al primo avvio locale vengono create due imprese separate:

- `my-clean`: My Clean Multiservice, con i dati importati dalla precedente demo SQLite se il file locale esiste; in una nuova copia del repository parte vuota.
- `impresa-demo`: seconda impresa, inizialmente vuota, utile per verificare la separazione dei dati.

Le password sono generate casualmente e salvate una sola volta in **`data/accessi-locali.txt`**, escluso da Git. Il file contiene due responsabili e un operatore di prova per My Clean. Non pubblicarlo. Gli account hanno password diverse anche quando l’email dimostrativa coincide.

Nella schermata di accesso inserire codice azienda, email e password. Per cambiare impresa occorre uscire e autenticarsi con l’altro account. Non esiste un selettore che simula ruoli o isolamento.

Da **Azienda e account** il responsabile può modificare nome, colore, sigla del logo e recapiti aziendali, creare account responsabile/operatore e disattivarli. Le disattivazioni invalidano le sessioni. Ogni utente può cambiare la propria password; la modifica richiede quella attuale e chiude le sessioni precedenti.

## Cosa provare

### Amministratori luviqAI

Sono disponibili due account personali di **amministratore della piattaforma**, separati dai responsabili delle imprese. Per accedere usare codice **`luviqai`**, la propria email e la password iniziale nel file riservato **`data/accessi-amministratori.txt`**. Se si è già dentro un’impresa, uscire prima di accedere con l’account amministrativo. Nessuna email viene inviata da questa funzione.

Entrambi gli amministratori possono:

- Vedere tutte le imprese e creare una nuova impresa con il suo primo responsabile.
- Sospendere/riattivare un’impresa senza perdere dati; la sospensione chiude le sessioni dei suoi utenti.
- Aprire qualunque impresa e usare tutte le funzioni esistenti: clienti, pacchetti, interventi, approvazioni, rettifiche, archiviazione, export e identità aziendale.
- Creare/disattivare gli account aziendali dentro “Azienda e account”, oppure reimpostarne la password dal pannello globale con motivazione e revoca delle vecchie sessioni.
- Modificare il proprio nome, email e password. Le password degli altri utenti non sono visibili.

Il banner amministrativo identifica l’impresa su cui si sta operando. “Tutte le imprese” riporta al pannello globale. Gli amministratori agiscono con la propria identità: le modifiche compaiono nello storico aziendale con nome e ID reali dell’autore. Gli accessi alle imprese, le sospensioni e i reset compaiono anche nel registro amministrativo (ultime 200 voci mostrate, conservazione integrale nel database e nei backup).

Il cambio impresa rinnova il token CSRF; le richieste amministrative richiedono anche un contesto aziendale coerente. Una scheda rimasta aperta sull’impresa precedente viene bloccata e deve essere ricaricata. I normali responsabili non possono selezionare un’altra impresa, accedere alle API globali o creare ruoli amministrativi.

Per una nuova installazione, a server locale fermo: `node scripts/admins.mjs`. Il comando chiede nome/email dei due amministratori e genera password casuali nel file riservato; rifiuta una seconda inizializzazione. Non concedere il ruolo `platform_admin` agli utenti delle aziende. “Possibilità di fare tutto” riguarda le funzioni implementate: non comprende eliminazione definitiva dello storico né funzioni future non ancora sviluppate.

### Operatività aziendale

1. Accedere a My Clean e verificare clienti, saldi e storico importati.
2. Creare un intervento e assegnarlo a un account operatore tramite il campo dedicato. Il nome libero della squadra non assegna permessi.
3. Accedere come operatore: sono visibili solo gli interventi assegnati e i relativi clienti/pacchetti. L’operatore può inserire la durata effettiva e completare l’intervento, ma non approvare, modificare clienti, confermare pagamenti o esportare dati.
4. Accedere come responsabile e approvare: vedere le ore da scalare e il saldo risultante. Provare rettifica motivata e annullamento.
5. Creare un cliente senza pacchetti, archiviarlo con motivazione, trovarlo nel filtro Archiviati e ripristinarlo. L’archiviazione è bloccata in presenza di ore residue, anche su pacchetti non pagati, o interventi aperti.
6. Ripianificare un intervento pianificato indicando nuova data e motivo. Le ore rimangono impegnate.
7. Uscire e accedere a impresa-demo: nessun dato di My Clean è visibile. Provare a personalizzare la seconda impresa.
8. Stampare una scheda cliente oppure esportare il CSV: contiene solo i dati della propria impresa.

## Catalogo pacchetti configurabile

Aprire **Pacchetti ore → Configura catalogo → Nuovo modello**. Ogni impresa gestisce il proprio catalogo, senza nomi o tagli obbligatori: nome, descrizione, ore intere e minuti aggiuntivi, conteggio per operatore o squadra. Quantità da 1 minuto a 10.000 ore. Le nuove imprese partono con il catalogo vuoto; My Clean conserva le offerte ricavate dai suoi pacchetti precedenti. Se lo stesso nome aveva più regole o tagli, vengono creati modelli distinti con una specificazione nel nome, modificabile.

Per assegnare un pacchetto, tornare a **Pacchetti assegnati → Nuovo pacchetto**, scegliere cliente e modello, eventuale saldo iniziale ridotto e conferma del pagamento. Nome, descrizione, taglio e regola vengono copiati nel pacchetto e rimangono immutabili. Modificare il catalogo non ricalcola disponibilità, interventi o saldi dei pacchetti già venduti.

Le modifiche e la disattivazione/riattivazione richiedono una motivazione, registrata con autore e valori precedenti/nuovi nello storico. I modelli disattivati non sono selezionabili per nuove assegnazioni o rinnovi; i pacchetti già assegnati restano utilizzabili. Il rinnovo crea un nuovo pacchetto alle condizioni attuali del modello selezionato, mostrate nel modulo, e conserva il precedente. Se il vecchio modello è disattivato, occorre sceglierne esplicitamente un altro.

Il server valida la versione del modello: una modifica concorrente impedisce di assegnare condizioni superate. Chiudere e riaprire il modulo dopo il messaggio per controllare i dati aggiornati. Responsabili e amministratori luviqAI possono configurare il catalogo; gli operatori non possono farlo. Il catalogo è incluso in backup e CSV e protetto dalle stesse regole di isolamento delle imprese. I backup precedenti al catalogo restano ripristinabili: i modelli vengono ricavati dai pacchetti restaurati.

Questa configurazione riguarda i pacchetti di ore venduti dalle imprese ai propri clienti. Prezzi, IVA, fatturazione e abbonamenti mensili alla piattaforma saranno gestiti nelle rispettive fasi successive.

## Gestione preventivi

La sezione **Preventivi** consente di creare proposte commerciali per i clienti dell’impresa. Sono accessibili anche dalla scheda cliente. Responsabili e amministratori luviqAI possono gestirli; gli operatori non vedono preventivi o importi.

1. **Nuovo preventivo**: scegliere cliente, oggetto, data e validità; aggiungere fino a 30 voci con quantità, prezzo unitario netto, sconto percentuale e IVA. È possibile copiare una descrizione dal catalogo pacchetti, poi indicare il prezzo concordato. Aggiungere condizioni e note.
2. **Salva bozza**: il backend calcola imponibile, IVA e totale. La numerazione è automatica e distinta per impresa (PRE-anno iniziale-progressivo aziendale); il progressivo non viene azzerato annualmente. Le bozze si possono modificare con una motivazione, conservando ogni versione nello storico.
3. **Scarica PDF / Stampa**: genera il PDF sul backend e lo scarica direttamente, anche senza la finestra di stampa del browser integrato. Aprire il file scaricato e scegliere Stampa nel lettore PDF. Il download richiede la sessione autenticata e rispetta l’isolamento tra imprese. Il documento conserva la copia di anagrafica cliente e azienda registrata all’ultimo salvataggio della bozza. Per aggiornare i recapiti prima dell’invio, salvare nuovamente la bozza. Le modifiche successive alle anagrafiche non riscrivono documenti già inviati.
4. **Registra invio**: conferma manualmente una consegna già effettuata e blocca le modifiche al contenuto. Nessuna email o messaggio viene inviato. Sono richiesti una motivazione o un riferimento e una validità corrente.
5. **Registra accettazione / rifiuto**: registra la risposta ricevuta dal cliente. Un preventivo scaduto non può essere accettato. L’accettazione non crea automaticamente pacchetti, pagamenti, interventi o fatture. È disponibile anche l’invio email con pagina di risposta: vedere docs/EMAIL.md.
6. **Duplica preventivo**: prepara una nuova bozza con nuovo numero, nuove date e riferimento al precedente. Consente di riformulare anche offerte rifiutate o annullate. Le condizioni sono ricopiate dal documento originale e possono essere modificate prima del salvataggio.

Stati disponibili: bozza, inviato, accettato, rifiutato, annullato. Lo stato “scaduto” è segnalato sui preventivi inviati oltre la validità. L’annullamento è motivato e conserva il documento. Non è disponibile la cancellazione definitiva. Filtri e ricerca trovano numero, cliente e oggetto. CSV, backup e ripristino includono tutti i preventivi e lo storico.

Gli importi sono salvati in centesimi interi, le quantità in centesimi di unità, aliquote e sconti in centesimi di punto percentuale. Arrotondamento commerciale per riga: importo quantità × prezzo al centesimo, poi sconto al centesimo, poi IVA al centesimo; i totali sommano le righe. Le aliquote sono indicate dall’utente, senza suggerire automaticamente il trattamento fiscale. I preventivi commerciali sono in EUR e possono essere inviati via email secondo la configurazione descritta in docs/EMAIL.md. La sezione Fatture gestisce bozze, emissione interna, annullamento, scadenze, registrazione del pagamento e PDF; può partire da un preventivo accettato. Non sono implementati invio SDI, regimi fiscali automatici, ritenute, bollo o firma elettronica.

## Database e migrazione

Per logo aziendale, email con PDF, risposta cliente e configurazione Gmail consultare [Email e notifiche](docs/EMAIL.md). La modalità corrente è simulazione locale, senza invii reali. Il layout del PDF rivisto con Sol è stato mantenuto.

- Database corrente: **Supabase**, progetto `yxothpsgfddmcqawgzhx`. Credenziali esclusivamente nella configurazione riservata.
- Database locale precedente: **`data/postgres/`**, conservato come copia storica; non sincronizzato automaticamente con Supabase.
- Database precedente: **`data/myclean.sqlite`**, conservato e aperto in sola lettura per l’importazione.
- L’importazione mantiene ID, dati cliente, pacchetti, minuti, stato degli interventi e storico. Un marcatore impedisce la seconda importazione.
- Il vecchio file SQLite non riceve più aggiornamenti. Non avviare una vecchia versione dell’app dopo il passaggio.
- Password e sessioni non vengono salvate in chiaro nel database: password con scrypt e salt, token di sessione sotto hash. Le sessioni scadono dopo 8 ore.
- Un file di blocco impedisce a due processi PGlite di aprire la stessa cartella. **Fermare il server prima dei comandi di amministrazione locali.** Non cancellare un blocco mentre il processo è attivo.

Le quantità restano minuti interi; pianificati e da approvare impegnano disponibilità, approvati la consumano. Le modifiche serializzano per impresa tramite transazione e blocco della relativa riga. Chiavi idempotenti distinte per azienda e autore impediscono ripetizioni. I vincoli composti impediscono riferimenti fra imprese.

Le operazioni aziendali usano un ruolo PostgreSQL senza privilegi di proprietario e policy Row Level Security. L’azienda deriva dalla sessione, mai dal browser. I servizi di autenticazione, amministrazione e backup usano il collegamento amministrativo: non sono esposti come query generiche al client.

## Backup e ripristino

Il server crea un backup logico all’avvio e ogni 24 ore **mentre rimane acceso**, in `data/backups/`. La scrittura è atomica; il contenuto ha un checksum di integrità. I backup includono tutte le imprese, hash delle password, storico e chiavi idempotenti. Non includono sessioni attive o link di recupero. Il checksum rileva alterazioni accidentali, non costituisce una firma contro manomissioni intenzionali.

I file non vengono cancellati automaticamente. Controllare lo spazio e copiare periodicamente i backup su un supporto separato: una copia sullo stesso computer non protegge dalla perdita del dispositivo. Questi file sono riservati e non sono scaricabili dalle API delle imprese.

Backup manuale, a server locale arrestato:

```powershell
node scripts/database.mjs backup data/backups/manuale.json
```

Ripristino di prova in una nuova cartella vuota:

```powershell
$env:PGLITE_PATH = "$PWD\data\postgres-ripristino"
node scripts/database.mjs restore data/backups/manuale.json
node server/index.mjs
```

Il ripristino rifiuta un database che contiene già imprese. Le password restano quelle del backup; occorre effettuare nuovamente il login. Per tornare al database standard, arrestare e usare `Remove-Item Env:PGLITE_PATH` prima del successivo avvio.

Il medesimo backup logico può alimentare un PostgreSQL esterno vuoto configurando `DATABASE_URL`: schema e vincoli vengono creati prima dell’importazione. La migrazione operativa a Supabase è stata effettuata; non ripetere il ripristino sul database condiviso. Gli script amministrativi leggono le variabili del processo: per usare la configurazione `.env`, avviarli con `node --env-file=.env scripts/database.mjs ...`.

## Creazione impresa e recupero password

I comandi sono riservati al gestore della piattaforma e vanno eseguiti dopo aver arrestato il server PGlite:

```powershell
node scripts/accounts.mjs create
node scripts/accounts.mjs reset
```

`create` chiede codice azienda, email e nome; scrive una password casuale in `data/nuovo-account.txt`. `reset` chiede codice azienda ed email e scrive un link monouso valido 30 minuti in `data/recupero-accesso.txt`. Riavviare il server e aprire il link. Nessuna email viene inviata. Comunicare password e link solo al destinatario; il collegamento recupero revoca tutte le vecchie sessioni quando viene utilizzato.

## Preparazione per hosting

Non è avvenuta alcuna pubblicazione. Le impostazioni già previste sono:

- `DATABASE_URL`: connessione PostgreSQL con credenziali conservate nell’ambiente, mai nei sorgenti. Il collegamento per la migrazione deve poter creare tabelle e il ruolo `luviq_tenant`.
- `APP_ORIGIN`: URL pubblico esatto. In produzione deve essere HTTPS.
- `NODE_ENV=production`: richiede PostgreSQL esterno e HTTPS; disattiva la creazione automatica di aziende demo e aggiunge Secure ai cookie.
- `PORT`: porta del backend. In locale il server ascolta solo su 127.0.0.1; in produzione su 0.0.0.0 dietro HTTPS/reverse proxy.
- `BOOTSTRAP_DEMO=0`: disattiva inizializzazione demo e backup periodici incorporati, utile per test o gestione backup esterna.

Prima di pubblicare restano la scelta dell’hosting, verifica TLS della connessione database, configurazione proxy/monitoraggio, backup su supporto esterno e revisione di sicurezza. Il recupero email self-service e MFA non sono implementati. Il limite dei tentativi IP usa l’indirizzo della connessione diretta: dietro un proxy va configurato un limite al perimetro prima dell’uso pubblico.

## Test

```powershell
npm.cmd test
npm.cmd run build
```

La suite comprende regressioni SQLite per l’importazione e test PostgreSQL/PGlite di isolamento RLS, saldi, richieste concorrenti, ruoli, sessioni, recupero password, archiviazione, catalogo personalizzato, versioni concorrenti, disattivazione, rinnovi e backup/ripristino. Il test HTTP verifica un riavvio reale sulla porta 3137.

Con Playwright e Chrome disponibili:

```powershell
node tests/browser.mjs
node tests/browser-accounts.mjs
node tests/browser-platform.mjs
node tests/browser-quotes.mjs
```

È possibile passare come primo argomento il percorso del modulo `playwright/index.mjs`. Le prove browser usano la porta 3138 e database temporanei; le schermate e il PDF dimostrativo vengono salvati in `test-results/`, esclusa da Git.

## Fasi successive

È disponibile una prima versione di **Assistente AI**: consultazioni rapide, ricerca clienti e preparazione di bozze di preventivo con conferma. Il testo libero richiede una chiave OpenRouter privata; configurazione, limiti e trattamento dei dati sono descritti in [Assistente AI](docs/AI.md). Non esegue invii, pagamenti o approvazioni automatiche.

Fatturazione elettronica, conversione automatica dei preventivi accettati in pacchetti, assistente AI operativo, account clienti e abbonamenti luviqAI non sono ancora implementati. Questa consegna prepara la base per più imprese e consolida i pacchetti ore. Il nome commerciale definitivo è ancora da scegliere; per ora è usato “luviqAI · Gestionale servizi”. La documentazione della prima demo è conservata in `docs/DEMO_V1.md` solo come riferimento storico.
