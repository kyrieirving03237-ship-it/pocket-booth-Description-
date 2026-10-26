import {test} from 'node:test';
import assert from 'node:assert/strict';
import {placement,mixDuration,encodeWav} from '../dist/audio-utils.mjs';
test('recording lead-in is trimmed and late voice moves earlier',()=>{
  assert.deepEqual(placement(-.25,-50),{delay:0,offset:.3});
});
test('moving a voice later preserves delayed start',()=>{
  assert.deepEqual(placement(-.25,400),{delay:.15000000000000002,offset:0});
});
test('timeline skip trims the correct amount',()=>{
  assert.deepEqual(placement(0,50,2),{delay:0,offset:1.95});
});
test('export length includes delayed tail and accepts empty session',()=>{
  assert.equal(mixDuration([]),0);
  assert.equal(mixDuration([{buffer:{duration:10},start:0,correction:0},{buffer:{duration:12},start:-.25,correction:500}]),12.25);
});
test('WAV is interleaved PCM16, preserves sample rate and clips safely',async()=>{
  const blob=encodeWav({numberOfChannels:2,length:3,sampleRate:48000,getChannelData:i=>i===0?[-2,0,.5]:[2,-.5,1]});
  const v=new DataView(await blob.arrayBuffer());
  assert.equal(blob.type,'audio/wav');assert.equal(v.byteLength,56);
  assert.equal(v.getUint16(22,true),2);assert.equal(v.getUint32(24,true),48000);
  assert.equal(v.getUint32(40,true),12);
  assert.equal(v.getInt16(44,true),-32768);assert.equal(v.getInt16(46,true),32767);
  assert.equal(v.getInt16(48,true),0);assert.equal(v.getInt16(50,true),-16384);
});
test('24-bit WAV preserves small signals and full scale at native sample rate',async()=>{
 const blob=encodeWav({numberOfChannels:1,length:4,sampleRate:48000,getChannelData:()=>[-1,1,1/8388607,0]},{bitDepth:24});
 const view=new DataView(await blob.arrayBuffer());assert.equal(view.getUint16(34,true),24);assert.equal(view.getUint16(32,true),3);assert.equal(view.getUint32(28,true),144000);assert.equal(view.getUint32(40,true),12);
 assert.deepEqual([...new Uint8Array(view.buffer,44)],[0,0,128,255,255,127,1,0,0,0,0,0]);
});
