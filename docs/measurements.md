# Image 3D: complete-package measurements

These historical measurements predate the standalone repository. References to
producer renderers describe comparisons at the time of measurement, not package
dependencies. Current commands and ownership are documented in the project README.

2026-11-07. Reproduce with [the experiment instructions](../README.md).
The one comparison page contains five checksum-pinned models, two atlas sizes,
and four lighting/codec profiles: **40 qualified combinations**. All use 36
cameras. These are measured results for this sweep, not a universal optimum.

## Runtime and decoder

| Single-file runtime | Raw bytes | Gzip bytes | Brotli bytes |
| --- | ---: | ---: | ---: |
| Native codecs | 21,739 | 8,590 | 7,775 |
| Complete XUASTC entry | 228,989 | 159,043 | 155,654 |

The optional entry includes the core, decoder, WASM and third-party notices.
Its WASM is 329,845 bytes raw, embedded as 142,424 gzip bytes.
No external decoder requests or neural codecs are involved. The standalone
optional entry avoids the extra core download incurred by the demo's lazy import.
Bundle gzip here uses level 9; package totals below use the converter's gzip setting.
Measurements use Node 24.22.1 and Chrome 156 on an Apple M2 Max (arm64).

A fresh classic worker's first startup measured **88.4 ms**;
the median across seven fresh workers was **77.0 ms**.
This includes worker creation, native gzip, WASM compilation/instantiation and
lookup-table initialization, with bytes already loaded. Later workers can reuse
Chrome's compiled-code cache. It excludes network transfer. Production shares
one initialized worker across all elements.

Warm timings below are medians of 20 transcodes after two warmups. They include
allocation and copying the output, and exclude GPU upload. These are CPU targets;
actual rendering and shader cost are separate.

| Image | Target | Median | p95 | Output bytes |
| --- | --- | ---: | ---: | ---: |
| 512×512 | ASTC | 2.80 ms | 3.90 ms | 262,144 |
| 512×512 | BC7 | 7.50 ms | 7.60 ms | 262,144 |
| 512×512 | RGBA | 2.50 ms | 2.60 ms | 1,048,576 |
| 1024×1024 | ASTC | 12.25 ms | 15.20 ms | 1,048,576 |
| 1024×1024 | BC7 | 27.90 ms | 28.40 ms | 1,048,576 |
| 1024×1024 | RGBA | 11.10 ms | 11.60 ms | 4,194,304 |
| 1024×512 | ASTC | 3.90 ms | 4.10 ms | 524,288 |
| 1024×512 | BC7 | 8.30 ms | 8.60 ms | 524,288 |
| 1024×512 | RGBA | 3.90 ms | 4.40 ms | 2,097,152 |
| 2048×1024 | ASTC | 15.40 ms | 15.70 ms | 2,097,152 |
| 2048×1024 | BC7 | 29.30 ms | 29.90 ms | 2,097,152 |
| 2048×1024 | RGBA | 15.10 ms | 15.70 ms | 8,388,608 |

Source/compiler/artifact hashes are pinned in the module's `xuastc/source.json`.
The reduced CAPI's 48 RGBA/ASTC/BC7 outputs matched the full official decoder.
Browser tests also cover RGBA fallback, blocked workers and rejected WASM while
native captures continue. Matrix quality numbers use the GPU format reported on
this machine; they do not establish identical perceptual quality on every target.

## Complete packages

Each cell is **capture KiB / complete page KiB over gzip**. Page totals include
one capture, one complete viewer and minimal HTML. The comparison page itself
shares viewers across assets. Geometry, coverage and opacity remain lossless;
these numbers include them rather than comparing color payloads alone.

