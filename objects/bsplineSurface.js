import * as THREE from "three";

// -----------------------------------------------------------------------------
// B-spline surface: Cox–De Boor basis + tensor-product evaluation
// Ported from lecture 03b-ACG-bspline-demo.html
// -----------------------------------------------------------------------------

/**
 * Generates a knot vector.
 * Clamped (open uniform) repeats first/last knots (p+1) times so the curve
 * starts at the first control point and ends at the last.
 * @param {number} degree - Degree p
 * @param {number} numPoints - Number of control points
 * @param {boolean} clamped - Use clamped (open uniform) knots
 * @returns {number[]}
 */
function generateKnots(degree, numPoints, clamped) {
    if (numPoints <= 0) return [];
    const n = numPoints - 1;
    const p = degree;
    const knots = [];

    if (clamped) {
        for (let i = 0; i <= p; i++) knots.push(0);
        const count = n - p;
        if (count > 0) {
            for (let i = 1; i <= count; i++) knots.push(i / (count + 1));
        }
        for (let i = 0; i <= p; i++) knots.push(1);
    } else {
        const len = n + p + 2;
        for (let i = 0; i < len; i++) knots.push(i / (len - 1));
    }
    return knots;
}

/**
 * Cox–De Boor basis function N_{i,p}(t).
 * @param {number} i - Basis index (control point index)
 * @param {number} p - Degree
 * @param {number} t - Parameter
 * @param {number[]} knots - Knot vector
 * @returns {number}
 */
function N(i, p, t, knots) {
    if (i >= knots.length - 1) return 0;

    if (p === 0) {
        if (Math.abs(t - knots[knots.length - 1]) < 1e-6) {
            return (knots[i] <= t && t <= knots[i + 1] && knots[i] < knots[i + 1]) ? 1 : 0;
        }
        return (knots[i] <= t && t < knots[i + 1]) ? 1 : 0;
    }

    let left = 0, right = 0;
    const d1 = knots[i + p] - knots[i];
    if (d1 > 1e-6) left = ((t - knots[i]) / d1) * N(i, p - 1, t, knots);
    const d2 = knots[i + p + 1] - knots[i + 1];
    if (d2 > 1e-6) right = ((knots[i + p + 1] - t) / d2) * N(i + 1, p - 1, t, knots);
    return left + right;
}

/**
 * Evaluates a point on a tensor-product B-spline surface.
 * S(u,v) = Sum_i Sum_j ( P_{ij} * N_{i,pU}(u) * N_{j,pV}(v) )
 * points[idx] can be { position: Vector3 } (mesh) or Vector3 (fixed).
 * @param {number} u
 * @param {number} v
 * @param {number} pU
 * @param {number} pV
 * @param {Array} points - Flat array of control points (Vector3 or { position: Vector3 })
 * @param {number} dimU
 * @param {number} dimV
 * @param {number[]} knotsU
 * @param {number[]} knotsV
 * @returns {THREE.Vector3}
 */
function evalSurface(u, v, pU, pV, points, dimU, dimV, knotsU, knotsV) {
    let x = 0, y = 0, z = 0;
    for (let i = 0; i < dimU; i++) {
        const bu = N(i, pU, u, knotsU);
        if (bu < 1e-6) continue;
        for (let j = 0; j < dimV; j++) {
            const bv = N(j, pV, v, knotsV);
            const weight = bu * bv;
            if (weight > 1e-6) {
                const idx = i * dimV + j;
                if (points[idx]) {
                    const pos = points[idx].position ?? points[idx];
                    x += pos.x * weight;
                    y += pos.y * weight;
                    z += pos.z * weight;
                }
            }
        }
    }
    return new THREE.Vector3(x, y, z);
}

/**
 * Build hull line segments for a dimU x dimV control grid (U rows, V cols).
 * @param {THREE.Vector3[]|Array} points - Flat array; each element has .position or is Vector3
 * @param {number} dimU
 * @param {number} dimV
 * @returns {THREE.Vector3[]} Pairs of points for LineSegments
 */
