import {test} from 'node:test';
import assert from 'node:assert/strict';
import {boundsFrame,orbitEye} from '../src/bounds-fit.js';
import {frameLayout} from '../src/responsive.js';
import {camera} from '../src/webgpu.js';
import {PerspectiveCamera,Vector3} from 'three';

test('bounds fitting replaces the authored crop with a centered 30-degree padded camera',()=>{
	const fit=boundsFrame([-2,-1,-.5,2,1,.5],{aspect:4/3});
	const view={yaw:Math.PI/4,pitch:Math.PI/9,distance:fit.distance};
	const element={...view,boundsFit:fit,metadata:{frame:[.4,.4,.1,.1]},frameRatio:fit.aspect,naturalWidth:100,orbitFit:'fixed'};
	element.layout=frameLayout(element,400,300,{objectFit:'contain',objectPosition:'50% 50%'});
	const actual=camera(element,400,300);
	assert(Math.abs(actual.focal-1/Math.tan(Math.PI/12))<1e-6);
	assert.deepEqual(fit.center,[0,0,0]);
	assert.equal(element.layout.cx,0);assert.equal(element.layout.cy,0);
	const before=JSON.stringify(fit);view.yaw=2;assert.equal(JSON.stringify(fit),before);
	assert(fit.distance>Math.hypot(2,1,.5));
});
test('portrait viewports gain distance and off-center geometry keeps its true orbit center',()=>{
	const points=[1,2,3,5,4,4];
	const wide=boundsFrame(points,{aspect:2}),portrait=boundsFrame(points,{aspect:.5});
	assert(portrait.distance>wide.distance);assert.deepEqual(wide.center,[3,3,3.5]);
	assert.deepEqual(orbitEye({yaw:0,pitch:0,distance:5},wide.center),[3,3,8.5]);
});
test('rejects invalid fitting inputs instead of producing a clipped or nonfinite camera',()=>{
	for(const points of [[],[NaN,0,0],[0,0,0]])assert.throws(()=>boundsFrame(points,{aspect:1}));
	assert.throws(()=>boundsFrame([-1,-1,-1,1,1,1],{aspect:0}));
});
test('projects off-center points like a conventional 30-degree camera for both viewport shapes',()=>{
	for(const aspect of [.6,1.5]){
		const fit=boundsFrame([1,2,3,5,4,4],{aspect});
		const view={yaw:.8,pitch:.35,distance:fit.distance};
		const element={...view,boundsFit:fit,frameRatio:aspect,naturalWidth:100,orbitFit:'fixed'};
		element.layout=frameLayout(element,300*aspect,300,{objectFit:'contain',objectPosition:'50% 50%'});
		const actual=camera(element,300*aspect,300),reference=new PerspectiveCamera(30,aspect,.01,100);
		reference.position.fromArray(orbitEye(view,fit.center));reference.lookAt(new Vector3(...fit.center));reference.updateMatrixWorld();
		for(const point of [[1,2,3],[5,4,4],[3,3,3.5]]){
			const expected=new Vector3(...point).project(reference),m=actual.matrix,p=[...point,1];
			const clip=[0,1,2,3].map(row=>p.reduce((sum,value,column)=>sum+value*m[column*4+row],0));
			assert(Math.abs(clip[0]/clip[3]-expected.x)<1e-5);
			assert(Math.abs(clip[1]/clip[3]-expected.y)<1e-5);
		}
	}
});
test('pitch beyond the orbit limit stops at the limit instead of crossing over the pole',()=>{
	for(const sign of [1,-1]){
		const limit=orbitEye({yaw:.3,pitch:sign*1.5,distance:4});
		for(const pitch of [1.6,Math.PI/2,2,3])assert.deepEqual(orbitEye({yaw:.3,pitch:sign*pitch,distance:4}),limit);
		const expected=camera({yaw:.3,pitch:sign*1.5,distance:4},200,100);
		for(const pitch of [Math.PI/2,2]){
			const actual=camera({yaw:.3,pitch:sign*pitch,distance:4},200,100);
			assert.deepEqual(actual.eye,expected.eye);assert.deepEqual([...actual.matrix],[...expected.matrix]);
		}
	}
});