| Model | Atlas | Live, native | Live, XUASTC | Baked, native | Baked, XUASTC |
| --- | ---: | ---: | ---: | ---: | ---: |
| Owl | 512 | 507.2 / 516.0 | 512.9 / 668.6 | 302.1 / 310.9 | 319.0 / 474.7 |
| Owl | 1024 | 1698.6 / 1707.5 | 1735.3 / 1891.1 | 1035.5 / 1044.3 | 1136.9 / 1292.7 |
| Watch | 512 | 312.8 / 321.7 | 318.5 / 474.2 | 181.9 / 190.7 | 242.4 / 398.2 |
| Watch | 1024 | 672.3 / 681.1 | 697.6 / 853.3 | 516.6 / 525.4 | 727.1 / 882.9 |
| Decor | 512 | 327.2 / 336.0 | 357.7 / 513.4 | 199.2 / 208.0 | 259.1 / 414.8 |
| Decor | 1024 | 964.6 / 973.4 | 972.1 / 1127.9 | 586.7 / 595.5 | 701.9 / 857.6 |
| Motorcycle | 512 | 422.0 / 430.8 | 398.8 / 554.6 | 290.2 / 299.0 | 302.1 / 457.8 |
| Motorcycle | 1024 | 1214.3 / 1223.1 | 1215.7 / 1371.5 | 796.8 / 805.7 | 992.3 / 1148.0 |
| Viking boat | 512 | 372.9 / 381.7 | 360.6 / 516.3 | 176.8 / 185.6 | 231.0 / 386.7 |
| Viking boat | 1024 | 866.6 / 875.4 | 935.6 / 1091.3 | 545.9 / 554.7 | 728.6 / 884.3 |

All 40 combinations pass covered-texel color PSNR≥40 dB, mean error≤1.5/255,
and aggregate rendered codec PSNR≥40 dB. PBR additionally requires shading
PSNR≥40 dB and normal RMS error≤2°. Rendered opacity must match byte for byte.
Selected aggregate codec PSNR ranges from 40.28 to 47.31 dB.
This is aggregate error across 36 views, **not a minimum per-view guarantee**;
per-view values and their minima are recorded separately in rendered-quality.json.

Selection visits atlas-qualified complete packages from smallest to largest,
renders 36 views and stops at the first passing package. Remaining candidates
are larger, so this proves the smallest passing package within the generated
sweep. Every atlas candidate and the rendered failures remain recorded. Larger
unrendered candidates are marked separately. No quality gate was relaxed.

Native sweeps use PNG/JPEG/WebP/AVIF. XUASTC uses Basis Universal 2.10.0, effort 3,
Zstandard and 4×4/6×6/8×6 blocks. PBR tries both lossless and qualified native
scalar planes. Native numeric geometry is never sent through a lossy color codec.
Native baked images can win transfer size even when XUASTC uses less GPU memory.
Per-variant codec, block, texture format and measured GPU payload are in the
page's comparison.json and generated metrics.json files.

## Source fidelity and baked lighting

Codec PSNR compares each selected package with the **lossless version of its
own shader**. It does not measure mesh reconstruction or baked-light fidelity.
The Reference toggle instead shows the original source rendered under studio
PBR at the same 36 saved cameras. Resolution and appearance switches remain on
that single page. Source comparisons below use lossless baked appearance:

| Source | Atlas | Minimum source silhouette IoU | Mean source PSNR |
| --- | ---: | ---: | ---: |
| Owl | 512 | 96.48% | 18.93 dB |
| Owl | 1024 | 98.61% | 20.01 dB |
| Watch | 512 | 92.02% | 14.69 dB |
| Watch | 1024 | 96.33% | 15.07 dB |
| Decor | 512 | 88.99% | 23.30 dB |
| Decor | 1024 | 93.79% | 25.45 dB |
| Motorcycle | 512 | 93.43% | 15.77 dB |
| Motorcycle | 1024 | 96.61% | 16.19 dB |
| Viking boat | 512 | 80.91% | 19.63 dB |
| Viking boat | 1024 | 88.36% | 20.99 dB |

Source PSNR uses intersecting silhouettes; IoU also measures missing/extra pixels.
The generated baked-reference-comparison.json additionally separates the baked
angular approximation from full PBR rendering of the same captured fields.
Six fixed studio-radiance directions retain view dependence, but cannot reproduce
arbitrary relighting or sharp moving reflections. A 40 dB codec gate does not
imply equivalence to the original mesh or full live PBR. Inspect the images.

## Report corrections and rendering cost

The Bag-02 report exposed reversed derivative normal-map perturbations and
WebGL texture maps falling back to the wrong UV channel. Both capture backends
now preserve UV0–3 and agree on authored alpha-map channels. The real WebGL/native
parity test checks these against analytic expected pixels and normal direction.
A whole-bag WebGL comparison isolates the capture correction at the report's
saved camera, with the same 19 boxes and 1024 atlas: color PSNR improves from
11.80 to 18.10 dB and mean error falls from 0.161 to 0.076, with unchanged
0.991 silhouette IoU. Reproduce with
`node experiments/impostor-reprojection/bag-capture-audit.mjs`.
The shared handbag source remains checksum pinned. Fine fabric blur and strap
artifacts remain; the correction does not establish full source fidelity.