function buildHullPoints(points, dimU, dimV) {
    const lines = [];
    const getPos = (idx) => {
        const p = points[idx];
        return p && (p.position ?? p);
    };
    for (let i = 0; i < dimU; i++) {
        for (let j = 0; j < dimV - 1; j++) {
            const a = getPos(i * dimV + j);
            const b = getPos(i * dimV + j + 1);
            if (a && b) lines.push(a, b);
        }
    }
    for (let j = 0; j < dimV; j++) {
        for (let i = 0; i < dimU - 1; i++) {
            const a = getPos(i * dimV + j);
            const b = getPos((i + 1) * dimV + j);
            if (a && b) lines.push(a, b);
        }
    }
    return lines;
}

/**
 * Create a fixed B-spline surface from a flat array of control points.
 * @param {THREE.Vector3[]} controlPoints - Flat array of dimU*dimV Vector3s
 * @param {Object} [options]
 * @param {number} [options.dimU=4]
 * @param {number} [options.dimV=4]
 * @param {number} [options.degree=3]
 * @param {boolean} [options.clamped=true]
 * @param {number} [options.segments=50]
 * @param {number} [options.color=0x3498db]
 * @param {boolean} [options.showHull=false]
 * @param {boolean} [options.showControlPoints=false]
 * @param {number} [options.controlPointSize=0.08]
 * @param {boolean} [options.wireframe=false]
 * @param {THREE.Material} [options.material]
 * @param {THREE.Side} [options.side=THREE.DoubleSide]
 * @returns {THREE.Group}
 */
export function createBSplineSurface(controlPoints, options = {}) {
    const {
        dimU = 4,
        dimV = 4,
        degree = 3,
        clamped = true,
        segments = 50,
        color = 0x3498db,
        showHull = false,
        showControlPoints = false,
        controlPointSize = 0.08,
        wireframe: showWireframe = false,
        material: customMaterial,
        side = THREE.DoubleSide
    } = options;

    const numPoints = dimU * dimV;
    if (!controlPoints || controlPoints.length !== numPoints) {
        throw new Error(`createBSplineSurface: controlPoints must have length dimU*dimV = ${numPoints}`);
    }
    const points = controlPoints.map(p => p instanceof THREE.Vector3 ? p.clone() : new THREE.Vector3(p.x, p.y, p.z));

    const pU = Math.max(1, Math.min(degree, dimU - 1));
    const pV = Math.max(1, Math.min(degree, dimV - 1));
    const knotsU = generateKnots(pU, dimU, clamped);
    const knotsV = generateKnots(pV, dimV, clamped);
    const startU = knotsU[pU];
    const endU = knotsU[knotsU.length - 1 - pU];
    const startV = knotsV[pV];
    const endV = knotsV[knotsV.length - 1 - pV];

    const group = new THREE.Group();
    group.userData.bspline = {
        hull: null,
        controlPoints: [],
        wireframe: null,
        dimU,
        dimV,
        surfaceMesh: null,
        knotsU,
        knotsV,
        pU,
        pV,
        startU,
        endU,
        startV,
        endV,
        segments
    };

    // 1. Control point spheres
    const sphereGeo = new THREE.SphereGeometry(controlPointSize, 16, 16);
    const sphereMat = new THREE.MeshBasicMaterial({ color: 0xcccccc });
    for (let idx = 0; idx < numPoints; idx++) {
        const sphere = new THREE.Mesh(sphereGeo, sphereMat);
        sphere.position.copy(points[idx]);
        sphere.visible = showControlPoints;
        group.userData.bspline.controlPoints.push(sphere);
        group.add(sphere);
    }

    // 2. Hull (control cage)
    const hullPoints = buildHullPoints(points, dimU, dimV);
    const cageGeo = new THREE.BufferGeometry().setFromPoints(hullPoints);
    const cageLine = new THREE.LineSegments(cageGeo, new THREE.LineBasicMaterial({ color: 0x555555 }));
    cageLine.visible = showHull;
    group.userData.bspline.hull = cageLine;
    group.add(cageLine);

    // 3. Surface mesh
    const geo = new THREE.PlaneGeometry(1, 1, segments, segments);
    const positions = geo.attributes.position;
    const uvAttr = geo.attributes.uv;
    for (let k = 0; k < positions.count; k++) {
        const uRaw = uvAttr.getX(k);
        const vRaw = uvAttr.getY(k);
        const u = startU + uRaw * (endU - startU);
        const v = startV + vRaw * (endV - startV);
        const pt = evalSurface(u, v, pU, pV, points, dimU, dimV, knotsU, knotsV);
        positions.setXYZ(k, pt.x, pt.y, pt.z);
    }
    positions.needsUpdate = true;
    geo.computeVertexNormals();

    const mat = customMaterial ?? new THREE.MeshPhongMaterial({ color, side, shininess: 80 });
    const mesh = new THREE.Mesh(geo, mat);
    group.userData.bspline.surfaceMesh = mesh;
    group.add(mesh);

    // 4. Wireframe overlay
    const wireMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        wireframe: true,
        transparent: true,
        opacity: 0.2,
        polygonOffset: true,
        polygonOffsetFactor: -1
    });
    const wireMesh = new THREE.Mesh(geo, wireMat);
    wireMesh.visible = showWireframe;
    group.userData.bspline.wireframe = wireMesh;
    group.add(wireMesh);

    return group;
}

