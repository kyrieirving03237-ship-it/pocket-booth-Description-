import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const base=process.env.SITE_URL||'http://127.0.0.1:4179';
try{
 for(const fail of [false,true]){
  const ctx=await browser.newContext(),p=await ctx.newPage();await p.goto(base+'/icon.svg');
  const result=await p.evaluate(async fail=>{
   const open=(name,version,upgrade)=>new Promise((resolve,reject)=>{const r=indexedDB.open(name,version);r.onupgradeneeded=()=>upgrade?.(r.result);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
   const source=await open('pocket-booth-web',2,db=>{for(const n of ['projects','sessions','settings','projectMeta'])db.createObjectStore(n);});
   const original={id:'existing',name:'既存の曲',tracks:[{kind:'voice',clips:[{start:12.3,correction:-70,blob:new Blob(['ORIGINAL PCM'],{type:'audio/wav'})}]}]};
   await new Promise((resolve,reject)=>{const tx=source.transaction(['projects','sessions'],'readwrite');tx.objectStore('projects').put(original,'existing');tx.objectStore('sessions').put([{blob:new Blob(['LEGACY'])}],'current');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});
   const get=(db,store,key)=>new Promise(resolve=>{const r=db.transaction(store).objectStore(store).get(key);r.onsuccess=()=>resolve(r.result);});
   const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(this.transaction.db.name==='pocket-booth-web')throw Error('Backup must not write to source');if(fail&&this.transaction.db.name==='pocket-booth-safety-backups'&&this.name==='snapshots')throw new DOMException('quota','QuotaExceededError');return put.apply(this,args);};
   const {backupBeforeUpdate}=await import('/update-backup.mjs?v=12');let error;try{await backupBeforeUpdate(source);}catch(e){error=e.name;}
   const backup=await open('pocket-booth-safety-backups',1),marker=await get(backup,'metadata','studio-12'),copy=await get(backup,'snapshots',JSON.stringify(['studio-12','projects','existing'])),after=await get(source,'projects','existing');
   const out={error,marker,originalText:await after.tracks[0].clips[0].blob.text(),start:after.tracks[0].clips[0].start,correction:after.tracks[0].clips[0].correction,copiedText:copy?await copy.value.tracks[0].clips[0].blob.text():null};
   if(!fail){const again=await backupBeforeUpdate(source);out.idempotent=again.at===marker.at;}
   source.close();backup.close();return out;
  },fail);
  assert.equal(result.originalText,'ORIGINAL PCM');assert.equal(result.start,12.3);assert.equal(result.correction,-70);
  if(fail){assert.equal(result.error,'QuotaExceededError');assert.equal(result.marker,undefined);console.log('PASS failed backup never marks completion or changes original data');}
  else{assert.equal(result.marker.complete,true);assert.equal(result.marker.count,2);assert.equal(result.copiedText,'ORIGINAL PCM');assert.equal(result.idempotent,true);console.log('PASS pre-update project + legacy audio copied exactly, read-only source, one-time marker');}
  await ctx.close();
 }
}finally{await browser.close();}
