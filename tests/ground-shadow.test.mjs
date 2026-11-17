import {test} from 'node:test';
import assert from 'node:assert/strict';
import {groundShadow} from '../src/ground-shadow.js';

const support=[-2,-1,-.5, 2,-1,-.5, 2,-1,.5, -2,-1,.5, 0,1,0];
test('caches a bounded soft mask per immutable capture, preserving its elongated footprint',()=>{
 const data={display:{support}};
 const shadow=groundShadow(data);
 assert.equal(groundShadow(data),shadow);
 assert.equal(shadow.size,64);
 assert.equal(shadow.pixels.length,4096);
 assert.ok(shadow.bounds[2]>shadow.bounds[3]*2);
 assert.ok(Math.abs(shadow.floor-(-1.004))<1e-12);
 assert.ok(Math.max(...shadow.pixels)>40);
 assert.ok(Math.max(...shadow.pixels)<140);
 assert.equal(shadow.pixels[0],0);
 assert.notEqual(groundShadow({display:{support}}),shadow);
});

test('keeps the shadow slightly below a flat ground plane at every model scale',()=>{
 for(const scale of [1e-6,1,1e6]){
  const support=[-scale,0,-scale,scale,0,-scale,scale,0,scale,-scale,0,scale];
  const shadow=groundShadow({display:{support}});
  assert.ok(shadow.floor<0,'Shadow is coplanar with the model ground');
  assert.ok(Math.abs(shadow.floor/(scale*2)+.001)<1e-12,'Floor offset must scale with the footprint');
 }
});
test('missing or invalid support has no shadow, without inventing bounds',()=>{
 assert.equal(groundShadow({}),null);
 assert.equal(groundShadow({display:{support:[NaN,0,0]}}),null);
});
