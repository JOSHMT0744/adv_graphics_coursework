import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

const HOUSE_DEFAULTS = {
    width: 8,
    depth: 5,
    groundHeight: 2.5,
    firstFloorHeight: 2.5,
    roofPitch: 0.45,
    roofOverhang: 0.25,
    chimneyWidth: 0.5,
    chimneyDepth: 0.45,
    chimneyHeight: 1.2,
    chimneyOffsetZ: 0.3,
    doorWidth: 0.9,
    doorHeight: 2.0,
    doorThickness: 0.04,
    wallColor: 0xf5f0e8,
    timberColor: 0x2a2520,
    doorColor: 0x1a1a1a,
    roofColor: 0x8b4513,
    chimneyColor: 0xb55239,
    windowColor: 0x384a60,
};

/** Add a vertex color attribute to a geometry (same color for all vertices). */
function applyVertexColor(geometry, hex) {
    const c = new THREE.Color(hex);
    const n = geometry.attributes.position.count;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
        colors[i * 3] = c.r;
        colors[i * 3 + 1] = c.g;
        colors[i * 3 + 2] = c.b;
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return geometry;
}

/**
 * Build gable roof BufferGeometry: ridge along X=0, two slope quads (left/right), two gable triangles (front/back).
 * Single-sided; no thickness.
 */
function createGableRoofGeometry(w, d, wallTop, pitch, overhang) {
    const w2 = w / 2 + overhang;
    const d2 = d / 2 + overhang;
    const ridgeY = wallTop + (w / 2 + overhang) * Math.tan(pitch);

    const vertices = [
        -w2, wallTop, -d2,   // 0: front-left
        0, ridgeY, -d2,     // 1: front-ridge
        w2, wallTop, -d2,   // 2: front-right
        -w2, wallTop, d2,   // 3: back-left
        0, ridgeY, d2,      // 4: back-ridge
        w2, wallTop, d2,    // 5: back-right
    ];
    const indices = [
        0, 1, 4, 0, 4, 3,   // left slope
        1, 2, 5, 1, 5, 4,   // right slope
        0, 2, 1,            // front gable
        3, 4, 5,            // back gable
    ];
    const uvs = [0, 0, 0.5, 0, 1, 0, 0, 1, 0.5, 1, 1, 1];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
}

/**
 * Create a house: two storeys, main door, windows, half-timber first floor, gable roof, chimney.
 * Local origin at ground centre; front face toward -Z.
 * @param {number} [x=0]
 * @param {number} [y=0]
 * @param {number} [z=0]
 * @param {number} [scale=1]
 * @param {Object} [options] - overrides for HOUSE_DEFAULTS
 * @returns {THREE.Group}
 */
export function createHouse(x = 0, y = 0, z = 0, scale = 1, options = {}) {
    const opts = { ...HOUSE_DEFAULTS, ...options };
    const W = opts.width;
    const D = opts.depth;
    const H0 = opts.groundHeight;
    const H1 = opts.firstFloorHeight;
    const wallTop = H0 + H1;
    const ridgeY = wallTop + (W / 2 + opts.roofOverhang) * Math.tan(opts.roofPitch);
    const chimneyZ = opts.chimneyOffsetZ;

    const geometries = [];
    const _m = new THREE.Matrix4();
    const _q = new THREE.Quaternion();
    const _s = new THREE.Vector3();
    const _p = new THREE.Vector3();

    function addPart(geometry, color, position, quaternion, scaleVec) {
        const g = geometry.clone();
        if (position) g.translate(position.x, position.y, position.z);
        if (quaternion) {
            _m.identity();
            _m.compose(_p.set(0, 0, 0), quaternion, _s.set(1, 1, 1));
            g.applyMatrix4(_m);
        }
        if (scaleVec) {
            _m.identity();
            _m.compose(_p.set(0, 0, 0), _q.identity(), scaleVec);
            g.applyMatrix4(_m);
        }
        applyVertexColor(g, color);
        geometries.push(g);
    }

    // Ground floor
    let g = new THREE.BoxGeometry(W, H0, D);
    addPart(g, opts.wallColor, new THREE.Vector3(0, H0 / 2, 0));

    // Main door
    g = new THREE.BoxGeometry(opts.doorWidth, opts.doorHeight, opts.doorThickness);
    addPart(g, opts.doorColor, new THREE.Vector3(0, opts.doorHeight / 2, -D / 2 - opts.doorThickness / 2 - 0.01));

    // Ground windows (two)
    g = new THREE.PlaneGeometry(0.7, 1.0);
    _q.setFromEuler(new THREE.Euler(0, Math.PI, 0));
    [-1.8, 1.8].forEach((ox) => {
        const winG = g.clone();
        winG.applyMatrix4(new THREE.Matrix4().compose(
            new THREE.Vector3(ox, H0 * 0.6, -D / 2 - 0.02),
            _q,
            new THREE.Vector3(1, 1, 1)
        ));
        applyVertexColor(winG, opts.windowColor);
        geometries.push(winG);
    });

    // First floor
    g = new THREE.BoxGeometry(W, H1, D);
    addPart(g, opts.wallColor, new THREE.Vector3(0, H0 + H1 / 2, 0));

    // First-floor windows (three)
    g = new THREE.PlaneGeometry(0.62, 0.85);
    [-W / 2 + 1.0, 0, W / 2 - 1.0].forEach((ox) => {
        const winG = g.clone();
        winG.applyMatrix4(new THREE.Matrix4().compose(
            new THREE.Vector3(ox, H0 + H1 * 0.55, -D / 2 - 0.02),
            _q.setFromEuler(new THREE.Euler(0, Math.PI, 0)),
            new THREE.Vector3(1, 1, 1)
        ));
        applyVertexColor(winG, opts.windowColor);
        geometries.push(winG);
    });

    // Gable roof
    g = createGableRoofGeometry(W, D, wallTop, opts.roofPitch, opts.roofOverhang);
    addPart(g, opts.roofColor);

    // Chimney
    g = new THREE.BoxGeometry(opts.chimneyWidth, opts.chimneyHeight, opts.chimneyDepth);
    addPart(g, opts.chimneyColor, new THREE.Vector3(0, ridgeY + opts.chimneyHeight / 2 - 0.5, chimneyZ));

    const merged = mergeGeometries(geometries);
    geometries.forEach((geo) => geo.dispose());
    if (!merged) throw new Error("createHouse: mergeGeometries failed (ensure all geometries have position, normal, uv, color)");

    const material = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.9,
        metalness: 0,
        side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(merged, material);
    merged.computeBoundingBox();

    const group = new THREE.Group();
    group.add(mesh);
    group.position.set(x, y, z);
    group.scale.setScalar(scale);
    group.userData.radius = Math.max(W, D) * 0.6 * scale;
    return group;
}
