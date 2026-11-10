// @ts-check

/**
 * Computes overlap, area, and symmetric boundary error for two binary masks.
 * Boundary distances use a fast eight-neighbor 3/4 chamfer approximation and
 * are reported in screen pixels.
 *
 * @param {Uint8Array} reference
 * @param {Uint8Array} candidate
 * @param {number} size
 */
export function computeSilhouetteError(reference, candidate, size) {
  if (reference.length !== size * size || candidate.length !== size * size) {
    throw new RangeError('Silhouette masks must match the declared square size.');
  }
  const overlap = computeSilhouetteOverlap(reference, candidate);
  const boundary = computeBoundaryError(reference, candidate, size);
  return { ...overlap, ...boundary };
}

/**
 * Computes silhouette overlap without imposing a square image layout.
 * @param {Uint8Array} reference
 * @param {Uint8Array} candidate
 */
export function computeSilhouetteOverlap(reference, candidate) {
  if (reference.length !== candidate.length || !reference.length) {
    throw new RangeError('Silhouette masks must have the same nonzero length.');
  }
  let intersection = 0;
  let union = 0;
  let referenceArea = 0;
  let candidateArea = 0;
  for (let pixel = 0; pixel < reference.length; pixel++) {
    if (reference[pixel] && candidate[pixel]) intersection++;
    if (reference[pixel] || candidate[pixel]) union++;
    if (reference[pixel]) referenceArea++;
    if (candidate[pixel]) candidateArea++;
  }
  return {
    silhouetteIoU: union ? intersection / union : 1,
    silhouettePrecision: candidateArea ? intersection / candidateArea : referenceArea ? 0 : 1,
    silhouetteRecall: referenceArea ? intersection / referenceArea : candidateArea ? 0 : 1,
    silhouetteAreaRatio: referenceArea ? candidateArea / referenceArea : candidateArea ? Infinity : 1,
  };
}

/**
 * Computes RGB error over the union of two silhouette masks. RGBA pixels must
 * be straight-alpha bytes with one pixel per mask entry.
 * @param {Uint8Array} referenceRgba
 * @param {Uint8Array} candidateRgba
 * @param {Uint8Array} referenceMask
 * @param {Uint8Array} candidateMask
 */
export function computeForegroundRenderError(
  referenceRgba,
  candidateRgba,
  referenceMask,
  candidateMask,
) {
  const pixels = referenceMask.length;
  if (
    !pixels
    || candidateMask.length !== pixels
    || referenceRgba.length !== pixels * 4
    || candidateRgba.length !== pixels * 4
  ) throw new RangeError('Render pixels and silhouette masks must describe the same nonzero image.');
  let squaredError = 0;
  let samples = 0;
  for (let pixel = 0; pixel < pixels; pixel++) {
    if (!referenceMask[pixel] && !candidateMask[pixel]) continue;
    const offset = pixel * 4;
    for (let channel = 0; channel < 3; channel++) {
      const error = referenceRgba[offset + channel] - candidateRgba[offset + channel];
      squaredError += error * error;
      samples++;
    }
  }
  const renderRmse = samples ? Math.sqrt(squaredError / samples) : 0;
  return {
    renderRmse,
    renderPsnr: renderRmse ? 20 * Math.log10(255 / renderRmse) : Number.POSITIVE_INFINITY,
  };
}

/**
 * Measures angular stability over a sequence of equally spaced views. The
 * source sequence establishes how much real silhouette motion the camera step
 * contains; excess candidate motion isolates impostor popping from legitimate
 * rotation. This deliberately evaluates adjacent views rather than a handful
 * of individually favorable angles.
 *
 * @param {Uint8Array[]} referenceFrames
 * @param {Uint8Array[]} candidateFrames
 */
export function computeAngularSilhouetteStability(referenceFrames, candidateFrames) {
  if (referenceFrames.length !== candidateFrames.length || referenceFrames.length < 2) {
    throw new RangeError('Angular stability requires matching sequences of at least two masks.');
  }
  const maskLength = referenceFrames[0]?.length ?? 0;
  if (!maskLength || [...referenceFrames, ...candidateFrames].some((frame) => frame.length !== maskLength)) {
    throw new RangeError('Every angular stability mask must have the same nonzero length.');
  }
  const steps = [];
  for (let index = 1; index < referenceFrames.length; index++) {
    const sourceChange = computeSilhouetteChange(referenceFrames[index - 1], referenceFrames[index]);
    const candidateChange = computeSilhouetteChange(candidateFrames[index - 1], candidateFrames[index]);
    steps.push({
      sourceChange,
      candidateChange,
      excessChange: Math.max(0, candidateChange - sourceChange),
    });
  }
  const excess = steps.map((step) => step.excessChange).sort((a, b) => a - b);
  const accelerations = [];
  for (let index = 1; index < steps.length; index++) {
    const sourceAcceleration = Math.abs(steps[index].sourceChange - steps[index - 1].sourceChange);
    const candidateAcceleration = Math.abs(
      steps[index].candidateChange - steps[index - 1].candidateChange,
    );
    accelerations.push({
      sourceAcceleration,
      candidateAcceleration,
      excessAcceleration: Math.max(0, candidateAcceleration - sourceAcceleration),
    });
  }
  const excessAcceleration = accelerations
    .map((step) => step.excessAcceleration)
    .sort((a, b) => a - b);
  return {
    steps,
    accelerations,
    meanExcessChange: excess.reduce((sum, value) => sum + value, 0) / excess.length,
    p95ExcessChange: excess[Math.min(excess.length - 1, Math.floor(excess.length * 0.95))],
    maximumExcessChange: excess[excess.length - 1],
    meanExcessAcceleration: excessAcceleration.length
      ? excessAcceleration.reduce((sum, value) => sum + value, 0) / excessAcceleration.length
      : 0,
    p95ExcessAcceleration: percentile(excessAcceleration, 0.95),
    maximumExcessAcceleration: excessAcceleration.at(-1) ?? 0,
  };
}

