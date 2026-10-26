import{test}from'node:test';import assert from'node:assert/strict';import{recommendVoiceGain,amplitudeFromDb}from'../dist/voice-level.mjs';
const buffer=a=>({numberOfChannels:1,getChannelData:()=>new Float32Array(a)});
test('quiet speech receives a substantial boost',()=>{const gain=recommendVoiceGain(buffer([.001,-.001,.001,-.001]));assert.ok(gain>=46);assert.ok(amplitudeFromDb(gain)>190);});
test('normal voice receives the louder default, already loud voice is preserved',()=>{assert.equal(recommendVoiceGain(buffer([.1,-.1,.1,-.1])),7);assert.equal(recommendVoiceGain(buffer([.3,-.3,.3,-.3])),0);});
test('silence is not amplified into noise',()=>assert.equal(recommendVoiceGain(buffer([0,0,0,0])),0));
test('gain is bounded and robust to invalid input',()=>{assert.equal(amplitudeFromDb(100),amplitudeFromDb(48));assert.equal(amplitudeFromDb(NaN),1);});

test('long pauses do not cause over-amplification of spoken phrases',()=>{const data=new Float32Array(48000);data.fill(.02,24000,33600);assert.equal(recommendVoiceGain({sampleRate:48000,numberOfChannels:1,getChannelData:()=>data}),21);});
