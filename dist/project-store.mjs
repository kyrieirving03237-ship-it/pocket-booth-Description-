import {bounded} from './media-import.mjs?v=12';
export function projectSummary(project){
  const clips=project.tracks.flatMap(t=>t.clips||[]);
  return {id:project.id,name:project.name,createdAt:project.createdAt,updatedAt:project.updatedAt,trackCount:project.tracks.length,clipCount:clips.length,duration:Math.max(0,...clips.map(c=>(c.duration||0)+(c.start||0)+(c.correction||0)/1000))};
}
export class ProjectStore{
  constructor(db){this.db=db;}
  static async open(signal){
    const db=await bounded(new Promise((resolve,reject)=>{
      const req=indexedDB.open('pocket-booth-web',2);
      req.onupgradeneeded=()=>{for(const name of ['sessions','projects','projectMeta','settings'])if(!req.result.objectStoreNames.contains(name))req.result.createObjectStore(name);};
      req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);req.onblocked=()=>reject(new Error('古い版を開いているタブを閉じ、もう一度お試しください。'));
    }),{signal,ms:8000,message:'端末内の保存領域を開けませんでした。'});
    db.onversionchange=()=>db.close();return new ProjectStore(db);
  }
  read(store,key,signal){return bounded(new Promise((resolve,reject)=>{const tx=this.db.transaction(store);const r=tx.objectStore(store).get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);}),{signal,ms:10000});}
  list(signal){return bounded(new Promise((resolve,reject)=>{const r=this.db.transaction('projectMeta').objectStore('projectMeta').getAll();r.onsuccess=()=>resolve(r.result.sort((a,b)=>b.updatedAt-a.updatedAt));r.onerror=()=>reject(r.error);}),{signal,ms:10000});}
  get(id,signal){return this.read('projects',id,signal);}
  put(project){
    return bounded(new Promise((resolve,reject)=>{const tx=this.db.transaction(['projects','projectMeta'],'readwrite');tx.objectStore('projects').put(project,project.id);tx.objectStore('projectMeta').put(projectSummary(project),project.id);tx.oncomplete=()=>resolve(true);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);}),{ms:15000,message:'保存を完了できませんでした。容量を確認してください。'});
  }
  remove(id){return bounded(new Promise((resolve,reject)=>{const tx=this.db.transaction(['projects','projectMeta'],'readwrite');tx.objectStore('projects').delete(id);tx.objectStore('projectMeta').delete(id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);}),{ms:10000});}
  migrateLegacy(){
    return bounded(new Promise((resolve,reject)=>{
      const tx=this.db.transaction(['sessions','settings','projects','projectMeta'],'readwrite');let migrated=false;
      const marker=tx.objectStore('settings').get('legacy-migrated');marker.onsuccess=()=>{
        if(marker.result)return;
        const old=tx.objectStore('sessions').get('current');old.onsuccess=()=>{
          if(old.result?.length){
            const timestamp=Date.now(),tracks=old.result.map(t=>Array.isArray(t.clips)?t:{id:t.id,kind:t.kind==='voice'?'voice':'file',name:t.name,volume:t.volume??.8,mute:false,solo:false,clips:t.blob?[{id:crypto.randomUUID(),name:t.name,blob:t.blob,start:t.start||0,correction:t.correction||0,duration:t.duration||0}]:[]});
            const p={id:crypto.randomUUID(),name:'マイ・セッション',createdAt:timestamp,updatedAt:timestamp,tracks};tx.objectStore('projects').put(p,p.id);tx.objectStore('projectMeta').put(projectSummary(p),p.id);migrated=true;
          }
          tx.objectStore('settings').put(true,'legacy-migrated');
        };
      };tx.oncomplete=()=>resolve(migrated);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
    }),{ms:15000});
  }
}
