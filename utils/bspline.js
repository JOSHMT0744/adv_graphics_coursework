import * as THREE from "https://unpkg.com/three@0.126.1/build/three.module.js";

// -----------------------------------------------------------------------------
// Cubic B-spline (GMP: General Matrix Representation)
// -----------------------------------------------------------------------------

/** Cubic B-spline basis matrix (1/6 factor included). Set once. */
export const M_BSPLINE = new THREE.Matrix4().set(
    1, 4, 1, 0,
    -3, 0, 3, 0,
    3, -6, 3, 0,
    -1, 3, -3, 1
).multiplyScalar(1 / 6);

/**
 * Evaluate one cubic B-spline segment. t in [0,1].
 * @param {number} t
 * @param {THREE.Vector3} p0
 * @param {THREE.Vector3} p1
 * @param {THREE.Vector3} p2
 * @param {THREE.Vector3} p3
 * @returns {THREE.Vector3}
 */
export function evalBSplineSegment(t, p0, p1, p2, p3) {
    const T = new THREE.Vector4(1, t, t * t, t * t * t);
    const W = T.clone().applyMatrix4(M_BSPLINE);
    const x = W.x * p0.x + W.y * p1.x + W.z * p2.x + W.w * p3.x;
    const y = W.x * p0.y + W.y * p1.y + W.z * p2.y + W.w * p3.y;
    const z = W.x * p0.z + W.y * p1.z + W.z * p2.z + W.w * p3.z;
    return new THREE.Vector3(x, y, z);
}

/**
 * Multi-segment B-spline curve. points.length >= 4; t in [0,1] over whole curve.
 * @param {number} t
 * @param {THREE.Vector3[]} points
 * @returns {THREE.Vector3}
 */
export function evalBSplineCurve(t, points) {
    const n = points.length;
    if (n < 4) throw new Error("evalBSplineCurve: need at least 4 points");
    const numSeg = n - 3;
    const segT = Math.max(0, Math.min(1, t)) * numSeg;
    const i = Math.min(Math.floor(segT), numSeg - 1);
    const s = segT - i;
    return evalBSplineSegment(s, points[i], points[i + 1], points[i + 2], points[i + 3]);
}

/**
 * Tangent of B-spline curve via central difference. t in [0,1].
 * @param {number} t
 * @param {THREE.Vector3[]} points
 * @param {number} [delta=1e-5]
 * @returns {THREE.Vector3} unit tangent
 */
export function evalBSplineTangent(t, points, delta = 1e-5) {
    const t0 = Math.max(0, t - delta);
    const t1 = Math.min(1, t + delta);
    const p0 = evalBSplineCurve(t0, points);
    const p1 = evalBSplineCurve(t1, points);
    const d = new THREE.Vector3().subVectors(p1, p0);
    return d.lengthSq() > 1e-20 ? d.normalize() : new THREE.Vector3(1, 0, 0);
}

/**
 * Bicubic B-spline surface (single 4x4 patch). u,v in [0,1].
 * grid[i][j] = THREE.Vector3, i,j in 0..3.
 * @param {number} u
 * @param {number} v
 * @param {THREE.Vector3[][]} grid
 * @returns {THREE.Vector3}
 */
export function evalBSplineSurface(u, v, grid) {
    const Tu = new THREE.Vector4(1, u, u * u, u * u * u);
    const Tv = new THREE.Vector4(1, v, v * v, v * v * v);
    const Wu = Tu.clone().applyMatrix4(M_BSPLINE);
    const Wv = Tv.clone().applyMatrix4(M_BSPLINE);
    const wu = [Wu.x, Wu.y, Wu.z, Wu.w];
    const wv = [Wv.x, Wv.y, Wv.z, Wv.w];
    let x = 0, y = 0, z = 0;
    for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
            const w = wu[i] * wv[j];
            const P = grid[i][j];
            x += w * P.x; y += w * P.y; z += w * P.z;
        }
    }
    return new THREE.Vector3(x, y, z);
}
