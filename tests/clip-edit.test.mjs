import {test} from 'node:test';import assert from 'node:assert/strict';import {takeOrigin,movedStart} from '../dist/clip-edit.mjs';
test('a reset or invalid worklet clock cannot throw a 90-second take to the start',()=>{for(const bad of [0,NaN,undefined,-10,999])assert.equal(takeOrigin(90,125,bad,.02),89.98);});
test('a valid first-sample delay remains part of the take placement',()=>assert.equal(takeOrigin(90,125,125.02,.02),90));
test('move respects correction, negative lead-in and timeline boundaries',()=>{assert.equal(movedStart(10,56,28,-500),12);assert.equal(movedStart(1,-999,28,-500),.5);assert.equal(movedStart(-.25,28,28),.75);assert.equal(movedStart(590,9999,28),600);});
test('bundled worklet stays identical to its standalone source',async()=>{const {readFile}=await import('node:fs/promises');const {processorSource}=await import('../dist/pcm-source.mjs');assert.equal(processorSource,await readFile(new URL('../dist/pcm-worklet.js',import.meta.url),'utf8'));});
