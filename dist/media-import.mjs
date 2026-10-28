// Fast, local ISO-BMFF audio extraction. Sample data is copied as Blob slices;
// compressed audio is never re-encoded and video frames are never decoded.
export class Cancelled extends Error { constructor(){super('キャンセルしました');this.name='AbortError';} }
export function bounded(promise, {signal, ms=30000, message='処理がタイムアウトしました。別の形式でお試しください。'}={}) {
  return new Promise((resolve,reject)=>{
    let timer;const finish=(fn,value)=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);fn(value);};
    const abort=()=>finish(reject,new Cancelled());
    if(signal?.aborted)return abort();signal?.addEventListener('abort',abort,{once:true});
    timer=setTimeout(()=>finish(reject,new Error(message)),ms);
    Promise.resolve(promise).then(v=>finish(resolve,v),e=>finish(reject,e));
  });
}
const typeAt=(v,p)=>String.fromCharCode(...new Uint8Array(v.buffer,v.byteOffset+p,4));
function header(v,p,end){
  if(p+8>end)throw new Error('MP4の構造が途中で切れています。');
  let size=v.getUint32(p),head=8;
  if(size===1){if(p+16>end)throw new Error('MP4ヘッダーが不正です。');size=Number(v.getBigUint64(p+8));head=16;}
  if(size===0)size=end-p;
  if(!Number.isSafeInteger(size)||size<head||p+size>end)throw new Error('MP4のボックスサイズが不正です。');
  return {type:typeAt(v,p+4),p,size,head,end:p+size,body:p+head};
}
function boxes(bytes,start=0,end=bytes.byteLength){const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),out=[];for(let p=start;p<end;){const b=header(v,p,end);out.push(b);p=b.end;}return out;}
function child(bytes,parent,type){return boxes(bytes,parent.body,parent.end).find(b=>b.type===type);}
function copy(bytes,b){return bytes.slice(b.p,b.end);}
function box(type,...parts){const size=8+parts.reduce((s,b)=>s+b.byteLength,0),out=new Uint8Array(size),v=new DataView(out.buffer);v.setUint32(0,size);[...type].forEach((c,i)=>out[4+i]=c.charCodeAt(0));let p=8;for(const b of parts){out.set(b,p);p+=b.byteLength;}return out;}
export async function extractMP4Audio(file,{signal,progress=()=>{}}={}){
  const read=(a,b)=>bounded(file.slice(a,b).arrayBuffer(),{signal,ms:20000,message:'ファイルを読めませんでした。iCloud上のファイルはダウンロードしてから選んでください。'});
  let moov,ftyp;
  for(let p=0;p<file.size;){
    const v=new DataView(await read(p,Math.min(file.size,p+16)));if(v.byteLength<8)throw new Error('動画ファイルが途中で切れています。');
    let size=v.getUint32(0),head=8;if(size===1){if(v.byteLength<16)throw new Error('動画ファイルが不正です。');size=Number(v.getBigUint64(8));head=16;}if(size===0)size=file.size-p;
    if(size<head||!Number.isSafeInteger(size)||p+size>file.size)throw new Error('MP4/MOVの構造を読み取れません。');
    const type=typeAt(v,4);if(type==='moov'){if(size>32*1024*1024)throw new Error('動画の管理情報が大きすぎます。');moov=new Uint8Array(await read(p,p+size));}
    if(type==='ftyp')ftyp=new Uint8Array(await read(p,p+size));p+=size;
  }
  if(!moov)throw new Error('この動画には対応する音声情報がありません。MP3/M4A/WAVでお試しください。');
  if(!ftyp)ftyp=box('ftyp',new Uint8Array([0x71,0x74,0x20,0x20,0,0,0,0,0x71,0x74,0x20,0x20]));
  const root=boxes(moov)[0],children=boxes(moov,root.body,root.end);
  let audioTrack,stbl;
  for(const trak of children.filter(b=>b.type==='trak')){
    const mdia=child(moov,trak,'mdia'),hdlr=mdia&&child(moov,mdia,'hdlr');
    if(hdlr&&typeAt(new DataView(moov.buffer),hdlr.body+8)==='soun'){
      const minf=child(moov,mdia,'minf');stbl=minf&&child(moov,minf,'stbl');audioTrack=trak;break;
    }
  }
  if(!audioTrack||!stbl)throw new Error('動画に音声トラックが見つかりませんでした。');
  const offsetBox=child(moov,stbl,'stco')||child(moov,stbl,'co64'),stsc=child(moov,stbl,'stsc'),stsz=child(moov,stbl,'stsz');
  if(!offsetBox||!stsc||!stsz)throw new Error('この動画の形式には未対応です。通常のMP4/MOVか、M4A/WAVでお試しください。');
  const v=new DataView(moov.buffer),count=v.getUint32(offsetBox.body+4),runs=v.getUint32(stsc.body+4),sampleSize=v.getUint32(stsz.body+4),sampleCount=v.getUint32(stsz.body+8);
  if(!count||!runs||count>1000000||sampleCount>5000000)throw new Error('動画の音声情報が空、または大きすぎます。');
  if(offsetBox.body+8+count*(offsetBox.type==='co64'?8:4)>offsetBox.end||stsc.body+8+runs*12>stsc.end||(!sampleSize&&stsz.body+12+sampleCount*4>stsz.end))throw new Error('動画の音声情報が不正です。');
  const chunks=[],sizes=[];let sample=0,run=0,total=0;
  for(let i=0;i<count;i++){
    if(signal?.aborted)throw new Cancelled();
    while(run+1<runs&&v.getUint32(stsc.body+8+(run+1)*12)<=i+1)run++;
    const samples=v.getUint32(stsc.body+12+run*12);let size=0;
    if(samples>sampleCount-sample)throw new Error('動画のサンプル情報が不正です。');
    for(let j=0;j<samples;j++,sample++)size+=sampleSize||v.getUint32(stsz.body+12+sample*4);
    const at=offsetBox.body+8+i*(offsetBox.type==='co64'?8:4),position=offsetBox.type==='co64'?Number(v.getBigUint64(at)):v.getUint32(at);
    if(!Number.isSafeInteger(position)||position+size>file.size)throw new Error('音声の位置情報が不正です。');
    chunks.push(file.slice(position,position+size));sizes.push(size);total+=size;
  }
  if(sample!==sampleCount||total>120*1024*1024)throw new Error('音声の長さまたはサイズを確認してください。');
  // Keep the original track metadata and durations; omit every video track.
  const track=copy(moov,audioTrack),trackView=new DataView(track.buffer);
  const kept=children.filter(b=>b.type!=='trak').map(b=>copy(moov,b));
  let audioMoov=box('moov',...kept,track),position=ftyp.byteLength+audioMoov.byteLength+8;
  for(let i=0;i<count;i++){
    const at=offsetBox.body-audioTrack.p+8+i*(offsetBox.type==='co64'?8:4);
    if(offsetBox.type==='co64')trackView.setBigUint64(at,BigInt(position));else trackView.setUint32(at,position);
    position+=sizes[i];
  }
  audioMoov=box('moov',...kept,track);
  const mdat=new Uint8Array(8);new DataView(mdat.buffer).setUint32(0,total+8);mdat.set([109,100,97,116],4);
  progress(`動画から音声を取り出しました · ${(total/1048576).toFixed(1)} MB`);
  return new Blob([ftyp,audioMoov,mdat,...chunks],{type:'audio/mp4'});
}
export async function importMedia(file,{signal,progress=()=>{},decode}={}){
  if(file.size>512*1024*1024)throw new Error('この試作版は512MB以下のファイルに対応しています。');
  const video=/\.(mp4|mov|m4v)$/i.test(file.name)||file.type.startsWith('video/');let blob=file;
  if(video){progress('動画の音声トラックを取り出しています…');blob=await extractMP4Audio(file,{signal,progress});}
  progress('音声を読み込んでいます…');
  const bytes=await bounded(blob.arrayBuffer(),{signal,ms:20000,message:'ファイルの取得に時間がかかっています。端末内に保存して選び直してください。'});
  // decodeAudioData may detach its input ArrayBuffer. Preserve original bytes first.
  const preservedBlob=new Blob([bytes],{type:blob.type||'audio/octet-stream'});
  let buffer;
  try{buffer=await bounded(decode(bytes),{signal,ms:45000,message:'音声を45秒以内に読み込めませんでした。M4A・MP3・WAVにして再度お試しください。'});}
  catch(e){if(e.name==='AbortError'||/45秒/.test(e.message))throw e;throw new Error('この音声形式をSafariで読み込めませんでした。MP3・M4A・WAVでお試しください。');}
  if(!Number.isFinite(buffer.duration)||buffer.duration<=0||buffer.duration>600)throw new Error('10分以内の音声を選んでください。');
  return {blob:preservedBlob,buffer};
}
