declare module 'qrcode-generator' {
  type ErrorCorrectionLevel='L'|'M'|'Q'|'H';
  type Mode='Numeric'|'Alphanumeric'|'Byte'|'Kanji';
  interface QRCode {
    addData(data:string,mode?:Mode):void;
    make():void;
    createDataURL(cellSize?:number,margin?:number):string;
  }
  export default function qrcode(typeNumber:number,errorCorrectionLevel:ErrorCorrectionLevel):QRCode;
}
