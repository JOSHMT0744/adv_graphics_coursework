import * as THREE from "three";
import { evalBezierSurface } from "../objects/surface.js";

const BEZIER_GRID_SIZE = 20;
const NEWTON_EPS = 1e-5;
const NEWTON_MAX_ITER = 10;
const NEWTON_TOL = 1e-6;

/**
 * Create a sampler for a Bezier surface (4x4 control points). sample() returns a random point on the surface.
 * contains(x,z) uses the actual surface (x,z) bounds from the evaluated patch. getY(x,z) finds (u,v) so the
 * surface point has that (x,z) via Newton iteration, then returns the surface y so feet sit on the top.
 * @param {THREE.Vector3[]} controlPoints - 16 control points (flat)
 * @returns {{ sample: () => THREE.Vector3, contains: (x: number, z: number) => boolean, getY: (x: number, z: number) => number | null }}
 */
export function createBezierSampler(controlPoints) {
    const grid = [];
    for (let i = 0; i <= BEZIER_GRID_SIZE; i++) {
        const row = [];
        const u = i / BEZIER_GRID_SIZE;
        for (let j = 0; j <= BEZIER_GRID_SIZE; j++) {
            const v = j / BEZIER_GRID_SIZE;
            const p = evalBezierSurface(u, v, controlPoints);
            row.push({ x: p.x, z: p.z, y: p.y });
        }
        grid.push(row);
    }

    const gridXs = grid.flatMap(row => row.map(c => c.x));
    const gridZs = grid.flatMap(row => row.map(c => c.z));
    const minX = Math.min(...gridXs);
    const maxX = Math.max(...gridXs);
    const minZ = Math.min(...gridZs);
    const maxZ = Math.max(...gridZs);

    /**
     * Find (u,v) on [0,1]^2 such that eval(u,v) has (x,z). Returns { y, onSurface } where onSurface
     * is true only when (x,z) actually lies on the patch (Newton converged with u,v in [0,1]).
     */
    function projectToSurface(x, z) {
        if (x < minX || x > maxX || z < minZ || z > maxZ) return { y: null, onSurface: false };
        let u = Math.max(0.001, Math.min(0.999, (maxX - minX) ? (x - minX) / (maxX - minX) : 0.5));
        let v = Math.max(0.001, Math.min(0.999, (maxZ - minZ) ? (z - minZ) / (maxZ - minZ) : 0.5));
        for (let iter = 0; iter < NEWTON_MAX_ITER; iter++) {
            const P = evalBezierSurface(u, v, controlPoints);
            const errX = x - P.x;
            const errZ = z - P.z;
            if (Math.abs(errX) < NEWTON_TOL && Math.abs(errZ) < NEWTON_TOL) {
                const onSurface = u >= 0 && u <= 1 && v >= 0 && v <= 1;
                return { y: P.y, onSurface };
            }
            const P_u = evalBezierSurface(u + NEWTON_EPS, v, controlPoints);
            const P_v = evalBezierSurface(u, v + NEWTON_EPS, controlPoints);
            const dx_du = (P_u.x - P.x) / NEWTON_EPS;
            const dx_dv = (P_v.x - P.x) / NEWTON_EPS;
            const dz_du = (P_u.z - P.z) / NEWTON_EPS;
            const dz_dv = (P_v.z - P.z) / NEWTON_EPS;
            const det = dx_du * dz_dv - dx_dv * dz_du;
            if (Math.abs(det) < 1e-12) break;
            const du = (errX * dz_dv - errZ * dx_dv) / det;
            const dv = (errZ * dx_du - errX * dz_du) / det;
            u = Math.max(0, Math.min(1, u + du));
            v = Math.max(0, Math.min(1, v + dv));
        }
        const P = evalBezierSurface(u, v, controlPoints);
        const err = Math.hypot(x - P.x, z - P.z);
        const onSurface = u >= 0 && u <= 1 && v >= 0 && v <= 1 && err < NEWTON_TOL * 10;
        return { y: P.y, onSurface };
    }

    return {
        sample() {
            const u = Math.random();
            const v = Math.random();
            return evalBezierSurface(u, v, controlPoints);
        },
        contains(x, z) {
            const { onSurface } = projectToSurface(x, z);
            return onSurface;
        },
        getY(x, z) {
            const { y, onSurface } = projectToSurface(x, z);
            return onSurface ? y : null;
        }
    };
}

/**
 * Bridge deck: axis-aligned rectangle at y = deckTopY. World: center (cx, cy, cz), scale, deckLength.
 * Deck in world: x in [cx - scale*deckWidth/2, cx + scale*deckWidth/2], z in [cz - scale*deckLength/2, cz + scale*deckLength/2], y = deckTopY.
 * @param {number} cx - center x
 * @param {number} deckTopY - y of deck top (walkable surface)
 * @param {number} cz - center z
 * @param {number} scale - bridge scale
 * @param {number} deckLength - local deck length (Z)
 * @param {number} [deckWidth=2] - local deck width (X)
 * @returns {{ sample: () => THREE.Vector3 }}
 */
