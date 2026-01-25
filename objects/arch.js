import * as THREE from "https://unpkg.com/three@0.126.1/build/three.module.js";

/**
 * Procedural arch mesh from a ParametricCurve (profile in YZ). The profile is
 * extruded along X to form an arch. No external 3D assets.
 *
 * @param {import("../utils/ParametricCurve.js").ParametricCurve} profileCurve - profile in YZ; getPoint(t).x is ignored, .y and .z used
 * @param {Object} [options]
 * @param {number} [options.width=4] - extent in X
 * @param {number} [options.segmentsX=10]
 * @param {number} [options.segmentsT=32]
 * @param {THREE.Material} [options.material]
 * @param {[number,number,number]} [options.position=[0,0,0]]
 * @returns {THREE.Mesh}
 */
export function createArchFromCurve(profileCurve, options = {}) {
    const width = options.width ?? 4;
    const segmentsX = options.segmentsX ?? 10;
    const segmentsT = options.segmentsT ?? 32;
    const [ox, oy, oz] = options.position ?? [0, 0, 0];

    const positions = [];
    for (let ix = 0; ix <= segmentsX; ix++) {
        const x = -width / 2 + (ix / segmentsX) * width;
        for (let it = 0; it <= segmentsT; it++) {
            const t = it / segmentsT;
            const p = profileCurve.getPoint(t);
            positions.push(x, p.y, p.z);
        }
    }

    const indices = [];
    const nv = segmentsT + 1;
    for (let ix = 0; ix < segmentsX; ix++) {
        for (let it = 0; it < segmentsT; it++) {
            const a = ix * nv + it;
            const b = a + 1;
            const c = a + nv;
            const d = c + 1;
            indices.push(a, c, b, b, c, d);
        }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    const material = options.material ?? new THREE.MeshStandardMaterial({ color: 0x9a9a9a });
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(ox, oy, oz);
    return mesh;
}
