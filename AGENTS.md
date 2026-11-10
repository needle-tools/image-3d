# Image 3D

- Keep the browser runtime dependency-free and independently buildable. Neither
  this package nor its tools may depend on Baker or Mesh Effects. Interoperate
  through documented capture formats, not imports from producer source trees.
- Keep compact box/card carriers. Reconstruct captured surfaces in shaders;
  do not generate surface meshes or geometry LODs from depth textures.
- Preserve the one-device/context ownership model, native scrolling, independent
  element state, bounded inactive caches and resource recovery.
- Automatic redraws depend on complete rendered state, not input event type.
  Explicit `draw()` retains its immediate pixel-readback contract.
- Maintain one comparison page. Use short labels, transparent backgrounds and
  reversible controls. Do not add implementation explanations around controls.
- Keep source-quality thresholds and the scalar oracle intact. Run browser/GPU
  tests one at a time. Do not edit source while a browser run is active.
- Commit focused changes on main. Keep local investigation notes, paths and
  generated logs out of commits. Preserve third-party licenses and source pins.
