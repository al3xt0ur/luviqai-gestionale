import {fileURLToPath} from 'node:url';
try{process.loadEnvFile(fileURLToPath(new URL('../.env.mail',import.meta.url)));}catch(error){if(error.code!=='ENOENT')throw error;}
await import('./http.mjs');
