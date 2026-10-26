const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream',...(process.env.MIC_FIXTURE?['--use-file-for-fake-audio-capture='+process.env.MIC_FIXTURE]:[])]});
try{
 const page=await browser.newPage();await page.goto(process.env.SITE_URL||'http://127.0.0.1:4173');
 const results=await page.evaluate(async()=>{
  const {createPcmRecorder}=await import('/pcm-capture.mjs?v=11');const results=[];
  for(let cycle=0;cycle<3;cycle++){
   const ctx=new AudioContext(),dest=ctx.createMediaStreamDestination();await ctx.resume();
   const inlet=ctx.createGain();const recorder=await createPcmRecorder(ctx,dest.stream,{source:inlet});let blob;const levels=[];recorder.onlevel=level=>levels.push(level);
   const stopped=new Promise(resolve=>{recorder.ondataavailable=e=>blob=e.data;recorder.onstop=resolve;});
   await new Promise(r=>setTimeout(r,150));recorder.start();const marker=ctx.currentTime+.5;
   const data=ctx.createBuffer(1,128,ctx.sampleRate);data.getChannelData(0).fill(.8);
   const src=ctx.createBufferSource();src.buffer=data;src.connect(inlet);src.start(marker);const second=ctx.createBufferSource();second.buffer=data;second.connect(inlet);second.start(marker+.3);
   // A busy UI must not become a 300ms recording offset.
   if(cycle===1){const end=performance.now()+300;while(performance.now()<end){}}
   await new Promise(r=>setTimeout(r,950));recorder.stop();await stopped;
   const view=new DataView(await blob.arrayBuffer());if(view.getUint16(34,true)!==24)throw Error('Expected PCM24');
   const decoded=await ctx.decodeAudioData(await blob.arrayBuffer());
   const peak=Math.max(...decoded.getChannelData(0).map(Math.abs));const index=decoded.getChannelData(0).findIndex(v=>Math.abs(v)>.1);
   const secondIndex=decoded.getChannelData(0).findIndex((v,i)=>i>index+1000&&Math.abs(v)>.1);
   const loudLevels=levels.filter(l=>l.peak>.4);
   results.push({cycle,peak,levelTimes:loudLevels.map(l=>l.time-marker),gap:(secondIndex-index)/decoded.sampleRate,frames:decoded.length,error:recorder.startTime+index/decoded.sampleRate-marker,index});
   src.disconnect();second.disconnect();dest.disconnect();dest.stream.getTracks().forEach(t=>t.stop());await ctx.close();
  }return results;
 });
 console.log(results);for(const result of results){assert.ok(result.index>=0);assert.ok(result.levelTimes.length>=2);assert.ok(Math.abs(result.levelTimes[0])<.05);assert.ok(Math.abs(result.levelTimes.at(-1)-.3)<.05);assert.ok(Math.abs(result.gap-.3)<.002);assert.ok(Math.abs(result.error)<.03,JSON.stringify(result));assert.ok(result.frames>20000);console.log('PASS sample clock marker',JSON.stringify(result));}
 if(process.env.MIC_FIXTURE){const mic=await page.evaluate(async()=>{const {createPcmRecorder}=await import('/pcm-capture.mjs?v=11');const stream=await navigator.mediaDevices.getUserMedia({audio:true});const ctx=new AudioContext();await ctx.resume();const rec=await createPcmRecorder(ctx,stream);let blob;const done=new Promise(resolve=>{rec.ondataavailable=e=>blob=e.data;rec.onstop=resolve;});rec.start();await new Promise(r=>setTimeout(r,1500));rec.stop();await done;const audio=await ctx.decodeAudioData(await blob.arrayBuffer());let sum=0;for(const v of audio.getChannelData(0))sum+=v*v;stream.getTracks().forEach(t=>t.stop());await ctx.close();return {rms:Math.sqrt(sum/audio.length),duration:audio.duration};});assert.ok(mic.rms>.01,JSON.stringify(mic));assert.ok(mic.duration>1);console.log('PASS actual MediaStream input contains audible signal',mic);}
}finally{await browser.close();}
