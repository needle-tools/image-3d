export const inputActions = {
	'hover-action': {values:['none', 'orbit', 'orbit-relative', 'look-at'], standard:'none', preset:'orbit'},
	'mouse-drag-action': {values:['none', 'orbit', 'orbit-environment'], standard:'orbit', preset:'orbit-environment'},
	'touch-drag-action': {values:['none', 'orbit', 'orbit-environment'], standard:'orbit', preset:'orbit'},
	'touch-pinch-action': {values:['browser', 'zoom-model'], standard:'browser', preset:'zoom-model'},
};

export function inputAction(element, name) {
	const rule = inputActions[name];
	const value = element.getAttribute(name);
	return rule.values.includes(value) ? value : element.hoverControls ? rule.preset : rule.standard;
}

export function setInputAction(element, name, value) {
	if (value == null) element.removeAttribute(name);
	else element.setAttribute(name, value);
}
