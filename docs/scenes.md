# Shared-camera scenes

`createImg3dScene(canvas, options)` renders captures on one WebGPU canvas with shared perspective and depth.

Scene loading is atomic by default: `await scene.load(items)` makes the new set available together.
To display ready captures while other requests are pending, explicitly opt in:

```js
const scene = await createImg3dScene(canvas);
const loading = scene.load(items.map(item => ({...item, opacity: 0})), {
  progressive: true,
  onLoad(index) {
    // Schedule draws and animate opacity from 0 to 1 in your render loop.
    scene.setOpacity(index, 1);
  },
  onError(index, error) { console.error(index, error); }
});
```

Progressive mode reserves normalized bounds for every placement so camera fitting does not jump as captures arrive. Item indices stay stable for picking and rotation. Individual request failures call `onError` and leave that item absent; other items continue loading. The returned promise settles after all items finish. Abort and scene disposal cancel pending work.

Opacity affects the capture and its contact shadow. It defaults to 1. Fading duration and redraw scheduling belong to the caller; the runtime adds no automatic animation loop. Set opacity immediately for reduced motion. This option loads whole captures progressively across a scene; it does not stream depth separately from color texture pages.

Use camera `fit: "width"` to fill and center the horizontal bounds, including zooming in on compact scenes. `padding` controls the edge margin; vertical extent may exceed the canvas. Default `fit: true` retains the original two-axis fitting and field-of-view cap.

Scene draws keep at most three GPU submissions in flight. When full, the runtime waits for a completion before scheduling the next render and sampling a camera callback. This bounds stale queued views without imposing a full GPU completion wait on every draw. Fully fogged geometry and shadows are skipped when fog opacity is 1.

An optional camera `fitReference: {eye, target}` holds the fitting basis fixed while the real camera moves. This keeps width fitting from changing horizontal zoom or recentering during scroll-driven camera motion.
