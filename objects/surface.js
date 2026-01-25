import * as THREE from "https://unpkg.com/three@0.126.1/build/three.module.js";
import { getTexture } from "../utils/getTexture.js";
import { COLORS } from "../constants.js";
import { evalBSplineCurve, evalBSplineSurface } from "../utils/bspline.js";

// -----------------------------------------------------------------------------
// B. SURFACE 1: ROAD (steep downhill, then flattens)
// -----------------------------------------------------------------------------

// Convex "water slide": P1 and P2 above the chord P0–P3 so the curve bulges outward.
// Chord at z=10 has y≈23, at z=-5 has y≈13; raising P1/P2 above those gives convex arc.
const DEFAULT_ROAD_PROFILE = [
    new THREE.Vector3(0, 30, 50),   // top
    new THREE.Vector3(0, 26, 10),   // above chord → convex bulge
    new THREE.Vector3(-10, 14, -5),    // above chord → convex sweep down
    new THREE.Vector3(-10, -0.5, -25), // flat run-out
    new THREE.Vector3(-10, -0.5, -200)
];

/** Returns a copy of the default road profile control points for use in the curve editor. */
export function getDefaultRoadProfile() {
    return DEFAULT_ROAD_PROFILE.map((p) => p.clone());
}

/**
 * @param {Object} [options]
 * @param {number} [options.width=4]
 * @param {number} [options.numLength=40]
 * @param {number} [options.numWidth=6]
 * @param {number} [options.camber=0.1]
 * @param {THREE.Vector3[]} [options.controlPoints]
 * @param {[number,number,number]} [options.worldOffset=[0,0,0]]
 * @returns {THREE.Mesh}
 */
