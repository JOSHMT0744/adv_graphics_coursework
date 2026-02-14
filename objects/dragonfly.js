import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

// Default physics limits (per-entity randomization applied in createDragonfly)
const DEFAULT_MAX_SPEED = 0.7;
const DEFAULT_MAX_FORCE = 0.04;
const FORCE_RADIUS = 0.5;

let _cachedGeometry = null;
let _cachedGeometryLOD = null;
let _cachedMaterial = null;

/**
 * Creates the close-LOD dragonfly geometry: body (long box) + 2 triangular wings.
 * Body: 0.08 x 0.08 x 0.5, centered at origin. Wings extend laterally from center.
 * @returns {THREE.BufferGeometry}
 */
export function getDragonflyGeometry() {
    if (_cachedGeometry) return _cachedGeometry;

    // Body: long thin box (has position, normal, uv attributes)
    const bodyGeo = new THREE.BoxGeometry(0.08, 0.08, 0.5);

    // Helper: build a triangle geometry with position, normal, and uv so it
    // matches BoxGeometry's attribute set (required by mergeGeometries).
    function makeWingTriangle(positions, indices) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
        geo.setIndex(indices);
        geo.computeVertexNormals();
        // Add dummy UVs (3 vertices)
        geo.setAttribute("uv", new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0.5, 1]), 2));
        return geo;
    }

    // Left wing: triangle extending in -X direction
    const leftWingGeo = makeWingTriangle(
        [0, 0, 0,  -0.35, 0.08, 0,  -0.35, -0.08, 0],
        [0, 1, 2]
    );

    // Right wing: mirrored triangle in +X direction
    const rightWingGeo = makeWingTriangle(
        [0, 0, 0,  0.35, 0.08, 0,  0.35, -0.08, 0],
        [0, 2, 1]
    );

    _cachedGeometry = mergeGeometries([bodyGeo, leftWingGeo, rightWingGeo]);
    bodyGeo.dispose();
    leftWingGeo.dispose();
    rightWingGeo.dispose();

    return _cachedGeometry;
}

/**
 * Far LOD: simple cube (looks like a small glowing box from distance).
 * @returns {THREE.BufferGeometry}
 */
export function getDragonflyGeometryLOD() {
    if (_cachedGeometryLOD) return _cachedGeometryLOD;
    _cachedGeometryLOD = new THREE.BoxGeometry(0.3, 0.3, 0.3);
    return _cachedGeometryLOD;
}

/**
 * Emissive material for dragonfly glow (works with bloom pass).
 * @returns {THREE.Material}
 */
export function getDragonflyMaterial(colour=0x44ffaa, emissive=0xf00ed2) {
    if (_cachedMaterial) return _cachedMaterial;
    _cachedMaterial = new THREE.MeshStandardMaterial({
        color: colour,
        emissive: emissive,
        emissiveIntensity: 1.5,
        roughness: 0.3,
        metalness: 0.1,
        vertexColors: true
    });
    return _cachedMaterial;
}

/**
 * Creates a lightweight dragonfly entity for instanced rendering.
 * @param {{ position?: THREE.Vector3, id?: number }} options
 * @returns {Object} Dragonfly entity with pos, vel, acc, bounds, id, physics params, etc.
 */
export function createDragonfly(options = {}) {
    const position = options.position;
    const pos = position
        ? position.clone()
        : new THREE.Vector3((Math.random() - 0.5) * 100, (Math.random() * 10), (Math.random() - 0.5) * 100);

    const maxSpeed = DEFAULT_MAX_SPEED * (0.85 + Math.random() * 0.3);
    const maxForce = DEFAULT_MAX_FORCE * (0.8 + Math.random() * 0.4);

    const hue = 140 + Math.random() * 40;
    const color = new THREE.Color().setHSL(hue / 360, 0.7, 0.7);

    const vel = new THREE.Vector3(
        (Math.random() - 0.5) * maxSpeed * 0.5,
        (Math.random() - 0.5) * maxSpeed * 0.3,
        (Math.random() - 0.5) * maxSpeed * 0.5
    );

    const r = FORCE_RADIUS;
    const bounds = new THREE.Box3(
        new THREE.Vector3(pos.x - r, pos.y - r, pos.z - r),
        new THREE.Vector3(pos.x + r, pos.y + r, pos.z + r)
    );

    return {
        id: options.id ?? -1,
        pos,
        vel,
        acc: new THREE.Vector3(),
        bounds,
        maxSpeed,
        maxForce,
        forceRadius: FORCE_RADIUS,
        flyHeight: pos.y,
        path: [],
        pathIndex: 0,
        color,
        bankAngle: 0,
        facingAngle: Math.atan2(vel.x, vel.z),
        _lastOctreePos: pos.clone()
    };
}
