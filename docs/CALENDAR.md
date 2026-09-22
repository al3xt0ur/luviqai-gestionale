# Calendario operativo

Il calendario usa gli interventi gia presenti nel gestionale; non introduce una seconda fonte dati.

Funzioni attuali:
- viste mese, settimana e giorno;
- filtri per cliente, squadra/operatore, account operatore e stato;
- creazione di un nuovo intervento dal giorno selezionato con data precompilata;
- drag & drop degli interventi pianificati per ripianificarli mantenendo l'orario;
- controllo server-side delle sovrapposizioni per squadre e account operatore assegnati durante creazione, ricorrenza e ripianificazione;
- evidenza visiva dei conflitti gia presenti;
- dettaglio intervento con operatore assegnato e collegamento alla sezione Interventi.

Il drag & drop richiama `/api/reschedule`, quindi conserva audit, idempotenza,
autorizzazioni, isolamento aziendale e controllo conflitti. Gli interventi non
pianificati non sono trascinabili.

Esistono due percorsi compatibili per le serie:

- la ricorrenza dell'intervento esistente, settimanale o mensile, con uno o più operatori;
- le serie del candidato PR #1, settimanali o bisettimanali, collegate a squadra,
  pacchetto pagato e registro operativo dedicato.

Le serie storiche non vengono migrate automaticamente nel nuovo registro. Prima
di unificare i due modelli servono una migrazione dedicata e prove di
retrocompatibilità; fino ad allora l'interfaccia indica quale percorso gestisce
la serie.
