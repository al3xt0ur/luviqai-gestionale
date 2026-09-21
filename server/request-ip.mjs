import {isIP} from 'node:net';

function cleanIp(value=''){
  let ip=String(value).trim();
  if(ip.startsWith('::ffff:'))ip=ip.slice(7);
  return isIP(ip)?ip:'';
}

export function clientIp(req,{trustProxy=false}={}){
  if(trustProxy){
    const forwarded=String(req.headers?.['x-forwarded-for']||'').split(',').map(cleanIp).find(Boolean);
    if(forwarded)return forwarded;
    const real=cleanIp(req.headers?.['x-real-ip']);
    if(real)return real;
  }
  return cleanIp(req.socket?.remoteAddress)||'unknown';
}
