import * as THREE from "three";
import { evalBezierSurface } from "../objects/surface.js";
import { getBSplineSurfaceWorldPointAtNormalized } from "../objects/bsplineSurface.js";

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
    function projectToSurfaceBezier(x, z) {
        if (x < minX || x > maxX || z < minZ || z > maxZ) return { u: null, v: null, y: null, onSurface: false };
        let u = Math.max(0.001, Math.min(0.999, (maxX - minX) ? (x - minX) / (maxX - minX) : 0.5));
        let v = Math.max(0.001, Math.min(0.999, (maxZ - minZ) ? (z - minZ) / (maxZ - minZ) : 0.5));
        for (let iter = 0; iter < NEWTON_MAX_ITER; iter++) {
            const P = evalBezierSurface(u, v, controlPoints);
            const errX = x - P.x;
            const errZ = z - P.z;
            if (Math.abs(errX) < NEWTON_TOL && Math.abs(errZ) < NEWTON_TOL) {
                const onSurface = u >= 0 && u <= 1 && v >= 0 && v <= 1;
                return { u, v, y: P.y, onSurface };
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
        return { u, v, y: P.y, onSurface };
    }

    const _evalP = new THREE.Vector3();
    const _evalPu = new THREE.Vector3();
    const _evalPv = new THREE.Vector3();
    const _tangentU = new THREE.Vector3();
    const _tangentV = new THREE.Vector3();
    const _normal = new THREE.Vector3();

    function evalAt(u, v, target) {
        const p = evalBezierSurface(u, v, controlPoints);
        if (target) { target.set(p.x, p.y, p.z); return target; }
        return p;
    }

    function velocityToUV(vel, u, v, dt = 1) {
        evalAt(u, v, _evalP);
        evalAt(u + NEWTON_EPS, v, _evalPu);
        evalAt(u, v + NEWTON_EPS, _evalPv);
        _tangentU.subVectors(_evalPu, _evalP).divideScalar(NEWTON_EPS);
        _tangentV.subVectors(_evalPv, _evalP).divideScalar(NEWTON_EPS);
        _normal.crossVectors(_tangentU, _tangentV).normalize();
        const velDotN = vel.x * _normal.x + vel.y * _normal.y + vel.z * _normal.z;
        const vTanX = vel.x - velDotN * _normal.x;
        const vTanY = vel.y - velDotN * _normal.y;
        const vTanZ = vel.z - velDotN * _normal.z;
        const tu_x = _tangentU.x, tu_z = _tangentU.z;
        const tv_x = _tangentV.x, tv_z = _tangentV.z;
        const det = tu_x * tv_z - tv_x * tu_z;
        if (Math.abs(det) < 1e-12) return { du: 0, dv: 0 };
        const du = (vTanX * tv_z - vTanZ * tv_x) / det * dt;
        const dv = (vTanZ * tu_x - vTanX * tu_z) / det * dt;
        return { du, dv };
    }

    return {
        surfaceType: 'bezier',
        controlPoints,
        projectToSurface(x, z) {
            const r = projectToSurfaceBezier(x, z);
            return r.onSurface ? { u: r.u, v: r.v, y: r.y, onSurface: true } : { u: null, v: null, y: r.y, onSurface: false };
        },
        evalAt,
        velocityToUV,
        sample() {
            const u = Math.random();
            const v = Math.random();
            const pos = evalBezierSurface(u, v, controlPoints);
            return { pos, u, v };
        },
        contains(x, z) {
            const { onSurface } = projectToSurfaceBezier(x, z);
            return onSurface;
        },
        getY(x, z) {
            const { y, onSurface } = projectToSurfaceBezier(x, z);
            return onSurface ? y : null;
        }
    };
}

const BSPLINE_GRID_SIZE = 20;

/**
 * Create a sampler for a B-spline surface (e.g. grass). Uses getBSplineSurfaceWorldPointAtNormalized
 * for world-space evaluation. sample() returns a random world point on the surface.
 * contains(x,z) / getY(x,z) use Newton iteration in (u,v) to project (x,z) onto the surface.
 * @param {THREE.Group} group - B-spline group from createBSplineSurface (with userData.bspline)
 * @param {THREE.Vector3[]} controlPoints - Flat array of control points (dimU * dimV)
 * @returns {{ sample: () => THREE.Vector3, contains: (x: number, z: number) => boolean, getY: (x: number, z: number) => number | null }}
 */
export function createBSplineSampler(group, controlPoints) {
    const _eval = new THREE.Vector3();
    const gridXs = [];
    const gridZs = [];
    for (let i = 0; i <= BSPLINE_GRID_SIZE; i++) {
        const u = i / BSPLINE_GRID_SIZE;
        for (let j = 0; j <= BSPLINE_GRID_SIZE; j++) {
            const v = j / BSPLINE_GRID_SIZE;
            getBSplineSurfaceWorldPointAtNormalized(group, controlPoints, u, v, _eval);
            gridXs.push(_eval.x);
            gridZs.push(_eval.z);
        }
    }
    const minX = Math.min(...gridXs);
    const maxX = Math.max(...gridXs);
    const minZ = Math.min(...gridZs);
    const maxZ = Math.max(...gridZs);

    function projectToSurfaceBSpline(x, z) {
        if (x < minX || x > maxX || z < minZ || z > maxZ) return { u: null, v: null, y: null, onSurface: false };
        let u = Math.max(0.001, Math.min(0.999, (maxX - minX) ? (x - minX) / (maxX - minX) : 0.5));
        let v = Math.max(0.001, Math.min(0.999, (maxZ - minZ) ? (z - minZ) / (maxZ - minZ) : 0.5));
        for (let iter = 0; iter < NEWTON_MAX_ITER; iter++) {
            getBSplineSurfaceWorldPointAtNormalized(group, controlPoints, u, v, _eval);
            const baseX = _eval.x, baseZ = _eval.z;
            const errX = x - baseX;
            const errZ = z - baseZ;
            if (Math.abs(errX) < NEWTON_TOL && Math.abs(errZ) < NEWTON_TOL) {
                const onSurface = u >= 0 && u <= 1 && v >= 0 && v <= 1;
                return { u, v, y: _eval.y, onSurface };
            }
            getBSplineSurfaceWorldPointAtNormalized(group, controlPoints, u + NEWTON_EPS, v, _eval);
            const P_u_x = _eval.x, P_u_z = _eval.z;
            getBSplineSurfaceWorldPointAtNormalized(group, controlPoints, u, v + NEWTON_EPS, _eval);
            const P_v_x = _eval.x, P_v_z = _eval.z;
            const dx_du = (P_u_x - baseX) / NEWTON_EPS;
            const dx_dv = (P_v_x - baseX) / NEWTON_EPS;
            const dz_du = (P_u_z - baseZ) / NEWTON_EPS;
            const dz_dv = (P_v_z - baseZ) / NEWTON_EPS;
            const det = dx_du * dz_dv - dx_dv * dz_du;
            if (Math.abs(det) < 1e-12) break;
            const du = (errX * dz_dv - errZ * dx_dv) / det;
            const dv = (errZ * dx_du - errX * dz_du) / det;
            u = Math.max(0, Math.min(1, u + du));
            v = Math.max(0, Math.min(1, v + dv));
        }
        getBSplineSurfaceWorldPointAtNormalized(group, controlPoints, u, v, _eval);
        const err = Math.hypot(x - _eval.x, z - _eval.z);
        const onSurface = u >= 0 && u <= 1 && v >= 0 && v <= 1 && err < NEWTON_TOL * 10;
        return { u, v, y: _eval.y, onSurface };
    }

    const _evalP = new THREE.Vector3();
    const _evalPu = new THREE.Vector3();
    const _evalPv = new THREE.Vector3();
    const _tangentU = new THREE.Vector3();
    const _tangentV = new THREE.Vector3();
    const _normal = new THREE.Vector3();

    function evalAt(u, v, target) {
        getBSplineSurfaceWorldPointAtNormalized(group, controlPoints, u, v, target ? target : _evalP);
        return target ? target : _evalP.clone();
    }

    function velocityToUV(vel, u, v, dt = 1) {
        evalAt(u, v, _evalP);
        evalAt(u + NEWTON_EPS, v, _evalPu);
        evalAt(u, v + NEWTON_EPS, _evalPv);
        _tangentU.subVectors(_evalPu, _evalP).divideScalar(NEWTON_EPS);
        _tangentV.subVectors(_evalPv, _evalP).divideScalar(NEWTON_EPS);
        _normal.crossVectors(_tangentU, _tangentV).normalize();
        const velDotN = vel.x * _normal.x + vel.y * _normal.y + vel.z * _normal.z;
        const vTanX = vel.x - velDotN * _normal.x;
        const vTanY = vel.y - velDotN * _normal.y;
        const vTanZ = vel.z - velDotN * _normal.z;
        const tu_x = _tangentU.x, tu_z = _tangentU.z;
        const tv_x = _tangentV.x, tv_z = _tangentV.z;
        const det = tu_x * tv_z - tv_x * tu_z;
        if (Math.abs(det) < 1e-12) return { du: 0, dv: 0 };
        const du = (vTanX * tv_z - vTanZ * tv_x) / det * dt;
        const dv = (vTanZ * tu_x - vTanX * tu_z) / det * dt;
        return { du, dv };
    }

    return {
        surfaceType: 'bspline',
        group,
        controlPoints,
        projectToSurface(x, z) {
            const r = projectToSurfaceBSpline(x, z);
            return r.onSurface ? { u: r.u, v: r.v, y: r.y, onSurface: true } : { u: null, v: null, y: r.y, onSurface: false };
        },
        evalAt,
        velocityToUV,
        sample() {
            const u = Math.random();
            const v = Math.random();
            getBSplineSurfaceWorldPointAtNormalized(group, controlPoints, u, v, _eval);
            return { pos: _eval.clone(), u, v };
        },
        contains(x, z) {
            const { onSurface } = projectToSurfaceBSpline(x, z);
            return onSurface;
        },
        getY(x, z) {
            const { y, onSurface } = projectToSurfaceBSpline(x, z);
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
    const halfW = (deckWidth * scale) / 3;
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

const HEIGHT_GRID_SENTINEL = NaN;
const DEFAULT_Y_CEILING = 30;

const _raycaster = new THREE.Raycaster();
const _rayOrigin = new THREE.Vector3();
const _rayDirection = new THREE.Vector3(0, -1, 0);

/**
 * Combine multiple regions; sampleRandom() picks a random region and samples from it.
 * getSurfaceInfo(x,z) returns { inside, y, surfaceType?, u?, v?, regionIndex? } for the first region that contains (x,z).
 * If options.bounds and options.cellSize are provided, a height-field grid is precomputed for O(1) lookup
 * with bilinear interpolation; falls back to region iteration for cells not covered.
 * @param {Array<{ sample: () => THREE.Vector3, contains?: (x: number, z: number) => boolean, getY?: (x: number, z: number) => number | null, surfaceType?: string, projectToSurface?: (x: number, z: number) => { u?: number, v?: number, y?: number, onSurface?: boolean } }>} regions
 * @param {{ bounds?: { minX: number, maxX: number, minZ: number, maxZ: number }, cellSize?: number, walkableMeshes?: THREE.Object3D[], yCeiling?: number }} [options]
 * @returns {{ sampleRandom: () => THREE.Vector3 | { pos: THREE.Vector3, u: number, v: number, surfaceType: string, regionIndex: number }, getSurfaceInfo: (x: number, z: number, cache?: object) => object, getSurfaceInfoRaycast: (x: number, z: number) => { inside: boolean, y: number | null } }}
 */
export function createCombinedSampler(regions, options = {}) {
    const bounds = options.bounds;
    const cellSize = options.cellSize ?? 1;
    const walkableMeshes = options.walkableMeshes ?? [];
    const yCeiling = options.yCeiling ?? DEFAULT_Y_CEILING;
    let heightGrid = null;
    let gridMinX = 0, gridMaxX = 0, gridMinZ = 0, gridMaxZ = 0;
    let numX = 0, numZ = 0;

    if (bounds && bounds.minX != null && bounds.maxX != null && bounds.minZ != null && bounds.maxZ != null && cellSize > 0) {
        gridMinX = bounds.minX;
        gridMaxX = bounds.maxX;
        gridMinZ = bounds.minZ;
        gridMaxZ = bounds.maxZ;
        numX = Math.max(1, Math.ceil((gridMaxX - gridMinX) / cellSize));
        numZ = Math.max(1, Math.ceil((gridMaxZ - gridMinZ) / cellSize));
        heightGrid = new Float64Array(numX * numZ);
        heightGrid.fill(HEIGHT_GRID_SENTINEL);
        // Sample multiple points per cell (center + 4 corners) so partially covered cells get a valid height
        const cellSamples = [
            { u: 0.5, v: 0.5 },   // center
            { u: 0, v: 0 }, { u: 1, v: 0 }, { u: 0, v: 1 }, { u: 1, v: 1 }  // corners
        ];
        for (let i = 0; i < numX; i++) {
            for (let j = 0; j < numZ; j++) {
                for (const s of cellSamples) {
                    const x = gridMinX + (i + s.u) * cellSize;
                    const z = gridMinZ + (j + s.v) * cellSize;
                    for (let ri = 0; ri < regions.length; ri++) {
                        const r = regions[ri];
                        if (r.contains && r.contains(x, z)) {
                            const y = r.getY ? r.getY(x, z) : null;
                            if (y != null) {
                                heightGrid[i * numZ + j] = y;
                                break;
                            }
                        }
                    }
                    if (heightGrid[i * numZ + j] === heightGrid[i * numZ + j]) break; // valid (not NaN)
                }
            }
        }
    }

    function getCellY(ix, iz) {
        if (ix < 0 || ix >= numX || iz < 0 || iz >= numZ) return HEIGHT_GRID_SENTINEL;
        const v = heightGrid[ix * numZ + iz];
        return v !== v ? HEIGHT_GRID_SENTINEL : v; // NaN check
    }

    return {
        sampleRandom() {
            const i = Math.floor(Math.random() * regions.length);
            const region = regions[i];
            const sampleResult = region.sample();
            if (region.surfaceType && (region.surfaceType === 'bezier' || region.surfaceType === 'bspline') && sampleResult && typeof sampleResult === 'object' && 'pos' in sampleResult && 'u' in sampleResult && 'v' in sampleResult) {
                return {
                    pos: sampleResult.pos instanceof THREE.Vector3 ? sampleResult.pos : new THREE.Vector3(sampleResult.pos.x, sampleResult.pos.y, sampleResult.pos.z),
                    u: sampleResult.u,
                    v: sampleResult.v,
                    surfaceType: region.surfaceType,
                    regionIndex: i
                };
            }
            return sampleResult instanceof THREE.Vector3 ? sampleResult : (sampleResult?.pos ?? sampleResult);
        },
        getSurfaceInfo(x, z, cache) {
            let cellIx = -1, cellIz = -1;
            if (heightGrid) {
                const fx = (x - gridMinX) / cellSize;
                const fz = (z - gridMinZ) / cellSize;
                cellIx = Math.floor(fx);
                cellIz = Math.floor(fz);
                // Same-cell cache: only use when last result was inside (avoid persisting "outside" and getting stuck)
                if (cache && cache.inside && typeof cache.cellIx === 'number' && typeof cache.cellIz === 'number' && cache.cellIx === cellIx && cache.cellIz === cellIz) {
                    const distSq = (typeof cache._lastX === 'number' && typeof cache._lastZ === 'number')
                        ? (x - cache._lastX) ** 2 + (z - cache._lastZ) ** 2 : 0;

                    // If in same cell, we can assume y valu hasn't changed, and so can replace cached x,z with new values
                    if (distSq <= 0.1) {
                        if (cache) { cache._lastX = x; cache._lastZ = z; }
                        return {
                            inside: !!cache.inside,
                            y: cache.y != null ? cache.y : null,
                            surfaceType: cache.surfaceType,
                            u: cache.u,
                            v: cache.v,
                            regionIndex: cache.regionIndex
                        };
                    }
                }
                // OOB: skip height grid, fall through to region iteration (avoid invalid cell indices)
                if (cellIx >= 0 && cellIx < numX && cellIz >= 0 && cellIz < numZ) {
                    const ix1 = cellIx + 1;
                    const iz1 = cellIz + 1;
                    const y00 = getCellY(cellIx, cellIz);
                    const y10 = getCellY(ix1, cellIz);
                    const y01 = getCellY(cellIx, iz1);
                    const y11 = getCellY(ix1, iz1);
                    const allValid = y00 === y00 && y10 === y10 && y01 === y01 && y11 === y11;
                    if (allValid) {
                        const tx = Math.max(0, Math.min(1, fx - cellIx));
                        const tz = Math.max(0, Math.min(1, fz - cellIz));
                        const y = (1 - tx) * (1 - tz) * y00 + tx * (1 - tz) * y10 + (1 - tx) * tz * y01 + tx * tz * y11;
                        if (cache) { cache.cellIx = cellIx; cache.cellIz = cellIz; cache._lastX = x; cache._lastZ = z; cache.inside = true; cache.y = y; cache.surfaceType = undefined; cache.u = undefined; cache.v = undefined; cache.regionIndex = undefined; }
                        return { inside: true, y };
                    }
                    // Single-cell fallback: primary cell has valid height => use it (avoids region iteration at edges)
                    const yCell = getCellY(cellIx, cellIz);
                    if (yCell === yCell) {
                        if (cache) { cache.cellIx = cellIx; cache.cellIz = cellIz; cache._lastX = x; cache._lastZ = z; cache.inside = true; cache.y = yCell; cache.surfaceType = undefined; cache.u = undefined; cache.v = undefined; cache.regionIndex = undefined; }
                        return { inside: true, y: yCell };
                    }
                    if (cache) { cache.cellIx = cellIx; cache.cellIz = cellIz; cache._lastX = x; cache._lastZ = z; cache.inside = false; cache.y = null; cache.surfaceType = undefined; cache.u = undefined; cache.v = undefined; cache.regionIndex = undefined; }
                }
            }
            const cachedIdx = (cache && typeof cache.regionIndex === 'number' && cache.regionIndex >= 0 && cache.regionIndex < regions.length) ? cache.regionIndex : -1;
            if (cachedIdx >= 0) {
                const r = regions[cachedIdx];
                if (r.contains && r.contains(x, z)) {
                    const y = r.getY ? r.getY(x, z) : null;
                    if (y != null) {
                        const result = { inside: true, y };
                        if (r.surfaceType && r.projectToSurface) {
                            const proj = r.projectToSurface(x, z);
                            if (proj.onSurface) {
                                result.surfaceType = r.surfaceType;
                                result.u = proj.u;
                                result.v = proj.v;
                                result.regionIndex = cachedIdx;
                                if (cache) { cache.regionIndex = cachedIdx; cache.cellIx = cellIx; cache.cellIz = cellIz; cache._lastX = x; cache._lastZ = z; cache.inside = true; cache.y = y; cache.surfaceType = r.surfaceType; cache.u = proj.u; cache.v = proj.v; }
                            } else if (cache) { cache.regionIndex = cachedIdx; cache.cellIx = cellIx; cache.cellIz = cellIz; cache._lastX = x; cache._lastZ = z; cache.inside = true; cache.y = y; cache.surfaceType = undefined; cache.u = undefined; cache.v = undefined; }
                        } else if (cache) { cache.regionIndex = cachedIdx; cache.cellIx = cellIx; cache.cellIz = cellIz; cache._lastX = x; cache._lastZ = z; cache.inside = true; cache.y = y; cache.surfaceType = undefined; cache.u = undefined; cache.v = undefined; }
                        return result;
                    }
                }
            }
            for (let i = 0; i < regions.length; i++) {
                const r = regions[i];
                if (r.contains && r.contains(x, z)) {
                    const y = r.getY ? r.getY(x, z) : null;
                    if (y != null) {
                        const result = { inside: true, y };
                        if (r.surfaceType && r.projectToSurface) {
                            const proj = r.projectToSurface(x, z);
                            if (proj.onSurface) {
                                result.surfaceType = r.surfaceType;
                                result.u = proj.u;
                                result.v = proj.v;
                                result.regionIndex = i;
                                if (cache) { cache.regionIndex = i; cache.cellIx = cellIx; cache.cellIz = cellIz; cache.inside = true; cache.y = y; cache.surfaceType = r.surfaceType; cache.u = proj.u; cache.v = proj.v; }
                            } else if (cache) { cache.regionIndex = i; cache.cellIx = cellIx; cache.cellIz = cellIz; cache.inside = true; cache.y = y; cache.surfaceType = undefined; cache.u = undefined; cache.v = undefined; }
                        } else if (cache) { cache.regionIndex = i; cache.cellIx = cellIx; cache.cellIz = cellIz; cache.inside = true; cache.y = y; cache.surfaceType = undefined; cache.u = undefined; cache.v = undefined; }
                        return result;
                    }
                }
            }
            if (cache) { cache.cellIx = cellIx; cache.cellIz = cellIz; cache._lastX = x; cache._lastZ = z; cache.inside = false; cache.y = null; cache.surfaceType = undefined; cache.u = undefined; cache.v = undefined; cache.regionIndex = undefined; }
            return { inside: false, y: null };
        },
        getSurfaceInfoRaycast(x, z, maxY) {
            if (walkableMeshes.length === 0) return { inside: false, y: null };
            _rayOrigin.set(x, yCeiling, z);
            _raycaster.set(_rayOrigin, _rayDirection);
            const hits = _raycaster.intersectObjects(walkableMeshes, true);
            if (hits.length === 0) return { inside: false, y: null };
            let hit = hits[0];
            if (maxY != null && typeof maxY === 'number') {
                const tolerance = 0.5;
                const valid = hits.find((h) => h.point.y <= maxY + tolerance);
                if (valid) hit = valid;
            }
            return { inside: true, y: hit.point.y };
        },
        /**
         * World-bounds boundary info for steering: distance to nearest edge, outward normal (into walkable), nearest point on boundary.
         * @param {number} x - world X
         * @param {number} z - world Z
         * @param {object} [cache] - unused; for API consistency with getSurfaceInfo
         * @returns {{ distanceToEdge: number, outwardNormalX: number, outwardNormalZ: number, nearestBoundaryX: number, nearestBoundaryZ: number, outside: boolean }}
         */
        getBoundaryInfo(x, z, cache) {
            const minX = gridMinX, maxX = gridMaxX, minZ = gridMinZ, maxZ = gridMaxZ;
            const dMinX = x - minX, dMaxX = maxX - x, dMinZ = z - minZ, dMaxZ = maxZ - z;
            const distanceToEdge = Math.min(dMinX, dMaxX, dMinZ, dMaxZ);
            const outside = distanceToEdge < 0;
            const nearestBoundaryX = Math.max(minX, Math.min(maxX, x));
            const nearestBoundaryZ = Math.max(minZ, Math.min(maxZ, z));
            let outwardNormalX = 0, outwardNormalZ = 0;
            if (dMinX <= dMaxX && dMinX <= dMinZ && dMinX <= dMaxZ) {
                outwardNormalX = 1;
                outwardNormalZ = 0;
            } else if (dMaxX <= dMinX && dMaxX <= dMinZ && dMaxX <= dMaxZ) {
                outwardNormalX = -1;
                outwardNormalZ = 0;
            } else if (dMinZ <= dMinX && dMinZ <= dMaxX && dMinZ <= dMaxZ) {
                outwardNormalX = 0;
                outwardNormalZ = 1;
            } else {
                outwardNormalX = 0;
                outwardNormalZ = -1;
            }
            return {
                distanceToEdge,
                outwardNormalX,
                outwardNormalZ,
                nearestBoundaryX,
                nearestBoundaryZ,
                outside
            };
        },
        /**
         * Nearest walkable point for steering/clamping when (x,z) is off walkable.
         * @param {number} x - world X
         * @param {number} z - world Z
         * @returns {{ x: number, z: number, y: number, inside: boolean }}
         */
        getNearestWalkable(x, z) {
            const info = this.getSurfaceInfo(x, z);
            if (info.inside && info.y != null) {
                return { x, z, y: info.y, inside: true };
            }
            if (!heightGrid || numX === 0 || numZ === 0) {
                const nx = Math.max(gridMinX, Math.min(gridMaxX, x));
                const nz = Math.max(gridMinZ, Math.min(gridMaxZ, z));
                return { x: nx, z: nz, y: 0, inside: false };
            }
            const fx = (x - gridMinX) / cellSize;
            const fz = (z - gridMinZ) / cellSize;
            let ix = Math.floor(fx);
            let iz = Math.floor(fz);
            ix = Math.max(0, Math.min(numX - 1, ix));
            iz = Math.max(0, Math.min(numZ - 1, iz));

            function isWalkable(ci, cj) {
                const y = getCellY(ci, cj);
                return y === y;
            }

            function cellNearestPoint(ci, cj, px, pz) {
                const cellMinX = gridMinX + ci * cellSize;
                const cellMaxX = gridMinX + (ci + 1) * cellSize;
                const cellMinZ = gridMinZ + cj * cellSize;
                const cellMaxZ = gridMinZ + (cj + 1) * cellSize;
                const nx = Math.max(cellMinX, Math.min(cellMaxX, px));
                const nz = Math.max(cellMinZ, Math.min(cellMaxZ, pz));
                return { nx, nz, distSq: (px - nx) ** 2 + (pz - nz) ** 2 };
            }

            if (isWalkable(ix, iz)) {
                const cellMinX = gridMinX + ix * cellSize;
                const cellMaxX = gridMinX + (ix + 1) * cellSize;
                const cellMinZ = gridMinZ + iz * cellSize;
                const cellMaxZ = gridMinZ + (iz + 1) * cellSize;
                const nx = Math.max(cellMinX, Math.min(cellMaxX, x));
                const nz = Math.max(cellMinZ, Math.min(cellMaxZ, z));
                const y = getCellY(ix, iz);
                return { x: nx, z: nz, y, inside: false };
            }

            const MAX_RADIUS = 15;
            let bestDistSq = Infinity;
            let bestNx = gridMinX + (ix + 0.5) * cellSize;
            let bestNz = gridMinZ + (iz + 0.5) * cellSize;
            let bestY = 0;

            for (let r = 1; r <= MAX_RADIUS; r++) {
                for (let di = -r; di <= r; di++) {
                    for (let dj = -r; dj <= r; dj++) {
                        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
                        const ci = ix + di;
                        const cj = iz + dj;
                        if (!isWalkable(ci, cj)) continue;
                        const { nx, nz, distSq } = cellNearestPoint(ci, cj, x, z);
                        if (distSq < bestDistSq) {
                            bestDistSq = distSq;
                            bestNx = nx;
                            bestNz = nz;
                            bestY = getCellY(ci, cj);
                        }
                    }
                }
                if (bestDistSq < Infinity) break;
            }

            if (bestDistSq === Infinity) {
                bestNx = gridMinX + (ix + 0.5) * cellSize;
                bestNz = gridMinZ + (iz + 0.5) * cellSize;
            }
            return { x: bestNx, z: bestNz, y: bestY, inside: false };
        },
        /**
         * Get grid cell bounds for debug visualization.
         * Returns array of Box3 objects representing each grid cell that has valid height data.
         * @returns {THREE.Box3[]}
         */
        getGridCells() {
            const cells = [];
            if (!heightGrid || numX === 0 || numZ === 0) return cells;
            for (let i = 0; i < numX; i++) {
                for (let j = 0; j < numZ; j++) {
                    const idx = i * numZ + j;
                    const y = heightGrid[idx];
                    // Only include cells with valid height data (not NaN)
                    if (y === y && y !== HEIGHT_GRID_SENTINEL) {
                        const cellMinX = gridMinX + i * cellSize;
                        const cellMaxX = gridMinX + (i + 1) * cellSize;
                        const cellMinZ = gridMinZ + j * cellSize;
                        const cellMaxZ = gridMinZ + (j + 1) * cellSize;
                        const cell = new THREE.Box3(
                            new THREE.Vector3(cellMinX, y - 0.1, cellMinZ),
                            new THREE.Vector3(cellMaxX, y + 0.1, cellMaxZ)
                        );
                        cells.push(cell);
                    }
                }
            }
            return cells;
        },
        regions
    };
}
