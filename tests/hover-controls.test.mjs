import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {chromium} from '@playwright/test';
import sharp from 'sharp';
import {encodeContainer} from '../tools/export.mjs';
import {decodeCapture,packWebp} from '../tools/webp-package.mjs';
import {backends,useBackend} from './backends.mjs';
import {orbitFrame,pointerLookAngles} from '../src/view-rotation.js';
import {camera} from '../src/webgpu.js';

const files = {
	'/runtime.js': ['text/javascript', 'dist/img-3d.js'],
	'/model.webp': ['image/webp', 'demo/public/owl-512-i3d/live.webp'],
	'/studio.json.gz': ['application/gzip', 'dist/studio.json.gz'],
};
const html = `<!doctype html><style>
	body{margin:0;height:2400px}
	a,img-3d{display:block;width:240px;height:240px;margin:40px}
</style><a href="#opened">Open asset</a><script type="module">
	import {Img3d} from '/runtime.js';
	const image = window.image = new Img3d();
	image.setAttribute('environment','studio');
	image.src = '/model.webp';
	document.querySelector('a').replaceChildren(image);
</script>`;
const capturePose = {yaw:1.1,pitch:.37,distance:5.2};
const markup = `<!doctype html><style>
	img, img-3d:not([data-img3d-overlay]), picture {display:block;width:180px;height:180px}
</style><img-3d id="direct" hover-controls src="/authored.webp"></img-3d>
<picture id="native" data-img-3d data-hover-controls><img src="/authored.webp" alt="Owl"></picture>
<script>
	window.firstViews = new Map();
	document.addEventListener('load', ({target}) => {
		if (target.localName !== 'img-3d') return;
		const key = target.id || target.closest('picture').id;
		if (!firstViews.has(key)) {
			const {yaw,pitch,distance} = target.renderCamera ?? target;
			firstViews.set(key, {yaw,pitch,distance});
		}
	}, true);
</script>
<script type="module">
	import {Img3d} from '/runtime.js';
	const manual = new Img3d();
	manual.id = 'manual';
	manual.setAttribute('hover-controls', '');
	Object.assign(manual, {src:'/authored.webp',yaw:.75,pitch:.15,distance:3});
	document.body.append(manual);
	void manual.draw();
</script>`;

async function withBrowser(run) {
	let authored;
	const server = createServer(async (request, response) => {
		if (request.url.startsWith('/authored.webp')) {
			authored ??= readFile(files['/model.webp'][1]).then(async input => {
				const {data,images} = decodeCapture(input);
				data.display.camera = {...data.display.camera,...capturePose};
				return packWebp(await sharp(input).webp().toBuffer(), encodeContainer(data,images));
			});
			response.setHeader('Content-Type','image/webp');
			response.end(await authored);
			return;
		}
		const file = files[request.url];
		response.setHeader('Content-Type', file?.[0] ?? 'text/html');
		response.end(file ? await readFile(file[1]) : request.url === '/markup' ? markup : html);
	});
	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
	try {
		const browser = await chromium.launch({channel:'chrome',headless:true});
		try {
			await run(browser, 'http://127.0.0.1:' + server.address().port);
		} finally {
			await browser.close();
		}
	} finally {
		await new Promise(resolve => server.close(resolve));
	}
}