/**
 * Re-evaluate the B-spline surface mesh from an updated control-point array.
 * Use this to animate the surface by mutating the points and calling this each frame.
 * @param {THREE.Group} group - Group returned by createBSplineSurface (must have userData.bspline with re-eval params)
 * @param {THREE.Vector3[]|Array} points - Flat array of dimU*dimV control points (will be read, not cloned)
 */
export function updateBSplineSurfaceFromPoints(group, points) {
    const data = group.userData.bspline;
    if (!data?.surfaceMesh || !data.knotsU || !data.knotsV) return;
    const { surfaceMesh, knotsU, knotsV, pU, pV, dimU, dimV, startU, endU, startV, endV } = data;
    const geo = surfaceMesh.geometry;
    const positions = geo.attributes.position;
    const uvAttr = geo.attributes.uv;
    for (let k = 0; k < positions.count; k++) {
        const uRaw = uvAttr.getX(k);
        const vRaw = uvAttr.getY(k);
        const u = startU + uRaw * (endU - startU);
        const v = startV + vRaw * (endV - startV);
        const pt = evalSurface(u, v, pU, pV, points, dimU, dimV, knotsU, knotsV);
        positions.setXYZ(k, pt.x, pt.y, pt.z);
    }
    positions.needsUpdate = true;
    geo.computeVertexNormals();
}

/**
 * Evaluate the B-spline surface at normalized (0–1) parameters and return world position.
 * Much cheaper than raycasting when updating many points (e.g. lights) on the surface.
 * @param {THREE.Group} group - Group from createBSplineSurface (with userData.bspline)
 * @param {THREE.Vector3[]|Array} points - Current control points (flat, dimU*dimV)
 * @param {number} uNorm - Parameter in [0, 1] (maps to startU..endU)
 * @param {number} vNorm - Parameter in [0, 1] (maps to startV..endV)
 * @param {THREE.Vector3} [target] - Optional vector to write result into (avoids allocation)
 * @returns {THREE.Vector3} World-space position on the surface
 */
export function getBSplineSurfaceWorldPointAtNormalized(group, points, uNorm, vNorm, target) {
    const data = group.userData.bspline;
    if (!data?.knotsU || !data?.knotsV) return target || new THREE.Vector3();
    const { knotsU, knotsV, pU, pV, dimU, dimV, startU, endU, startV, endV } = data;
    const u = startU + uNorm * (endU - startU);
    const v = startV + vNorm * (endV - startV);
    const localPt = evalSurface(u, v, pU, pV, points, dimU, dimV, knotsU, knotsV);
    const out = target || new THREE.Vector3();
    out.copy(localPt);
    group.localToWorld(out);
    return out;
}

/**
 * Create a draggable B-spline surface; control points are sphere meshes that update the surface on drag.
 * @param {THREE.Vector3[]} controlPoints - Flat array of dimU*dimV Vector3s (initial positions)
 * @param {Object} [options]
 * @param {number} [options.dimU=4]
 * @param {number} [options.dimV=4]
 * @param {number} [options.degree=3]
 * @param {boolean} [options.clamped=true]
 * @param {number} [options.segments=20]
 * @param {number} [options.color=0x3498db]
 * @param {boolean} [options.showHull=true]
 * @param {boolean} [options.showControlPoints=true]
 * @param {number} [options.controlPointSize=0.15]
 * @param {boolean} [options.wireframe=false]
 * @param {THREE.Material} [options.material]
 * @param {THREE.Side} [options.side=THREE.DoubleSide]
 * @returns {THREE.Group}
 */
