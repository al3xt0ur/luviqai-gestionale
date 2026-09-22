# Monitoraggio e alert luviqAI

## Health check

L'endpoint pubblico `/api/health` verifica che il processo risponda, che il database sia raggiungibile e che non ci sia un picco di errori HTTP 5xx recenti. Il campo `release` espone lo SHA Git validato fornito dall'ambiente di deploy (`RENDER_GIT_COMMIT`, con fallback `GIT_COMMIT`/`SOURCE_VERSION`), oppure `unknown`. Non espone stack trace, conteggi interni o credenziali.

## Controllo esterno

Il workflow `.github/workflows/uptime-staging.yml` controlla lo staging. Quando il workflow è presente sul branch predefinito GitHub, la schedulazione viene eseguita ogni 30 minuti.

Il controllo pianificato verifica salute e database. Avviandolo manualmente è
possibile indicare `expected_release`: in quel caso il workflow fallisce anche
se il servizio è sano ma lo SHA esposto non coincide. Questo è il controllo da
usare per certificare il candidato durante il collaudo.

Se il controllo fallisce, il workflow prova a inviare un alert tramite Resend e poi rimane rosso in GitHub Actions.

Repository Actions secrets richiesti per l'email:

- `ALERT_RESEND_API_KEY`: chiave Resend dedicata agli alert.
- `ALERT_MAIL_FROM`: mittente verificato, consigliato `luviqAI Monitor <alerts@luviqai.it>`.
- `ALERT_MAIL_TO`: destinatario degli alert.

La chiave Resend deve restare fuori dal repository. Il dominio del mittente deve essere verificato nel provider. Staging e produzione dovrebbero usare credenziali separate quando possibile.

## Limiti

L'alert email è esterno all'applicazione: è intenzionale, perché deve poter segnalare anche quando LuviqAI è completamente irraggiungibile. Se anche il provider email non è disponibile, il workflow GitHub resta comunque fallito e visibile in Actions.
