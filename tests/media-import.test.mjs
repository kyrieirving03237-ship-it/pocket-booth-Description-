import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {extractMP4Audio,bounded,importMedia} from '../dist/media-import.mjs';
test('extracts audio-only MP4 without decoding video',async()=>{
  const bytes=await readFile(new URL('./fixtures/short-video.mp4',import.meta.url));
  const blob=await extractMP4Audio(new File([bytes],'clip.mp4',{type:'video/mp4'}));
  const out=new Uint8Array(await blob.arrayBuffer());const text=new TextDecoder('latin1').decode(out);
  assert.ok(text.includes('soun'));assert.ok(!text.includes('vide'));assert.ok(blob.size<bytes.byteLength);
});
test('video without audio gives a clear failure',async()=>{
  const bytes=await readFile(new URL('./fixtures/no-audio.mp4',import.meta.url));
  await assert.rejects(extractMP4Audio(new File([bytes],'silent.mp4')),/音声トラック/);
});
test('cancel unwinds a promise that never resolves',async()=>{
  const c=new AbortController(),p=bounded(new Promise(()=>{}),{signal:c.signal,ms:5000});c.abort();await assert.rejects(p,{name:'AbortError'});
});
test('timeout unwinds a promise that never resolves',async()=>{
  await assert.rejects(bounded(new Promise(()=>{}),{ms:10,message:'timed out'}),/timed out/);
});
test('import decodes without calling AudioContext resume',async()=>{
  let called=false;const file=new File(['audio'],'song.mp3',{type:'audio/mpeg'});
  const result=await importMedia(file,{decode:async()=>{called=true;return {duration:240};}});
  assert.equal(called,true);assert.equal(result.buffer.duration,240);
});
test('corrupt video rejects and never reaches decode',async()=>{
  await assert.rejects(importMedia(new File(['not a video'],'broken.mov'),{decode:()=>{throw Error('unexpected');}}),/構造|切れ|情報/);
});

test('extracts a QuickTime MOV audio track',async()=>{
  const bytes=await readFile(new URL('./fixtures/short-video.mov',import.meta.url));
  const blob=await extractMP4Audio(new File([bytes],'clip.mov',{type:'video/quicktime'}));
  const text=new TextDecoder('latin1').decode(await blob.arrayBuffer());
  assert.ok(text.includes('soun'));assert.ok(!text.includes('vide'));
});

test('original audio survives decoders that detach their input buffer',async()=>{
 const original=new Uint8Array([82,73,70,70,1,2,3,4,87,65,86,69]);
 const result=await importMedia(new File([original],'voice.wav',{type:'audio/wav'}),{decode:async bytes=>{
  structuredClone(bytes,{transfer:[bytes]});assert.equal(bytes.byteLength,0);return {duration:1};
 }});
 assert.equal(result.blob.size,original.byteLength);assert.deepEqual(new Uint8Array(await result.blob.arrayBuffer()),original);
});
