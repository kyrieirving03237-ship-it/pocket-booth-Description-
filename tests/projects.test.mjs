import {test} from 'node:test';
import assert from 'node:assert/strict';
import {projectSummary} from '../dist/project-store.mjs';
test('project list metadata includes every clip and its corrected tail',()=>{
  const p={id:'A',name:'曲A',createdAt:1,updatedAt:2,tracks:[{clips:[{duration:240,start:0,correction:0}]},{clips:[{duration:12,start:238,correction:50}]}]};
  assert.deepEqual(projectSummary(p),{id:'A',name:'曲A',createdAt:1,updatedAt:2,trackCount:2,clipCount:2,duration:250.05});
});
test('new empty project is independent and has zero duration',()=>{
  assert.equal(projectSummary({id:'B',name:'B',tracks:[{clips:[]},{clips:[]}]}).duration,0);
});