The V8 report exposed fixed-step searches skipping narrow captured details.
Texel-aware intervals and both crossing directions recover more of its radiator
without increasing the four-box fit. At its saved camera and 1024 atlas, measured
silhouette IoU improves from 73.3% to 91.4%; union color error drops from 0.344 to 0.183.
Some gaps remain. This is an improvement, not a claim that the report is fully
resolved or that every source layer is represented by six captures.

The corrected tracer can execute many more depth reads. It increases worst-case
shader work; decoder throughput does not measure that cost. The following matched
native WebGPU timing uses the same capture, saved camera, 768-pixel target and
16 trace setting, compared with module commit 4957a85:

| Renderer | Median GPU time | Silhouette IoU |
| --- | ---: | ---: |
| Before | 1.442 ms | 73.32% |
| Corrected | 13.631 ms | 91.40% |

This is a bounded fixture/camera measurement, not a portable frame-rate guarantee.
Projection-only variants do not compile this traced search. The tiny viewer also
uses texel-aware intervals; baked shading removes its PBR-map/lighting work but
retains tracing.

## Many elements and reproducibility

One shared WebGL2 surface renders into ordinary per-element 2D canvases. Native
compositing owns clipping, stacking and scrolling. Rendering is queued on load,
interaction and resize; there is no idle animation loop. Offscreen views defer
work. Visible assets stay resident; inactive encoded and GPU caches are bounded.
Per-element raster memory is additional.
Real Chrome coverage uses 120 elements for shared fetch/context, independent
controls, scrolling/touch/DPR, source replacement, resizing and context recovery;
XUASTC tests also exercise a 60-element scrolling grid. The comparison page now
cycles all five models across 120 cards, with appearance and resolution shared.

The matrix fingerprints source/capture/code/runtime/encoder and reference inputs.
Validation remains provisional until opacity, interaction, lifecycle and standalone
checks finish. A content hash binds successful validation to its runtime and views.
Shared source pointers and SHA-256 manifests live in tests/fixtures/cloud/;
Decor selects the unreduced GLB conversion of an FBX upload. Generated candidates,
reference PNGs and logs remain under .local/img-3d/. No source report ZIP is a
private-only regression dependency.

## 2026-11-08: ordinary WebP turntables and live light

The same comparison page now includes **32 WebP views** for all five models at
512 and 1024. These render the original source with the same normalization,
45° field of view, distance 4 and RoomEnvironment/ACES as the studio references.
There are 32 evenly spaced azimuths at elevation 0.2 radians (11.46°), with
11.25° between frames. WebP uses quality 80, effort 6 and lossless alpha; the
measured alpha mismatch count is zero. Reproduce with:

```sh
node experiments/img-3d/turntable.mjs
node experiments/img-3d/demo.mjs
```

| Model | Frame side | All 32 WebPs | Complete gzip | Mean frame | Codec PSNR |
| --- | ---: | ---: | ---: | ---: | ---: |
| Owl | 512 | 347.1 KB | 348.5 KB | 10.8 KB | 30.4 dB |
| Owl | 1024 | 1001.6 KB | 1003.0 KB | 31.3 KB | 31.5 dB |
| Watch | 512 | 385.6 KB | 387.0 KB | 12.0 KB | 33.7 dB |
| Watch | 1024 | 939.5 KB | 940.8 KB | 29.4 KB | 35.6 dB |
| Decor | 512 | 183.9 KB | 185.3 KB | 5.7 KB | 35.5 dB |
| Decor | 1024 | 464.3 KB | 465.7 KB | 14.5 KB | 37.1 dB |
| Motorcycle | 512 | 239.9 KB | 241.2 KB | 7.5 KB | 29.7 dB |
| Motorcycle | 1024 | 638.4 KB | 639.8 KB | 19.9 KB | 31.7 dB |
| Viking boat | 512 | 179.1 KB | 180.4 KB | 5.6 KB | 33.2 dB |
| Viking boat | 1024 | 508.2 KB | 509.6 KB | 15.9 KB | 33.9 dB |

KB here means 1,000 bytes. A blanket estimate of 32 × 20 KB = 640 KB is plausible,
but image detail, silhouette and resolution change the result substantially.
Complete totals include every WebP, the manifest, the independent image-only
viewer and minimal HTML; HTTP headers are excluded. Frames load on demand.
The comparison page's image-memory figure is the decoded RGBA size of all 32 frames
(32 MiB at 512, 128 MiB at 1024), not measured browser residency.