export function createBridgeDeckSampler(cx, deckTopY, cz, scale, deckLength, deckWidth = 2) {
    const halfW = (deckWidth * scale) / 2;
    const halfL = (deckLength * scale) / 2;
    const xMin = cx - halfW, xMax = cx + halfW, zMin = cz - halfL, zMax = cz + halfL;
    return {
        sample() {
            const x = cx + (Math.random() * 2 - 1) * halfW;
            const z = cz + (Math.random() * 2 - 1) * halfL;
            return new THREE.Vector3(x, deckTopY, z);
        },
        contains(x, z) {
            return x >= xMin && x <= xMax && z >= zMin && z <= zMax;
        },
        getY(x, z) {
            return this.contains(x, z) ? deckTopY : null;
        }
    };
}

/**
 * Connection surface: hexagon with 6 points. Triangulate fan from 0: (0,1,2), (0,2,3), (0,3,4), (0,4,5).
 * Sample random point in hexagon via triangle + barycentric.
 * @param {THREE.Vector3[]} points - 6 points in perimeter order
 * @returns {{ sample: () => THREE.Vector3 }}
 */
function pointInTriangle2D(px, pz, ax, az, bx, bz, cx, cz) {
    const sign = (x1, z1, x2, z2, x3, z3) => (x1 - x3) * (z2 - z3) - (x2 - x3) * (z1 - z3);
    const d1 = sign(px, pz, ax, az, bx, bz);
    const d2 = sign(px, pz, bx, bz, cx, cz);
    const d3 = sign(px, pz, cx, cz, ax, az);
    const hasNeg = (d1 < 0) || (d2 < 0) || (d3 < 0);
    const hasPos = (d1 > 0) || (d2 > 0) || (d3 > 0);
    return !(hasNeg && hasPos);
}

function barycentricY(px, pz, a, b, c) {
    const denom = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z) || 1e-10;
    const wa = ((b.z - c.z) * (px - c.x) + (c.x - b.x) * (pz - c.z)) / denom;
    const wb = ((c.z - a.z) * (px - c.x) + (a.x - c.x) * (pz - c.z)) / denom;
    const wc = 1 - wa - wb;
    return a.y * wa + b.y * wb + c.y * wc;
}

export function createConnectionSampler(points) {
    const triangles = [
        [points[0], points[1], points[2]],
        [points[0], points[2], points[3]],
        [points[0], points[3], points[4]],
        [points[0], points[4], points[5]]
    ];
    const areas = triangles.map(([a, b, c]) => {
        const ab = new THREE.Vector3().subVectors(b, a);
        const ac = new THREE.Vector3().subVectors(c, a);
        return ab.cross(ac).length() * 0.5;
    });
    const totalArea = areas.reduce((s, x) => s + x, 0);
    const vertsX = points.map(p => p.x);
    const vertsZ = points.map(p => p.z);

    function pointInPolygon2D(x, z) {
        let inside = false;
        const n = vertsX.length;
        for (let i = 0, j = n - 1; i < n; j = i++) {
            if (((vertsZ[i] > z) !== (vertsZ[j] > z)) &&
                (x < (vertsX[j] - vertsX[i]) * (z - vertsZ[i]) / (vertsZ[j] - vertsZ[i]) + vertsX[i])) {
                inside = !inside;
            }
        }
        return inside;
    }

    return {
        sample() {
            let t = Math.random() * totalArea;
            let idx = 0;
            for (let i = 0; i < areas.length; i++) {
                if (t < areas[i]) { idx = i; break; }
                t -= areas[i];
            }
            const [a, b, c] = triangles[idx];
            let u = Math.random();
            let v = Math.random();
            if (u + v > 1) { u = 1 - u; v = 1 - v; }
            const w = 1 - u - v;
            return new THREE.Vector3(
                a.x * w + b.x * u + c.x * v,
                a.y * w + b.y * u + c.y * v,
                a.z * w + b.z * u + c.z * v
            );
        },
        contains(x, z) {
            return pointInPolygon2D(x, z);
        },
        getY(x, z) {
            if (!this.contains(x, z)) return null;
            for (let t = 0; t < triangles.length; t++) {
                const [a, b, c] = triangles[t];
                if (pointInTriangle2D(x, z, a.x, a.z, b.x, b.z, c.x, c.z)) {
                    return barycentricY(x, z, a, b, c);
                }
            }
            return null;
        }
    };
}

/**
 * Quad surface: 4 points in order. Triangulate as (0,1,2), (0,2,3).
 * @param {THREE.Vector3[]} points - 4 points in perimeter order
 * @returns {{ sample: () => THREE.Vector3, contains: (x: number, z: number) => boolean, getY: (x: number, z: number) => number | null }}
 */