test('hover mode rotates the model, drags the studio lighting, and restores default drag on cleanup', {timeout:30000}, async () => {
	await withBrowser(async (browser, url) => {
		const page = await browser.newPage({viewport:{width:800,height:600},reducedMotion:'reduce'});
		page.setDefaultTimeout(5000);
		await page.goto(url);
		await page.waitForFunction(() => window.image?.lighting.environment && image.data, undefined, {timeout:20000});
		await page.evaluate(() => {
			window.detach = image.attachHoverControls({returnDelayMs:0});
		});
		const box = await page.locator('img-3d canvas').boundingBox();
		const x = box.x + box.width / 2, y = box.y + box.height / 2;
		await page.mouse.move(x, y);
		await page.waitForFunction(() => Math.abs(image.yaw - .55) < .01);
		await page.mouse.move(x + 50, y - 15);
		await page.waitForFunction(() => image.yaw < .2 && image.pitch < .2);
		const before = await page.evaluate(() => ({
			yaw:image.yaw, pitch:image.pitch, intensity:image.lighting.environmentIntensity, renders:image.constructor.statistics.renders,
		}));
		await page.mouse.down();
		await page.mouse.move(x + 90, y + 15);
		await page.waitForFunction(() => image.lighting.environmentRotation > .9 && image.lighting.environmentPitch > .3);
		const lit = await page.evaluate(() => ({yaw:image.yaw,pitch:image.pitch,intensity:image.lighting.environmentIntensity}));
		assert.deepEqual(lit, {yaw:before.yaw,pitch:before.pitch,intensity:before.intensity});
		await page.waitForFunction(renders => image.constructor.statistics.renders > renders, before.renders);
		await page.mouse.up();
		assert.equal(new URL(page.url()).hash, '');
		await page.mouse.move(0, 0);
		await page.waitForFunction(() => image.yaw === .55 && image.lighting.environmentRotation === 0);
		await page.mouse.click(x, y);
		await page.waitForURL('**/#opened');
		await page.evaluate(() => detach());
		await page.mouse.move(x, y);
		await page.mouse.down();
		await page.mouse.move(x + 50, y);
		await page.mouse.up();
		assert(Math.abs(await page.evaluate(() => image.yaw) - .05) < .01);
	});
});

test('HTML and JavaScript can enable hover controls on standalone and native images', {timeout:40000}, async () => {
	await withBrowser(async (browser, url) => {
		const page = await browser.newPage({viewport:{width:700,height:650},reducedMotion:'reduce'});
		page.setDefaultTimeout(5000);
		await page.goto(url + '/markup');
		await page.waitForFunction(() => firstViews.size === 3, undefined, {timeout:20000});
		const first = await page.evaluate(() => Object.fromEntries(firstViews));
		assert.deepEqual(first, {direct:capturePose,native:capturePose,manual:{yaw:.75,pitch:.15,distance:3}});
		const orbit = async (selector, leave=true) => {
			const box = await page.locator(selector + ' canvas').boundingBox();
			const x = box.x + box.width / 2, y = box.y + box.height / 2;
			const before = await page.locator(selector).evaluate(el => el.yaw);
			await page.mouse.move(x, y);
			await page.mouse.move(x + 30, y);
			await page.waitForFunction(({selector,before}) => document.querySelector(selector).yaw < before - .3, {selector,before});
			if (leave) await page.mouse.move(500, 0);
		};
		await orbit('#direct');
		await orbit('#native img-3d');
		await page.evaluate(() => {
			const element = document.querySelector('#direct');
			element.reset();
			element.remove();
			document.body.prepend(element);
		});
		await page.waitForFunction(() => document.querySelector('#direct').textureBytes);
		await orbit('#direct');
		await page.evaluate(() => document.querySelector('#native').removeAttribute('data-hover-controls'));
		await page.waitForFunction(() => document.querySelector('#native img-3d').hoverControls === false);
		await page.evaluate(async () => {
			const {enhanceImage} = await import('/runtime.js');
			const picture = document.querySelector('#native');
			enhanceImage(picture).element.hoverControls = true;
			picture.style.width = '200px';
		});
		assert.equal(await page.locator('#native img-3d[hover-controls]').count(), 1);
		await orbit('#native img-3d', false);
		const {before,after} = await page.evaluate(async () => {
			const picture = document.querySelector('#native');
			const renderer = picture.querySelector('img-3d');
			const pose = () => [renderer.yaw,renderer.pitch,renderer.distance];
			renderer.distance = 3.7;
			await renderer.draw();
			const before = pose();
			await new Promise(resolve => {
				renderer.addEventListener('load', resolve, {once:true});
				picture.querySelector('img').src = '/authored.webp?replacement';
			});
			await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
			return {before,after:pose()};
		});
		assert.deepEqual(after, before, 'Changing the source while hovering reset the camera');
		await page.evaluate(() => document.querySelector('#native').setAttribute('data-touch-drag-action', 'orbit-environment'));
		await page.waitForFunction(() => document.querySelector('#native img-3d').touchDragAction === 'orbit-environment');
		await page.evaluate(() => document.querySelector('#native').removeAttribute('data-touch-drag-action'));
		await page.waitForFunction(() => document.querySelector('#native img-3d').touchDragAction === 'orbit');
	});
});

