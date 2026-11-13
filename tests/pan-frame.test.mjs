import {test} from 'node:test';
import assert from 'node:assert/strict';
import {panFrame} from '../src/bounds-fit.js';
import {camera} from '../src/webgpu.js';
test('screen panning translates projection without changing fitting, orbit or the source layout',()=>{
 const layout={sx:1,sy:1,cx:0,cy:0};
 const view={yaw:.5,pitch:.3,distance:5,frameRatio:1,layout};
 const before=camera(view,300,300),after=camera({...view,layout:panFrame(layout,.2,.1)},300,300);
 const project=m=>[m[12]/m[15],m[13]/m[15]];
 const a=project(before.matrix),b=project(after.matrix);
 assert.ok(Math.abs(b[0]-a[0]-.4)<1e-6);assert.ok(Math.abs(b[1]-a[1]+.2)<1e-6);
 assert.deepEqual(before.eye,after.eye);assert.deepEqual(layout,{sx:1,sy:1,cx:0,cy:0});
 assert.deepEqual(panFrame(layout,0,0),layout);
});