export function createDraggableBSplineSurface(controlPoints, options = {}) {
    const {
        dimU = 4,
        dimV = 4,
        degree = 3,
        clamped = true,
        segments = 20,
        color = 0x3498db,
        showHull = true,
        showControlPoints = true,
        controlPointSize = 0.15,
        wireframe: showWireframe = false,
        material: customMaterial,
        side = THREE.DoubleSide
    } = options;

    const numPoints = dimU * dimV;
    if (!controlPoints || controlPoints.length !== numPoints) {
        throw new Error(`createDraggableBSplineSurface: controlPoints must have length dimU*dimV = ${numPoints}`);
    }
    const initialPoints = controlPoints.map(p => p instanceof THREE.Vector3 ? p.clone() : new THREE.Vector3(p.x, p.y, p.z));

    const group = new THREE.Group();
    group.userData.bspline = {
        controlPoints: [],
        hull: null,
        surfaceMesh: null,
        wireframe: null,
        dimU,
        dimV,
        degree,
        clamped,
        segments,
        update: null
    };

    // 1. Draggable control point spheres
    const sphereGeo = new THREE.SphereGeometry(controlPointSize, 16, 16);
    const sphereMat = new THREE.MeshBasicMaterial({ color: 0xcccccc });
    for (let idx = 0; idx < numPoints; idx++) {
        const sphere = new THREE.Mesh(sphereGeo, sphereMat);
        sphere.position.copy(initialPoints[idx]);
        sphere.visible = showControlPoints;
        group.userData.bspline.controlPoints.push(sphere);
        group.add(sphere);
    }

    // 2. Hull (updated each frame)
    const cageGeo = new THREE.BufferGeometry();
    const cageLine = new THREE.LineSegments(cageGeo, new THREE.LineBasicMaterial({ color: 0x555555 }));
    cageLine.visible = showHull;
    group.userData.bspline.hull = cageLine;
    group.add(cageLine);

    // 3. Surface mesh (updated each frame)
    const geo = new THREE.PlaneGeometry(1, 1, segments, segments);
    const mat = customMaterial ?? new THREE.MeshPhongMaterial({ color, side, shininess: 80 });
    const mesh = new THREE.Mesh(geo, mat);
    group.userData.bspline.surfaceMesh = mesh;
    group.add(mesh);

    // 4. Wireframe overlay
    const wireMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        wireframe: true,
        transparent: true,
        opacity: 0.2,
        polygonOffset: true,
        polygonOffsetFactor: -1
    });
    const wireMesh = new THREE.Mesh(geo, wireMat);
    wireMesh.visible = showWireframe;
    group.userData.bspline.wireframe = wireMesh;
    group.add(wireMesh);

    group.userData.bspline.update = function () {
        const spheres = group.userData.bspline.controlPoints;
        const dimU_ = group.userData.bspline.dimU;
        const dimV_ = group.userData.bspline.dimV;
        const degree_ = group.userData.bspline.degree;
        const clamped_ = group.userData.bspline.clamped;

        const pU = Math.max(1, Math.min(degree_, dimU_ - 1));
        const pV = Math.max(1, Math.min(degree_, dimV_ - 1));
        const knotsU = generateKnots(pU, dimU_, clamped_);
        const knotsV = generateKnots(pV, dimV_, clamped_);
        const startU = knotsU[pU];
        const endU = knotsU[knotsU.length - 1 - pU];
        const startV = knotsV[pV];
        const endV = knotsV[knotsV.length - 1 - pV];

        // Update hull
        if (cageLine.visible) {
            const hullPoints = buildHullPoints(spheres, dimU_, dimV_);
            cageGeo.setFromPoints(hullPoints);
        }

        // Update surface vertices
        const positions = geo.attributes.position;
        const uvAttr = geo.attributes.uv;
        for (let k = 0; k < positions.count; k++) {
            const uRaw = uvAttr.getX(k);
            const vRaw = uvAttr.getY(k);
            const u = startU + uRaw * (endU - startU);
            const v = startV + vRaw * (endV - startV);
            const pt = evalSurface(u, v, pU, pV, spheres, dimU_, dimV_, knotsU, knotsV);
            positions.setXYZ(k, pt.x, pt.y, pt.z);
        }
        positions.needsUpdate = true;
        geo.computeVertexNormals();
    };

    group.userData.bspline.update();
    return group;
}
