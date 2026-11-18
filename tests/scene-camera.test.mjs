import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PerspectiveCamera,Vector3,Matrix4} from 'three';
import {sceneInstance,sceneProjection,instanceCamera,sceneHitTest,sceneBounds} from '../src/scene-camera.js';
const data=points=>({display:{support:points}});
const points=[-1,-2,-.5,1,2,.5];
test('normalizes different captures by radius and places their base centers on the same world plane',()=>{
 for(const support of [points,[1,3,2,5,4,6]]){
  const instance=sceneInstance(data(support),{position:[2,0,-3],yaw:.7,scale:1});
  const ground=new Vector3((support[0]+support[3])/2,support[1],(support[2]+support[5])/2).applyMatrix4(new Matrix4().fromArray(instance.model));
  assert(ground.distanceTo(new Vector3(2,0,-3))<1e-6);
 }
});
test('uses one perspective camera for every instance, matching a conventional 3D scene',()=>{
 const instances=[sceneInstance(data(points),{position:[-3,0,-2],yaw:.4,scale:1}),sceneInstance(data(points),{position:[4,0,1],yaw:-.3,scale:1})];
 for(const height of [18,6]){
  const settings={eye:[0,height,21],target:[0,1,-4],fit:false,fov:45};
  const shared=sceneProjection(settings,1200,700,instances);
  const reference=new PerspectiveCamera(45,1200/700,.01,200);reference.position.fromArray(settings.eye);reference.lookAt(new Vector3(...settings.target));reference.updateMatrixWorld();
  for(const instance of instances){
   const view=instanceCamera(shared,instance),matrix=new Matrix4().fromArray(view.matrix);
   for(const p of [[-1,-2,-.5],[1,2,.5],[0,-2,0]]){
    const actual=new Vector3(...p).applyMatrix4(matrix);
    const expected=new Vector3(...p).applyMatrix4(new Matrix4().fromArray(instance.model)).project(reference);
    assert(Math.abs(actual.x-expected.x)<1e-5);assert(Math.abs(actual.y-expected.y)<1e-5);
    assert(Math.abs(actual.z-(expected.z+1)/2)<1e-5);
   }
  }
 }
});
test('fits all instance corners with margins at wide and narrow aspect ratios',()=>{
 const instances=[sceneInstance(data(points),{position:[-10,0,-10],yaw:.4,scale:1}),sceneInstance(data(points),{position:[10,0,4],yaw:-.3,scale:1})];
 for(const [w,h]of [[390,796],[1440,900]])for(const y of [6,18]){
  const shared=sceneProjection({eye:[0,y,21],target:[0,1,-4],padding:1.12},w,h,instances);
  for(const instance of instances)for(const corner of instance.corners){
   const q=new Vector3(...corner).applyMatrix4(new Matrix4().fromArray(shared.matrix));
   assert(Math.abs(q.x)<=1/1.12+1e-5);assert(Math.abs(q.y)<=1/1.12+1e-5);
  }
 }
});

test('box picking chooses the nearest intersected instance and misses empty canvas',()=>{
 const boxes=[{index:0,left:10,right:30,top:10,bottom:30,distance:20},{index:1,left:15,right:35,top:15,bottom:35,distance:10}];
 assert.equal(sceneHitTest(boxes,20,20),1);assert.equal(sceneHitTest(boxes,12,12),0);assert.equal(sceneHitTest(boxes,100,100),-1);
});

test('bottom alignment leaves a small explicit inset instead of empty space under the field',()=>{
 const instances=[sceneInstance(data(points),{position:[-4,0,0],yaw:0,scale:1}),sceneInstance(data(points),{position:[4,0,-12],yaw:.4,scale:1})];
 const shared=sceneProjection({eye:[0,3,21],target:[0,1,-4],align:'bottom'},1200,700,instances);
 const bottom=Math.max(...instances.map(instance=>{const box=sceneBounds(shared,instance,1200,700);return box.bottom;}));
 assert(Math.abs(bottom-700*.98)<.01);
});

test('width fitting fills available canvas width even for a compact field',()=>{
 const instances=[sceneInstance(data(points),{position:[-2,0,0]}),sceneInstance(data(points),{position:[5,0,-8]})];
 for(const [w,h]of [[390,550],[800,650],[1440,760]])for(const y of [2.5,18]){
  const padding=w<600?1.02:1.06;
  const shared=sceneProjection({eye:[0,y,21],target:[0,1,-4],fit:'width',padding,align:'bottom'},w,h,instances);
  const edge=Math.max(...instances.flatMap(instance=>instance.corners.map(corner=>Math.abs(new Vector3(...corner).applyMatrix4(new Matrix4().fromArray(shared.matrix)).x))));
  assert(Math.abs(edge-1/padding)<1e-5,'Camera left unused horizontal space');
  const boxes=instances.map(instance=>sceneBounds(shared,instance,w,h));
  assert(Math.abs(Math.min(...boxes.map(b=>b.left))+Math.max(...boxes.map(b=>b.right))-w)<.01,'Field is not centered within available width');
 }
});

test('keeps width framing fixed while the camera descends with a fit reference',()=>{
 const instances=[sceneInstance(data(points),{position:[-4,0,3]}),sceneInstance(data(points),{position:[6,0,-12]})];
 const settings={target:[0,1,-4],fit:'width',fitReference:{eye:[0,2.5,21],target:[0,1,-4]}};
 const high=sceneProjection({...settings,eye:[0,18,21]},1200,700,instances);
 const low=sceneProjection({...settings,eye:[0,2.5,21]},1200,700,instances);
 assert(Math.abs(high.focal-low.focal)<1e-8,'Scrolling changes horizontal zoom');
 assert(Math.abs(high.horizontalShift-low.horizontalShift)<1e-8,'Scrolling recenters the field horizontally');
});