export function createQuadSampler(points) {
    const triangles = [
        [points[0], points[1], points[2]],
        [points[0], points[2], points[3]]
    ];
    const areas = triangles.map(([a, b, c]) => {
        const ab = new THREE.Vector3().subVectors(b, a);
        const ac = new THREE.Vector3().subVectors(c, a);
        return ab.cross(ac).length() * 0.5;
    });
    const totalArea = areas.reduce((s, x) => s + x, 0);
    const vertsX = points.map(p => p.x);
    const vertsZ = points.map(p => p.z);

    function pointInPolygon2D(x, z) {
        let inside = false;
        const n = vertsX.length;
        for (let i = 0, j = n - 1; i < n; j = i++) {
            if (((vertsZ[i] > z) !== (vertsZ[j] > z)) &&
                (x < (vertsX[j] - vertsX[i]) * (z - vertsZ[i]) / (vertsZ[j] - vertsZ[i]) + vertsX[i])) {
                inside = !inside;
            }
        }
        return inside;
    }

    return {
        sample() {
            let t = Math.random() * totalArea;
            let idx = 0;
            for (let i = 0; i < areas.length; i++) {
                if (t < areas[i]) { idx = i; break; }
                t -= areas[i];
            }
            const [a, b, c] = triangles[idx];
            let u = Math.random();
            let v = Math.random();
            if (u + v > 1) { u = 1 - u; v = 1 - v; }
            const w = 1 - u - v;
            return new THREE.Vector3(
                a.x * w + b.x * u + c.x * v,
                a.y * w + b.y * u + c.y * v,
                a.z * w + b.z * u + c.z * v
            );
        },
        contains(x, z) {
            return pointInPolygon2D(x, z);
        },
        getY(x, z) {
            if (!this.contains(x, z)) return null;
            for (let t = 0; t < triangles.length; t++) {
                const [a, b, c] = triangles[t];
                if (pointInTriangle2D(x, z, a.x, a.z, b.x, b.z, c.x, c.z)) {
                    return barycentricY(x, z, a, b, c);
                }
            }
            return null;
        }
    };
}

/**
 * Staircase: linear path from start to end, with perpendicular width. Sample along path and offset.
 * The path line runs through step centres; step tops are stepHeight/2 above that, so we add that to Y
 * so characters stand on top of steps rather than inside them.
 * @param {THREE.Vector3} start
 * @param {THREE.Vector3} end
 * @param {number} width - staircase width (perpendicular to path)
 * @param {number} [stepHeight=0.5] - height of each step; sampled Y is offset by stepHeight/2 so characters sit on step tops
 * @returns {{ sample: () => THREE.Vector3 }}
 */
export function createStaircaseSampler(start, end, width, stepHeight = 0.5) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const dz = end.z - start.z;
    const perpX = -dz;
    const perpZ = dx;
    const len = Math.sqrt(perpX * perpX + perpZ * perpZ) || 1;
    const perpNormX = perpX / len;
    const perpNormZ = perpZ / len;
    const yOffset = stepHeight / 2;
    const halfW = width / 2;
    return {
        sample() {
            const t = Math.random();
            const along = new THREE.Vector3(
                start.x + dx * t,
                start.y + dy * t + yOffset,
                start.z + dz * t
            );
            const offset = (Math.random() * 2 - 1) * halfW;
            along.x += perpNormX * offset;
            along.z += perpNormZ * offset;
            return along;
        },
        contains(x, z) {
            const vx = x - start.x;
            const vz = z - start.z;
            const t = (vx * dx + vz * dz) / (len * len);
            if (t < 0 || t > 1) return false;
            const projX = start.x + t * dx;
            const projZ = start.z + t * dz;
            const distSq = (x - projX) ** 2 + (z - projZ) ** 2;
            return distSq <= halfW * halfW;
        },
        getY(x, z) {
            if (!this.contains(x, z)) return null;
            const vx = x - start.x;
            const vz = z - start.z;
            const t = Math.max(0, Math.min(1, (vx * dx + vz * dz) / (len * len)));
            return start.y + t * dy + yOffset;
        }
    };
}

/**
 * Combine multiple regions; sampleRandom() picks a random region and samples from it.
 * getSurfaceInfo(x,z) returns { inside, y } for the first region that contains (x,z).
 * @param {Array<{ sample: () => THREE.Vector3, contains?: (x: number, z: number) => boolean, getY?: (x: number, z: number) => number | null }>} regions
 * @returns {{ sampleRandom: () => THREE.Vector3, getSurfaceInfo: (x: number, z: number) => { inside: boolean, y: number | null } }}
 */
export function createCombinedSampler(regions) {
    return {
        sampleRandom() {
            const i = Math.floor(Math.random() * regions.length);
            return regions[i].sample();
        },
        getSurfaceInfo(x, z) {
            for (let i = 0; i < regions.length; i++) {
                const r = regions[i];
                if (r.contains && r.contains(x, z)) {
                    const y = r.getY ? r.getY(x, z) : null;
                    return { inside: true, y };
                }
            }
            return { inside: false, y: null };
        }
    };
}