test('hover mode leaves vertical scrolling native and keeps horizontal touch rotation and pinch zoom', {timeout:30000}, async () => {
	await withBrowser(async (browser, url) => {
		const page = await browser.newPage({viewport:{width:500,height:650},hasTouch:true,isMobile:true,reducedMotion:'reduce'});
		page.setDefaultTimeout(5000);
		await page.addInitScript(() => document.addEventListener('DOMContentLoaded', () => {
			const viewport = document.createElement('meta');
			viewport.name = 'viewport';
			viewport.content = 'width=device-width, initial-scale=1';
			document.head.append(viewport);
		}));
		const ready = async path => {
			await page.goto(url + path);
			await page.waitForFunction(() => window.image?.data, undefined, {timeout:20000});
			await page.evaluate(() => image.attachHoverControls({target:image.closest('a')}));
			const box = await page.locator('img-3d canvas').boundingBox();
			return {x:Math.round(box.x + box.width / 2),y:Math.round(box.y + box.height / 2)};
		};
		const scroll = await ready('/');
		const cdp = await page.context().newCDPSession(page);
		const sendTouch = (type, ...points) => cdp.send('Input.dispatchTouchEvent', {
			type, touchPoints:points.map(([x,y],id) => ({x,y,id})),
		});
		await sendTouch('touchStart', [scroll.x,scroll.y]);
		await sendTouch('touchMove', [scroll.x,scroll.y-30]);
		await sendTouch('touchMove', [scroll.x,scroll.y-80]);
		await sendTouch('touchEnd');
		await page.waitForFunction(() => scrollY > 0);
		assert.equal(await page.evaluate(() => image.yaw), .55);
		assert.equal(await page.evaluate(() => image.pitch), .2);
		// Use a fresh document so the previous swipe's fling cannot shift the hit target.
		const {x,y} = await ready('/?orbit');
		await sendTouch('touchStart', [x,y]);
		await sendTouch('touchMove', [x+30,y]);
		await sendTouch('touchMove', [x+70,y+15]);
		await sendTouch('touchEnd');
		await page.waitForFunction(() => image.yaw < 0 && image.pitch > .25);
		assert.equal(new URL(page.url()).hash, '');
		assert.equal(await page.evaluate(() => scrollY), 0);
		await sendTouch('touchStart', [x-20,y], [x+20,y]);
		await sendTouch('touchMove', [x-60,y], [x+60,y]);
		await sendTouch('touchEnd');
		await page.waitForFunction(() => image.distance < 4);
		assert.equal(await page.evaluate(() => visualViewport.scale), 1);
	});
});

test('mouse actions compose with the preset and reflect HTML and JavaScript overrides', {timeout:40000}, async () => {
	await withBrowser(async (browser, url) => {
		const page = await browser.newPage({viewport:{width:800,height:600},reducedMotion:'reduce'});
		await page.goto(url);
		await page.waitForFunction(() => window.image?.data && image.lighting.environment);
		await page.evaluate(() => {
			image.setAttribute('mouse-drag-action', 'orbit-environment');
			image.setAttribute('hover-action', 'none');
		});
		const read = () => page.evaluate(() => ({
			yaw:image.yaw, pitch:image.pitch, distance:image.distance,
			light:image.lighting.environmentRotation, hover:image.hoverAction, drag:image.mouseDragAction,
		}));
		const box = await page.locator('img-3d canvas').boundingBox();
		const x = box.x + box.width / 2, y = box.y + box.height / 2;
		const initial = await read();
		assert.equal(initial.drag, 'orbit-environment');
		assert.equal(initial.hover, 'none');
		await page.mouse.move(x + 20, y);
		await page.mouse.down();
		await page.mouse.move(x + 65, y + 5);
		await page.mouse.up();
		await page.waitForFunction(() => image.lighting.environmentRotation > .8);
		const lit = await read();
		assert.equal(lit.yaw, initial.yaw);
		assert.equal(lit.pitch, initial.pitch);
		assert.equal(lit.distance, initial.distance);
		await page.evaluate(() => {
			image.hoverControls = true;
			image.mouseDragAction = 'orbit';
		});
		assert.equal(await page.locator('img-3d').getAttribute('mouse-drag-action'), 'orbit');
		await page.mouse.move(x, y);
		await page.mouse.down();
		await page.mouse.move(x + 45, y + 5);
		await page.mouse.up();
		await page.waitForFunction(yaw => image.yaw < yaw - .3, initial.yaw);
		await page.evaluate(() => image.mouseDragAction = 'none');
		const orbit = await read();
		await page.mouse.move(x, y);
		await page.mouse.down();
		await page.mouse.move(x + 45, y + 5);
		await page.mouse.up();
		await page.mouse.move(x, y);
		const disabled = await read();
		assert.equal(disabled.yaw, orbit.yaw);
		assert.equal(disabled.light, 0);
		await page.mouse.click(x, y);
		await page.waitForURL('**/#opened');
	});
});

