import {spawnSync,spawn} from 'node:child_process';
const vite='node_modules/vite/bin/vite.js';
const build=spawnSync(process.execPath,[vite,'build'],{stdio:'inherit'});
if(build.status!==0) process.exit(build.status||1);
spawn(process.execPath,['server/index.mjs'],{stdio:'inherit'});