export function createRoadSurface(options = {}) {
    const width = options.width ?? 4;
    const numLength = options.numLength ?? 40;
    const numWidth = options.numWidth ?? 6;
    const camber = options.camber ?? 0.1;
    const raw = options.controlPoints ?? DEFAULT_ROAD_PROFILE;
    const [ox, oy, oz] = options.worldOffset ?? [0, 0, 0];
    const pts = (raw && raw.length >= 4) ? raw : DEFAULT_ROAD_PROFILE;

    const positions = [];
    for (let i = 0; i < numLength; i++) {
        const t = i / (numLength - 1);
        const pt = evalBSplineCurve(t, pts);
        for (let j = 0; j < numWidth; j++) {
            const x = -width / 2 + (j / (numWidth - 1)) * width;
            const yCamber = camber * (x / (width / 2));
            positions.push(x, pt.y + yCamber, pt.z);
        }
    }

    const indices = [];
    for (let i = 0; i < numLength - 1; i++) {
        for (let j = 0; j < numWidth - 1; j++) {
            const a = i * numWidth + j;
            const b = a + 1;
            const c = a + numWidth;
            const d = c + 1;
            indices.push(a, c, b, b, c, d);
        }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    const map = getTexture("textures/concrete_ground_01_2k/concrete_ground_01_color_2k.png", "Error loading road texture");
    const material = new THREE.MeshStandardMaterial({ map });

    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(ox, oy, oz);
    return mesh;
}

// -----------------------------------------------------------------------------
// C. SURFACE 2: GREEN SPACE WITH MOUND (left of road)
// -----------------------------------------------------------------------------

function buildDefaultGreenGrid() {
    const xs = [-12, -8, -6, -4];
    const zs = [-15, -5, 5, 15];
    const grid = [];
    for (let i = 0; i < 4; i++) {
        grid[i] = [];
        for (let j = 0; j < 4; j++) {
            let y = -0.5;
            if ((i === 1 || i === 2) && (j === 1 || j === 2)) y = 1.0;
            grid[i][j] = new THREE.Vector3(xs[i], y, zs[j]);
        }
    }
    return grid;
}

/**
 * @param {Object} [options]
 * @param {THREE.Vector3[][]} [options.controlGrid]
 * @param {number} [options.numU=24]
 * @param {number} [options.numV=24]
 * @param {[number,number,number]} [options.worldOffset=[0,0,0]]
 * @returns {THREE.Mesh}
 */
export function createGreenMoundSurface(options = {}) {
    const grid = options.controlGrid ?? buildDefaultGreenGrid();
    const numU = options.numU ?? 24;
    const numV = options.numV ?? 24;
    const [ox, oy, oz] = options.worldOffset ?? [0, 0, 0];

    const positions = [];
    for (let i = 0; i < numU; i++) {
        const u = i / (numU - 1);
        for (let j = 0; j < numV; j++) {
            const v = j / (numV - 1);
            const P = evalBSplineSurface(u, v, grid);
            positions.push(P.x, P.y, P.z);
        }
    }

    const indices = [];
    for (let i = 0; i < numU - 1; i++) {
        for (let j = 0; j < numV - 1; j++) {
            const a = i * numV + j;
            const b = a + 1;
            const c = a + numV;
            const d = c + 1;
            indices.push(a, c, b, b, c, d);
        }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({ color: COLORS.GRASS_DARK });

    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(ox, oy, oz);
    return mesh;
}

// -----------------------------------------------------------------------------
// D. SURFACE 3: PATH AROUND THE GREEN, MEETING THE ROAD
// -----------------------------------------------------------------------------

function buildDefaultPathControlPoints(roadWidth = 4) {
    const left = -roadWidth / 2;
    return [
        new THREE.Vector3(left, -0.3, 10),
        new THREE.Vector3(-5, 0.2, 5),
        new THREE.Vector3(-8, 0.6, 0),
        new THREE.Vector3(-5, 0.2, -5),
        new THREE.Vector3(left, -0.3, -10)
    ];
}

/**
 * @param {Object} [options]
 * @param {THREE.Vector3[]} [options.controlPoints]
 * @param {number} [options.pathWidth=1.2]
 * @param {number} [options.numSamples=60]
 * @param {[number,number,number]} [options.worldOffset=[0,0,0]]
 * @param {number} [options.roadWidth=4]
 * @returns {THREE.Mesh}
 */
export function createPathSurface(options = {}) {
    const roadWidth = options.roadWidth ?? 4;
    const pts = options.controlPoints ?? buildDefaultPathControlPoints(roadWidth);
    const pathWidth = options.pathWidth ?? 1.2;
    const numSamples = options.numSamples ?? 60;
    const [ox, oy, oz] = options.worldOffset ?? [0, 0, 0];

    const half = pathWidth / 2;
    const C = [];
    for (let i = 0; i < numSamples; i++) {
        const t = i / (numSamples - 1);
        C.push(evalBSplineCurve(t, pts));
    }

    const positions = [];
    for (let i = 0; i < numSamples; i++) {
        let Tx, Ty, Tz;
        if (i === 0) {
            const d = new THREE.Vector3().subVectors(C[1], C[0]);
            d.normalize();
            Tx = d.x; Ty = d.y; Tz = d.z;
        } else if (i === numSamples - 1) {
            const d = new THREE.Vector3().subVectors(C[i], C[i - 1]);
            d.normalize();
            Tx = d.x; Ty = d.y; Tz = d.z;
        } else {
            const d = new THREE.Vector3().subVectors(C[i + 1], C[i - 1]);
            d.normalize();
            Tx = d.x; Ty = d.y; Tz = d.z;
        }
        const len = Math.hypot(Tz, Tx) || 1;
        const px = Tz / len;
        const pz = -Tx / len;
        const L = new THREE.Vector3(C[i].x - half * px, C[i].y, C[i].z - half * pz);
        const R = new THREE.Vector3(C[i].x + half * px, C[i].y, C[i].z + half * pz);
        positions.push(L.x, L.y, L.z, R.x, R.y, R.z);
    }

    const indices = [];
    for (let i = 0; i < numSamples - 1; i++) {
        const a = 2 * i, b = 2 * i + 1, c = 2 * i + 2, d = 2 * i + 3;
        indices.push(a, b, c, b, d, c);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({ color: 0x8b7355 });

    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(ox, oy, oz);
    return mesh;
}
