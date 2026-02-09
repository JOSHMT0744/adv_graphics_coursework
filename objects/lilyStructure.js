import * as THREE from "three";
import { evalBSplineSurface } from "../utils/bspline.js";

// -----------------------------------------------------------------------------
// Lily structure (Elysium Garden style): stem + 9 B-spline petals (6 at 30°, 3 at 20°)
// -----------------------------------------------------------------------------

const DEFAULT_OPTIONS = {
    scale: 1,
    stemHeight: 3,
    stemRadiusBottom: 0.15,
    stemRadiusTop: 0.22,
    petalLength: 20,
    petalColor: 0xff44aa,
    stemColor: 0x22aa88,
    emissiveIntensity: 3,
    transparent: false,
};

const PETAL_SEGMENTS_U = 20;
const PETAL_SEGMENTS_V = 12;

/** Angle from vertical (radians): 6 outer petals. */
export const PETAL_ANGLE_OUTER = (30 * Math.PI) / 180;
/** Angle from vertical (radians): 3 inner petals. */
export const PETAL_ANGLE_INNER = (40 * Math.PI) / 180;

/** Layout for instancing: [{ angle, azimuth }, ...] for 9 petals (6 outer, 3 inner). */
export const PETAL_LAYOUT = [
    ...Array.from({ length: 6 }, (_, i) => ({ angle: PETAL_ANGLE_OUTER, azimuth: (i * 60 * Math.PI) / 180 })),
    ...Array.from({ length: 3 }, (_, i) => ({ angle: PETAL_ANGLE_INNER, azimuth: ((40 + i * 120) * Math.PI) / 180 })),
];

/**
 * Build 4×4 control grid for one petal in local space.
 * u: 0 = base at stem, 1 = tip. v: 0 to 1 across width. Petal in YZ plane (Y = stem-to-tip, Z = width).
 * @param {number} length - petal length (Y extent)
 * @returns {THREE.Vector3[][]} grid[0..3][0..3]
 */
function createPetalControlGrid(length) {
    const hw = length * 0.22; // half width at base
    const grid = [
        [new THREE.Vector3(0, 0, -hw), new THREE.Vector3(0, 0, -hw * 0.35), new THREE.Vector3(0, 0, hw * 0.35), new THREE.Vector3(0, 0, hw)],
        [new THREE.Vector3(0, length * 0.35, -hw * 1.05), new THREE.Vector3(0, length * 0.4, -hw * 0.3), new THREE.Vector3(0, length * 0.4, hw * 0.3), new THREE.Vector3(0, length * 0.35, hw * 1.05)],
        [new THREE.Vector3(0, length * 0.7, -hw * 0.65), new THREE.Vector3(0, length * 0.75, -hw * 0.2), new THREE.Vector3(0, length * 0.75, hw * 0.2), new THREE.Vector3(0, length * 0.7, hw * 0.65)],
        [new THREE.Vector3(0, length, 0), new THREE.Vector3(0, length, 0), new THREE.Vector3(0, length, 0), new THREE.Vector3(0, length, 0)],
    ];
    return grid;
}

/**
 * Build BufferGeometry for one petal by sampling the 4×4 B-spline patch.
 * @param {THREE.Vector3[][]} grid - 4×4 control grid from createPetalControlGrid
 * @returns {THREE.BufferGeometry}
 */
