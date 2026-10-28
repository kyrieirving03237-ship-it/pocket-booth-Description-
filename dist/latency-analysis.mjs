// Pure DSP: Worker and automated tests use the same detector. No browser/audio I/O.
export function makeClick(rate){
 const out=new Float32Array(Math.round(rate*.018));let seed=76419,low=0;
 for(let i=0;i<out.length;i++){seed=(Math.imul(seed,1664525)+1013904223)|0;const noise=(seed>>>0)/2147483648-1;low+=Math.min(1,16000/rate)*(noise-low);out[i]=low*Math.sin(Math.PI*i/(out.length-1))**2;}
 let peak=0;for(const v of out)peak=Math.max(peak,Math.abs(v));for(let i=0;i<out.length;i++)out[i]/=peak||1;return out;
}
function reduce(data,stride){const out=new Float32Array(Math.floor(data.length/stride));for(let i=0;i<out.length;i++){let sum=0;for(let j=0;j<stride;j++)sum+=data[i*stride+j];out[i]=sum/stride;}return out;}
export function detectClick(samples,reference,rate,expectedIndex,{minLag=-.05,maxLag=1.5,threshold=.48}={}){
 const stride=Math.max(1,Math.floor(rate/12000)),data=reduce(samples,stride),template=reduce(reference,stride),n=template.length;
 const mean=template.reduce((s,v)=>s+v,0)/n;let energy=0;for(let j=0;j<n;j++){template[j]-=mean;energy+=template[j]**2;}
 const first=Math.max(0,Math.floor((expectedIndex+minLag*rate)/stride)),last=Math.min(data.length-n,Math.ceil((expectedIndex+maxLag*rate)/stride));
 if(n<4||last<first||energy===0)return {detected:false,reason:'録音データ不足',lagSeconds:null};
 let sum=0,square=0;for(let j=0;j<n;j++){sum+=data[first+j];square+=data[first+j]**2;}
 let best=-1,bestIndex=-1,bestRms=0;const scores=[];
 for(let i=first;i<=last;i++){
  if(i>first){const old=data[i-1],next=data[i+n-1];sum+=next-old;square+=next*next-old*old;}
  let dot=0;for(let j=0;j<n;j++)dot+=data[i+j]*template[j];
  const score=Math.min(1,Math.abs(dot)/Math.sqrt(energy*Math.max(1e-20,square-sum*sum/n)));scores.push(score);
  if(score>best){best=score;bestIndex=i;bestRms=Math.sqrt(Math.max(0,square/n));}
 }
 let runnerUp=0;for(let i=0;i<scores.length;i++)if(Math.abs(first+i-bestIndex)>rate*.03/stride)runnerUp=Math.max(runnerUp,scores[i]);
 const ambiguous=runnerUp>best*.9,detected=best>=threshold&&bestRms>.00002&&!ambiguous;
 return {detected,correlation:best,runnerUp,ambiguous,rms:bestRms,lagSeconds:detected?(bestIndex*stride-expectedIndex)/rate:null,
  reason:detected?null:ambiguous?'クリック候補が複数あり判別できません':'クリックを十分な確かさで検出できません',resolutionSeconds:stride/rate};
}
export function analyzeRecording({samples,reference,rate,firstPcmTime,markerTimes}){
 if(!Number.isFinite(firstPcmTime))return {accepted:false,markers:[],reason:'最初のPCM時刻を取得できません'};
 const markers=markerTimes.map((time,i)=>({section:['先頭','中盤','終盤'][i],scheduledContextTime:time,...detectClick(samples,reference,rate,(time-firstPcmTime)*rate)}));
 let peak=0;for(const value of samples)peak=Math.max(peak,Math.abs(value));
 const accepted=markers.every(m=>m.detected)&&peak<.999;
 return {accepted,markers,peak,reason:peak>=.999?'音割れのため測定無効':accepted?null:'音響結合を確認できないため測定無効'};
}
