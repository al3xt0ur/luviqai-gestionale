import test from 'node:test';
import assert from 'node:assert/strict';
import {clientIp} from '../server/request-ip.mjs';

test('clientIp usa il proxy solo quando esplicitamente trusted',()=>{
  const req={headers:{'x-forwarded-for':'203.0.113.25, 10.0.0.2','x-real-ip':'198.51.100.9'},socket:{remoteAddress:'127.0.0.1'}};
  assert.equal(clientIp(req,{trustProxy:true}),'203.0.113.25');
  assert.equal(clientIp(req,{trustProxy:false}),'127.0.0.1');
});

test('clientIp normalizza IPv4 mapped e ignora header proxy non validi',()=>{
  assert.equal(clientIp({headers:{},socket:{remoteAddress:'::ffff:192.0.2.10'}},{trustProxy:false}),'192.0.2.10');
  assert.equal(clientIp({headers:{'x-forwarded-for':'non-un-ip'},socket:{remoteAddress:'127.0.0.1'}},{trustProxy:true}),'127.0.0.1');
});
