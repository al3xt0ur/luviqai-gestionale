# Calendario operativo

Il calendario usa gli interventi gia presenti nel gestionale; non introduce una seconda fonte dati.

Funzioni attuali:
- viste mese, settimana e giorno;
- filtri per cliente, squadra/operatore e stato;
- creazione di un nuovo intervento dal giorno selezionato con data precompilata;
- drag & drop degli interventi pianificati per ripianificarli mantenendo l'orario;
- controllo backend delle sovrapposizioni per lo stesso account operatore assegnato;
- evidenza visiva dei conflitti gia presenti;
- dettaglio intervento con operatore assegnato e collegamento alla sezione Interventi.

Il drag & drop richiama `/api/reschedule`, quindi conserva audit, idempotenza, autorizzazioni e isolamento aziendale. Gli interventi non pianificati non sono trascinabili.