These are different representations and quality budgets. WebP PSNR measures
codec error against the original rendered frame at its captured angle. It does
not use the 3D codec's 40 dB gate, measure stepping between angles, or account
for the restriction to one elevation. The 3D score measures codec error against
its own lossless shader, whose separate source approximation can be much larger.
A 512-pixel image per angle also differs from one 512-pixel atlas shared by all
3D views. Compare images and source fidelity alongside bytes; neither codec
PSNR column establishes overall superiority.

**Move light** animates the key in the existing live view at the display refresh rate. It adds no new comparison pane. The runtime exposes per-element
`lighting` direction, intensity and hemisphere strength. Setting it to `null`
restores the original key. Defaults matched the previous runtime byte for byte
on the analytic opaque-cube regression; lights remain independent between
shared-context elements and baked pixels remain unchanged. The live shader
still uses GGX plus a hemisphere approximation, not full RoomEnvironment IBL.
Baked and turntable lighting is fixed. Demo animation pauses offscreen, while
hidden, and stops when disabled; Grid applies the same moving key to its visible
models. Ordinary runtime viewing remains
on demand. The fixed studio reference is hidden during light movement and is
restored afterward.

This control belongs to the standalone developer comparison, rather than the
workbench UI or its WebMCP workflow. It adds no workbench settings or telemetry.

With light controls, visible-asset retention and the initial frame batching, the core was 22,810 bytes
raw / 8,127 Brotli; the complete optional XUASTC entry is 230,061 bytes raw /
155,957 Brotli. That adds 352 and 303 compressed bytes respectively to the
November 7 bundles.
Decoder code and WASM are unchanged. The comparison page refreshes its package
totals using the current viewer size alongside saved capture qualifications; the November 7 tables above remain the
dated measurements from that sweep.

The comparison Grid contains 120 items, cycling through all five models with
the same resolution and appearance. Item size adjusts cards from 80 to 360 pixels. Visible cards follow the mouse. While one is dragged, the others turn
away and the selected element keeps its own orbit gesture; release or cancellation
restores following. Input is coalesced per animation frame without waiting for the whole grid to
finish drawing; offscreen cards are skipped. This interaction is demo code; it adds no bytes
to the standalone capture viewers and changes no shader or encoded capture.
Following and the temporary look-away gesture now ease between poses; look-away
is limited to approximately 32° horizontally. **Follow mouse** can disable both
automatic camera behaviors. With **Move light** also off, dragging one model
does not request redraws of the other cards. This isolates single-view camera
cost from a grid whose 120 cameras change simultaneously.

The runtime automatically retains the visible working set, including its
128-pixel preload margin, shared across all elements referring to one source.
The eight-entry / 64 MiB GPU and 32 MiB encoded-cache limits apply to inactive
assets. Visible memory is additional and reported separately. Five native live
1024 captures use about 98 MiB; mouse tracking now reuses those textures instead
of uploading them again on every move. Ownership and eviction tests also cover
ten unique visible sources, removing one of two shared owners, offscreen LRU
eviction, cache reuse on return and final disconnect. The demo needs no cache
budget overrides.

The shared renderer now handles multiple pending views per frame with a 12 ms
work budget instead of one view per animation frame. An eleven-element warm
fixture refresh improved from 11 animation frames / 179 ms to one frame / 14 ms
on this machine. This is a scheduler regression check, not a universal frame-rate
guarantee; model complexity, card size and device still determine draw cost.
On the actual 120-item comparison at 512 / Live light, with 24 visible cards
in a 1200×900 viewport, three warm refreshes took 400.4 / 400.0 / 399.9 ms
(24 frames each) before batching and 17.2 / 16.6 / 19.1 ms (one frame each)
afterward. Both runs used one context and the same five captures.
Redraw requests share one pending completion per element, so a slow load does
not accumulate a promise for every mouse or light update. That scheduling change
did not alter shader sources or capture textures. These single-refresh timings
do not establish sustained animation performance or account for all GPU work.

## 2026-11-08: sustained moving-light performance

