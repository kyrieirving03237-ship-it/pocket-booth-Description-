export function placement(start, correction, cursor = 0) {
  const position = start + correction / 1000;
  return {delay: Math.max(0, position - cursor), offset: Math.max(0, cursor - position)};
}
export function mixDuration(tracks) {
  return Math.max(0, ...tracks.map(t => t.buffer.duration + t.start + t.correction / 1000));
}
export function encodeWav(buffer,{bitDepth=16}={}) {
  if(![16,24].includes(bitDepth))throw new Error('Unsupported PCM bit depth');
  const sampleBytes=bitDepth/8;
  const channels = buffer.numberOfChannels, frames = buffer.length;
  const data = new ArrayBuffer(44 + frames * channels * sampleBytes), v = new DataView(data);
  const str = (o,s) => [...s].forEach((c,i)=>v.setUint8(o+i,c.charCodeAt(0)));
  str(0,'RIFF');v.setUint32(4,data.byteLength-8,true);str(8,'WAVE');str(12,'fmt ');
  v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,channels,true);
  v.setUint32(24,buffer.sampleRate,true);v.setUint32(28,buffer.sampleRate*channels*sampleBytes,true);
  v.setUint16(32,channels*sampleBytes,true);v.setUint16(34,bitDepth,true);str(36,'data');v.setUint32(40,frames*channels*sampleBytes,true);
  const planes=Array.from({length:channels},(_,i)=>buffer.getChannelData(i));
  for(let i=0;i<frames;i++)for(let c=0;c<channels;c++){
    const sample=Math.max(-1,Math.min(1,planes[c][i]));
    const offset=44+(i*channels+c)*sampleBytes;
    if(bitDepth===16)v.setInt16(offset,sample<0?sample*32768:sample*32767,true);
    else{const value=Math.round(sample<0?sample*8388608:sample*8388607);v.setUint8(offset,value&255);v.setUint8(offset+1,(value>>8)&255);v.setUint8(offset+2,(value>>16)&255);}
  }
  return new Blob([data],{type:'audio/wav'});
}
