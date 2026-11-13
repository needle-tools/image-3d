import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeLighting,lightingState,studioUniforms} from '../src/lighting.js';
test('environment rotation is independent lighting state, accepts negative angles and keeps the shared texture',()=>{
 const environment={size:2,levels:2,data:new Uint16Array(288)};
 const base=normalizeLighting({environment,environmentIntensity:.65});
 const turned=normalizeLighting({...base,environmentRotation:-Math.PI/2});
 assert.equal(base.environmentRotation,0);assert.equal(turned.environmentRotation,-Math.PI/2);
 assert.equal(turned.environment,environment);assert.equal(turned.environmentIntensity,.65);
 assert.notDeepEqual(lightingState(turned),lightingState(base));
 assert.ok(Math.abs(studioUniforms(turned)[27]+Math.PI/2)<1e-6);
 assert.equal(normalizeLighting({...base,environmentRotation:NaN}).environmentRotation,0);
});

test('vertical environment tilt has independent state and uniform storage without changing intensity',()=>{
 const environment={size:2,levels:2,data:new Uint16Array(288)};
 const base=normalizeLighting({environment,environmentIntensity:.65,environmentRotation:.4});
 const tilted=normalizeLighting({...base,environmentPitch:.7});
 assert.equal(base.environmentPitch,0);assert.equal(tilted.environmentPitch,.7);
 assert.equal(tilted.environmentRotation,.4);assert.equal(tilted.environmentIntensity,.65);
 assert.equal(tilted.environment,environment);assert.notDeepEqual(lightingState(base),lightingState(tilted));
 assert.ok(Math.abs(studioUniforms(tilted)[7]-.7)<1e-6);
});
