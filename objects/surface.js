import * as THREE from "three";

// -----------------------------------------------------------------------------
// Bezier surface: Bernstein basis + tensor-product evaluation (4×4 patch)
// -----------------------------------------------------------------------------

const BEZIER_PATCH_SIZE = 4;

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
export function evalBezierSurface(u, v, controlPoints) {
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
 * @param {boolean} [options.showHull=false] - show control polygon grid (cage) connecting control points
 * @param {boolean} [options.showControlPoints=false] - show spheres at each control point
 * @param {number} [options.controlPointSize=0.08] - radius of control point spheres (when showControlPoints)
 * @param {boolean} [options.wireframe=false] - wireframe overlay on the surface
 * @param {THREE.Material} [options.material]
 * @param {THREE.Side} [options.side=THREE.DoubleSide]
 * @returns {THREE.Group}
 */
export function createBezierSurface(controlPoints, options = {}) {
    const {
        segments = 50,
        color = 0x3498db,
        showHull = false,
        showControlPoints = false,
        controlPointSize = 1,
        wireframe: showWireframe = false,
        material: customMaterial,
        side = THREE.DoubleSide
    } = options;

    // Normalize control points to 16-element array
    const points = normalizeControlPoints(controlPoints);

    const group = new THREE.Group();
    group.userData.bezier = { hull: null, controlPoints: [], wireframe: null };

    // 1. Control point spheres (like lecture demo) – always created, visibility from option
    const sphereGeo = new THREE.SphereGeometry(controlPointSize, 16, 16);
    const sphereMat = new THREE.MeshBasicMaterial({ color: 0xcccccc });
    for (let idx = 0; idx < points.length; idx++) {
        const sphere = new THREE.Mesh(sphereGeo, sphereMat);
        sphere.position.copy(points[idx]);
        sphere.visible = showControlPoints;
        group.userData.bezier.controlPoints.push(sphere);
        group.add(sphere);
    }

    // 2. Hull grid (cage) – LineSegments connecting control points (like lecture demo)
    const cagePoints = [];
    for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 3; j++) {
            cagePoints.push(points[i * 4 + j], points[i * 4 + j + 1]);
        }
    }
    for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 4; j++) {
            cagePoints.push(points[i * 4 + j], points[(i + 1) * 4 + j]);
        }
    }
    const cageGeo = new THREE.BufferGeometry().setFromPoints(cagePoints);
    const cageLine = new THREE.LineSegments(cageGeo, new THREE.LineBasicMaterial({ color: 0x555555 }));
    cageLine.visible = showHull;
    group.userData.bezier.hull = cageLine;
    group.add(cageLine);

    // 3. Solid surface
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

    // 4. Wireframe overlay (like lecture demo: on top of mesh via polygonOffset)
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
    group.userData.bezier.wireframe = wireMesh;
    group.add(wireMesh);

    return group;
}

/**
 * Create a draggable Bezier surface with control points that can be moved interactively.
 * Like the lecture demo - sphere positions are read each frame and the surface updates.
 * @param {THREE.Vector3[]|THREE.Vector3[][]} controlPoints - 16 Vector3s (flat) or 4×4 grid
 * @param {Object} [options]
 * @param {number} [options.segments=20]
 * @param {number} [options.color=0x3498db]
 * @param {boolean} [options.showHull=true]
 * @param {boolean} [options.showControlPoints=true]
 * @param {number} [options.controlPointSize=0.15] - radius of draggable control point spheres
 * @param {boolean} [options.wireframe=false]
 * @param {THREE.Material} [options.material]
 * @param {THREE.Side} [options.side=THREE.DoubleSide]
 * @returns {THREE.Group} - Group with userData.bezier containing controlPoints (sphere meshes), hull, surfaceMesh, wireframe, and update()
 */
export function createDraggableBezierSurface(controlPoints, options = {}) {
    const {
        segments = 20,
        color = 0x3498db,
        showHull = true,
        showControlPoints = true,
        controlPointSize = 0.15,
        wireframe: showWireframe = false,
        material: customMaterial,
        side = THREE.DoubleSide
    } = options;

    // Normalize initial control points to 16-element array
    const initialPoints = normalizeControlPoints(controlPoints);

    const group = new THREE.Group();
    group.userData.bezier = {
        controlPoints: [],
        hull: null,
        surfaceMesh: null,
        wireframe: null,
        update: null
    };

    // 1. Create draggable control point sphere meshes (like lecture demo)
    const sphereGeo = new THREE.SphereGeometry(controlPointSize, 16, 16);
    const sphereMat = new THREE.MeshBasicMaterial({ color: 0xcccccc });
    for (let idx = 0; idx < 16; idx++) {
        const sphere = new THREE.Mesh(sphereGeo, sphereMat);
        sphere.position.copy(initialPoints[idx]);
        sphere.visible = showControlPoints;
        group.userData.bezier.controlPoints.push(sphere);
        group.add(sphere);
    }

    // 2. Create hull (cage) - will be updated each frame
    const cageGeo = new THREE.BufferGeometry();
    const cageLine = new THREE.LineSegments(cageGeo, new THREE.LineBasicMaterial({ color: 0x555555 }));
    cageLine.visible = showHull;
    group.userData.bezier.hull = cageLine;
    group.add(cageLine);

    // 3. Create surface mesh - will be updated each frame
    const geo = new THREE.PlaneGeometry(1, 1, segments, segments);
    const mat = customMaterial ?? new THREE.MeshPhongMaterial({
        color,
        side,
        shininess: 80
    });
    const mesh = new THREE.Mesh(geo, mat);
    group.userData.bezier.surfaceMesh = mesh;
    group.add(mesh);

    // 4. Create wireframe overlay
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
    group.userData.bezier.wireframe = wireMesh;
    group.add(wireMesh);

    // 5. Define update function that reads current sphere positions and updates geometry
    group.userData.bezier.update = function() {
        const spheres = group.userData.bezier.controlPoints;
        
        // Update hull geometry from current sphere positions
        if (showHull && cageLine.visible) {
            const cagePoints = [];
            // Horizontal connections
            for (let i = 0; i < 4; i++) {
                for (let j = 0; j < 3; j++) {
                    cagePoints.push(spheres[i * 4 + j].position, spheres[i * 4 + j + 1].position);
                }
            }
            // Vertical connections
            for (let i = 0; i < 3; i++) {
                for (let j = 0; j < 4; j++) {
                    cagePoints.push(spheres[i * 4 + j].position, spheres[(i + 1) * 4 + j].position);
                }
            }
            cageGeo.setFromPoints(cagePoints);
        }

        // Update surface mesh vertices from current sphere positions
        const positions = geo.attributes.position;
        const uvAttr = geo.attributes.uv;
        
        for (let k = 0; k < positions.count; k++) {
            const u = uvAttr.getX(k);
            const v = uvAttr.getY(k);
            const vec = evalBezierSurface(u, v, spheres);
            positions.setXYZ(k, vec.x, vec.y, vec.z);
        }
        
        positions.needsUpdate = true;
        geo.computeVertexNormals();
    };

    // Initial update to set up geometry
    group.userData.bezier.update();

    return group;
}
