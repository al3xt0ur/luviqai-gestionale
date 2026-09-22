# LuviqAI Market Ready — modello operativo

Questo documento descrive l'architettura obiettivo. Commesse, interventi,
rapportini e fatture sono presenti nella base integrata, ma il ciclo completo
non è ancora un'unica automazione: creazione della commessa, conversione in
pacchetto, fatturazione e incasso restano azioni distinte e confermate.

## Obiettivo

LuviqAI deve coprire un ciclo operativo completo per piccole aziende di servizi:

Cliente → Preventivo → Commessa → Interventi → Rapportino → Fattura → Incasso → Rinnovo

I pacchetti ore restano una modalità contrattuale distintiva, non il contenitore principale di tutto il flusso.

## Entità principali

### Cliente
Anagrafica unica del committente. Può avere più sedi operative, contatti, preventivi, commesse, pacchetti, interventi e fatture.

### Preventivo
Documento commerciale pre-vendita. Stati: bozza, inviato, accettato, rifiutato, annullato, scaduto.

Un preventivo accettato può generare:
- una commessa standard;
- una commessa collegata a pacchetto ore;
- una fattura/acconto, se richiesto.

### Commessa
Nuova entità centrale del ciclo operativo.

Contiene:
- cliente;
- titolo e descrizione;
- sede operativa;
- stato;
- origine del lavoro;
- preventivo sorgente opzionale;
- pacchetto ore opzionale;
- responsabile;
- date pianificate;
- valore commerciale;
- note interne;
- interventi collegati;
- allegati;
- checklist;
- rapportini;
- fatture collegate.

Stati iniziali proposti:
- draft
- planned
- active
- completed
- cancelled

### Contratto a pacchetto ore
Un pacchetto ore continua a rappresentare un monte ore acquistato dal cliente.

Può finanziare una o più commesse/interventi.
Le ore:
- acquistate;
- consumate;
- impegnate;
- libere;
restano tracciate come oggi.

### Intervento
Unità schedulabile della commessa.

Deve poter gestire:
- inizio/fine;
- durata prevista ed effettiva;
- uno o più operatori;
- sede;
- checklist;
- foto/allegati;
- note;
- firma cliente;
- stato operativo;
- ore imputate;
- eventuali costi.

### Rapportino
Documento consuntivo dell'intervento:
- data;
- operatori;
- attività svolte;
- tempo;
- checklist;
- foto;
- note;
- firma;
- PDF.

### Fattura
Documento amministrativo collegabile a:
- preventivo;
- commessa;
- pacchetto;
- intervento/rapportino.

La fattura elettronica verrà delegata a un provider esterno.

### Incasso
Evento economico separato dalla fattura:
- importo;
- data;
- metodo;
- riferimento;
- stato;
- provider pagamento opzionale.

## Principi architetturali

1. Nessuna cancellazione distruttiva per dati contabili o operativi critici.
2. Ogni transizione significativa è auditata.
3. L'azienda deriva sempre dalla sessione.
4. Le azioni AI propongono; un umano conferma prima di mutazioni sensibili.
5. Staging e produzione restano completamente separati.
6. Le nuove funzioni devono essere progettate mobile-first per l'operatore.
7. La commessa diventa il contenitore operativo centrale, senza rompere i pacchetti esistenti.

## Compatibilità con il modello attuale

La prima introduzione di `jobs`/commesse deve essere retrocompatibile:
- gli interventi esistenti possono inizialmente avere `job_id = NULL`;
- nessun saldo pacchetto viene ricalcolato;
- preventivi e fatture esistenti restano validi;
- la migrazione non modifica documenti storici;
- il nuovo flusso viene introdotto gradualmente.
