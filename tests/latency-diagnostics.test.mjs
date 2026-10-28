import {test} from 'node:test';
import assert from 'node:assert/strict';
import {reading,formatMs,explainPlacement,statistics,summarizeTrials,snapshot,loadRecordingLogs,createRecordingDiagnostics,LOG_KEY} from '../dist/latency-diagnostics.mjs';
import {makeClick,analyzeRecording,detectClick} from '../dist/latency-analysis.mjs';
import {captureDelay} from '../dist/pcm-capture.mjs';
import {takeOrigin} from '../dist/clip-edit.mjs';
test('unavailable, invalid and real zero latency remain distinct after JSON roundtrip',()=>{
 for(const v of [undefined,null,NaN,Infinity,-1,'0'])assert.equal(formatMs(reading(v)),'取得不可');
 assert.equal(formatMs(reading(0)),'0.00 ms');assert.deepEqual(JSON.parse(JSON.stringify(reading(undefined))),{available:false,seconds:null});
 const ctx={state:'running',sampleRate:48000,currentTime:2,get outputLatency(){throw Error('unsupported');}},stream={getAudioTracks:()=>[{label:'EarPods',getSettings:()=>({latency:0,deviceId:'test'})}]};
 const s=snapshot(ctx,stream);assert.equal(s.inputLatency.available,true);assert.equal(s.outputLatency.available,false);assert.equal(s.output.verified,false);assert.equal(s.input.label,'EarPods');
});
test('diagnostics observes legacy behavior without changing caps, fallback or take placement',()=>{
 for(const output of [undefined,0,.02,.51,1.2,3,NaN])for(const input of [undefined,0,.01,.3]){
  const events=[],ctx={outputLatency:output},stream={getAudioTracks:()=>[{getSettings:()=>({latency:input})}]};
  const latency=captureDelay(ctx,stream,e=>events.push(e)),valid=v=>Number.isFinite(v)&&v>=0&&v<=2?v:0;assert.equal(latency,valid(output)+valid(input));
  for(const first of [undefined,0,1.02,1.4]){const d=explainPlacement({timelineStart:10,contextStart:1,firstPcmTime:first,legacyLatency:latency,manualMs:-30});assert.equal(d.calculatedStart,takeOrigin(10,1,first,latency));assert.equal(d.manualMs,-30);assert.equal(d.overHalfSecondDiscarded,latency>.5);}
  assert.equal(events.length,1);
 }
 assert.equal(explainPlacement({timelineStart:0,contextStart:1,firstPcmTime:1,legacyLatency:.51}).automaticAppliedSeconds,0);
 assert.equal(captureDelay({outputLatency:.2},{getAudioTracks:()=>[]},()=>{throw Error('logger failure');}),.2);
});
test('known delays at 44.1/48k, polarity change and scaling are detected; no drift is invented',()=>{
 for(const rate of [44100,48000])for(const lag of [0,.125,.42]){
  const ref=makeClick(rate),times=[1,3,5],samples=new Float32Array(rate*7),first=10;
  for(const t of times){const index=Math.round((t+lag)*rate);for(let j=0;j<ref.length;j++)samples[index+j]=-.08*ref[j];}
  const result=analyzeRecording({samples,reference:ref,rate,firstPcmTime:first,markerTimes:times.map(t=>t+first)});assert.equal(result.accepted,true,JSON.stringify(result));for(const marker of result.markers)assert.ok(Math.abs(marker.lagSeconds-lag)<.0005,JSON.stringify(marker));
 }
});
test('silence, unrelated signal, duplicate arrivals, out-of-window lag and clipping cannot count as zero',()=>{
 const rate=12000,reference=makeClick(rate),times=[1,3,5];
 for(const mode of ['silence','noise','duplicate','outside','clipped']){
  const samples=new Float32Array(rate*8);let seed=111;
  if(mode==='noise')for(let i=0;i<samples.length;i++){seed=(Math.imul(seed,1664525)+1013904223)|0;samples[i]=((seed>>>0)/2147483648-1)*.1;}
  else if(mode!=='silence')for(const t of times)for(const lag of mode==='duplicate'?[.1,.3]:[mode==='outside'?1.7:.1])for(let j=0;j<reference.length;j++)samples[Math.round((t+lag)*rate)+j]=reference[j]*(mode==='clipped'?1:.1);
  const result=analyzeRecording({samples,reference,rate,firstPcmTime:0,markerTimes:times});assert.equal(result.accepted,false,mode);if(mode==='silence')assert.ok(result.markers.every(m=>m.lagSeconds===null));
 }
 assert.equal(detectClick(new Float32Array(2),reference,rate,100).detected,false);
});
test('beginning/middle/end drift and five-trial sample standard deviation have correct units',()=>{
 const trials=Array.from({length:5},(_,i)=>({accepted:true,markers:[.1+i*.001,.11+i*.001,.12+i*.001].map(lagSeconds=>({lagSeconds}))}));
 const summary=summarizeTrials(trials);assert.equal(summary.complete,true);assert.ok(Math.abs(summary.statistics.mean-.112)<1e-9);assert.ok(Math.abs(summary.statistics.standardDeviation-Math.sqrt(2.5)*.001)<1e-9);assert.ok(Math.abs(summary.drift.mean-.02)<1e-9);
 assert.equal(summarizeTrials([...trials.slice(0,4),{accepted:false}]).complete,false);assert.equal(statistics([]),null);assert.equal(statistics([.2]).standardDeviation,null);
});
test('diagnostic storage failure is isolated; malformed logs are ignored',()=>{
 const storage={getItem:()=>'{bad',setItem:()=>{throw Error('quota');}};assert.deepEqual(loadRecordingLogs(storage),[]);assert.doesNotThrow(()=>createRecordingDiagnostics(storage));assert.deepEqual(loadRecordingLogs({getItem:()=>'{"invalid":true}'}),[]);
 const logger=createRecordingDiagnostics(storage);assert.doesNotThrow(()=>logger.syncClips(null));assert.equal(logger.begin({context:null}),undefined);
});
test('four-minute synthetic PCM reports changing early/middle/late lag instead of folding it into one constant',()=>{
 const rate=48000,reference=makeClick(rate),samples=new Float32Array(rate*240),times=[1,120,238.7],lags=[.125,.13,.135];
 for(let marker=0;marker<3;marker++){const start=Math.round((times[marker]+lags[marker])*rate);for(let j=0;j<reference.length;j++)samples[start+j]=reference[j]*.1;}
 const result=analyzeRecording({samples,reference,rate,firstPcmTime:0,markerTimes:times});assert.equal(result.accepted,true);for(let i=0;i<3;i++)assert.ok(Math.abs(result.markers[i].lagSeconds-lags[i])<.0005);assert.ok(Math.abs(result.markers[2].lagSeconds-result.markers[0].lagSeconds-.01)<.0005);
});
test('quota failures while finalizing observed takes do not escape into production recording',()=>{
 const storage={getItem:()=>null,setItem:()=>{throw Error('quota');}},logger=createRecordingDiagnostics(storage);
 const context={state:'running',sampleRate:48000,currentTime:5,outputLatency:.7},stream={getAudioTracks:()=>[{label:'Test input',getSettings:()=>({})}]},input={startTime:4.02,latency:.7};
 const preparation=logger.prepare(context,stream);logger.register(input,preparation);const take=logger.begin({context,stream,input,timelineStart:1,contextStart:4});let id;
 assert.doesNotThrow(()=>{id=take.finish({savedStart:1.02});});assert.equal(typeof id,'string');assert.match(logger.storageError,/保存できません/);assert.doesNotThrow(()=>logger.attachClip(id,{id:'clip',correction:0}));
});
