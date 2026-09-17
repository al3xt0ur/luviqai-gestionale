# Integrazione continua

La workflow `.github/workflows/ci.yml` esegue test e build su Node.js 24 con pnpm 11.

Per evitare accessi accidentali al database operativo o invii reali, la CI imposta esplicitamente `DATABASE_URL` vuota, `MAIL_MODE=preview` e nessuna chiave OpenRouter. I test devono continuare a usare database temporanei isolati e provider simulati.

La CI non pubblica né distribuisce l'applicazione.
