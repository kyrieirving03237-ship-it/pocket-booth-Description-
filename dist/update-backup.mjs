// One-time, device-local copy before Studio 12 starts writing project data.
// The original database is read-only here. No clearing, deleting or migration.
import {bounded} from './media-import.mjs?v=12';
export const BACKUP_DATABASE='pocket-booth-safety-backups';
export const BACKUP_RELEASE='studio-12';
function request(db,store,method,...args){return bounded(new Promise((resolve,reject)=>{const tx=db.transaction(store,'readonly'),req=tx.objectStore(store)[method](...args);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);}),{ms:15000});}
function write(db,store,key,value){return bounded(new Promise((resolve,reject)=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).put(value,key);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);}),{ms:30000});}
export async function backupBeforeUpdate(source){
 const backup=await bounded(new Promise((resolve,reject)=>{const req=indexedDB.open(BACKUP_DATABASE,1);req.onupgradeneeded=()=>{req.result.createObjectStore('snapshots');req.result.createObjectStore('metadata');};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);req.onblocked=()=>reject(new Error('安全用保存領域を開けません'));}),{ms:10000});
 try{
  const done=await request(backup,'metadata','get',BACKUP_RELEASE);if(done?.complete)return done;
  let count=0;
  for(const name of ['projects','sessions']){
   if(!source.objectStoreNames.contains(name))continue;
   const keys=await request(source,name,'getAllKeys');
   for(const key of keys){const value=await request(source,name,'get',key);if(value===undefined)continue;await write(backup,'snapshots',JSON.stringify([BACKUP_RELEASE,name,key]),{sourceStore:name,sourceKey:key,value});count++;}
  }
  const result={release:BACKUP_RELEASE,complete:true,count,at:new Date().toISOString()};await write(backup,'metadata',BACKUP_RELEASE,result);return result;
 }finally{backup.close();}
}
