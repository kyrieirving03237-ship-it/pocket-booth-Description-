import {processorSource} from './pcm-source.mjs?v=11';
import {bounded} from './media-import.mjs?v=11';
import {encodeWav} from './audio-utils.mjs?v=11';
export function captureDelay(context,stream){
  // Only compensate latency the platform actually reports; never guess 500ms.
  const valid=v=>Number.isFinite(v)&&v>=0&&v<=2?v:0;
  return valid(context.outputLatency)+valid(stream.getAudioTracks()[0]?.getSettings?.().latency);
}
const moduleLoads=new WeakMap();
const processorURL=globalThis.URL?.createObjectURL&&typeof Blob!=='undefined'?URL.createObjectURL(new Blob([processorSource],{type:'text/javascript'})):null;
export function preparePcmModule(context){
 if(!moduleLoads.has(context)){
  const promise=context.audioWorklet.addModule(processorURL||new URL('./pcm-worklet.js?v=11',import.meta.url));
  moduleLoads.set(context,promise);promise.catch(()=>moduleLoads.delete(context));
 }return moduleLoads.get(context);
}
export async function createPcmRecorder(context,stream,{source:inputSource,signal}={}){
  if(!context.audioWorklet||!globalThis.AudioWorkletNode)throw new Error('このブラウザは同期録音に対応していません。最新のSafariで開いてください。');
  await bounded(preparePcmModule(context),{signal,ms:10000,message:'録音機能を準備できませんでした。もう一度お試しください。'});
  const node=new AudioWorkletNode(context,'booth-capture',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1]});
  const source=inputSource||context.createMediaStreamSource(stream);source.connect(node);node.connect(context.destination);
  const chunks=[];let frames=0,disposed=false;
  const dispose=()=>{if(disposed)return;disposed=true;source.disconnect();node.disconnect();node.port.close();};
  const recorder={state:'inactive',mimeType:'audio/wav',startTime:undefined,latency:captureDelay(context,stream),
    start(){this.state='recording';node.port.postMessage({type:'start'});},
    stop(){if(this.state==='inactive')return;this.state='inactive';node.port.postMessage({type:'stop'});},
    requestData(){const samples=new Float32Array(frames);let offset=0;for(const chunk of chunks){samples.set(chunk,offset);offset+=chunk.length;}const blob=encodeWav({numberOfChannels:1,length:frames,sampleRate:context.sampleRate,getChannelData:()=>samples},{bitDepth:24});this.ondataavailable?.({data:blob});},dispose};
  node.port.onmessage=({data})=>{
    if(data.type==='started'){recorder.startTime=data.time;
    }else if(data.type==='level'){recorder.onlevel?.(data);
    }else if(data.type==='samples'){
      if(recorder.startTime===undefined)recorder.startTime=data.time;
      chunks.push(data.samples);frames+=data.samples.length;
    }else if(data.type==='stopped'){
      dispose();recorder.requestData();chunks.length=0;recorder.onstop?.();
    }
  };
  node.onprocessorerror=()=>{dispose();recorder.onerror?.();};
  return recorder;
}
