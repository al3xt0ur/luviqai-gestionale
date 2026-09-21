// Imported first by test entry points, including browser checks run directly.
// Never read the application's .env files in a test process or its children.
process.env.LUVIQ_TEST_MODE='1';
process.env.NODE_ENV='test';
for(const key of Object.keys(process.env)){
  if(/^(DATABASE_URL|PGLITE_PATH|PGHOST|PGPORT|PGUSER|PGPASSWORD|PGDATABASE|PGSERVICE|PGSERVICEFILE|PGPASSFILE|APP_ORIGIN|PUBLIC_APP_URL|PORT|MAIL_|SMTP_|RESEND_|OPENROUTER_)/i.test(key))delete process.env[key];
}
process.env.DATABASE_URL='';
process.env.MAIL_MODE='preview';
process.env.BOOTSTRAP_DEMO='0';
