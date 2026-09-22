const fail = message => {
  console.error('STAGING CONFIG ERROR:', message);
  process.exitCode = 1;
};

const env = process.env;
const productionHost = 'app.luviqai.it';

if (env.NODE_ENV !== 'production') fail('NODE_ENV deve essere production anche in staging.');
if (!env.DATABASE_URL) fail('DATABASE_URL staging mancante.');

for (const name of ['APP_ORIGIN', 'PUBLIC_APP_URL']) {
  const value = env[name];
  if (!value) {
    fail(`${name} mancante.`);
    continue;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') fail(`${name} deve usare HTTPS.`);
    if (url.hostname === productionHost) fail(`${name} non deve puntare alla produzione (${productionHost}).`);
  } catch {
    fail(`${name} non è un URL valido.`);
  }
}

if ((env.MAIL_MODE || 'preview') !== 'preview') fail('MAIL_MODE deve essere preview nello staging.');

for (const secretName of ['RESEND_API_KEY', 'SMTP_PASSWORD']) {
  if (env[secretName]) fail(`${secretName} non deve essere configurata nello staging iniziale.`);
}

if (env.BOOTSTRAP_DEMO !== '0') fail('BOOTSTRAP_DEMO deve essere 0 nello staging.');

if (!process.exitCode) console.log('Configurazione staging valida: ambiente separato dalla produzione.');