/** @param {Uint8Array} previous @param {Uint8Array} current */
export function computeSilhouetteChange(previous, current) {
  if (previous.length !== current.length || !previous.length) {
    throw new RangeError('Silhouette change masks must have the same nonzero length.');
  }
  let changed = 0;
  let union = 0;
  for (let pixel = 0; pixel < previous.length; pixel++) {
    if (previous[pixel] || current[pixel]) union++;
    if (Boolean(previous[pixel]) !== Boolean(current[pixel])) changed++;
  }
  return union ? changed / union : 0;
}

/** @param {number[]} sorted @param {number} fraction */
function percentile(sorted, fraction) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

/** @param {Uint8Array} reference @param {Uint8Array} candidate @param {number} size */
function computeBoundaryError(reference, candidate, size) {
  const referenceBoundary = extractBoundary(reference, size);
  const candidateBoundary = extractBoundary(candidate, size);
  const referenceDistance = chamferDistance(referenceBoundary, size);
  const candidateDistance = chamferDistance(candidateBoundary, size);
  const distances = [];
  for (let pixel = 0; pixel < reference.length; pixel++) {
    if (referenceBoundary[pixel]) distances.push(candidateDistance[pixel]);
    if (candidateBoundary[pixel]) distances.push(referenceDistance[pixel]);
  }
  if (!distances.length) return { silhouetteBoundaryMeanPx: 0, silhouetteBoundaryP95Px: 0 };
  distances.sort((a, b) => a - b);
  return {
    silhouetteBoundaryMeanPx: distances.reduce((sum, value) => sum + value, 0) / distances.length,
    silhouetteBoundaryP95Px: distances[Math.min(distances.length - 1, Math.floor(distances.length * 0.95))],
  };
}

/** @param {Uint8Array} mask @param {number} size */
function extractBoundary(mask, size) {
  const result = new Uint8Array(mask.length);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const pixel = y * size + x;
      if (!mask[pixel]) continue;
      if (
        x === 0 || x === size - 1 || y === 0 || y === size - 1
        || !mask[pixel - 1] || !mask[pixel + 1]
        || !mask[pixel - size] || !mask[pixel + size]
      ) result[pixel] = 1;
    }
  }
  return result;
}

/**
 * Eight-neighbor 3/4 chamfer distance, returned in pixel units.
 * @param {Uint8Array} boundary
 * @param {number} size
 */
function chamferDistance(boundary, size) {
  const distance = new Float32Array(boundary.length);
  distance.fill(size * 4);
  for (let pixel = 0; pixel < boundary.length; pixel++) {
    if (boundary[pixel]) distance[pixel] = 0;
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const pixel = y * size + x;
      if (x) distance[pixel] = Math.min(distance[pixel], distance[pixel - 1] + 3);
      if (y) distance[pixel] = Math.min(distance[pixel], distance[pixel - size] + 3);
      if (x && y) distance[pixel] = Math.min(distance[pixel], distance[pixel - size - 1] + 4);
      if (x + 1 < size && y) distance[pixel] = Math.min(distance[pixel], distance[pixel - size + 1] + 4);
    }
  }
  for (let y = size - 1; y >= 0; y--) {
    for (let x = size - 1; x >= 0; x--) {
      const pixel = y * size + x;
      if (x + 1 < size) distance[pixel] = Math.min(distance[pixel], distance[pixel + 1] + 3);
      if (y + 1 < size) distance[pixel] = Math.min(distance[pixel], distance[pixel + size] + 3);
      if (x + 1 < size && y + 1 < size) distance[pixel] = Math.min(distance[pixel], distance[pixel + size + 1] + 4);
      if (x && y + 1 < size) distance[pixel] = Math.min(distance[pixel], distance[pixel + size - 1] + 4);
    }
  }
  for (let pixel = 0; pixel < distance.length; pixel++) distance[pixel] /= 3;
  return distance;
}