test('look-at aligns +Z with the full projected direction and keeps the model right axis level', () => {
	const center = [.2,.1,-.4];
	const element = {yaw:.55,pitch:.2,distance:4,frameRatio:1.6,layout:{sx:1.1,sy:.8,cx:.2,cy:-.1},boundsFit:{center}};
	const {eye,right,up,forward} = orbitFrame(element, center);
	const {matrix} = camera(element, 500, 260);
	for (const [x,y] of [[0,0],[0,.42],[0,-.42],[.72,.3],[-.72,-.3]]) {
		const point = eye.map((value,i) => value+forward[i]*element.distance/2+right[i]*x+up[i]*y);
		const clip = [0,1,3].map(row => matrix[12+row]+point.reduce((sum,value,column) => sum+value*matrix[column*4+row],0));
		const aim = pointerLookAngles(element, element.layout, element.frameRatio, clip[0]/clip[2], clip[1]/clip[2]);
		const {rotation} = orbitFrame(element, center, aim);
		const direction = point.map((value,i) => value-center[i]), length = Math.hypot(...direction);
		const facing = direction.map(value => value/length);
		for (let axis=0; axis<3; axis++) assert(Math.abs(rotation[6+axis]-facing[axis]) < 1e-6);
		assert(Math.abs(rotation[1]) < 1e-10);
		assert(rotation[4] > 0);
	}
});

test('relative hover orbit starts at the entry position and keeps the current pose on re-entry', {timeout:30000}, async () => {
	await withBrowser(async (browser, url) => {
		const page = await browser.newPage({viewport:{width:800,height:600},reducedMotion:'reduce'});
		page.setDefaultTimeout(6000);
		await page.goto(url);
		await page.waitForFunction(() => window.image?.data, undefined, {timeout:20000});
		await page.evaluate(() => image.hoverAction = 'orbit-relative');
		assert.equal(await page.locator('img-3d').getAttribute('hover-action'), 'orbit-relative');
		const read = () => page.evaluate(async () => {
			await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
			return [image.yaw,image.pitch,image.distance];
		});
		const box = await page.locator('img-3d canvas').boundingBox();
		const x = box.x + box.width * .8, y = box.y + box.height * .75;
		const rest = await read();
		await page.mouse.move(x,y);
		assert.deepEqual(await read(), rest);
		await page.mouse.move(x-30,y-10);
		const moved = await read();
		assert(moved[0] > rest[0] + .4);
		assert(moved[1] < rest[1]);
		await page.mouse.move(0,0);
		await page.mouse.move(box.x + box.width * .1, y);
		assert.deepEqual(await read(), moved);
	});
});

