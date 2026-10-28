import {bounded,Cancelled} from './media-import.mjs?v=13';
export function setAudioMode(type,nav=globalThis.navigator){
  try{if(!nav?.audioSession)return false;if(nav.audioSession.type!==type)nav.audioSession.type=type;return true;}catch{return false;}
}
export class AudioOutput{
  constructor({createContext=()=>new(globalThis.AudioContext||globalThis.webkitAudioContext)({latencyHint:'interactive'}),navigator=globalThis.navigator,closeTimeout=1500}={}){
    this.createContext=createContext;this.navigator=navigator;this.closeTimeout=closeTimeout;this.context=undefined;this.dirty=false;
  }
  invalidate(){this.dirty=true;}
  async retire(signal){
    const old=this.context;this.context=undefined;this.dirty=false;
    if(old&&old.state!=='closed'){try{await bounded(old.close(),{signal,ms:this.closeTimeout});}catch(e){if(e.name==='AbortError')throw e;}}
  }
  async prepare(signal,{capture=false}={}){
    setAudioMode(capture?'play-and-record':'playback',this.navigator);
    if(this.context&&(this.dirty||this.context.state==='closed'))await this.retire(signal);
    if(signal?.aborted)throw new Cancelled();
    this.context??=this.createContext();this.dirty=false;
    if(this.context.state!=='running'){
      try{await bounded(this.context.resume(),{signal,ms:5000,message:'音声の開始に応答がありません。再生ボタンを押し直してください。'});}
      catch(e){this.dirty=true;throw e;}
    }
    if(this.context.state!=='running'){this.dirty=true;throw new Error('音声が中断されています。再生ボタンを押し直してください。');}
    return this.context;
  }
}
export function disconnectSource(source){
  if(source.boothDisposed)return;source.boothDisposed=true;
  try{source.stop();}catch{}
  for(const node of [source,...(source.boothNodes||[])]){try{node.disconnect();}catch{}}
  source.boothNodes=[];source.onended=null;
}
