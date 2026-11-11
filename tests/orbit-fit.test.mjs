import {test} from 'node:test';
import assert from 'node:assert/strict';
import {frameLayout} from '../src/responsive.js';

const style={objectFit:'contain',objectPosition:'50% 50%'};
const metadata={width:300,height:300,frame:[.2,.2,.6,.6],support:[2,0,0,-2,0,0,0,1,0]};
const element=orbitFit=>({metadata,frameRatio:1,naturalWidth:300,yaw:0,pitch:0,distance:4,orbitFit});
test('fixed orbit fitting keeps the same scale and center at different camera angles',()=>{
 const el=element('fixed'),front=frameLayout(el,208,220,style);
 el.yaw=1.3;el.pitch=.4;
 assert.deepEqual(frameLayout(el,208,220,style),front);
});
test('automatic orbit fitting remains adaptive and fixed mode does not mutate shared metadata',()=>{
 const el=element('auto'),front=frameLayout(el,208,220,style),original=structuredClone(metadata);
 el.yaw=1.3;el.pitch=.4;
 assert.notDeepEqual(frameLayout(el,208,220,style),front);
 el.orbitFit='fixed';frameLayout(el,208,220,style);
 assert.deepEqual(metadata,original);
 el.orbitFit='auto';el.yaw=el.pitch=0;
 assert.deepEqual(frameLayout(el,208,220,style),front);
});
