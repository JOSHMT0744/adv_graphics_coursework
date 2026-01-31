import * as THREE from "three";

// -----------------------------------------------------------------------------
// Bezier surface: Bernstein basis + tensor-product evaluation (4×4 patch)
// -----------------------------------------------------------------------------

/**
 * Cubic Bernstein basis polynomials. i in 0..3, t in [0,1].
 * Calculates the "weight" or influence of a control point at parameter t
 * @param {number} i
 * @param {number} t
 * @returns {number}
 */
function bernstein(i, t) {
    const k = 1 - t;
    switch (i) {
        case 0: return k * k * k;
        case 1: return 3 * k * k * t;
        case 2: return 3 * k * t * t;
        case 3: return t * t * t;
        default: return 0;
    }
}

/**
 * Tensor-product Bezier surface: S(u,v) = Σᵢ Σⱼ Bᵢ(u) Bⱼ(v) Pᵢⱼ.
 * controlPoints: flat array of 16 Vector3 (or {x,y,z}), index = i*4+j.
 * @param {number} u
 * @param {number} v
 * @param {THREE.Vector3[]|{x:number,y:number,z:number}[]} controlPoints
 * @returns {THREE.Vector3}
 */
function evalBezierSurface(u, v, controlPoints) {
    const point = new THREE.Vector3(0, 0, 0);

    for (let i = 0; i < 4; i++) { // u direction
        for (let j = 0; j < 4; j++) { // v direction
            // Calculate combined weight
            const basisU = bernstein(i, u);
            const basisV = bernstein(j, v);
            const weight = basisU * basisV;

            // Retrieve control point from the flattened 1D array
            const P_ij = controlPoints[i * 4 + j];
            const px = P_ij.x ?? P_ij.position?.x ?? 0;
            const py = P_ij.y ?? P_ij.position?.y ?? 0;
            const pz = P_ij.z ?? P_ij.position?.z ?? 0;
            point.x += weight * px;
            point.y += weight * py;
            point.z += weight * pz;
        }
    }
    return point;
}

/**
 * Flatten control points to 16-element array. Accepts 16-element array or 4×4 grid.
 * @param {THREE.Vector3[]|THREE.Vector3[][]} controlPoints
 * @returns {THREE.Vector3[]}
 */
function normalizeControlPoints(controlPoints) {
    if (!controlPoints || (Array.isArray(controlPoints) && controlPoints.length === 0)) {
        throw new Error("createBezierSurface: controlPoints required");
    }
    if (Array.isArray(controlPoints[0]) && controlPoints[0].length === 4) {
        const flat = [];
        for (let i = 0; i < 4; i++) {
            for (let j = 0; j < 4; j++) {
                flat.push(controlPoints[i][j] instanceof THREE.Vector3 ? controlPoints[i][j] : new THREE.Vector3(controlPoints[i][j].x, controlPoints[i][j].y, controlPoints[i][j].z));
            }
        }
        return flat;
    }
    if (controlPoints.length !== 16) {
        throw new Error("createBezierSurface: controlPoints must be 16 Vector3s or 4×4 grid");
    }
    return controlPoints.map(p => p instanceof THREE.Vector3 ? p : new THREE.Vector3(p.x, p.y, p.z));
}

/**
 * Create a Bezier surface mesh from a 4×4 grid of control points.
 * @param {THREE.Vector3[]|THREE.Vector3[][]} controlPoints - 16 Vector3s (flat) or 4×4 grid
 * @param {Object} [options]
 * @param {number} [options.segments=50]
 * @param {number} [options.color=0x3498db]
 * @param {boolean} [options.showHull=false]
 * @param {boolean} [options.wireframe=false]
 * @param {THREE.Material} [options.material]
 * @param {THREE.Side} [options.side=THREE.DoubleSide]
 * @returns {THREE.Group}
 */
export function createBezierSurface(controlPoints, options = {}) {
    const {
        segments = 50,
        color = 0x3498db,
        showHull = false,
        wireframe: showWireframe = false,
        material: customMaterial,
        side = THREE.DoubleSide
    } = options;

    // Normalize control points to 16-element array
    const points = normalizeControlPoints(controlPoints);

    const group = new THREE.Group();

    // 1. Optional cage (control-point hull)
    if (showHull) {
        const cagePoints = [];

        // Generate horizontal and vertical lines for the grid
        for (let i = 0; i < 4; i++) {
            for (let j = 0; j < 3; j++) {
                cagePoints.push(points[i * 4 + j].position, points[i * 4 + j + 1].position);
            }
        }
        for (let i = 0; i < 3; i++) {
            for (let j = 0; j < 4; j++) {
                // Vertical connection between points
                cagePoints.push(points[i * 4 + j].position, points[(i + 1) * 4 + j].position);
            }
        }
        const cageGeo = new THREE.BufferGeometry().setFromPoints(cagePoints);
        const cageLine = new THREE.LineSegments(cageGeo, new THREE.LineBasicMaterial({ color: 0x555555 }));
        group.add(cageLine);
    }

    // 2. Solid surface
    const geo = new THREE.PlaneGeometry(1, 1, segments, segments);
    const positions = geo.attributes.position;
    const uvAttr = geo.attributes.uv;
    
    // Evaluate the Bezier surface at each segment
    for (let k = 0; k < positions.count; k++) {
        const u = uvAttr.getX(k);
        const v = uvAttr.getY(k);
        const vec = evalBezierSurface(u, v, points);
        positions.setXYZ(k, vec.x, vec.y, vec.z);
    }
    positions.needsUpdate = true;
    geo.computeVertexNormals();

    const mat = customMaterial ?? new THREE.MeshPhongMaterial({
        color,
        side,
        shininess: 80
    });
    const mesh = new THREE.Mesh(geo, mat);
    group.add(mesh);

    // 3. Optional wireframe overlay
    if (showWireframe) {
        const wireMat = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            wireframe: true,
            transparent: true,
            opacity: 0.2,
            polygonOffset: true,
            polygonOffsetFactor: -1
        });
        const wireMesh = new THREE.Mesh(geo, wireMat);
        group.add(wireMesh);
    }

    return group;
}
