import PDFDocument from 'pdfkit';

const fmtDate=value=>new Date(value).toLocaleString('it-IT',{dateStyle:'short',timeStyle:'short'});
const fmtDuration=seconds=>{
  const total=Math.max(0,Number(seconds)||0),h=Math.floor(total/3600),m=Math.floor((total%3600)/60);
  return h?(h+' h '+m+' min'):(m+' min');
};

export function interventionReportPDF({intervention,client,job,company}){
  return new Promise((resolve,reject)=>{
    const doc=new PDFDocument({size:'A4',margin:44,bufferPages:true,info:{Title:'Rapportino intervento #'+intervention.id,Author:company.name}});
    const chunks=[];doc.on('data',c=>chunks.push(c));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);
    const L=44,W=doc.page.width-88,R=L+W,ink='#173c43',muted='#66787b',soft='#f4f7f6',line='#dce6e3';
    const brand=/^#[0-9a-f]{6}$/i.test(company.brandColor||'')?company.brandColor:'#176653';
    let y=44;
    const text=(v,x,t,w,s=10,b=false,c=ink,a='left')=>{doc.font(b?'Helvetica-Bold':'Helvetica').fontSize(s).fillColor(c).text(String(v||''),x,t,{width:w,align:a,lineGap:2});return doc.y};
    const rule=t=>doc.moveTo(L,t).lineTo(R,t).strokeColor(line).lineWidth(.7).stroke();
    const room=h=>{if(y+h>doc.page.height-70){doc.addPage();doc.rect(0,0,doc.page.width,6).fill(brand);y=44;}};

    doc.rect(0,0,doc.page.width,7).fill(brand);
    if(company.logoData){try{doc.image(Buffer.from(company.logoData.split(',')[1],'base64'),L,35,{fit:[165,58]});}catch{}}
    else text(company.name,L,46,270,17,true);
    text('RAPPORTINO INTERVENTO',R-260,40,260,8,true,muted,'right');
    text('#'+intervention.id,R-220,58,220,22,true,ink,'right');
    y=118;

    doc.roundedRect(L,y,W,92,10).fill(soft);doc.roundedRect(L,y,5,92,3).fill(brand);
    text(client.name,L+18,y+15,W-36,13,true);
    text(client.address||'',L+18,y+38,W-36,9,false,muted);
    text(intervention.service,L+18,y+60,W-36,11,true,brand);
    y+=116;

    const meta=[
      ['Data e ora',fmtDate(intervention.date)],
      ['Squadra',intervention.team],
      ['Operatori previsti',String(intervention.operators)],
      ['Durata pianificata',intervention.duration+' min'],
      ['Tempo registrato',fmtDuration(intervention.execution?.elapsedSeconds||0)],
      ['Commessa',job?(job.title+' · #'+job.id):'—']
    ];
    for(let i=0;i<meta.length;i+=2){
      room(48);
      for(let c=0;c<2;c++){
        const item=meta[i+c];if(!item)continue;
        const x=L+c*(W/2);
        text(item[0].toUpperCase(),x,y,W/2-12,7,true,muted);
        text(item[1],x,y+15,W/2-12,10,true,ink);
      }
      y+=48;
    }

    const ex=intervention.execution||{};
    const checklist=Array.isArray(ex.checklist)?ex.checklist:[];
    if(checklist.length){
      room(48);text('CHECKLIST',L,y,W,8,true,brand);y+=22;
      for(const item of checklist){room(26);text((item.done?'✓':'○')+' '+item.text,L,y,W,9,item.done===true,item.done===true?ink:muted);y+=22;}
      y+=8;
    }

    const materials=Array.isArray(ex.materials)?ex.materials:[];
    if(materials.length){
      room(48);text('MATERIALI UTILIZZATI',L,y,W,8,true,brand);y+=22;
      for(const item of materials){room(24);text('• '+item.text,L,y,W,9,false,ink);y+=20;}
      y+=8;
    }

    if(ex.reportNotes){
      room(70);text('NOTE TECNICHE',L,y,W,8,true,brand);y+=20;
      const h=doc.heightOfString(ex.reportNotes,{width:W,lineGap:3});room(h+20);text(ex.reportNotes,L,y,W,9,false,ink);y+=h+24;
    }

    if(ex.signatureData){
      room(120);text('FIRMA CLIENTE',L,y,W,8,true,brand);y+=20;
      try{doc.image(Buffer.from(ex.signatureData.split(',')[1],'base64'),L,y,{fit:[220,75]});}catch{}
      text(ex.signatureName||'Firma acquisita',L+240,y+22,W-240,9,true,ink);
      y+=95;
    }

    const range=doc.bufferedPageRange();
    for(let p=0;p<range.count;p++){
      doc.switchToPage(p);rule(doc.page.height-48);
      text(company.name,L,doc.page.height-36,W-220,7,true,muted);
      text('Rapportino intervento #'+intervention.id+' · '+(p+1)+'/'+range.count,R-220,doc.page.height-36,220,7,false,muted,'right');
    }
    doc.end();
  });
}