Lighting updates previously repeated the six-face depth search and handed the
shared WebGL surface to a canvas after every card. The current runtime caches
opaque intersections for stable cameras, prunes searches beyond the nearest
accepted hit, renders ready cards into a shared frame atlas and copies afterward.
Identical views share a render within the frame. Resource preparation happens
outside that draw/copy sequence, so a loading source cannot stall resident views.

The benchmark below uses Chrome 156, ANGLE Metal on Apple M2 Max, device pixel
ratio 2 and native live captures. Each case warms for 1.5 seconds then measures
two seconds of moving light with stationary cameras. It counts actual canvas
updates per card, rather than animation callbacks alone. The baseline is module
commit `9a34123`. Reproduce with `grid-performance.mjs` as documented in the
experiment README.

| Visible cards | CSS card size | Atlas | Camera poses | Before updates/s | Current updates/s | Current p95 frame |
| ---: | ---: | ---: | --- | ---: | ---: | ---: |
| 24 | 180 px | 512 | Repeated defaults | 19.5 | 60.0 | 16.8 ms |
| 120 | 80 px | 1024 | Repeated defaults | 2.5 | 60.0 | 16.7 ms |
| 120 | 80 px | 1024 | Distinct mouse-facing | 3.0 | 25.5 | 50.0 ms |

Viewports are 1440×1000 for 24 cards and 1440×1800 for all 120. All cases use
one context and perform zero source uploads in the timed window. Current cases
also perform zero surface-cache rebuilds during that window. Repeated defaults
need five rendered views per frame; mouse-facing cameras need 120. These are
sustained lighting measurements, not continuous camera-motion measurements or a
universal 60 fps guarantee. Distinct views remain substantially more expensive
than conventional mesh shading.

A rerun after adding the **Follow mouse** control and eased camera motion still
measured 60 updates/s for repeated defaults, but 15.5 updates/s with 120 distinct
cursor-facing cameras (p95 frame 83.3 ms). It waited for all camera easing to
finish and performed zero uploads or cache rebuilds in the timed window. The
earlier 25.5 result is not a lower bound: camera pose, layout and system load
matter substantially for this tracer.

Opaque intersection caches cost 20 bytes per physical pixel: 12,960,000 bytes
for the 24-card case, 2,689,600 for the repeated 120-card case and 64,550,400
(61.6 MiB) for 120 distinct cameras. This is additional to the approximately
98 MiB source payload for five native 1024 captures, driver allocations and
raster canvases. Offscreen views and released sources drop their intersection
caches. Float-render-target support is required; other devices render directly.
Transparent batches and carrier triangle edges retain direct tracing.

An 80-view regression across all five sources, 512/1024, four cameras and two
lights matches exhaustive uncached rendering byte for byte in RGBA. The Watch
includes a transparent batch. Separate tests cover fallback, shared uploads,
context restoration and cache release. No capture or codec settings changed;
the November 7 codec qualification remains a dated measurement.

| Current single-file runtime | Raw bytes | Gzip bytes | Brotli bytes |
| --- | ---: | ---: | ---: |
| Native codecs | 28,374 | 10,820 | 9,777 |
| Complete XUASTC entry | 235,628 | 161,135 | 157,643 |

The native runtime adds 1,650 Brotli bytes over the initial November 8 batching
implementation. Decoder code and WASM remain unchanged. The comparison page
calculates package totals using the current runtime with the saved captures.

## 2026-11-08: rotating-view cost isolation

`render-cost.mjs` keeps all 120 cards visible at 80 CSS pixels, DPR 2 and 1024
native live captures. The five sources have 120 distinct cameras. It rotates
either one or all 120 by 0.01 radians per step, warms for two steps and measures
eight more. A one-pixel readback forces completion; GPU times use
`EXT_disjoint_timer_query_webgl2`, discarding disjoint or unavailable samples.
These bounded diagnostic steps are separate from sustained animation FPS.
The runtime is module commit `0bdb958`; hardware and browser match the section
above. Results include a runtime SHA-256 for subsequent reproductions. Two
paired runs recorded the following medians; ranges show variation between runs.

| Diagnostic | Rotating cards | Median GPU time |
| --- | ---: | ---: |
| Actual renderer | 1 | 1.51–1.58 ms |
| Actual renderer | 120 | 51.28–59.27 ms |
| Placeholder surface, same PBR lighting | 120 | 0.94–1.38 ms |

