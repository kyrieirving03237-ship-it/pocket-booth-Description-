export const amplitudeFromDb=db=>Math.pow(10,Math.max(0,Math.min(48,Number(db)||0))/20);
export function recommendVoiceGain(buffer){
  const size=Math.max(1,Math.round((buffer.sampleRate||48000)*.02)),levels=[];let peak=0;
  for(let c=0;c<buffer.numberOfChannels;c++){const data=buffer.getChannelData(c);for(let start=0;start<data.length;start+=size){let square=0;const end=Math.min(data.length,start+size);for(let i=start;i<end;i++)square+=data[i]*data[i];const rms=Math.sqrt(square/(end-start));levels.push(rms);peak=Math.max(peak,rms);}}
  if(peak<.00001)return 0;
  // Measure audible phrases, excluding pauses. Target a clearly audible vocal.
  const active=levels.filter(level=>level>=Math.max(.00001,peak*.1));
  const rms=Math.sqrt(active.reduce((sum,v)=>sum+v*v,0)/active.length);
  return Math.round(Math.max(0,Math.min(48,20*Math.log10(.22/rms))));
}
export function connectVoiceLevel(ctx,source,destination,db){
  const gain=ctx.createGain();gain.gain.value=amplitudeFromDb(db);
  const limiter=ctx.createDynamicsCompressor();limiter.threshold.value=-3;limiter.knee.value=3;limiter.ratio.value=12;limiter.attack.value=.001;limiter.release.value=.08;
  source.connect(gain);gain.connect(limiter);limiter.connect(destination);return {gain,limiter};
}
