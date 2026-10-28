import {backupBeforeUpdate} from './update-backup.mjs?v=13';
import {builtInMicrophone,isWireless,microphoneDescription} from './mic-input.mjs?v=13';
import {attachPinchZoom} from './pinch-zoom.mjs?v=13';
import {takeOrigin,attachClipDrag} from './clip-edit.mjs?v=13';
import {createPcmRecorder,preparePcmModule} from './pcm-capture.mjs?v=13';
import {placement,encodeWav} from './audio-utils.mjs?v=13';
import {bounded,importMedia,Cancelled} from './media-import.mjs?v=13';
import {ProjectStore} from './project-store.mjs?v=13';
import {CaptureError,requestCapture,captureEnvironment,captureFailureKind} from './capture.mjs?v=13';
import {amplitudeFromDb,recommendVoiceGain,connectVoiceLevel} from './voice-level.mjs?v=13';
import {AudioOutput,setAudioMode,disconnectSource} from './audio-output.mjs?v=13';
const output=new AudioOutput();
const BUILD='13';
// Explicit opt-in only. Normal sessions do not load the diagnostic logger.
let recordingDiagnostics;
if(new URLSearchParams(location.search).get('diagnostics')==='1'){
  try{const {createRecordingDiagnostics}=await import('./latency-diagnostics.mjs');recordingDiagnostics=createRecordingDiagnostics();
    const link=document.createElement('a');link.href='./diagnostics.html';link.textContent='開発者向け録音診断';link.className='choice';document.querySelector('#menuDialog').append(link);
  }catch{}
}
document.querySelectorAll('[data-build]').forEach(el=>el.textContent=BUILD.padStart(2,'0'));
const $=s=>document.querySelector(s), MAX=600;
const colors=['#98a4b5','#f04d59','#4fa2e8','#dfb343','#b094df','#70c3a3'];
let context,decoder,db,job,tracks=[],selected,selectedClip,mode='idle',cursor=0,pps=28;
let sources=[],anchor=0,startCursor=0,frame,timer,recorder,stream,mic,analyser,live,livePeaks=[],recordOrigin=0,recordTrack,recordName,captureFinalizer,captureWatchdog,clockWall=0,clockAudio=0;
let readyInput,preparingCapture,prepareController,microphoneDevices=[],lastMicrophone;
let microphonePreference='auto';try{microphonePreference=localStorage.getItem('pocket-booth-microphone')||'auto';}catch{}
let exportBlob,backupBlob,saveSequence=0,store,project,projects=[],recordFrom=0,timelineLayers=[],micState="unknown",correctionExpanded=true,micDiagnostic,lastCaptureError;
let timingVisible=false;
const correctionValue=value=>Number.isFinite(value)?Math.max(-5000,Math.min(5000,Math.round(value))):0;
const uid=()=>crypto.randomUUID(),isPlaying=()=>['playing','recording'].includes(mode),idle=()=>mode==='idle'&&!job;
const time=t=>`${String(Math.floor(t/60)).padStart(2,'0')}:${String(Math.floor(t%60)).padStart(2,'0')}`;
const currentTrack=()=>tracks.find(t=>t.id===selected);
const clips=()=>tracks.flatMap(t=>t.clips.map(c=>({...c,track:t})));
const duration=()=>Math.max(0,...clips().map(c=>(c.buffer?.duration||c.duration||0)+c.start+c.correction/1000));
const labelWidth=()=>parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--label'))||104;
function notice(text){$('#noticeText').textContent=text;$('#notice').hidden=false;}
$('#closeNotice').onclick=()=>$('#notice').hidden=true;
function report(e){
  if(e.name==='AbortError')return;console.error(e);
  if(e instanceof CaptureError){showCaptureFailure(e);return;}
  if(e.name==='NotAllowedError'){notice('音声の再生開始が許可されませんでした。マイクの許可とは別のエラーです。録音を停止し、再生ボタンで音が出るか確認してください。');return;}
  notice(e.name==='NotFoundError'?'マイクが見つかりません。接続を確認してください。':e.message||'処理できませんでした。もう一度お試しください。');
}
function progress(text){$('#busyDetail').textContent=text;if(document.body.dataset.view==='library')$('#libraryStatus').textContent=text;}
function invalidate(){exportBlob=undefined;backupBlob=undefined;$('#backupReady').replaceChildren();$('#saveExport').hidden=true;$('#makeExport').hidden=false;$('#exportDetail').textContent='ファイルは端末内で作成します。';}
async function run(title,fn,{duringPlayback=false}={}){
  if(!idle()&&!(duringPlayback&&mode==='playing'&&!job))return;
  const controller=new AbortController();job=controller;if(mode!=='playing')mode='busy';
  $('#busyTitle').textContent=title;progress('準備しています…');update();
  try{await fn(controller.signal);}catch(e){report(e);}finally{
    if(job===controller){controller.abort();job=undefined;if(mode!=='playing')mode='idle';render();}
    if(document.body.dataset.view==='library')$('#libraryStatus').textContent='';
  }
}
$('#cancelJob').onclick=()=>{if(job){job.abort();progress('キャンセルしています…');}};
function decode(bytes){
  // Decoding works while suspended. Never await AudioContext.resume() on import:
  // Safari can leave that promise pending without a direct user playback gesture.
  const header=new DataView(bytes),wav=bytes.byteLength>=44&&header.getUint32(0)===0x52494646&&header.getUint32(8)===0x57415645;
  const rate=wav?header.getUint32(24,true):48000;
  const sampleRate=rate>=8000&&rate<=96000?rate:48000;
  if(!decoder||decoder.sampleRate!==sampleRate)decoder=new (window.OfflineAudioContext||window.webkitOfflineAudioContext)(1,1,sampleRate);
  return decoder.decodeAudioData(bytes);
}
async function audio(signal,{capture=false}={}){
  context=await output.prepare(signal,{capture});if(!capture)preparePcmModule(context).catch(()=>{});return context;
}
function makeTrack(kind,name){return {id:uid(),kind,name,volume:kind==='file'?.7:1,mute:false,solo:false,clips:[]};}
function defaults(){tracks=[makeTrack('file','ビート'),makeTrack('voice','ボーカル 1'),makeTrack('voice','ダブル / アドリブ')];selected=tracks[1].id;}
function migrate(saved){return saved.map(t=>{
  if(Array.isArray(t.clips))return {...t,solo:!!t.solo,mute:!!t.mute,clips:t.clips.map(c=>({...c,id:c.id||uid(),correction:correctionValue(c.correction)}))};
  return {id:t.id||uid(),kind:t.kind==='voice'?'voice':'file',name:t.name,volume:t.volume??.8,mute:false,solo:false,clips:t.blob||t.data?[{id:uid(),name:t.name,blob:t.blob,data:t.data,start:t.start||0,correction:t.correction||0}]:[]};
});}
function payload(){return tracks.map(t=>({id:t.id,kind:t.kind,name:t.name,volume:t.volume,mute:t.mute,solo:t.solo,color:t.color,clips:t.clips.map(c=>({id:c.id,name:c.name,blob:c.blob,start:c.start,correction:c.correction,gainDb:c.gainDb,captureTiming:c.captureTiming,duration:c.buffer?.duration||c.duration||0}))}));}
async function persist(){
  if(!project)return true;
  if(!store){$('#saveState').textContent='未保存';notice('端末内に保存できていません。バックアップを保存してください。');return false;}
  const seq=++saveSequence;$('#saveState').textContent='保存中';
  const snapshot={...project,updatedAt:Date.now(),cursor,tracks:payload()};
  try{await store.put(snapshot);if(project?.id===snapshot.id){project.updatedAt=snapshot.updatedAt;if(seq===saveSequence)$('#saveState').textContent='保存済み';}return true;}
  catch(e){$('#saveState').textContent='未保存';notice('曲を保存できませんでした。空き容量を確認し、メニューからバックアップを保存してください。');return false;}
}
function changed(){recordingDiagnostics?.syncClips(tracks);invalidate();return persist();}
async function restoreTracks(signal){
  let failures=0;
  for(const t of tracks)for(const c of t.clips){
    progress(`曲を開いています · ${t.name}`);
    try{const result=await importMedia(new File([c.blob],c.name||'audio.m4a',{type:c.blob.type}),{signal,progress,decode});Object.assign(c,result,{duration:result.buffer.duration,error:undefined});if(t.kind==='voice'&&!Number.isFinite(c.gainDb))c.gainDb=recommendVoiceGain(c.buffer);}
    catch(e){if(e.name==='AbortError')throw e;c.error=e.message;failures++;}
  }
  if(failures)notice(`${failures}個の音声を開けませんでした。元ファイルは保持しています。トラックの「⋯」から再読込できます。`);
}
async function refreshLibrary(){projects=await store.list();renderLibrary();}
function renderLibrary(){
  const list=$('#projectList');list.replaceChildren();
  if(!projects.length){list.innerHTML='<div class="emptylibrary"><b>＋</b>まだ曲はありません。<br>「新しい曲」から、最初の一曲を。</div>';return;}
  for(const [i,p] of projects.entries()){
    const card=document.createElement('article');card.className='projectcard';card.style.setProperty('--cover',colors[i%colors.length]);
    const button=document.createElement('button');button.className='projectopen';button.setAttribute('aria-label',p.name+'を開く');
    const cover=document.createElement('div');cover.className='projectcover';
    if(p.clipCount){for(let j=0;j<21;j++){const bar=document.createElement('i');bar.style.height=`${8+Math.abs(Math.sin(j*1.37+i)*Math.cos(j*.3))*42}px`;cover.append(bar);}}else{const empty=document.createElement('b');empty.textContent='＋';empty.className='emptycover';cover.append(empty);}
    const length=document.createElement('span');length.textContent=time(p.duration);cover.append(length);
    const info=document.createElement('div');info.className='projectinfo';const title=document.createElement('strong');title.textContent=p.name;
    const meta=document.createElement('small');meta.textContent=`${p.trackCount} トラック · ${new Intl.DateTimeFormat('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(p.updatedAt)}`;info.append(title,meta);button.append(cover,info);button.onclick=()=>openProject(p.id);
    const del=document.createElement('button');del.className='projectdelete';del.textContent='×';del.setAttribute('aria-label',p.name+'を削除');del.onclick=()=>{
      if(!idle()||!confirm(`「${p.name}」を削除しますか？この曲のビートと録音が削除されます。`))return;
      run('曲を削除',async()=>{await store.remove(p.id);await refreshLibrary();});
    };card.append(button,del);list.append(card);
  }
}
async function openProject(id){
  await run('曲を開く',async signal=>{
    const saved=await store.get(id,signal);if(!saved)throw new Error('曲が見つかりませんでした。');
    timingVisible=false;project={id:saved.id,name:saved.name,createdAt:saved.createdAt,updatedAt:saved.updatedAt,lyrics:typeof saved.lyrics==='string'?saved.lyrics:'',recordingCorrectionMs:correctionValue(saved.recordingCorrectionMs)};tracks=migrate(saved.tracks);selected=tracks.find(t=>t.kind==='voice')?.id||tracks[0]?.id;selectedClip=undefined;
    document.body.dataset.view='editor';openEditorTab('arrange');$('#lyricsText').value=project.lyrics;invalidate();setClock(saved.cursor||0);render();await restoreTracks(signal);$('#saveState').textContent='保存済み';
  });
  warmRecordingIfAllowed();
}
async function boot(){
  tracks=[];render();await run('曲の一覧を読み込み',async signal=>{
    store=await ProjectStore.open(signal);db=store.db;
    progress('更新前の曲を端末内へ安全にコピーしています…');
    try{await backupBeforeUpdate(db);}catch{store=undefined;db=undefined;throw new Error('更新前の安全用バックアップを作成できませんでした。元の曲・録音は変更していません。サイトデータは消さず、端末の空き容量を確保して再読み込みしてください。');}
    await store.migrateLegacy();await refreshLibrary();
  });
  const params=new URLSearchParams(location.search),resume=params.get('resumeProject');
  if(resume&&store){await openProject(resume);if(project&&params.has('micRecovery'))micHelp();const clean=new URL(location.href);clean.searchParams.delete('resumeProject');clean.searchParams.delete('micRecovery');history.replaceState(null,'',clean.href);}
}
$('#newProject').onclick=()=>{if(!idle())return;if(!store)return notice('保存領域を開けていません。「画面を更新」を試してください。');$('#newProjectName').value='';$('#createDialog').showModal();$('#newProjectName').focus();};
$('#createForm').onsubmit=e=>{
  e.preventDefault();const name=$('#newProjectName').value.trim();if(!name||!idle())return;$('#createDialog').close();
  run('新しい曲を作成',async()=>{
    const date=Date.now();timingVisible=false;project={id:uid(),name,createdAt:date,updatedAt:date,lyrics:'',recordingCorrectionMs:0};$('#lyricsText').value='';openEditorTab('arrange');defaults();selectedClip=undefined;cursor=0;invalidate();
    const ok=await persist();if(!ok){project=undefined;tracks=[];return;}
    document.body.dataset.view='editor';navigator.storage?.persist?.().catch(()=>{});render();setClock(0);
  }).then(warmRecordingIfAllowed);
};
$('#backToLibrary').onclick=async()=>{
  if(mode==='playing')stop();if(!idle())return;
  await run('曲を保存',async()=>{if(!await persist())return;await refreshLibrary();document.body.dataset.view='library';project=undefined;tracks=[];selected=undefined;selectedClip=undefined;invalidate();cleanupMic();});
};
$('#saveProject').onclick=async()=>{if(!idle())return;navigator.storage?.persist?.().catch(()=>{});await persist();};
$('#editorTitle').onclick=()=>$('#projectName').click();
$('#projectName').onclick=()=>{if(!idle()||!project)return;const name=prompt('曲の名前',project.name);if(name?.trim()){project.name=name.trim().slice(0,80);changed();update();}};
function openEditorTab(tab){
  const lyrics=tab==='lyrics';document.body.dataset.editorTab=tab;
  $('#workspace').hidden=lyrics;$('#lyricsPanel').hidden=!lyrics;
  $('#arrangeTab').setAttribute('aria-selected',String(!lyrics));$('#lyricsTab').setAttribute('aria-selected',String(lyrics));
  if(!lyrics)requestAnimationFrame(positionHead);
}
$('#arrangeTab').onclick=()=>openEditorTab('arrange');$('#lyricsTab').onclick=()=>openEditorTab('lyrics');
let lyricsSaveTimer;
$('#lyricsText').oninput=()=>{if(!project)return;project.lyrics=$('#lyricsText').value;$('#saveState').textContent='未保存';clearTimeout(lyricsSaveTimer);lyricsSaveTimer=setTimeout(()=>persist(),350);};
$('#lyricsText').onblur=()=>{clearTimeout(lyricsSaveTimer);if(project)persist();};
async function refreshApp(){
  if(!idle()&&mode!=='playing'){notice('録音や処理が終わってから更新してください。');return;}
  if(mode==='playing')stop();if(!await persist())return;
  let latest=BUILD;try{const r=await fetch('./version.json?check='+Date.now(),{cache:'no-store'});if(r.ok)latest=String((await r.json()).version);}catch{}
  const url=new URL(location.href);url.searchParams.set('v',latest);url.searchParams.set('refresh',Date.now());location.replace(url.href);
}
$('#refreshApp').onclick=refreshApp;$('#libraryRefresh').onclick=refreshApp;$('#applyUpdate').onclick=refreshApp;
async function checkUpdate(){try{const r=await fetch('./version.json?check='+Date.now(),{cache:'no-store'});if(r.ok&&(await r.json()).version!==BUILD)$('#updateBanner').hidden=false;}catch{}}
document.addEventListener('visibilitychange',()=>{if(!document.hidden){checkUpdate();warmRecordingIfAllowed();}});
function update(){
  updateCaptureReady();updateTiming();
  $('#busy').hidden=!job&&mode!=='busy';$('#cancelJob').disabled=!job;$('#status').textContent=({idle:'停止中',busy:'処理中',playing:'再生中',recording:'● 録音中'})[mode];
  document.body.classList.toggle('is-recording',mode==='recording');$('#inputMeter').hidden=mode!=='recording';
  $('#record').disabled=!!job||mode==='busy';$('#record small').textContent=mode==='recording'?'停止':'録音';
  $('#record').setAttribute('aria-label',mode==='recording'?'録音を停止':'録音開始');
  $('#stop').disabled=!isPlaying();$('#play').disabled=!!job||mode==='busy'||mode==='recording'||!clips().some(c=>c.buffer);
  $('#playIcon').textContent=mode==='playing'?'Ⅱ':'▶';$('#play small').textContent=mode==='playing'?'一時停止':'再生';
  $('#addTrack').disabled=!idle();$('#addLane').disabled=!idle();$('#rewind').disabled=!idle();$('#export').disabled=!idle()||!clips().some(c=>c.buffer);
  $('#mediaFile').disabled=!idle();$('#zoomIn').disabled=!idle();$('#zoomOut').disabled=!idle();$('#demo').disabled=!idle();$('#menu').disabled=!idle();
  $('#micSetup').textContent=stream?.getAudioTracks().some(t=>t.readyState==='live')?'マイク接続済み':'マイク設定';
  $('#backToLibrary').disabled=!!job||mode==='busy'||mode==='recording';$('#saveProject').disabled=!project||!idle();$('#projectName').textContent=project?.name||'マイ・セッション';$('#editorTitle').textContent=project?.name||'Pocket Booth';
  $('#selectionMenu').disabled=!currentTrack()||!idle();$('#selectionMenu').title=(currentTrack()?.name||'トラック')+'の編集メニュー';
  $('#sessionDuration').textContent=time(duration());$('#welcome').hidden=tracks.some(t=>t.clips.length>0);
  const target=currentTrack();$('#selectedHint').textContent=target?.kind==='voice'?`${target.name} に録音`:'録音時にボーカルトラックを追加';
  $('#transportHint').textContent=mode==='recording'?'録音中 · 停止でテイクを保存':mode==='playing'?'再生中 · 全トラックをミックス':'有線イヤホンで録音しよう';
  document.querySelectorAll('.laneactions button,#inspector input,#inspector button').forEach(el=>el.disabled=!idle());
}
function timelineExtent(){return Math.min(660,Math.max(45,duration()+15,cursor+15));}
function setClock(t){cursor=Math.max(0,Math.min(MAX,t));$('#clock').textContent=time(cursor)+'.'+Math.floor((cursor%1)*10);positionHead();}
function centerPadding(){return Math.max(24,$('.app').clientWidth/2-labelWidth());}
function positionHead(){
  const sc=$('#timelineScroll'),position=cursor*pps;sc.scrollLeft=position;
  const residual=position-sc.scrollLeft;
  for(const layer of timelineLayers)layer.style.transform=`translateX(${-residual}px)`;
  $('#playhead').style.left=`${labelWidth()+centerPadding()}px`;
}
$('#timelineScroll').addEventListener('scroll',()=>{
  const sc=$('#timelineScroll');if(idle()&&!document.querySelector('.clip.dragging')&&Math.abs(sc.scrollLeft-cursor*pps)>1){setClock(sc.scrollLeft/pps);}
});
function wavePath(buffer,multiplier=1){
  const samples=buffer.getChannelData(0),n=Math.min(1200,Math.max(100,Math.round(buffer.duration*20))),out=[];
  for(let i=0;i<n;i++){const a=Math.floor(i*samples.length/n),b=Math.floor((i+1)*samples.length/n);let peak=0;for(let j=a;j<b;j+=Math.max(1,Math.floor((b-a)/32)))peak=Math.max(peak,Math.abs(samples[j]));const h=Math.max(1,Math.min(38,peak*multiplier*38));out.push(`M${i*2} ${20-h/2}h1v${h}h-1Z`);}return {d:out.join(''),width:n*2};
}
function svgWave(c){
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('preserveAspectRatio','none');const path=document.createElementNS(svg.namespaceURI,'path');
  if(c.buffer){const gain=c.gainDb||0;if(!c.peaks||c.peakGain!==gain){c.peaks=wavePath(c.buffer,amplitudeFromDb(gain));c.peakGain=gain;}svg.setAttribute('viewBox',`0 0 ${c.peaks.width} 40`);path.setAttribute('d',c.peaks.d);}svg.append(path);return svg;
}
function render(){
  const extent=timelineExtent(),padding=centerPadding();$('#timeline').style.width=`${labelWidth()+2*padding+extent*pps}px`;$('#timeline').style.setProperty('--grid',`${5*pps}px`);
  $('#ruler').replaceChildren();const interval=pps>=40?2:pps>=20?5:10;
  for(let sec=0;sec<extent;sec+=interval){const mark=document.createElement('span');mark.className='mark';mark.style.left=`${padding+sec*pps}px`;mark.dataset.second=sec;mark.textContent=time(sec);$('#ruler').append(mark);}
  $('#trackRows').replaceChildren();
  tracks.forEach((t,i)=>{
    const row=document.createElement('div');row.className='lane'+(t.id===selected?' selected':'');row.style.setProperty('--color',t.color||colors[i%colors.length]);
    row.innerHTML=`<div class="tracklabel" tabindex="0" role="button"><div class="tracktop"><span class="tracknum">${String(i+1).padStart(2,'0')}</span><span class="tracktitle"></span></div><span class="tracktype">${t.kind==='voice'?'VOICE / MIC':'AUDIO'}</span><div class="laneactions"><button class="mute ${t.mute?'on':''}" aria-label="ミュート">M</button><button class="solo ${t.solo?'on':''}" aria-label="ソロ">S</button><span class="armed">${t.kind==='voice'&&t.id===selected?'● REC':''}</span></div></div><div class="lanearea"></div>`;
    row.querySelector('.tracklabel').insertAdjacentHTML('afterbegin','<svg class="trackmic" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="2" width="6" height="13" rx="3"/><path d="M6 10v2a6 6 0 0 0 12 0v-2M12 18v4M9 22h6"/></svg>');row.querySelector('.tracktitle').textContent=t.name;row.querySelector('.tracklabel').setAttribute('aria-label',t.name+'を選択');
    const select=()=>{if(!idle()&&mode!=='playing')return;selected=t.id;selectedClip=t.clips.at(-1)?.id;timingVisible=false;render();};row.querySelector('.tracklabel').onclick=select;row.querySelector('.tracklabel').onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();select();}};
    for(const key of ['mute','solo'])row.querySelector('.'+key).onclick=e=>{e.stopPropagation();if(!idle())return;t[key]=!t[key];changed();render();};
    const area=row.querySelector('.lanearea');area.style.backgroundPosition=`${padding}px 0`;
    if(!t.clips.length){const p=document.createElement('span');p.className='placeholder';p.style.left=`${padding+14}px`;p.textContent=t.kind==='voice'?'選択して、赤い録音ボタンで録音':'＋から音声・動画ファイルを追加';area.append(p);}
    for(const c of t.clips){const el=document.createElement('div');el.setAttribute('role','button');el.setAttribute('aria-label',c.name||'音声クリップ');el.tabIndex=0;el.className='clip'+(c.id===selectedClip?' selectedclip':'')+(t.mute?' muted':'');const start=c.start+c.correction/1000,len=c.buffer?.duration||c.duration||5;el.style.left=`${padding+Math.max(0,start)*pps}px`;el.style.width=`${Math.max(.05,len+Math.min(0,start))*pps}px`;
      const name=document.createElement('span');name.className='clipname';name.textContent=c.error?'! 読み込み不可':c.name;const svg=svgWave(c);if(start<0){svg.style.width=`${len*pps}px`;svg.style.transform=`translateX(${start*pps}px)`;}el.append(name,svg);
      attachClipDrag(el,{canEdit:idle,position:()=>c,scale:()=>pps,scroll:()=>$('#timelineScroll'),
        preview:value=>{el.style.transform=`translateX(${(value-c.start)*pps}px)`;const needed=labelWidth()+2*centerPadding()+(value+c.correction/1000+len+15)*pps;$('#timeline').style.width=`${Math.max(parseFloat($('#timeline').style.width)||0,needed)}px`;},restore:()=>{el.style.transform='';},
        commit:value=>{c.start=value;selected=t.id;selectedClip=c.id;changed();render();}});
      el.title='長押しで左右に移動';el.setAttribute('aria-description','長押しで左右に移動。キーボードでは左右矢印で位置を調整。');
      el.onclick=e=>{e.stopPropagation();if(!idle()&&mode!=='playing')return;selected=t.id;selectedClip=c.id;timingVisible=false;render();};el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();el.click();}};area.append(el);
    }
    area.onclick=e=>{if(!idle())return;selected=t.id;selectedClip=t.clips.at(-1)?.id;timingVisible=false;seek((e.clientX-area.getBoundingClientRect().left-centerPadding())/pps);render();};$('#trackRows').append(row);
  });timelineLayers=Array.from(document.querySelectorAll('.lanearea,.ruler'));inspect();positionHead();update();
}
function inspect(){
  const t=currentTrack();const el=$('#inspector');el.replaceChildren();if(!t)return;
  const index=tracks.indexOf(t);el.style.setProperty('--color',t.color||colors[index%colors.length]);
  el.classList.toggle('expanded',correctionExpanded);el.innerHTML='<div class="inspecthead"><strong></strong><button class="correctiontoggle">ズレ調整</button><details class="trackdetails"><summary aria-label="トラックを編集">⋯</summary><div class="inspectactions"><button class="rename">名前変更</button><button class="remove">トラック削除</button></div></details></div><div class="inspectvolume"><span>音量</span><input class="volume" type="range" min="0" max="1" step="0.01" aria-label="選択トラックの音量"><span class="inspectvalue"></span></div>';
  el.querySelector('.correctiontoggle').onclick=()=>{correctionExpanded=!correctionExpanded;el.classList.toggle('expanded',correctionExpanded);};
  el.querySelector('strong').textContent=t.name;const mix=document.createElement('div');mix.className='mixoptions';for(const [key,label]of[['mute','ミュート'],['solo','ソロ']]){const b=document.createElement('button');b.textContent=label;b.setAttribute('aria-pressed',String(!!t[key]));b.onclick=()=>{t[key]=!t[key];changed();render();};mix.append(b);}el.append(mix);const volume=el.querySelector('.volume'),value=el.querySelector('.inspectvalue');volume.value=t.volume;value.textContent=Math.round(t.volume*100)+'%';volume.oninput=()=>{t.volume=Number(volume.value);value.textContent=Math.round(t.volume*100)+'%';invalidate();};volume.onchange=changed;
  el.querySelector('.rename').onclick=()=>{const name=prompt('トラック名',t.name);if(name?.trim()){t.name=name.trim().slice(0,80);changed();render();}};
  el.querySelector('.remove').onclick=()=>{if(!confirm(`「${t.name}」を削除しますか？録音も削除されます。`))return;tracks=tracks.filter(x=>x!==t);selected=tracks[0]?.id;selectedClip=undefined;changed();render();};
  const palette=document.createElement('div');palette.className='trackpalette';palette.setAttribute('aria-label','トラックの色');for(const color of colors){const b=document.createElement('button');b.style.background=color;b.setAttribute('aria-label','色 '+color);b.setAttribute('aria-pressed',String((t.color||colors[index%colors.length])===color));b.onclick=()=>{t.color=color;changed();render();};palette.append(b);}el.append(palette);
  const c=t.clips.find(c=>c.id===selectedClip)||t.clips.at(-1);
  if(c){
    if(t.kind==='voice'){const quick=document.createElement('button');quick.className='secondaryaction';quick.textContent='再生しながらズレ調整';quick.onclick=()=>{timingVisible=true;$('#trackDialog').close();updateTiming();};el.append(quick);const boost=document.createElement('div');boost.className='voiceboost';boost.innerHTML='<label>声の増幅 <output></output><input type="range" min="0" max="48" step="1" aria-label="声の増幅 デシベル"></label><button class="secondaryaction">自動で声を大きくする</button><small>元の録音は保持。増幅は再生・書き出しに反映します。</small>';const slider=boost.querySelector('input'),out=boost.querySelector('output');slider.value=c.gainDb||0;out.textContent='+'+(c.gainDb||0)+' dB';slider.oninput=()=>{c.gainDb=Number(slider.value);out.textContent='+'+c.gainDb+' dB';invalidate();};slider.onchange=changed;boost.querySelector('button').onclick=()=>{if(c.buffer){c.gainDb=recommendVoiceGain(c.buffer);changed();inspect();}};el.append(boost);}
    const timing=document.createElement('div');timing.className='timing';timing.innerHTML='<span>補正 ms</span><button class="earlier" aria-label="10ミリ秒早く">−10</button><input class="correction" type="range" min="-5000" max="5000" step="1" aria-label="タイミング補正"><button class="later" aria-label="10ミリ秒遅く">＋10</button><input class="exact" type="number" min="-5000" max="5000" step="1" aria-label="タイミング補正のミリ秒値">';
    const range=timing.querySelector('.correction'),exact=timing.querySelector('.exact');range.value=exact.value=c.correction;
    const adjust=v=>{if(!Number.isFinite(v))return;setClipCorrection(c,v,{save:false,redraw:false});range.value=exact.value=c.correction;};
    range.oninput=()=>adjust(Number(range.value));range.onchange=()=>{changed();render();};exact.onchange=()=>{adjust(Number(exact.value));changed();render();};
    timing.querySelector('.earlier').onclick=()=>{adjust(c.correction-10);changed();render();};timing.querySelector('.later').onclick=()=>{adjust(c.correction+10);changed();render();};el.append(timing);
    const note=document.createElement('p');note.className='inspectnote';note.textContent='声が遅い → −側へ ／ 早い → ＋側へ。0.5秒遅ければ −500。再生と書き出しに反映します。';el.append(note);
    if(t.kind==='voice'&&c.captureTiming){const info=document.createElement('details');info.className='take-timing-info';const summary=document.createElement('summary');summary.textContent='このテイクの録音情報';const body=document.createElement('p'),data=c.captureTiming,prepared=data.readings?.prepared,start=data.readings?.start;const ms=value=>typeof value==='number'&&Number.isFinite(value)?`${Math.round(value*1000)}ms`:'取得不可';body.textContent=`自動補正 ${Math.round(data.automaticAppliedMs)}ms ／ 手動補正 ${correctionValue(c.correction)}ms。端末の報告値（実測ではありません）：出力 ${ms(prepared?.output)} → 録音開始 ${ms(start?.output)}、入力 ${ms(start?.input)}。`;info.append(summary,body);el.append(info);}
    const del=document.createElement('button');del.textContent='クリップ削除';del.onclick=()=>{if(confirm('このクリップを削除しますか？')){t.clips=t.clips.filter(x=>x!==c);selectedClip=undefined;changed();render();}};el.querySelector('.inspectactions').append(del);
    if(c.error||!c.buffer){const retry=document.createElement('button');retry.textContent='再読込';retry.onclick=()=>run('音声を再読込',async signal=>{const result=await importMedia(new File([c.blob],c.name,{type:c.blob.type}),{signal,progress,decode});Object.assign(c,result,{error:undefined,peaks:undefined});changed();});el.querySelector('.inspectactions').append(retry);}
  }update();
}
function timingClip(){const t=currentTrack();return t?.kind==='voice'?(t.clips.find(c=>c.id===selectedClip)||t.clips.at(-1)):undefined;}
function updateTiming(){
  const c=timingClip(),panel=$('#quickTiming'),editable=(idle()||mode==='playing')&&!job;
  panel.hidden=!timingVisible||!c||mode==='recording'||mode==='busy';
  if(!c)return;
  const value=correctionValue(c.correction);$('#timingValue').textContent=`${value>0?'+':''}${value} ms`;
  $('#timingName').textContent=c.name||'ボーカル';
  $('#timingListen').textContent=mode==='playing'?'確認を停止':'▶ 聴いて確認';
  for(const id of ['timingEarlier','timingLater','timingReset','timingRemember','timingForget'])$('#'+id).disabled=!editable;
  $('#timingListen').disabled=!editable||!c.buffer;
  $('#timingDefault').textContent=`この曲の次回初期値：${correctionValue(project?.recordingCorrectionMs)} ms`;
}
function setClipCorrection(c,value,{save=true,redraw=true}={}){
  c.correction=correctionValue(value);invalidate();
  if(mode==='playing'&&context){
    const from=startCursor+Math.max(0,context.currentTime-anchor);
    const old=sources.filter(src=>src.boothClipId===c.id);old.forEach(disconnectSource);sources=sources.filter(src=>src.boothClipId!==c.id);
    try{sources.push(...schedule(context,context.currentTime,from,c.id));}catch(e){stop();report(e);}
    if(mode==='playing'){clearTimeout(timer);timer=setTimeout(stop,Math.max(.1,duration()-from+.15)*1000);}
  }
  if(save)changed();if(redraw)render();else{previewTimelineZoom();updateTiming();}
}
for(const [id,delta] of [['timingEarlier',-10],['timingLater',10]])$('#'+id).onclick=()=>{const c=timingClip();if(c&&(idle()||mode==='playing')&&!job)setClipCorrection(c,correctionValue(c.correction)+delta);};
$('#timingReset').onclick=()=>{const c=timingClip();if(c&&(idle()||mode==='playing')&&!job)setClipCorrection(c,0);};
$('#timingClose').onclick=()=>{timingVisible=false;updateTiming();};
$('#timingListen').onclick=()=>{if(mode==='playing'){stop();return;}const c=timingClip();if(!idle()||!c?.buffer)return;seek(Math.max(0,c.start+c.correction/1000-1));play();};
$('#timingRemember').onclick=()=>{const c=timingClip();if(!c||!project||(!idle()&&mode!=='playing')||job)return;project.recordingCorrectionMs=correctionValue(c.correction);changed();updateTiming();};
$('#timingForget').onclick=()=>{if(!project||(!idle()&&mode!=='playing')||job)return;project.recordingCorrectionMs=0;changed();updateTiming();};
function seek(t){if(!idle())return;setClock(t);positionHead();}
$('#ruler').onclick=e=>seek((e.clientX-$('#ruler').getBoundingClientRect().left-centerPadding())/pps);
function showAdd(){if(idle())$('#addDialog').showModal();}$('#addTrack').onclick=showAdd;$('#addLane').onclick=showAdd;
$('#addVoice').onclick=()=>{$('#addDialog').close();const t=makeTrack('voice',`ボーカル ${tracks.filter(x=>x.kind==='voice').length+1}`);tracks.push(t);selected=t.id;selectedClip=undefined;changed();render();};
$('#addFile').onclick=()=>{$('#addDialog').close();$('#mediaFile').click();};
$('#mediaFile').onchange=e=>{
  const file=e.target.files[0];e.target.value='';if(!file)return;
  run('ファイルを読み込み',async signal=>{
    const result=await importMedia(file,{signal,progress,decode});if(signal.aborted)throw new Cancelled();
    const empty=tracks.find(t=>t.kind==='file'&&!t.clips.length),t=empty||makeTrack('file',file.name.replace(/\.[^.]+$/,''));
    if(!empty)tracks.push(t);else t.name=file.name.replace(/\.[^.]+$/,'');
    t.clips.push({id:uid(),name:file.name.replace(/\.(mp4|mov|m4v)$/i,' · AUDIO'),...result,start:cursor,correction:0});selected=t.id;selectedClip=t.clips.at(-1).id;const saved=await changed();
    if(!saved)notice('読み込みましたが、端末内に保存できていません。バックアップを保存してください。');
  });
};
function schedule(ctx,when,from=0,onlyClipId){
  const list=[],solo=tracks.some(t=>t.solo);
  try{for(const t of tracks){if(t.mute||solo&&!t.solo)continue;for(const c of t.clips){if(onlyClipId&&c.id!==onlyClipId)continue;if(!c.buffer)continue;const p=placement(c.start,c.correction,from);if(p.offset>=c.buffer.duration)continue;
    const src=ctx.createBufferSource(),gain=ctx.createGain();src.buffer=c.buffer;src.boothClipId=c.id;gain.gain.value=t.volume;src.boothNodes=[gain];if(t.kind==='voice'){const voice=connectVoiceLevel(ctx,src,gain,c.gainDb||0);src.boothNodes.push(voice.gain,voice.limiter);}else src.connect(gain);gain.connect(ctx.destination);src.onended=()=>disconnectSource(src);list.push(src);src.start(when+p.delay,p.offset);
  }}return list;}catch(e){for(const s of list)disconnectSource(s);throw e;}
}
function silence(){sources.forEach(disconnectSource);sources=[];clearTimeout(timer);cancelAnimationFrame(frame);clockWall=0;clockAudio=0;}
function tick(){if(!isPlaying())return;const wall=performance.now(),audioTime=context.currentTime;if(job||!clockWall||Math.abs(audioTime-clockAudio)>.01){clockWall=wall;clockAudio=audioTime;}else if(wall-clockWall>1800){output.invalidate();stop();if(mode==='idle')cleanupMic();notice('音声機能が中断されたため停止しました。再生ボタンで音声を作り直して再開できます。');return;}setClock(startCursor+Math.max(0,context.currentTime-anchor));
  if(mode==='recording'){
    const elapsed=Math.max(0,cursor-recordFrom);live.style.width=`${Math.max(6,elapsed*pps)}px`;
    const svg=live.querySelector('svg'),path=svg.querySelector('path'),width=Math.max(6,elapsed*pps);
    svg.setAttribute('viewBox',`0 0 ${width} 40`);
    path.setAttribute('d',livePeaks.filter(p=>p.x>=Math.max(0,width-$('.app').clientWidth)&&p.x<=width).map(p=>{const h=Math.max(1,Math.min(38,Math.sqrt(p.peak)*65));return `M${p.x.toFixed(2)} ${(20-h/2).toFixed(2)}h.7v${h.toFixed(2)}h-.7Z`;}).join(''));

    if(cursor*pps>parseFloat($('#timeline').style.width)-labelWidth()-pps*10){$('#timeline').style.width=`${labelWidth()+2*centerPadding()+(cursor+30)*pps}px`;}
  }
  frame=requestAnimationFrame(tick);
}
async function play(){if(mode==='playing'){stop();return;}if(!idle())return;
  if(cursor>=duration())setClock(0);
  await run('再生を開始',async signal=>{if(preparingCapture)await bounded(preparingCapture,{signal}).catch(()=>{});if(!readyInput||output.dirty)cleanupMic();await audio(signal,{capture:!!readyInput});if(signal.aborted)throw new Cancelled();startCursor=cursor;anchor=context.currentTime+.12;sources=schedule(context,anchor,startCursor);mode='playing';job=undefined;update();clockWall=0;tick();timer=setTimeout(stop,Math.max(.1,duration()-startCursor+.15)*1000);});
}
function cleanupMic(){
  prepareController?.abort();prepareController=undefined;readyInput?.dispose();readyInput=undefined;
  const captured=!!stream||!!mic;
  mic?.disconnect();mic=undefined;analyser=undefined;
  stream?.getTracks().forEach(t=>t.stop());stream=undefined;
  // Stop the capture tracks BEFORE switching the native audio session back.
  // iOS can report a running AudioContext even when its old output is silent.
  setAudioMode('playback');if(captured)output.invalidate();updateCaptureReady();
}
function stop(){
  if(mode==='playing'){setClock(startCursor+Math.max(0,context.currentTime-anchor));silence();mode='idle';update();return;}
  if(mode==='recording'){
    setClock(startCursor+Math.max(0,context.currentTime-anchor));silence();mode='busy';$('#busyTitle').textContent='録音を保存';progress('録音ファイルを仕上げています…');update();
    if(recorder?.state!=='inactive')recorder.stop();
    captureWatchdog=setTimeout(()=>{if(mode==='busy'&&captureFinalizer){notice('録音の終了応答が遅いため、取得済みの音声を保存します。');captureFinalizer();}},10000);
  }
}
function renderMicrophoneInput(){
  const select=$('#microphoneInput');select.replaceChildren();
  const auto=document.createElement('option');auto.value='auto';auto.textContent='自動（本体マイクを優先）';select.append(auto);
  for(const device of microphoneDevices.filter(d=>d.kind==='audioinput'&&d.deviceId&&d.label)){
    const option=document.createElement('option');option.value=device.deviceId;option.textContent=device.label;select.append(option);
  }
  if(microphonePreference!=='auto'&&!Array.from(select.options).some(o=>o.value===microphonePreference)){
    const missing=document.createElement('option');missing.value=microphonePreference;missing.textContent='前に選んだマイク（再接続が必要）';select.append(missing);
  }
  select.value=microphonePreference;
  $('#microphoneCurrent').textContent=lastMicrophone?(stream?.getAudioTracks().some(t=>t.readyState==='live')?'現在の入力：':'前回の入力：')+lastMicrophone.label:'マイク接続後に入力を確認できます。';
  $('#wirelessMicNote').hidden=!lastMicrophone||!(isWireless(lastMicrophone.label)||(microphonePreference==='auto'&&!builtInMicrophone(microphoneDevices)));
}
$('#microphoneInput').onchange=()=>{
  if(!idle()){renderMicrophoneInput();return;}
  microphonePreference=$('#microphoneInput').value;try{localStorage.setItem('pocket-booth-microphone',microphonePreference);}catch{}
  cleanupMic();lastMicrophone=undefined;renderMicrophoneInput();prepareRecording().catch(report);
};
function micHelp(){
  renderMicrophoneInput();
  const connected=stream?.getAudioTracks().some(t=>t.readyState==='live');
  $('#micTitle').textContent=connected?'マイク・音質設定':'この画面でマイクを接続';
  $('#micExplanation').textContent='「マイクを接続」を押して、iPhoneの許可画面で「許可」を選んでください。Safariでの許可を引き継ぐのではなく、この画面から接続します。';
  if(connected)$('#micExplanation').textContent='録音に使うマイクを選べます。声が小さい・こもる場合は、iPhone本体のマイクで比べてください。';
  $('#retryMic').textContent=connected?'マイクを確認':'マイクを接続';$('#micResult').hidden=!connected;$('#micDiagnostic').hidden=true;
  const env=captureEnvironment();$('#micEnvironment').textContent=`STUDIO ${BUILD.padStart(2,'0')} · ${env.standalone?'ホーム画面版':'ブラウザ版'}`;
  $('#openSafari').href=location.origin+location.pathname+'?v='+BUILD;
  if(!$('#micDialog').open)$('#micDialog').showModal();
}
async function showCaptureFailure(e){
  lastCaptureError=e;micDiagnostic={version:BUILD,time:new Date().toISOString(),stage:'microphone-capture',errorName:e.originalName,message:e.message,...e.environment};
  micHelp();$('#micTitle').textContent='マイクの接続エラー';$('#retryMic').textContent='もう一度接続する';
  const apply=permission=>{
    const kind=captureFailureKind(e,permission);micDiagnostic.permission=permission;micDiagnostic.kind=kind;
    $('#micExplanation').textContent=kind==='policy'?'この画面の表示方法によってマイクが制限されています。下のリンクからサイトを直接開いてください。':kind==='device'?'iPhoneの音声機能がマイクを開始できていません。権限の拒否とは別の問題です。「保存して録音を再起動」を試してください。':kind==='denied'?'このホーム画面版でマイクが拒否されています。Safari側の許可をコピーすることはできません。下の設定手順で「確認」または「許可」に変更してください。':kind==='missing'?'マイクが見つかりません。接続を確認してから再度お試しください。':kind==='security'?'HTTPSの正式なURLを開いてください。':'マイクの取得に失敗しました。許可の拒否か、iPhoneの録音機能の不調かは、この結果だけでは特定できません。再接続か「保存して録音を再起動」を試してください。';
    $('#micDiagnostic').hidden=false;$('#diagnosticText').textContent=JSON.stringify(micDiagnostic,null,2);
  };apply('unknown');
  try{const status=await bounded(navigator.permissions.query({name:'microphone'}),{ms:5000});if(lastCaptureError===e)apply(status.state);}catch{}
}
function microphoneRequest(){setAudioMode('play-and-record');return requestCapture({existing:stream,deviceId:microphonePreference==='auto'?'':microphonePreference});}
async function acquireMicrophone(request,signal){
  request.then(s=>{if(signal.aborted)s.getTracks().forEach(t=>t.stop());},()=>{});
  let value=await bounded(request,{signal,ms:30000,message:'マイクの応答がありません。許可画面やSafariの設定を確認してください。'});
  if(signal.aborted||document.hidden){value.getTracks().forEach(t=>t.stop());throw new Cancelled();}
  stream=value;micState='allowed';lastCaptureError=undefined;
  try{microphoneDevices=await bounded(navigator.mediaDevices.enumerateDevices(),{signal,ms:1500});}catch{}
  if(signal.aborted||document.hidden){value.getTracks().forEach(t=>t.stop());throw new Cancelled();}
  const preferred=microphonePreference==='auto'?builtInMicrophone(microphoneDevices):undefined;
  const current=microphoneDescription(value.getAudioTracks()[0]);
  if(preferred&&current.deviceId!==preferred.deviceId&&current.label!==preferred.label){
    if(mode==='playing')stop();value.getTracks().forEach(t=>t.stop());stream=undefined;output.invalidate();
    const retry=requestCapture({deviceId:preferred.deviceId});retry.then(s=>{if(signal.aborted)s.getTracks().forEach(t=>t.stop());},()=>{});
    try{value=await bounded(retry,{signal,ms:10000});}catch(error){if(signal.aborted)throw error;const fallback=requestCapture();fallback.then(s=>{if(signal.aborted||document.hidden)s.getTracks().forEach(t=>t.stop());},()=>{});value=await bounded(fallback,{signal,ms:10000});}
    if(signal.aborted||document.hidden){value.getTracks().forEach(t=>t.stop());throw new Cancelled();}stream=value;
  }
  lastMicrophone=microphoneDescription(value.getAudioTracks()[0]);renderMicrophoneInput();return value;
}
async function authorizeMic(){
  if(!idle()&&!(mode==='playing'&&!job))return;
  $('#micDialog').close();$('#menuDialog').close();let request;try{request=microphoneRequest();}catch(e){report(e);return;}
  request.catch(()=>{});
  await run('マイクの使用許可',async signal=>{
    progress('この画面の許可リクエストを待っています');await acquireMicrophone(request,signal);showMicTest();
  },{duringPlayback:true});
}
$('#micSetup').onclick=()=>micHelp();$('#enableMic').onclick=()=>{$('#menuDialog').close();micHelp();};$('#retryMic').onclick=authorizeMic;
let micTestRecorder,micTestTimer,micTestUrl;
function showMicTest(){
  micHelp();$('#micTitle').textContent='マイクに接続できました';$('#micExplanation').textContent='この画面でマイクを取得できました。「3秒テスト」で声が録れるか確認できます。閉じて赤い録音ボタンを押すと、ビートと一緒に録音できます。';$('#micResult').hidden=false;$('#retryMic').textContent='再接続する';
}
$('#testMic').onclick=()=>{
  if(!stream||micTestRecorder?.state==='recording')return;
  try{const chunks=[],mime=['audio/mp4','audio/webm;codecs=opus','audio/webm'].find(x=>MediaRecorder.isTypeSupported(x));micTestRecorder=new MediaRecorder(stream,mime?{mimeType:mime}:undefined);
    micTestRecorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};micTestRecorder.onstop=async()=>{cleanupMic();clearTimeout(micTestTimer);$('#testMic').disabled=true;$('#testMic').textContent='もう一度3秒テスト';if(micTestUrl)URL.revokeObjectURL(micTestUrl);let testBlob=new Blob(chunks,{type:micTestRecorder.mimeType});try{const buffer=await decode(await testBlob.arrayBuffer()),db=recommendVoiceGain(buffer),offline=new OfflineAudioContext(buffer.numberOfChannels,buffer.length,buffer.sampleRate),source=offline.createBufferSource();source.buffer=buffer;connectVoiceLevel(offline,source,offline.destination,db);source.start();testBlob=encodeWav(await bounded(offline.startRendering(),{ms:10000}));}catch{}micTestUrl=URL.createObjectURL(testBlob);$('#micTestAudio').src=micTestUrl;$('#micTestAudio').hidden=false;$('#micTestMessage').textContent='録音できました。自動音量調整後の声を再生して確認してください。';$('#testMic').disabled=false;};micTestRecorder.start();$('#testMic').disabled=true;$('#testMic').textContent='テスト録音中…';$('#micTestMessage').textContent='マイクに向かって話してください。';micTestTimer=setTimeout(()=>{if(micTestRecorder.state==='recording')micTestRecorder.stop();},3000);
  }catch(e){report(e);}
};
$('#micDialog').addEventListener('close',()=>{if(micTestRecorder?.state==='recording')micTestRecorder.stop();clearTimeout(micTestTimer);$('#micTestAudio').pause();});
$('#copyDiagnostic').onclick=async()=>{if(!micDiagnostic)return;const text=JSON.stringify(micDiagnostic,null,2);try{await navigator.clipboard.writeText(text);$('#copyDiagnostic').textContent='コピーしました';}catch{$('#diagnosticText').focus();const selection=window.getSelection(),range=document.createRange();range.selectNodeContents($('#diagnosticText'));selection.removeAllRanges();selection.addRange(range);}};
$('#restartCapture').onclick=async()=>{
  if(mode==='recording')return;if(mode==='playing')stop();if(!idle())return;
  if(!await persist())return;cleanupMic();if(context){try{await bounded(context.close(),{ms:2000});}catch{}context=undefined;output.invalidate();}decoder=undefined;
  let latest=BUILD;try{const r=await fetch('./version.json?check='+Date.now(),{cache:'no-store'});if(r.ok)latest=String((await r.json()).version);}catch{}
  const url=new URL(location.href);url.searchParams.set('v',latest);url.searchParams.set('micRecovery',Date.now());if(project)url.searchParams.set('resumeProject',project.id);location.replace(url.href);
};
function updateCaptureReady(){
  const ready=!!readyInput&&context?.state==='running'&&!output.dirty;
  $('#captureReady').textContent=mode==='recording'?'':ready?'録音準備完了':preparingCapture?'マイク準備中…':'';
  $('#record').classList.toggle('capture-ready',ready);
}
function prepareRecording(){
  if(readyInput&&context?.state==='running'&&!output.dirty&&stream?.getAudioTracks().some(t=>t.readyState==='live'))return Promise.resolve(readyInput);
  if(preparingCapture?.captureController.signal.aborted)preparingCapture=undefined;
  if(preparingCapture){if(context?.state==='suspended')context.resume().catch(()=>{});return preparingCapture;}
  if(readyInput)cleanupMic();
  const controller=new AbortController();prepareController=controller;
  let request;try{request=microphoneRequest();}catch(e){return Promise.reject(e);}
  const pending=(async()=>{
    await acquireMicrophone(request,controller.signal);await audio(controller.signal,{capture:true});
    const observation=recordingDiagnostics?.prepare(context,stream);
    const input=await createPcmRecorder(context,stream,{signal:controller.signal,onDiagnostic:observation?.observe});
    if(observation)recordingDiagnostics.register(input,observation);
    if(controller.signal.aborted||document.hidden){input.dispose();throw new Cancelled();}
    readyInput=input;return input;
  })();
  pending.captureController=controller;preparingCapture=pending;updateCaptureReady();
  pending.then(()=>{},()=>{if(prepareController===controller)cleanupMic();}).finally(()=>{if(preparingCapture===pending)preparingCapture=undefined;if(prepareController===controller)prepareController=undefined;updateCaptureReady();});
  return pending;
}
async function warmRecordingIfAllowed(){
  if(!project||document.hidden||!idle())return;
  const id=project.id;
  let allowed=micState==='allowed';
  if(!allowed)try{allowed=(await navigator.permissions.query({name:'microphone'})).state==='granted';}catch{}
  if(allowed&&project?.id===id&&!document.hidden&&idle())prepareRecording().catch(()=>{});
}
$('#record').addEventListener('pointerdown',()=>{if((idle()||mode==='playing')&&!job)prepareRecording().catch(()=>{});});
async function record(){
  if(mode==='recording'){stop();return;}if(!idle()&&!(mode==='playing'&&!job))return;

  if(cursor>=MAX){notice('録音位置が10分の上限です。先頭へ戻してください。');return;}
  const tappedAt=performance.now(),requestedCursor=mode==='playing'?startCursor+Math.max(0,context.currentTime-anchor):cursor;
  const prepared=prepareRecording();prepared.catch(()=>{});
  await run('マイクを準備',async signal=>{
    progress('録音を開始しています…');
    const input=await bounded(prepared,{signal});readyInput=undefined;
    let continuing=mode==='playing';
    const target=currentTrack();let t=target?.kind==='voice'?target:tracks.find(t=>t.kind==='voice'&&!t.clips.length);
    if(!t){t=makeTrack('voice',`ボーカル ${tracks.filter(t=>t.kind==='voice').length+1}`);tracks.push(t);}selected=t.id;recordTrack=t;recordName=`テイク ${t.clips.length+1}`;
    const chunks=[];recorder=input;
    input.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
    input.onerror=()=>{notice('録音が中断されました。保存できた部分を確認してください。');if(mode==='recording')stop();};
    let takeClock,takeTimeline,takeDiagnostic;
    let finished=false;const finalize=()=>{if(finished)return;finished=true;clearTimeout(captureWatchdog);if(captureFinalizer===finalize)captureFinalizer=undefined;if(!chunks.length)input.requestData();recordOrigin=takeOrigin(takeTimeline,takeClock,input.startTime,input.latency);const diagnosticId=takeDiagnostic?.finish({savedStart:recordOrigin});const captureTiming={readings:input.latencyReadings,automaticAppliedMs:-takeOrigin(0,0,0,input.latency)*1000,sampleRate:context.sampleRate,microphone:stream?.getAudioTracks()[0]?.label||null,requestedContextTime:takeClock,firstPcmContextTime:input.startTime??null};input.dispose();finishRecording(new Blob(chunks,{type:'audio/wav'}),diagnosticId,captureTiming);};captureFinalizer=finalize;input.onstop=finalize;
    input.onlevel=({time,peak,offset})=>{if(mode!=='recording')return;const safe=takeOrigin(takeTimeline,takeClock,input.startTime,input.latency);const relative=Number.isFinite(offset)?offset:Number.isFinite(input.startTime)?time-input.startTime:0;const x=(safe+Math.max(0,relative)-recordFrom)*pps;livePeaks.push({x,peak});$('#recordMeter').value=Math.min(1,peak*amplitudeFromDb(12));$('#inputLabel').textContent=peak>.98?'入力が大きめです':'録音中';};
    if(continuing&&performance.now()-tappedAt>200){silence();setClock(requestedCursor);continuing=false;}
    if(!continuing)setClock(requestedCursor);
    const captureStart=context.currentTime;input.start();
    if(continuing){
      recordOrigin=startCursor+captureStart-anchor;recordFrom=Math.max(0,recordOrigin);setClock(recordFrom);clearTimeout(timer);
    }else{
      startCursor=cursor;anchor=context.currentTime+.06;recordOrigin=startCursor+captureStart-anchor;recordFrom=startCursor;
      try{sources=schedule(context,anchor,startCursor);}catch(e){input.onstop=undefined;captureFinalizer=undefined;input.stop();input.dispose();recorder=undefined;cleanupMic();throw e;}
    }
    takeClock=captureStart;takeTimeline=recordOrigin;
    takeDiagnostic=recordingDiagnostics?.begin({context,stream,input,timelineStart:takeTimeline,contextStart:takeClock,playbackAnchor:anchor,timelineCursor:startCursor,requestedCursor,tapPerformanceTime:tappedAt,continuing});
    render();const row=$('#trackRows').children[tracks.indexOf(t)],area=row.querySelector('.lanearea');live=document.createElement('div');live.className='clip live';live.style.left=`${centerPadding()+recordFrom*pps}px`;live.innerHTML='<span class="clipname">● REC</span><svg preserveAspectRatio="none"><path/></svg>';area.append(live);livePeaks=[];
    mode='recording';job=undefined;invalidate();update();cancelAnimationFrame(frame);clockWall=0;tick();timer=setTimeout(()=>{stop();notice('10分の上限に達したため録音を停止しました。');},Math.max(0,MAX-recordFrom)*1000);
    stream.getAudioTracks()[0].onended=()=>{if(mode==='recording')stop();};
  },{duringPlayback:true});
  if((mode==='idle'||mode==='playing')&&!recorder&&!readyInput)cleanupMic();
}
async function finishRecording(blob,diagnosticId,captureTiming){
  cleanupMic();silence();recorder=undefined;live=undefined;mode='idle';
  const c={id:uid(),name:recordName,blob,captureTiming,start:recordOrigin,correction:correctionValue(project?.recordingCorrectionMs),duration:Math.max(.01,cursor-recordOrigin)};recordTrack.clips.push(c);if(diagnosticId)recordingDiagnostics?.attachClip(diagnosticId,c);selectedClip=c.id;setClock(recordFrom);
  await run('録音を保存',async signal=>{
    progress('声の波形を作っています…');
    // Commit the original Blob first. A decoder failure must never discard a take.
    await persist();
    // Retire the old capture context while finalizing the take, before another
    // getUserMedia request can reopen the microphone on the next tap.
    await output.retire(signal);context=undefined;
    try{c.buffer=await bounded(decode(await bounded(blob.arrayBuffer(),{signal})),{signal,ms:30000,message:'録音は保存済みですが、波形の準備に時間がかかっています。再読込をお試しください。'});c.duration=c.buffer.duration;c.gainDb=recommendVoiceGain(c.buffer);}
    catch(e){c.error=e.message;throw e;}finally{await changed();}
  });
  timingVisible=true;updateTiming();warmRecordingIfAllowed();
}
$('#record').onclick=record;$('#stop').onclick=stop;$('#play').onclick=play;$('#rewind').onclick=()=>seek(0);
function previewTimelineZoom(){
  const padding=centerPadding();$('#timeline').style.width=`${labelWidth()+2*padding+timelineExtent()*pps}px`;
  document.querySelectorAll('.mark').forEach(mark=>mark.style.left=`${padding+Number(mark.dataset.second)*pps}px`);
  tracks.forEach((t,i)=>{const area=$('#trackRows').children[i]?.querySelector('.lanearea');if(!area)return;
    const elements=area.querySelectorAll('.clip');t.clips.forEach((c,j)=>{const el=elements[j];if(!el)return;const start=c.start+c.correction/1000,len=c.buffer?.duration||c.duration||5;el.style.left=`${padding+Math.max(0,start)*pps}px`;el.style.width=`${Math.max(.05,len+Math.min(0,start))*pps}px`;if(start<0){el.querySelector('svg').style.width=`${len*pps}px`;el.querySelector('svg').style.transform=`translateX(${start*pps}px)`;}});
  });positionHead();
}
attachPinchZoom($('#timelineScroll'),{canZoom:idle,getScale:()=>pps,setScale:(value,final)=>{pps=value;if(final)render();else previewTimelineZoom();}});
for(const [id,factor] of [['#zoomIn',1.5],['#zoomOut',1/1.5]])$(id).onclick=()=>{pps=Math.max(8,Math.min(100,pps*factor));render();positionHead(true);};
for(const button of document.querySelectorAll('[data-close]'))button.onclick=()=>button.closest('dialog').close();
$('#selectionMenu').onclick=()=>{if(idle()&&currentTrack())$('#trackDialog').showModal();};
$('#help').onclick=()=>$('#helpDialog').showModal();$('#trackSettings').onclick=()=>{if(currentTrack())$('#trackDialog').showModal();};$('#projectSettings').onclick=()=>$('#menuDialog').showModal();$('#libraryHelp').onclick=()=>$('#helpDialog').showModal();$('#menu').onclick=()=>$('#menuDialog').showModal();
async function deliver(blob,name){
  const file=new File([blob],name,{type:blob.type});if(navigator.canShare?.({files:[file]})&&navigator.share){try{await navigator.share({files:[file]});return;}catch(e){if(e.name==='AbortError')return;}}
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
$('#export').onclick=()=>{if(idle())$('#exportDialog').showModal();};
$('#makeExport').onclick=()=>run('ミックスを書き出し',async signal=>{
  progress('全トラックをWAVにまとめています…');const length=Math.ceil(duration()*48000);if(length<=0)throw new Error('音声がありません。');
  const offline=new OfflineAudioContext(2,length,48000);schedule(offline,0);const buffer=await bounded(offline.startRendering(),{signal,ms:60000});if(signal.aborted)throw new Cancelled();exportBlob=encodeWav(buffer,{bitDepth:24});$('#makeExport').hidden=true;$('#saveExport').hidden=false;$('#exportDetail').textContent=`WAVの準備ができました · ${(exportBlob.size/1048576).toFixed(1)} MB`;
});
$('#saveExport').onclick=()=>{if(exportBlob)deliver(exportBlob,`PocketBooth-${new Date().toISOString().slice(0,10)}.wav`);};
$('#backup').onclick=()=>run('バックアップを作成',async signal=>{
  const data=payload();for(const t of data)for(const c of t.clips){c.data=await bounded(new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.readAsDataURL(c.blob);}),{signal,ms:20000});delete c.blob;}
  backupBlob=new Blob([JSON.stringify({format:'pocket-booth',version:3,name:project?.name,lyrics:project?.lyrics||'',recordingCorrectionMs:correctionValue(project?.recordingCorrectionMs),tracks:data})],{type:'application/json'});$('#backupReady').replaceChildren();const b=document.createElement('button');b.className='primary';b.textContent='バックアップを保存する ↓';b.onclick=()=>deliver(backupBlob,'PocketBooth-backup.json');$('#backupReady').append(b);
});
$('#restoreButton').onclick=()=>{$('#menuDialog').close();$('#restore').click();};
$('#restore').onchange=e=>{const file=e.target.files[0];e.target.value='';if(!file||!idle())return;if(file.size>180*1048576)return notice('バックアップは180MBまでです。');if(!confirm('現在開いている曲の内容を置き換えますか？他の曲は変更されません。'))return;
  run('バックアップを復元',async signal=>{
    const data=JSON.parse(await bounded(file.text(),{signal}));if(data.format!=='pocket-booth'||![1,2,3].includes(data.version)||!Array.isArray(data.tracks)||data.tracks.length>60)throw new Error('対応していないバックアップです。');
    const incoming=migrate(data.tracks);
    for(const t of incoming){if(!['voice','file'].includes(t.kind)||typeof t.name!=='string'||!Number.isFinite(t.volume)||t.volume<0||t.volume>1||t.clips.length>100)throw new Error('バックアップのトラックが不正です。');
      for(const c of t.clips){
        // Version 1 stored audio data on the track itself.
        const encoded=c.data||data.tracks.find(x=>x.id===t.id)?.data;
        if(t.color!==undefined&&!/^#[0-9a-f]{6}$/i.test(t.color))throw new Error('トラックの色が不正です。');
        if(c.gainDb!==undefined&&(!Number.isFinite(c.gainDb)||c.gainDb<0||c.gainDb>48))throw new Error('声の増幅値が不正です。');
        if(!Number.isFinite(c.start)||c.start < -10||c.start>MAX||!Number.isFinite(c.correction)||Math.abs(c.correction)>5000||typeof encoded!=='string'||!/^data:(audio|video|application)\/[^,]*;base64,/.test(encoded))throw new Error('音声データの形式が不正です。');
        const [meta,base64]=encoded.split(','),raw=atob(base64),bytes=Uint8Array.from(raw,ch=>ch.charCodeAt(0));const blob=new Blob([bytes],{type:meta.slice(5).split(';')[0]});
        const result=await importMedia(new File([blob],c.name||'audio.m4a',{type:blob.type}),{signal,progress,decode});Object.assign(c,result);delete c.data;
      }
    }tracks=incoming;project.recordingCorrectionMs=correctionValue(data.recordingCorrectionMs);timingVisible=false;project.lyrics=typeof data.lyrics==='string'?data.lyrics:'';$('#lyricsText').value=project.lyrics;selected=tracks[0]?.id;selectedClip=undefined;setClock(0);changed();
  });
};
$('#demo').onclick=()=>{$('#addDialog').close();return run('デモビートを作成',async signal=>{
  const rate=44100,b=new OfflineAudioContext(1,1,rate).createBuffer(1,rate*16,rate),a=b.getChannelData(0),beat=60/90;let seed=12345;
  for(let step=0;step<24;step++){const start=Math.floor(step*beat*rate);for(let j=0;j<rate*.2&&start+j<a.length;j++){const t=j/rate;a[start+j]+=.6*Math.sin(2*Math.PI*(48*t+3*(1-Math.exp(-t*30))))*Math.exp(-t*22);}if(step%2)for(let j=0;j<rate*.12&&start+j<a.length;j++){seed=(Math.imul(seed,1664525)+1013904223)|0;a[start+j]+=((seed>>>0)/4294967296*2-1)*.25*Math.exp(-j/rate*40);}for(let k=0;k<2;k++)for(let j=0;j<rate*.04;j++){const ix=start+Math.floor(k*beat*rate/2)+j;if(ix>=a.length)break;seed=(Math.imul(seed,1664525)+1013904223)|0;a[ix]+=((seed>>>0)/4294967296*2-1)*.1*Math.exp(-j/rate*120);}}
  const t=tracks.find(t=>t.kind==='file'&&!t.clips.length)||makeTrack('file','Demo / 90 BPM');if(!tracks.includes(t))tracks.push(t);t.name='Demo / 90 BPM';t.clips.push({id:uid(),name:'Late Night · 90 BPM',buffer:b,blob:encodeWav(b),start:0,correction:0});selected=tracks.find(t=>t.kind==='voice')?.id||t.id;changed();
});};
document.addEventListener('visibilitychange',()=>{if(document.hidden){if(isPlaying()){const recording=mode==='recording';stop();if(!recording)cleanupMic();notice('画面を離れたため停止しました。録音した部分は保存します。');}else{cleanupMic();persist();}}});
window.addEventListener('pagehide',()=>{if(isPlaying())stop();if(mode!=='busy')cleanupMic();persist();});window.addEventListener('resize',()=>{if(idle())render();});
boot();checkUpdate();