The placeholder replaces the depth search with projected surface coordinates;
its image is deliberately incorrect. It isolates the cost of reconstruction
from the remaining lighting work, rather than proposing a lower-quality viewer
setting. A separate paired sweep measured 44.97 ms for the actual renderer and
42.56 ms with canvas copies omitted. Flat-color boxes measured 0.54 ms. Copies
still have a cost, but the surface-search shader dominates this case.

The current viewer searches up to six depth fields for each covered pixel,
using at least 24 samples per valid search interval and potentially hundreds
at 1024. Quality fixes preserved thin surfaces by increasing that search work.
Opaque caches help stationary cameras and repeated views share draws, but a
changing camera still needs reconstruction. This exact tracer does not yet
meet the intended throughput for thousands of independently changing captures.
With **Follow mouse** and **Move light** off, the demo isolates one rotating
card and leaves neighboring cards unchanged without requesting their redraws.

## 2026-11-08: packetized surface traversal

The standalone viewer now fetches 16 independent fine-depth samples together,
then processes only crossing intervals through a bit mask. The original
texel-scaled sample grid, five refinement iterations and hit validation remain.
Affine ray projection is calculated once per field. PBR searches camera-facing
fields first, retaining all six and the original equal-depth face priority;
baked captures retain their accumulation order. Cache writes, reuse, forward
PBR and baked shading compile separately.

Cached relighting also uses a positive opaque owner's depth to bound fallback
edge searches. The bound includes depth-quantization and projection allowances;
far-plane ties remain unbounded. It preserves draw order. Caching requires a
24- or 32-bit destination depth buffer and matching cache depth attachment;
lower precision uses direct tracing. The 32-bit attachment path has been
reviewed but has not been measured on a native 32-bit default framebuffer.

The changes are module commits `b1472e7` and `edfc1a8`. The final native
runtime SHA-256 is
`8ecb02a65ec3c3fb561e70488f34874a8cac76d661a3e0e3e7378008a01a4450`.
The saved `0bdb958` baseline is
`9e20bb5f494a6cce2fd556f5dc3d3668335e364f2f94f5fe767f6537d1dd2eb7`.
The hardware/browser and 120-card Retina layout match the preceding diagnostic.
The final completion-forced run measured 0.78 ms GPU for one rotating card and
18.82 ms for all 120, versus 1.51–1.58 ms and 51.28–59.27 ms in the saved baseline
runs. These are GPU timings, not sustained FPS.

Sustained runs use `grid-performance.mjs`, moving light, a 1.5-second warmup and
2-second timed window. Rotating cases advance every distinct camera by 0.01
radians per animation callback. All rows use one context and zero uploads in
the timed window. Rotating rows also have zero surface builds and reuses.

| Workload, all 120 visible at 80 CSS px / DPR 2 | Atlas | Old updates/s | Current updates/s |
| --- | ---: | ---: | ---: |
| All cameras rotate, five shared source uploads | 1024 | 17.48 | 36.48 |
| All cameras rotate, 120 independent GPU resources | 512 | — | 47.48 |
| All cameras rotate, 120 independent GPU resources | 1024 | — | 33.46 |
| Settled distinct cursor-facing cameras, moving light | 1024 | 19.48 | 43.45 |

The relighting values come from separate old/current runs. A paired incremental
comparison measured 39.99 updates/s for packet traversal alone (`b1472e7`,
SHA-256 `c87fe12249294752897697f3f489c1594817c032fb942a2905e350d3418e0192`)
and 43.45 with the edge bound. Every measured card updates at the reported
rate; p95 frame intervals are 33.4 ms in the final cases. The independent runs
assert 120 active assets and 120 unique source URLs. They duplicate the five
source geometries into separate uploads and textures; they do not establish
performance for 120 different model geometries. The faster orbit result does
not depend on sharing completed views or reusing cached intersections.

This substantially reduces reconstruction cost, but the full 1024 all-motion
stress case remains below 60 fps. Fine-detail tracing still scales with crossed
capture texels; these measurements do not establish throughput for thousands of
independently changing captures.

`surface-search.test.mjs` now freezes the scalar fine-grid traversal independently
of packet masking and pruning. It compares 160 images across five models,
512/1024, PBR/baked, four poses and two lights, then repeats with simulated
16-bit destination depth and verifies direct fallback: 320 byte-identical RGBA
comparisons. The scalar oracle shares affine field evaluation and face setup.
The separate saved-runtime comparison checks the native-depth images against
`0bdb958`: exact alpha, minimum 54.92 dB RGBA PSNR, exceeding its additional
50 dB gate. Affine reassociation can affect tied/specular pixels, so this is
measured equivalence, not a claim of universal byte identity.
Capture files, codec settings and decoder artifacts are unchanged.

