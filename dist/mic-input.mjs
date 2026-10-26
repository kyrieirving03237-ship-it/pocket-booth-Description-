export function builtInMicrophone(devices){
 return devices.find(d=>d.kind==='audioinput'&&d.deviceId&&!['default','communications'].includes(d.deviceId)&&!isWireless(d.label)&&/(iphone|ipad|built.?in|internal|内蔵|本体)/i.test(d.label));
}
export const isWireless=label=>/(bluetooth|airpods?|wireless|無線|buds)/i.test(label||'');
export function microphoneDescription(track){
 const settings=track?.getSettings?.()||{};return {label:track?.label||'ブラウザ既定のマイク（名前非公開）',deviceId:settings.deviceId||'',sampleRate:settings.sampleRate||0};
}
