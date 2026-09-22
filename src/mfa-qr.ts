import qrcode from 'qrcode-generator';

export function mfaQrDataUrl(uri:string){
  const qr=qrcode(0,'M');
  qr.addData(uri,'Byte');
  qr.make();
  return qr.createDataURL(7,4);
}
