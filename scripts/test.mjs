import './test-isolation.mjs';
import {spawn} from 'node:child_process';
import {readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
// Do not pass inherited credentials or Node preload flags into test children.
const allowed=/^(PATH|SYSTEMROOT|WINDIR|COMSPEC|PATHEXT|TEMP|TMP|TMPDIR|HOME|USERPROFILE|LOCALAPPDATA|APPDATA|LANG|LC_ALL|TZ|CI|TERM|NO_COLOR)$/i;
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>allowed.test(key)));
Object.assign(env,{LUVIQ_TEST_MODE:'1',NODE_ENV:'test',DATABASE_URL:'',MAIL_MODE:'preview',BOOTSTRAP_DEMO:'0'});
const files=readdirSync(new URL('../tests/',import.meta.url)).filter(f=>f.endsWith('.test.mjs')).sort().map(f=>'tests/'+f);
const child=spawn(process.execPath,['--test','--test-concurrency=2',...files],{cwd:root,env,stdio:'inherit'});
child.on('error',()=>{console.error('Impossibile avviare i test.');process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??1;});
