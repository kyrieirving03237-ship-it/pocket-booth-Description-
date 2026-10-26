export class CaptureError extends Error{
  constructor(cause,environment){super(cause.message||'マイクを開始できませんでした。');this.name='CaptureError';this.originalName=cause.name||'Error';this.cause=cause;this.environment=environment;}
}
export function captureEnvironment(win=window,nav=navigator,doc=document){
  let policy=null;try{policy=(doc.permissionsPolicy||doc.featurePolicy)?.allowsFeature('microphone')??null;}catch{}
  return {secure:!!win.isSecureContext,standalone:!!(nav.standalone||win.matchMedia('(display-mode: standalone)').matches),topLevel:win.top===win.self,policy,visibility:doc.visibilityState,origin:win.location.origin,userAgent:nav.userAgent};
}
export function requestCapture({existing,deviceId='',environment=captureEnvironment(),mediaDevices=navigator.mediaDevices}={}){
  if(existing?.getAudioTracks().some(t=>t.readyState==='live'&&(!deviceId||t.getSettings?.().deviceId===deviceId)))return Promise.resolve(existing);
  const fail=(name,message)=>Promise.reject(new CaptureError({name,message},environment));
  if(!environment.secure)return fail('SecurityError','HTTPSのページで録音してください。');
  if(!mediaDevices?.getUserMedia)return fail('NotSupportedError','この画面ではマイク機能を利用できません。');
  try{
    // Request capture synchronously from the tap and configure quality once.
    // Reconfiguring the track after permission can stall iOS for seconds.
    return mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:true,channelCount:{ideal:1},sampleRate:{ideal:48000},sampleSize:{ideal:24},...(deviceId?{deviceId:{exact:deviceId}}:{})},video:false}).catch(e=>{throw new CaptureError(e,environment);});
  }catch(e){return Promise.reject(new CaptureError(e,environment));}
}
export function captureFailureKind(error,permission='unknown'){
  const name=error.originalName||error.name,message=error.message||'',env=error.environment||{};
  if(env.policy===false||name==='PolicyError')return 'policy';
  if(env.secure===false||name==='SecurityError')return 'security';
  if(/AVAudioSession|capturedevice|audio device|media.?services/i.test(message)||name==='NotReadableError'||name==='AbortError')return 'device';
  if(name==='NotFoundError')return 'missing';
  if(permission==='denied')return 'denied';
  return 'unknown';
}
export async function optimizeCapture(stream){
  const track=stream.getAudioTracks()[0];
  // Failure here must never turn a granted permission into a failed recording.
  try{await track?.applyConstraints?.({echoCancellation:false,noiseSuppression:false,autoGainControl:true,channelCount:{ideal:1},sampleRate:{ideal:48000},sampleSize:{ideal:24}});}catch{}
  return stream;
}