| Final single-file runtime | Raw bytes | Gzip (level 9) | Brotli bytes |
| --- | ---: | ---: | ---: |
| Native codecs | 32,465 | 12,149 | 10,899 |
| Complete XUASTC entry | 239,720 | 162,333 | 158,781 |

The complete XUASTC SHA-256 is
`3cb209ff291bc6f6a343704748fe9978f584f729cedf905fbcf30247ef27edb7`.
Benchmark output now records its runtime SHA-256 and resource counts; `--runtime`
and `--before-runtime` select exact artifacts. `--pose rotate`, `--resolution`
and `--independent-resources` reproduce the distinct-camera stress cases.

## 2026-11-08: WebGPU renderer

This section records the superseded depth-mesh experiment. The current runtime
uses compact boxes and shader reconstruction; see the compact-box results below.

The viewer renders with WebGPU when available. One device renders all changed
views of a frame together: a visibility pass over rasterized level-of-detail
meshes of every face's captured depth, with a per-pixel search through the
full-resolution depth whose hit depth decides the front surface; a shading pass
that shades each visible pixel once; and separate passes for translucent boxes.
A GPU texture copy then moves each view into its element's WebGPU canvas. The
WebGL renderer is the previous runtime, used when WebGPU is unavailable.

Runtime `4cc1c84aaf88ebfe89be82b7015f2acdab048ea064d355d2c5d49c3d341bf925`:
64,032 bytes raw, 21,148 Brotli (previous runtime: 32,465 raw, 10,899 Brotli).
With XUASTC: 271,314 raw, 169,098 Brotli (previously 239,720 raw, 158,781 Brotli). Apple M2 Max, Chrome 156, WebGPU adapter
`apple` / `metal-3` (not a fallback adapter), DPR 2, 120 elements of 80 CSS px
(160 × 160 device pixels), all visible. Every camera rotates by 0.01 radians per
animation callback and the light moves. Cards use 120 distinct captures from
`unique-pool.mjs` (variants of five authored models). The measured window starts
and ends with the GPU queue drained; complete grid updates are the rate of the
least-updated card.

| Runtime | Frame rate | Complete grid updates/s | Mean per card | 2D copies / frame | GPU copies / frame | Main thread ms |
|---|---|---|---|---|---|---|
| Previous (WebGL) | unlimited | 33.6 | 38.9 | 125.4 | 0 | 25.0 |
| WebGPU | unlimited | 99.5 | 99.5 | 0 | 123.5 | 6.5 |
| Previous (WebGL) | display (60 Hz) | 39.5 | 39.5 | 123.0 | 0 | 1.8 |
| WebGPU | display (60 Hz) | 59.8 | 59.8 | 0 | 121.5 | 1.6 |

Copies are per animation callback. In every measured window the only GPU writes
were per-frame uniform data: no texture or buffer creation, uploads or shader
and pipeline compilation, which the benchmark rejects. Resident texture and mesh payload is
2,701 MiB with WebGPU and 2,352 MiB previously for the 120 distinct 1024 captures.

Development measurements on the same workload explain the design. Rendering
each element in its own render passes reached 13–23 complete updates/s: pass
count, not canvas presentation, dominated (clearing all 120 canvases alone ran at
137/s). A depth pre-pass with multisampled coverage cost more than half the
frame on this GPU. Shared atlas passes with single-sample visibility removed both.

Source fidelity against the studio renders of the checksum-pinned sources, views
0, 1, 14 and 30, baked captures (IoU / mean boundary px / union PSNR dB):

| Case | Previous | WebGPU |
|---|---|---|
| Card, 1024: owl | .988 / .11 / 20.32 | .990 / .09 / 20.43 |
| Card, 1024: watch | .985 / .25 / 15.42 | .990 / .20 / 15.76 |
| Card, 1024: decor | .977 / .31 / 25.42 | .989 / .18 / 24.86 |
| Card, 1024: motorcycle | .976 / .20 / 17.17 | .984 / .14 / 17.49 |
| Card, 1024: boat | .966 / .36 / 21.74 | .988 / .15 / 22.50 |
| Card, 512: decor | .954 / .65 / 22.68 | .986 / .23 / 23.86 |
| View, 1024: decor | .971 / 1.39 / 18.86 | .992 / .38 / 23.35 |
| View, 512: watch | .973 / 1.55 / 13.83 | .994 / .32 / 15.09 |

