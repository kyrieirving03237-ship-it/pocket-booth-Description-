import {takeOrigin} from './clip-edit.mjs?v=12';
export const LOG_KEY='pocket-booth-developer-recordings-v1';
const numeric=value=>typeof value==='number'&&Number.isFinite(value);
export function reading(value){return numeric(value)&&value>=0?{available:true,seconds:value}:{available:false,seconds:null};}
export function formatMs(value){return value?.available?`${(value.seconds*1000).toFixed(2)} ms`:'取得不可';}
function safe(get){try{return get();}catch{return undefined;}}
const contextIds=new WeakMap();let sequence=0;
export function snapshot(context,stream){
 if(!contextIds.has(context))contextIds.set(context,`context-${Date.now()}-${++sequence}`);
 const track=stream?.getAudioTracks?.()[0],settings=safe(()=>track.getSettings())||{};
 const timestamp=safe(()=>context.getOutputTimestamp());
 return {at:new Date().toISOString(),contextId:contextIds.get(context),state:context.state,sampleRate:context.sampleRate,currentTime:context.currentTime,
  baseLatency:reading(safe(()=>context.baseLatency)),outputLatency:reading(safe(()=>context.outputLatency)),inputLatency:reading(settings.latency),
  outputTimestamp:timestamp&&numeric(timestamp.contextTime)&&numeric(timestamp.performanceTime)?{available:true,...timestamp}:{available:false},
  input:{label:track?.label||null,settings},output:{apiSinkId:safe(()=>context.sinkId)??null,verified:false,note:'出力装置名・実際の配線はAPIだけでは確認できません。'},
  audioSession:safe(()=>navigator.audioSession.type)??null};
}
export function explainPlacement({timelineStart,contextStart,firstPcmTime,legacyLatency,manualMs=0}){
 const delta=firstPcmTime-contextStart,validDelta=numeric(delta)&&delta>=-.05&&delta<=.25;
 const applied=numeric(legacyLatency)&&legacyLatency>=0&&legacyLatency<=.5?legacyLatency:0;
 return {timelineStart,contextStart,firstPcmTime:numeric(firstPcmTime)?firstPcmTime:null,startupDifference:numeric(delta)?delta:null,startupApplied:validDelta?delta:0,startupDiscarded:!validDelta,
  legacyReportedSum:legacyLatency,automaticAppliedSeconds:applied,overHalfSecondDiscarded:numeric(legacyLatency)&&legacyLatency>.5,
  manualMs,calculatedStart:takeOrigin(timelineStart,contextStart,firstPcmTime,legacyLatency),
  warning:'端末報告値は実測ではありません。この診断は既存の補正処理を変更しません。'};
}
export function statistics(values){
 const valid=values.filter(numeric);if(!valid.length)return null;
 const mean=valid.reduce((a,b)=>a+b,0)/valid.length;
 return {count:valid.length,mean,standardDeviation:valid.length>1?Math.sqrt(valid.reduce((sum,v)=>sum+(v-mean)**2,0)/(valid.length-1)):null,min:Math.min(...valid),max:Math.max(...valid)};
}
export function summarizeTrials(trials){
 const good=trials.filter(t=>t.accepted),means=good.map(t=>t.markers.reduce((s,m)=>s+m.lagSeconds,0)/t.markers.length);
 return {requested:5,completed:trials.length,accepted:good.length,complete:trials.length===5&&good.length===5,unit:'seconds',standardDeviationKind:'sample',
  statistics:statistics(means),bySection:[0,1,2].map(i=>statistics(good.map(t=>t.markers[i].lagSeconds))),
  drift:statistics(good.map(t=>t.markers[2].lagSeconds-t.markers[0].lagSeconds)),
  note:'同一条件の有効な測定だけの集計。自動補正には適用しません。'};
}
export function loadRecordingLogs(storage=globalThis.localStorage){try{const data=JSON.parse(storage.getItem(LOG_KEY)||'[]');return Array.isArray(data)?data.filter(item=>item&&typeof item==='object'&&item.placement&&item.start).slice(-30):[];}catch{return [];}}
export function createRecordingDiagnostics(storage=globalThis.localStorage){
 let records=loadRecordingLogs(storage);const prepared=new WeakMap();let lastStorageError=null;
 const save=()=>{try{storage.setItem(LOG_KEY,JSON.stringify(records.slice(-30)));lastStorageError=null;}catch{lastStorageError='診断ログを保存できません。曲の保存処理には影響しません。';}};
 const observer={
  get storageError(){return lastStorageError;},
  prepare(context,stream){const data={prepared:snapshot(context,stream),events:[]};return {data,observe:event=>{data.events.push(event);}};},
  register(input,observation){prepared.set(input,observation.data);},
  begin({context,stream,input,...timing}){
   const data={id:crypto.randomUUID(),kind:'production-recording-observation',environment:{userAgent:navigator.userAgent,standalone:!!navigator.standalone},...prepared.get(input),start:snapshot(context,stream),timing};
   return {finish({savedStart,manualMs=0}){
    data.end=snapshot(context,stream);data.placement={...explainPlacement({...timing,firstPcmTime:input.startTime,legacyLatency:input.latency,manualMs}),savedStart};
    records.push(data);records=records.slice(-30);save();return data.id;
   }};
  },
  attachClip(id,clip){const item=records.find(r=>r.id===id);if(item){item.clipId=clip.id;item.placement.manualMs=clip.correction;save();}},
  syncClips(tracks){let dirty=false;for(const t of tracks)for(const c of t.clips){const r=records.find(r=>r.clipId===c.id);if(r&&(r.currentStart!==c.start||r.placement.manualMs!==c.correction)){r.currentStart=c.start;r.placement.manualMs=c.correction;r.effectivePosition=c.start+c.correction/1000;dirty=true;}}if(dirty)save();}
 };
 // Diagnostics must never prevent a take from being recorded or saved.
 for(const name of ['prepare','register','begin','attachClip','syncClips']){
  const method=observer[name];observer[name]=(...args)=>safe(()=>{const result=method(...args);if(name==='begin'&&result){const finish=result.finish;result.finish=(...values)=>safe(()=>finish(...values));}return result;});
 }
 return observer;
}