function buildPetalGeometry(grid) {
    const nu = PETAL_SEGMENTS_U;
    const nv = PETAL_SEGMENTS_V;
    const positions = [];
    const indices = [];

    for (let iv = 0; iv <= nv; iv++) {
        const v = iv / nv;
        for (let iu = 0; iu <= nu; iu++) {
            const u = iu / nu;
            const pt = evalBSplineSurface(u, v, grid);
            positions.push(pt.x, pt.y, pt.z);
        }
    }

    for (let iv = 0; iv < nv; iv++) {
        for (let iu = 0; iu < nu; iu++) {
            const a = iv * (nu + 1) + iu;
            const b = a + 1;
            const c = a + (nu + 1);
            const d = c + 1;
            indices.push(a, c, b, b, c, d);
        }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
}

let _sharedPetalGeometry = null;
let _sharedStemGeometry = null;

/** Shared petal BufferGeometry (single B-spline patch, default length) for InstancedMesh. */
export function getSharedPetalGeometry() {
    if (!_sharedPetalGeometry) {
        const grid = createPetalControlGrid(DEFAULT_OPTIONS.petalLength);
        _sharedPetalGeometry = buildPetalGeometry(grid);
    }
    return _sharedPetalGeometry;
}

/** Shared stem BufferGeometry (unit height cylinder, scale Y by stemHeight in instance matrix). */
export function getSharedStemGeometry() {
    if (!_sharedStemGeometry) {
        _sharedStemGeometry = new THREE.CylinderGeometry(
            DEFAULT_OPTIONS.stemRadiusTop,
            DEFAULT_OPTIONS.stemRadiusBottom,
            1,
            16
        );
    }
    return _sharedStemGeometry;
}

/**
 * Create stem mesh (cylinder, origin at base, +Y up). Widens at top.
 * @param {number} height
 * @param {number} radiusBottom
 * @param {number} radiusTop
 * @param {THREE.Material} material
 * @returns {THREE.Mesh}
 */
function createStem(height, radiusBottom, radiusTop, material) {
    const geo = new THREE.CylinderGeometry(radiusTop, radiusBottom, height, 16);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.y = height / 2; // cylinder is centered; we want base at 0
    return mesh;
}

/**
 * Create a lily structure: stem + 9 curved petals (6 at 30°, 3 at 20° from axis).
 * @param {number} x - world X
 * @param {number} y - world Y (base of stem on ground)
 * @param {number} z - world Z
 * @param {Object} [options] - overrides for scale, stemHeight, stemRadiusBottom, stemRadiusTop, petalLength, petalColor, stemColor, emissiveIntensity, transparent
 * @returns {THREE.Group}
 */
export function createLilyStructure(x = 0, y = 0, z = 0, options = {}) {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const stemHeight = opts.stemHeight;
    const petalLength = opts.petalLength;
    const scale = opts.scale;

    const group = new THREE.Group();

    // Stem material: emissive green/teal
    const stemColor = new THREE.Color(opts.stemColor);
    const stemMat = new THREE.MeshStandardMaterial({
        color: stemColor,
        emissive: stemColor.clone(),
        emissiveIntensity: opts.emissiveIntensity,
        transparent: opts.transparent,
        opacity: opts.transparent ? 0.85 : 1,
    });
    const stem = createStem(stemHeight, opts.stemRadiusBottom, opts.stemRadiusTop, stemMat);
    stem.castShadow = false;
    stem.receiveShadow = false;
    group.add(stem);

    // Petal geometry (one shared): 4×4 B-spline patch
    const petalGrid = createPetalControlGrid(petalLength);
    const petalGeometry = buildPetalGeometry(petalGrid);

    // Petal material: emissive, double-sided. Scale emissive so all colours have equal perceived luminosity.
    const petalColor = new THREE.Color(opts.petalColor);
    const lum = 0.299 * petalColor.r + 0.587 * petalColor.g + 0.114 * petalColor.b;
    const targetLum = 0.5;
    const petalEmissiveIntensity = lum > 1e-4 ? targetLum / lum : opts.emissiveIntensity;
    const petalMat = new THREE.MeshStandardMaterial({
        color: petalColor,
        emissive: petalColor.clone(),
        emissiveIntensity: Math.min(petalEmissiveIntensity, 4),
        side: THREE.DoubleSide,
        transparent: opts.transparent,
        opacity: opts.transparent ? 0.9 : 1,
    });

    // 6 petals at PETAL_ANGLE_OUTER from +Y (splay outward), azimuth 0°, 60°, …
    for (let i = 0; i < 6; i++) {
        const azimuth = (i * 60 * Math.PI) / 180;
        const petal = new THREE.Mesh(petalGeometry, petalMat);
        petal.position.set(0, stemHeight, 0);
        petal.rotation.order = "YXZ";
        petal.rotation.y = azimuth;
        petal.rotation.x = PETAL_ANGLE_OUTER;
        petal.castShadow = false;
        petal.receiveShadow = true;
        group.add(petal);
    }

    // 3 petals at PETAL_ANGLE_INNER from +Y (splay outward), azimuth 40°, 160°, 280°
    for (let i = 0; i < 3; i++) {
        const azimuth = (40 + i * 120) * (Math.PI / 180);
        const petal = new THREE.Mesh(petalGeometry, petalMat);
        petal.position.set(0, stemHeight, 0);
        petal.rotation.order = "YXZ";
        petal.rotation.y = azimuth;
        petal.rotation.x = PETAL_ANGLE_INNER;
        petal.castShadow = false;
        petal.receiveShadow = false;
        group.add(petal);
    }

    // Optional point light at flower so emissive "glow" contributes to scene lighting (e.g. SU window reflections)
    if (opts.addLight) {
        const flowerLight = new THREE.PointLight(petalColor, 0.5, 18, 1.5);
        flowerLight.position.set(0, stemHeight, 0);
        group.add(flowerLight);
    }

    group.position.set(x, y, z);
    group.scale.setScalar(scale);
    return group;
}