Silhouette IoU and boundary error improve in every model, size and view mode.
Union PSNR improves in all baked cases except the decor 1024 card (−0.56 dB).
`source-quality.test.mjs` checks every case against these previous scores.
Silhouettes are binary per pixel, as in the previous renderer. The translucent
mirrored, nonuniformly scaled fixture renders the same centre pixel (alpha 120)
with both renderers.


## 2026-11-09: shared surface refinement

These measurements precede the compact-box correction described below.

Production TSL and standalone WebGL now use one renderer-independent interval
refinement implementation. Standalone WebGPU uses the same kernel module's
seeded local search; its depth-cell mesher remains specific to the visibility
renderer. Shader text is generated at build time, keeping the writer and Three.js
out of the deployed viewer. Production retains compact box/card geometry and
its PBR, shadow, transparency and camera behavior. A trial cell-carrier port was
rejected after increasing production geometry and GPU cost.

The existing source-quality sweep passes all 40 combinations. The WebGL scalar
oracle passes 320 RGBA comparisons, including simulated 16-bit destination depth.
The native-depth comparison with the pre-consolidation viewer is byte-identical
across its 160 views. No quality threshold was changed.

The matched production owl benchmark (1024 atlas, 512 output, four views, eight
timing rounds) is byte-identical to the pre-consolidation material. Median GPU
time across views was 3.21 ms versus 3.31 ms before; this establishes preserved
cost for this case, rather than a general production speedup.

The 120-distinct-capture stress case still uses 120 independent uploads and
resources, at DPR 2 and 160 device pixels per card, with every camera and light
moving. With the display limit lifted, complete grid updates measured 98.3/s
versus 87.6/s for the saved pre-consolidation WebGPU bundle in this paired run.
Both used one device, zero 2D copies and zero uploads during measurement, with
2,832,172,648 resident payload bytes. These short windows can vary with machine
load; they show the consolidation retains the fast path.

| Single-file runtime | Raw bytes | Gzip (level 9) | Brotli bytes |
| --- | ---: | ---: | ---: |
| Native codecs | 68,247 | 24,350 | 21,596 |
| Complete XUASTC entry | 275,529 | 175,144 | 169,510 |

The native runtime SHA-256 is
`aeb30f2e805784a25eddf70016bc8404d643a4c100d32d2485aeed5a21edc558`.
The paired previous runtime SHA-256 is
`688bca1caa25bde54c227b978d7fd237ff87fc2ecfb9ea8ffb746e4c5cadc2e7`.
Use the existing `benchmark-box-impostors.mjs --assert-equivalent`,
`source-quality.test.mjs`, `surface-search.test.mjs` and `one-scene.mjs` commands
from the experiment README.

## 2026-11-09: compact boxes and shader reconstruction

The viewer now draws twelve triangles per box at every size, with no generated
surface mesh or geometry LOD. A conservative min/max depth texture pyramid
accelerates shader tracing. Light-only changes reuse visibility; camera and size
changes retrace the captured surfaces. The runtime remains dependency-free.

Paired measurements on Apple M2 Max, WebGPU, with the display limit lifted:
120 distinct captures and independent GPU uploads, DPR 2, 160 device pixels per
card, moving lights in both cases. These captures are deterministic variants of
the five authored comparison models, not 120 separately authored models.

| Workload | Compact boxes, complete grid updates/s | Previous depth meshes |
| --- | ---: | ---: |
| Every object rotating | 43.4 | 82.1 |
| Fixed views, moving lights | 139.0 | 80.7 |

Each window lasts three seconds and drains the GPU queue at both ends. Both
paths use one device, zero 2D copies, and no uploads during measurement. Short
windows vary with machine load. The all-rotating case still misses the 60 Hz
target; the previous mesh-based performance figures must not be attributed to
this compact-box path. Resident capture payload falls from 2,832,172,648 to
2,508,493,152 bytes; these totals exclude render targets and driver overhead.

The existing 40-case source-quality sweep and 320 WebGL scalar comparisons pass.
Additional coverage checks fixed geometry across element sizes, folded depth
with fractional attribute coverage, mixed cached and changed views, scrolling,
device loss, and visibility reuse during light changes. Quality thresholds are
unchanged.
