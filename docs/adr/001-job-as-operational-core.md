# ADR-001 — La Commessa come contenitore operativo centrale

Data: 2026-09-21
Stato: Accepted

## Contesto

Il modello attuale collega direttamente clienti, pacchetti e interventi. Questo funziona per il caso "pacchetto ore", ma limita:
- lavori a forfait;
- progetti multi-intervento;
- interventi non legati a pacchetti;
- allegati e rapportini;
- costi e marginalità;
- stato complessivo di un lavoro;
- fatturazione per commessa.

## Decisione

Introduciamo l'entità `jobs` (Commessa) come contenitore operativo.

Un intervento potrà appartenere a una commessa. Il collegamento sarà inizialmente opzionale per compatibilità con i dati esistenti.

La commessa può avere:
- `quote_id` opzionale;
- `package_id` opzionale;
- nessuno dei due per lavori inseriti manualmente.

## Conseguenze positive

- ciclo commerciale e operativo collegato;
- supporto a modelli a forfait e a ore;
- base per portale cliente;
- base per rapportini, allegati, firma e pagamenti;
- reporting per commessa.

## Conseguenze da gestire

- nuove migrazioni DB;
- aggiornamento UI e API;
- conversione graduale dei flussi esistenti;
- necessità di non duplicare le regole di saldo pacchetto.

## Vincolo

La commessa non deve diventare una seconda fonte di verità per ore o fatture. Le ore restano calcolate dagli interventi/pacchetti; gli importi contabili restano nei documenti commerciali.
