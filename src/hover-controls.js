import {orbitPitchLimit} from './bounds-fit.js';
import {wrapAngle} from './camera-motion.js';
import {pointerLookAngles} from './view-rotation.js';

const radians = Math.PI / 180;
const yawRange = 160 * radians, pitchRange = 70 * radians;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const limitPitch = value => clamp(value, -orbitPitchLimit, orbitPitchLimit);
const lerp = (from, to, amount) => from + (to - from) * amount;

/** Hover, light drag and touch gestures share a single pose and animation clock. */
export function createHoverControls(element, {
	target, rest, initialPointer, viewportTilt, entryDelayMs, returnDelayMs, returnDurationMs,
	hoverAction, mouseDragAction, touchDragAction, touchPinchAction, returnToRest,
}, clock, apply, getBaseLightPitch) {
	const view = target.ownerDocument.defaultView;
	const motionPreference = view.matchMedia('(prefers-reduced-motion: reduce)');
	const relativeOrbit = hoverAction === 'orbit-relative';
	const mouseOrbit = hoverAction === 'orbit' || relativeOrbit;
	const restPitch = limitPitch(rest.pitch);
	const restDistance = rest.distance ?? element.distance;
	const minimumDistance = Math.max(1.8, restDistance * .6);
	const maximumDistance = Math.max(minimumDistance, restDistance * 1.8);
	const previousCursor = target.style.cursor;
	const previousTouchAction = target.style.touchAction;
	const previousCanvasTouchAction = element.canvas.style.touchAction;
	const zoomModel = touchPinchAction === 'zoom-model';
	const touchPan = touchDragAction === 'none' ? 'pan-x pan-y' : 'pan-y';
	const touchAction = zoomModel ? touchPan : touchDragAction === 'none' ? 'auto' : 'pan-y pinch-zoom';
	if (touchAction !== 'auto') target.style.touchAction = touchAction;
	element.canvas.style.touchAction = touchAction;

	let yaw = rest.yaw, pitch = restPitch, distance = restDistance;
	let rotation = 0, lightPitch = 0;
	let lookYaw = 0, lookPitch = 0;
	let fromYaw = yaw, fromPitch = pitch, targetYaw = yaw, targetPitch = pitch;
	let fromRotation = rotation, fromLightPitch = lightPitch, targetRotation = rotation, targetLightPitch = lightPitch;
	let fromLookYaw = 0, fromLookPitch = 0, targetLookYaw = 0, targetLookPitch = 0;
	let elapsed = 0, duration = 0, easePower = 3, following = false, entering = false;
	let lastFrame, entryTimer, returnTimer;
	let velocityYaw = 0, velocityPitch = 0, samples = [];
	let mouse, mouseDrag, anchor, touch, pinch;
	let suppressClick = false, enteredOnce = false, attached = true;

	function cancelEntry() {
		clearTimeout(entryTimer);
		entryTimer = undefined;
		entering = false;
	}
	function cancelReturn() {
		clearTimeout(returnTimer);
		returnTimer = undefined;
	}
	function clearMomentum() {
		velocityYaw = velocityPitch = 0;
		samples = [];
	}
	function schedule() {
		lastFrame ??= performance.now();
		clock.requestFrame(animate);
	}
	function applyView() {
		apply(yaw, pitch, distance, rotation, lightPitch, lookYaw || lookPitch ? [lookYaw,lookPitch] : undefined);
	}
	function animate(time) {
		if (!attached) return;
		const step = Math.max(0, time - lastFrame);
		lastFrame = time;
		if (velocityYaw || velocityPitch) {
			const damping = Math.exp(-step / 180);
			const deltaYaw = velocityYaw * 180 * (1 - damping);
			const deltaPitch = velocityPitch * 180 * (1 - damping);
			fromYaw += deltaYaw;
			targetYaw += deltaYaw;
			fromPitch = limitPitch(fromPitch + deltaPitch);
			targetPitch = limitPitch(targetPitch + deltaPitch);
			velocityYaw = Math.abs(velocityYaw * damping) < .00002 ? 0 : velocityYaw * damping;
			velocityPitch = Math.abs(velocityPitch * damping) < .00002 ? 0 : velocityPitch * damping;
		}
		elapsed += step;
		const progress = duration ? Math.min(1, elapsed / duration) : 1;
		if (progress === 1) entering = false;
		const eased = progress < .5
			? (2 * progress) ** easePower / 2
			: 1 - (2 - 2 * progress) ** easePower / 2;
		if (following) {
			const blend = 1 - Math.exp(-step / 12);
			yaw = lerp(yaw, targetYaw, blend);
			pitch = lerp(pitch, targetPitch, blend);
			lookYaw = lerp(lookYaw, targetLookYaw, blend);
			lookPitch = lerp(lookPitch, targetLookPitch, blend);
			if (Math.max(Math.abs(targetYaw - yaw), Math.abs(targetPitch - pitch),
				Math.abs(targetLookYaw - lookYaw), Math.abs(targetLookPitch - lookPitch)) < 1e-4) {
				yaw = targetYaw;
				pitch = targetPitch;
				lookYaw = targetLookYaw;
				lookPitch = targetLookPitch;
				following = false;
			}
		} else {
			yaw = lerp(fromYaw, targetYaw, eased);
			pitch = lerp(fromPitch, targetPitch, eased);
			lookYaw = lerp(fromLookYaw, targetLookYaw, eased);
			lookPitch = lerp(fromLookPitch, targetLookPitch, eased);
		}
		rotation = lerp(fromRotation, targetRotation, eased);
		lightPitch = lerp(fromLightPitch, targetLightPitch, eased);
		applyView();
		if (progress < 1 || following || velocityYaw || velocityPitch) schedule();
		else lastFrame = undefined;
	}
	function transition(nextYaw, nextPitch, milliseconds = 0, power = 3, restore = false) {
		following = false;
		fromYaw = yaw;
		fromPitch = pitch;
		fromRotation = rotation;
		fromLightPitch = lightPitch;
		fromLookYaw = restore ? wrapAngle(lookYaw) : lookYaw;
		fromLookPitch = lookPitch;
		targetYaw = nextYaw;
		targetPitch = limitPitch(nextPitch);
		targetRotation = restore ? 0 : rotation;
		targetLightPitch = restore ? 0 : lightPitch;
		targetLookYaw = restore ? 0 : lookYaw;
		targetLookPitch = restore ? 0 : lookPitch;
		elapsed = 0;
		duration = motionPreference.matches ? 0 : milliseconds;
		easePower = power;
		schedule();
	}
	function beginEntry() {
		entryTimer = undefined;
		transition(yaw, pitch, 450);
		entering = true;
		if (mouse) move(mouse);
	}
	function enter(event, fresh = false) {
		if (event.pointerType !== 'mouse') return;
		clearMomentum();
		cancelReturn();
		cancelEntry();
		if (hoverAction === 'none') return;
		mouse = event;
		if (relativeOrbit) rebaseHover(event, yaw, pitch);
		if (enteredOnce && !fresh) {
			if (motionPreference.matches) move(event);
			else beginEntry();
			return;
		}
		enteredOnce = true;
		if (hoverAction === 'orbit') {
			yaw = rest.yaw;
			pitch = restPitch;
			distance = restDistance;
			rotation = lightPitch = 0;
		}
		if (!relativeOrbit) anchor = undefined;
		transition(yaw, pitch);
		if (motionPreference.matches) move(event);
		else if (entryDelayMs) entryTimer = setTimeout(beginEntry, entryDelayMs);
		else beginEntry();
	}
	function loaded() {
		if (mouse && !mouseDrag) enter(mouse, true);
		else schedule();
	}
	function aimAtPointer(event) {
		const canvas = element.canvas;
		const rect = canvas.getBoundingClientRect();
		if (!element.layout || !rect.width || !rect.height || !canvas.offsetWidth || !canvas.offsetHeight) return;
		const css = view.getComputedStyle(canvas);
		const scaleX = rect.width/canvas.offsetWidth, scaleY = rect.height/canvas.offsetHeight;
		const left = parseFloat(css.paddingLeft), top = parseFloat(css.paddingTop);
		const width = canvas.clientWidth-left-parseFloat(css.paddingRight), height = canvas.clientHeight-top-parseFloat(css.paddingBottom);
		if (width <= 0 || height <= 0) return;
		const x = ((event.clientX-rect.left)/scaleX-canvas.clientLeft-left)/width;
		const y = ((event.clientY-rect.top)/scaleY-canvas.clientTop-top)/height;
		const [aimYaw,aimPitch] = pointerLookAngles({yaw,pitch}, element.layout, element.frameRatio, 2*x-1, 1-2*y);
		if (motionPreference.matches) transition(yaw, pitch);
		else if (!entering) following = true;
		targetLookYaw = lookYaw + wrapAngle(aimYaw-lookYaw);
		targetLookPitch = aimPitch;
		schedule();
	}
	function move(event) {
		if (hoverAction === 'none' || event.pointerType !== 'mouse' || event.buttons || mouseDrag) return;
		mouse = event;
		if (entryTimer !== undefined) return;
		cancelReturn();
		if (hoverAction === 'look-at') {
			aimAtPointer(event);
			return;
		}
		const rect = target.getBoundingClientRect();
		if (!rect.width || !rect.height) return;
		if (relativeOrbit && !anchor) rebaseHover(event, yaw, pitch);
		const baseYaw = relativeOrbit ? anchor.yaw : rest.yaw;
		const basePitch = relativeOrbit ? anchor.pitch : restPitch;
		const horizontal = anchor
			? (anchor.yaw - baseYaw) / yawRange + (anchor.x - event.clientX) / rect.width * 2
			: 1 - (event.clientX - rect.left) / rect.width * 2;
		const vertical = anchor
			? (anchor.pitch - basePitch) / pitchRange + (event.clientY - anchor.y) / rect.height * 2
			: (event.clientY - rect.top) / rect.height * 2 - 1;
		const yawLimit = anchor ? Math.max(yawRange, Math.abs(anchor.yaw-baseYaw)) : yawRange;
		const pitchLimit = anchor ? Math.max(pitchRange, Math.abs(anchor.pitch-basePitch)) : pitchRange;
		const nextYaw = baseYaw + clamp(horizontal*yawRange, -yawLimit, yawLimit);
		const nextPitch = limitPitch(basePitch + clamp(vertical*pitchRange, -pitchLimit, pitchLimit));
		if (motionPreference.matches) {
			transition(nextYaw, nextPitch);
			return;
		}
		const now = performance.now();
		samples = samples.filter(sample => now - sample.at <= 100);
		samples.push({at:now, yaw:nextYaw, pitch:nextPitch});
		if (!entering) following = true;
		targetYaw = nextYaw;
		targetPitch = nextPitch;
		schedule();
	}
	function leave() {
		if (touch || pinch || mouseDrag?.dragged) return;
		mouseDrag = undefined;
		cancelEntry();
		const first = samples[0], last = samples.at(-1);
		if (mouse && !motionPreference.matches && first && last && performance.now() - last.at < 80 && last.at - first.at >= 8) {
			const span = last.at - first.at;
			velocityYaw = clamp((last.yaw - first.yaw) / span * .35, -.002, .002);
			velocityPitch = clamp((last.pitch - first.pitch) / span * .35, -.002, .002);
			transition(yaw, pitch);
		}
		samples = [];
		mouse = anchor = undefined;
		cancelReturn();
		if (returnToRest) returnTimer = setTimeout(() => {
			transition(mouseOrbit ? rest.yaw : yaw, mouseOrbit ? restPitch : pitch, returnDurationMs, 5, true);
		}, returnDelayMs);
	}
	function down(event) {
		if (event.isPrimary === false) return;
		if (event.pointerType === 'touch' || event.pointerType === 'mouse' && event.button === 0) suppressClick = false;
		if (event.pointerType === 'mouse' && event.button === 0) {
			if (mouseDragAction === 'none' && hoverAction === 'none') return;
			clearMomentum();
			cancelReturn();
			cancelEntry();
			mouseDrag = {id:event.pointerId, x:event.clientX, y:event.clientY, yaw, pitch, rotation, lightPitch, dragged:false};
			transition(yaw, pitch);
		} else if (event.pointerType === 'touch' && touchDragAction !== 'none') {
			clearMomentum();
			cancelReturn();
			cancelEntry();
			touch = {id:event.pointerId, x:event.clientX, y:event.clientY, yaw, pitch, rotation, lightPitch,
				lastX:event.clientX, lastAt:performance.now(), velocity:0, dragged:false};
			transition(yaw, pitch);
		}
	}
	function orbitEnvironment(gesture, dx, dy, rect) {
		const basePitch = getBaseLightPitch();
		rotation = wrapAngle(gesture.rotation + dx / rect.width * Math.PI * 2);
		lightPitch = clamp(basePitch + gesture.lightPitch + dy / rect.height * Math.PI, -Math.PI / 2, Math.PI / 2) - basePitch;
		transition(yaw, pitch);
	}
	function orbitCamera(gesture, dx, dy) {
		transition(gesture.yaw - dx * .01, gesture.pitch + dy * .01);
	}
	function drag(event) {
		if (mouseDrag && mouseDrag.id === event.pointerId) {
			if (mouseDragAction === 'none') return;
			const dx = event.clientX - mouseDrag.x, dy = event.clientY - mouseDrag.y;
			if (!mouseDrag.dragged && Math.hypot(dx, dy) < 4) return;
			const rect = target.getBoundingClientRect();
			if (!rect.width || !rect.height) return;
			if (!mouseDrag.dragged) {
				mouseDrag.dragged = true;
				target.setPointerCapture?.(event.pointerId);
				target.style.cursor = 'grabbing';
			}
			event.preventDefault();
			suppressClick = true;
			if (mouseDragAction === 'orbit-environment') orbitEnvironment(mouseDrag, dx, dy, rect);
			else orbitCamera(mouseDrag, dx, dy);
			return;
		}
		if (pinch || !touch || event.pointerId !== touch.id) return;
		const dx = event.clientX - touch.x, dy = event.clientY - touch.y;
		if (!touch.dragged && Math.max(Math.abs(dx), Math.abs(dy)) < 8) return;
		if (touchDragAction === 'orbit-environment') {
			const rect = target.getBoundingClientRect();
			if (!rect.width || !rect.height) return;
			touch.dragged = suppressClick = true;
			orbitEnvironment(touch, dx, dy, rect);
			return;
		}
		touch.dragged = true;
		const now = performance.now(), span = now - touch.lastAt;
		if (span > 0) {
			const velocity = -(event.clientX - touch.lastX) * .01 / span;
			touch.velocity = clamp(span > 100 ? velocity : lerp(touch.velocity, velocity, .75), -.008, .008);
			touch.lastX = event.clientX;
			touch.lastAt = now;
		}
		suppressClick = true;
		orbitCamera(touch, dx, dy);
	}
	function rebaseHover(event, yaw = targetYaw, pitch = targetPitch) {
		if (mouseOrbit) anchor = {x:event.clientX, y:event.clientY, yaw, pitch};
	}
	function end(event) {
		if (mouseDrag && mouseDrag.id === event.pointerId) {
			if (mouseDrag.dragged || mouseDragAction === 'none') rebaseHover(event);
			mouseDrag = undefined;
			target.style.cursor = previousCursor;
			if (target.hasPointerCapture?.(event.pointerId)) target.releasePointerCapture(event.pointerId);
			const rect = target.getBoundingClientRect();
			if (event.type === 'pointercancel' || event.clientX < rect.left || event.clientX > rect.right ||
				event.clientY < rect.top || event.clientY > rect.bottom) leave();
			return;
		}
		if (!touch || event.pointerId !== touch.id) return;
		if (event.type !== 'pointerup') {
			// Undo provisional rotation when the browser takes over the gesture.
			rotation = touch.rotation;
			lightPitch = touch.lightPitch;
			transition(touch.yaw, touch.pitch);
			suppressClick = false;
		} else if (touchDragAction === 'orbit' && touch.dragged && !motionPreference.matches && performance.now() - touch.lastAt < 100) {
			velocityYaw = touch.velocity;
			schedule();
		}
		touch = undefined;
		if (viewportTilt) viewportChanged();
		else leave();
	}
	function click(event) {
		if (!suppressClick || event.detail === 0) return;
		suppressClick = false;
		event.preventDefault();
		event.stopImmediatePropagation();
	}
	function pinchSpan(touches) {
		return Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
	}
	function pinchStart(event) {
		if (event.touches.length !== 2) return;
		const span = pinchSpan(event.touches);
		if (!span) return;
		event.preventDefault();
		cancelEntry();
		cancelReturn();
		clearMomentum();
		touch = undefined;
		pinch = {span, distance};
		suppressClick = true;
		transition(yaw, pitch);
	}
	function pinchMove(event) {
		if (!pinch || event.touches.length !== 2) return;
		event.preventDefault();
		const span = pinchSpan(event.touches);
		if (!span) return;
		distance = clamp(pinch.distance * pinch.span / span, minimumDistance, maximumDistance);
		schedule();
	}
	function pinchEnd(event) {
		if (!pinch || event.touches.length >= 2) return;
		pinch = undefined;
		if (viewportTilt) viewportChanged();
	}
	function tilt() {
		if (!attached || pinch || mouseDrag || touch || motionPreference.matches) return;
		const rect = target.getBoundingClientRect();
		if (!rect.height || !view.innerHeight) return;
		const position = clamp((rect.top + rect.height / 2) / view.innerHeight * 2 - 1, -1, 1);
		cancelReturn();
		cancelEntry();
		transition(targetYaw, restPitch + position * 40 * radians, 120);
	}
	function viewportChanged() {
		if (!motionPreference.matches) clock.requestFrame(tilt);
	}
	function nativeDrag(event) {
		if (mouseDrag && mouseDragAction !== 'none') event.preventDefault();
	}
	const listeners = [
		['dragstart', nativeDrag], ['pointerenter', enter], ['pointermove', move], ['pointerleave', leave],
		['pointerdown', down, true], ['pointermove', drag], ['pointerup', end], ['pointercancel', end],
		['lostpointercapture', end], ['click', click, true],
	];
	if (zoomModel) listeners.push(['touchstart', pinchStart, {passive:false}], ['touchmove', pinchMove, {passive:false}],
		['touchend', pinchEnd], ['touchcancel', pinchEnd]);
	for (const [name, listener, options] of listeners) target.addEventListener(name, listener, options);
	// Restart entry once for the poster handoff. Later source changes keep the active pose.
	if (!element.data) element.addEventListener('load', loaded, {once:true});
	if (viewportTilt) {
		view.addEventListener('scroll', viewportChanged, {passive:true, capture:true});
		view.addEventListener('resize', viewportChanged, {passive:true});
		viewportChanged();
	}
	schedule();
	if (initialPointer?.pointerType === 'mouse') enter(initialPointer);
	else if (initialPointer) down(initialPointer);
	return {
		syncPose() {
			cancelEntry();
			clearMomentum();
			yaw = element.yaw;
			pitch = element.pitch;
			distance = element.distance;
			transition(yaw, pitch);
			if (mouse) rebaseHover(mouse);
		},
		reset() {
			cancelEntry();
			cancelReturn();
			clearMomentum();
			anchor = undefined;
			yaw = rest.yaw;
			pitch = restPitch;
			distance = restDistance;
			rotation = lightPitch = 0;
			lookYaw = lookPitch = 0;
			transition(yaw, pitch);
			applyView();
		},
		disconnect() {
			attached = false;
			cancelEntry();
			cancelReturn();
			clock.cancelFrame(animate);
			clock.cancelFrame(tilt);
			if (viewportTilt) {
				view.removeEventListener('scroll', viewportChanged, true);
				view.removeEventListener('resize', viewportChanged);
			}
			for (const [name, listener, options] of listeners) target.removeEventListener(name, listener, options);
			const captured = mouseDrag?.id;
			if (captured !== undefined && target.hasPointerCapture?.(captured)) target.releasePointerCapture(captured);
			target.style.cursor = previousCursor;
			target.style.touchAction = previousTouchAction;
			element.canvas.style.touchAction = previousCanvasTouchAction;
			element.removeEventListener('load', loaded);
		},
	};
}