test('look-at changes the rendered facing while leaving the camera and its framing in place', {timeout:60000}, async () => {
	await withBrowser(async (browser, url) => {
		for (const backend of backends) {
			const page = await browser.newPage({viewport:{width:800,height:600},reducedMotion:'reduce'});
			await useBackend(page, backend);
			await page.goto(url);
			await page.waitForFunction(() => window.image?.data && image.lighting.environment);
			assert.equal(await page.evaluate(() => image.constructor.statistics.backend), backend);
			await page.evaluate(() => image.hoverAction = 'look-at');
			const box = await page.locator('img-3d canvas').boundingBox();
			const [cx,cy] = await page.evaluate(() => [image.layout.cx,image.layout.cy]);
			const x = box.x+box.width*(1+cx)/2, y = box.y+box.height*(1-cy)/2;
			const move = (x,y) => page.evaluate(({x,y}) => image.dispatchEvent(new PointerEvent('pointermove', {
				pointerType:'mouse',clientX:x,clientY:y,
			})), {x,y});
			const snapshot = () => page.evaluate(async () => {
				await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
				await image.draw();
				return {camera:[image.yaw,image.pitch,image.distance], pixels:Array.from(readCanvas(image.canvas).data)};
			});
			await move(x, y);
			const center = await snapshot();
			await move(x, y - box.height * .25);
			const tilted = await snapshot();
			assert.deepEqual(tilted.camera, center.camera);
			assert(tilted.pixels.filter((value,index) => index % 4 === 3 && Math.abs(value-center.pixels[index]) > 60).length > 20,
				backend + ' did not pitch the model on vertical pointer movement');
			await move(x + box.width * .35, y - box.height * .25);
			const turned = await snapshot();
			assert.deepEqual(turned.camera, center.camera);
			assert(turned.pixels.some((value,index) => index % 4 === 3 && Math.abs(value - tilted.pixels[index]) > 60), backend + ' did not turn the model');
			await move(x, y);
			assert.deepEqual((await snapshot()).pixels, center.pixels);
			await page.close();
		}
	});
});

test('touch can orbit the environment and leave pinch zoom to the browser', {timeout:40000}, async () => {
	await withBrowser(async (browser, url) => {
		const page = await browser.newPage({viewport:{width:500,height:650},hasTouch:true,reducedMotion:'reduce'});
		await page.goto(url);
		await page.waitForFunction(() => window.image?.data && image.lighting.environment);
		const result = await page.evaluate(async () => {
			const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
			const send = (type, x, y) => image.dispatchEvent(new PointerEvent(type, {
				pointerType:'touch', pointerId:1, isPrimary:true, clientX:x, clientY:y, bubbles:true, cancelable:true,
			}));
			const pinch = () => {
				const touches = [new Touch({identifier:1,target:image,clientX:100,clientY:100}),new Touch({identifier:2,target:image,clientX:200,clientY:100})];
				const start = new TouchEvent('touchstart',{touches,bubbles:true,cancelable:true});
				image.dispatchEvent(start);
				return start.defaultPrevented;
			};
			image.touchDragAction = 'orbit-environment';
			image.touchPinchAction = 'browser';
			const orbitCSS = getComputedStyle(image.canvas).touchAction;
			const browserPinch = pinch();
			const before = [image.yaw,image.pitch,image.distance];
			send('pointerdown', 100, 100);
			send('pointermove', 150, 115);
			await frame();
			const moved = {rotation:image.lighting.environmentRotation, camera:[image.yaw,image.pitch,image.distance]};
			send('pointercancel', 150, 115);
			await frame();
			const cancelled = image.lighting.environmentRotation;
			image.touchDragAction = 'none';
			image.touchPinchAction = 'zoom-model';
			const pinchCSS = getComputedStyle(image.canvas).touchAction;
			const modelPinch = pinch();
			image.touchPinchAction = 'browser';
			return {before,moved,cancelled,orbitCSS,pinchCSS,browserPinch,modelPinch,passThroughCSS:getComputedStyle(image.canvas).touchAction};
		});
		assert.equal(result.orbitCSS, 'pan-y pinch-zoom');
		assert.equal(result.pinchCSS, 'pan-x pan-y');
		assert.equal(result.passThroughCSS, 'auto');
		assert.equal(result.browserPinch, false);
		assert.equal(result.modelPinch, true);
		assert(result.moved.rotation > 1);
		assert.deepEqual(result.moved.camera, result.before);
		assert.equal(result.cancelled, 0);
	});
});
