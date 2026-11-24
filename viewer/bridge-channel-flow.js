const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
export const channelVelocityLimit = 1.38;

// The stream function lives on cell corners. Its difference across a face is
// water discharge through that face, including the return flow beside a pile.
export function createChannelFlow({ minX, minZ, dx, dz, columns, rows, floor,
  bed, eastDepth, southDepth, piers, current }) {
  const stride = columns + 1;
  const stream = new Float32Array(stride * (rows + 1));
  const baseEast = new Float32Array(floor.length), baseSouth = new Float32Array(floor.length);
  const east = new Float32Array(floor.length), south = new Float32Array(floor.length);
  const air = new Float32Array(floor.length), staticAir = new Float32Array(floor.length);
  const texture = new Uint8Array(floor.length * 4);
  const mobile = new Float32Array(stream.length);
  const outlet = new Float32Array(rows + 1);

  function rowProfile(row, col) {
    const before = bed[Math.max(0, row - 1) * columns + col];
    const after = bed[Math.min(rows - 1, row) * columns + col];
    const depth = (before + after) * .5;
    return depth * (.36 + .64 * Math.min(1, depth / 1.48));
  }

  let reference = 0;
  for (let col = 0; col < columns; col++) reference += rowProfile(Math.floor(rows / 2), col) * dx;
  const discharge = reference * current;
  for (let row = 0; row <= rows; row++) {
    const start = row * stride;
    let total = 0;
    for (let col = 0; col < columns; col++) {
      total += rowProfile(row, col) * dx;
      stream[start + col + 1] = total;
    }
    outlet[row] = reference ? Math.min(1, total / (reference * .56)) : 0;
    const scale = total ? discharge / total : 0;
    for (let col = 1; col <= columns; col++) stream[start + col] *= scale;
  }

  function relaxPiles() {
    const correction = new Float32Array(stream.length);
    const fixed = new Uint8Array(stream.length);
    // Every blocked cell pins all four corners to the same streamline.
    for (const pile of piers) {
      const px = (pile.x - minX) / dx, pz = (pile.y - minZ) / dz;
      const col = clamp(Math.round(px), 0, columns), row = clamp(Math.round(pz), 0, rows);
      const boundary = stream[row * stride + col];
      for (let r = Math.max(0, row - 2); r < Math.min(rows, row + 2); r++) {
        for (let c = Math.max(0, col - 2); c < Math.min(columns, col + 2); c++) {
          const i = r * columns + c;
          if (floor[i] || !bed[i] || Math.abs(c + .5 - px) * dx >= .145 ||
              Math.abs(r + .5 - pz) * dz >= .145) continue;
          const k = r * stride + c;
          for (const corner of [k, k + 1, k + stride, k + stride + 1]) {
            correction[corner] = boundary - stream[corner];
            fixed[corner] = 1;
          }
        }
      }
    }
    // Fix the shoreline while letting an obstruction deflect its neighbours.
    const active = [];
    for (let row = 1; row < rows; row++) {
      for (let col = 1; col < columns; col++) {
        const i = row * columns + col, k = row * stride + col;
        if (fixed[k]) continue;
        if (floor[i] && floor[i - 1] && floor[i - columns] && floor[i - columns - 1]) active.push(k);
      }
    }
    const wx = dz * dz / (2 * (dx * dx + dz * dz));
    const wz = .5 - wx;
    for (let iteration = 0; iteration < 114; iteration++) {
      for (const k of active) {
        const average = wx * (correction[k - 1] + correction[k + 1]) +
          wz * (correction[k - stride] + correction[k + stride]);
        correction[k] += (average - correction[k]) * 1.69;
      }
    }
    for (let k = 0; k < stream.length; k++) stream[k] += correction[k];
  }

  function faces(source, across, along, bounds) {
    const { c0, c1, r0, r1 } = bounds;
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        const i = row * columns + col, k = row * stride + col;
        if (eastDepth[i]) {
          const flux = (source[k + 1] - source[k + stride + 1]) / dz;
          across[i] = clamp(flux / Math.max(.14, eastDepth[i]) * outlet[row],
            -channelVelocityLimit, channelVelocityLimit);
        }
        if (southDepth[i]) {
          const flux = (source[k + stride + 1] - source[k + stride]) / dx;
          along[i] = clamp(flux / Math.max(.14, southDepth[i]) * outlet[row + 1],
            -channelVelocityLimit, channelVelocityLimit);
        }
      }
    }
  }

  if (current && piers.length) relaxPiles();
  faces(stream, baseEast, baseSouth, { c0: 0, c1: columns - 1, r0: 0, r1: rows - 1 });
  east.set(baseEast);
  south.set(baseSouth);

  function area(x, z, radius) {
    return { c0: clamp(Math.floor((x - radius - minX) / dx), 0, columns - 1),
      c1: clamp(Math.ceil((x + radius - minX) / dx), 0, columns - 1),
      r0: clamp(Math.floor((z - radius - minZ) / dz), 0, rows - 1),
      r1: clamp(Math.ceil((z + radius - minZ) / dz), 0, rows - 1) };
  }

  // Air entrainment is local. Its foam is then transported by the velocity field.
  for (const pile of piers) {
    const bounds = area(pile.x, pile.y, .84);
    for (let row = bounds.r0; row <= bounds.r1; row++) {
      for (let col = bounds.c0; col <= bounds.c1; col++) {
        const i = row * columns + col;
        if (!floor[i]) continue;
        const x = minX + (col + .5) * dx - pile.x, z = minZ + (row + .5) * dz - pile.y;
        const edge = Math.exp(-(((Math.abs(x) - .205) / .107) ** 2 + ((z - .03) / .34) ** 2));
        const speed = Math.hypot(baseEast[i], baseSouth[i]);
        staticAir[i] += edge * Math.max(0, speed - .16) * 1.30;
      }
    }
  }
  air.set(staticAir);
  let boatActive = false;

  function centerVelocity(x, z, out) {
    const col = clamp(Math.floor((x - minX) / dx), 0, columns - 1);
    const row = clamp(Math.floor((z - minZ) / dz), 0, rows - 1);
    const i = row * columns + col;
    out.u = (baseEast[i] + (col ? baseEast[i - 1] : 0)) * .5;
    out.v = (baseSouth[i] + (row ? baseSouth[i - columns] : 0)) * .5;
    return [i, row * stride + col];
  }

  const baseVelocity = { u: 0, v: 0 };
  function update(hull, motion) {
    if (!hull && !boatActive) return;
    east.set(baseEast);
    south.set(baseSouth);
    air.set(staticAir);
    boatActive = Boolean(hull);
    if (!hull) return;
    const bounds = area(hull.x, hull.y, 3.08);
    const { c0, c1, r0, r1 } = bounds;
    const [i, k] = centerVelocity(hull.x, hull.y, baseVelocity);
    const depth = floor[i];
    if (!depth) return;
    const center = stream[k] + depth * (baseVelocity.v * ((hull.x - minX) % dx) -
      baseVelocity.u * ((hull.y - minZ) % dz));
    const slip = Math.hypot(baseVelocity.u - motion.x, baseVelocity.v - motion.y);
    const agitation = Math.abs(motion.x) * .18 + Math.abs(motion.w) * .55;
    mobile.set(stream);
    for (let row = r0 + 1; row <= r1; row++) {
      for (let col = c0 + 1; col <= c1; col++) {
        const cell = row * columns + col, corner = row * stride + col;
        if (!floor[cell] || !floor[cell - 1] || !floor[cell - columns] || !floor[cell - columns - 1]) continue;
        const x = minX + col * dx - hull.x, z = minZ + row * dz - hull.y;
        const axial = x * hull.z + z * hull.w, lateral = x * hull.w - z * hull.z;
        const radius = (axial / 1.55) ** 2 + (lateral / .50) ** 2;
        const taper = clamp((3.08 - Math.hypot(x, z)) / .94, 0, 1);
        const blend = taper * taper * Math.min(1, 1 / Math.max(.001, radius));
        const movingSurface = center + depth * (motion.y * x - motion.x * z);
        mobile[corner] += blend * (movingSurface - stream[corner]);
      }
    }
    faces(mobile, east, south, bounds);
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        const cell = row * columns + col;
        if (!floor[cell]) continue;
        const x = minX + (col + .5) * dx - hull.x, z = minZ + (row + .5) * dz - hull.y;
        const axial = x * hull.z + z * hull.w, lateral = x * hull.w - z * hull.z;
        const radius = Math.hypot(axial / 1.55, lateral / .50);
        const lip = Math.exp(-(((radius - 1.09) / .21) ** 2));
        const fasterSide = Math.abs(east[cell] - baseEast[cell]) + Math.abs(south[cell] - baseSouth[cell]);
        const shoulders = clamp(Math.abs(lateral) / .46, .28, 1);
        air[cell] += lip * (slip * .23 + fasterSide * .57 + agitation) * shoulders;
      }
    }
  }

  return { east, south, air, update, texture, discharge };
}
