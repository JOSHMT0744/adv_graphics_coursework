import * as THREE from "three";

const textureLoader = new THREE.TextureLoader();

/**
 * Create a procedural cube env map for window reflections (no CubeCamera / extra renders).
 * Night-themed but with enough contrast and brightness so reflections are visible on windows.
 * @returns {THREE.CubeTexture}
 */
export function createDefaultEnvMap() {
    const size = 32;
    const hexToStyle = (h) => '#' + h.toString(16).padStart(6, '0');
    const canvases = [];
    // +X, -X: mid grey so reflection is visible
    for (let i = 0; i < 2; i++) {
        const c = document.createElement('canvas');
        c.width = size; c.height = size;
        const ctx = c.getContext('2d');
        ctx.fillStyle = hexToStyle(0x404055);
        ctx.fillRect(0, 0, size, size);
        canvases.push(c);
    }
    // +Y (sky): blue/purple gradient, brighter so sky reflection reads
    (function () {
        const c = document.createElement('canvas');
        c.width = size; c.height = size;
        const ctx = c.getContext('2d');
        const g = ctx.createLinearGradient(0, size, 0, 0);
        g.addColorStop(0, hexToStyle(0x252538));
        g.addColorStop(0.5, hexToStyle(0x35355a));
        g.addColorStop(1, hexToStyle(0x404070));
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, size, size);
        canvases.push(c);
    })();
    // -Y (ground): darker grey-blue
    (function () {
        const c = document.createElement('canvas');
        c.width = size; c.height = size;
        const ctx = c.getContext('2d');
        ctx.fillStyle = hexToStyle(0x2a2e38);
        ctx.fillRect(0, 0, size, size);
        canvases.push(c);
    })();
    // +Z, -Z: mid grey
    for (let i = 0; i < 2; i++) {
        const c = document.createElement('canvas');
        c.width = size; c.height = size;
        const ctx = c.getContext('2d');
        ctx.fillStyle = hexToStyle(0x404055);
        ctx.fillRect(0, 0, size, size);
        canvases.push(c);
    }
    const cube = new THREE.CubeTexture(canvases);
    cube.mapping = THREE.CubeReflectionMapping;
    return cube;
}

/** Glass material with transmission so interior lights pass through. envMap required for reflections. */
function createGlassWindowMat(envMap) {
    return new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        transmission: 1,
        opacity: 1,
        metalness: 0,
        roughness: 0,
        ior: 1.5,
        thickness: 0.1,
        envMap: envMap,
    });
}

let _defaultWindowMat = null;
function getDefaultWindowMat() {
    if (!_defaultWindowMat) {
        _defaultWindowMat = createGlassWindowMat(createDefaultEnvMap());
    }
    return _defaultWindowMat;
}

/**
 * Planar reflection shader: samples texture with UV from reflection camera projection.
 * textureMatrix = (0.5 scale/offset) * reflectionCamera.projectionMatrix * reflectionCamera.matrixWorldInverse.
 * Vertex: vUv = textureMatrix * modelMatrix * vec4(position, 1).
 */
const PLANAR_REFLECTION_VERTEX = `
    uniform mat4 textureMatrix;
    varying vec4 vUv;
    void main() {
        vUv = textureMatrix * modelMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;
const PLANAR_REFLECTION_FRAGMENT = `
    uniform vec3 color;
    uniform sampler2D tDiffuse;
    varying vec4 vUv;
    void main() {
        vec4 base = texture2DProj(tDiffuse, vUv);
        gl_FragColor = vec4(mix(base.rgb, color, 0.15), 1.0);
    }
`;

/**
 * Create a material for planar reflection (one per face). Caller must set material.uniforms.textureMatrix
 * each frame from the reflection camera's projectionMatrix * matrixWorldInverse (with 0.5 scale/offset).
 * @param {THREE.Texture} texture - reflection render target texture
 * @param {string} face - 'front'|'back' (stored in userData for app.js to update matrix)
 * @returns {THREE.ShaderMaterial}
 */
function createPlanarReflectionMaterial(texture, face) {
    const mat = new THREE.ShaderMaterial({
        uniforms: {
            tDiffuse: { value: texture },
            textureMatrix: { value: new THREE.Matrix4() },
            color: { value: new THREE.Color(0x444860) }
        },
        vertexShader: PLANAR_REFLECTION_VERTEX,
        fragmentShader: PLANAR_REFLECTION_FRAGMENT,
        side: THREE.DoubleSide
    });
    mat.userData.planarReflectionFace = face;
    return mat;
}
const concreteTexture = textureLoader.load('textures/concrete_ground_01_2k/concrete_ground_01_color_2k.png',
    function (texture) {
        texture.minFilter = THREE.LinearMipmapLinearFilter; // enable mipmapping
        texture.magFilter = THREE.LinearFilter; // enable linear filtering
    },
    undefined,
    function(err) {
        console.error("Error loading concrete texture: ", err);
    }
);

// Materials: flat grey concrete, reflective windows (transmission glass), dark railing
const concreteMat = new THREE.MeshStandardMaterial({ map: concreteTexture });
const railingMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a });

const RECESS = 0.03;
const WINDOW_FACE_OFFSET = 0.002;
const _windowDummy = new THREE.Object3D();

let _sharedWindowPlaneGeometry = null;
/** Single shared geometry for all window instances (unit plane; scale is in instance matrix). */
function getSharedWindowPlaneGeometry() {
    if (!_sharedWindowPlaneGeometry) _sharedWindowPlaneGeometry = new THREE.PlaneGeometry(0.6, 1);
    return _sharedWindowPlaneGeometry;
}

/**
 * Add a grid of window planes on one face of a block as one InstancedMesh.
 * Uses shared unit-plane geometry; per-window size and position are in the instance matrix.
 * @param {THREE.Group} parentGroup - Block group to add windows to.
 * @param {string} face - 'front'|'back'
 * @param {number} blockW - block width (X)
 * @param {number} blockH - block height (Y)
 * @param {number} blockD - block depth (Z)
 * @param {number} countX - number of windows in the face's horizontal direction
 * @param {number} countY - number of windows in the face's vertical direction
 * @param {number} recess - reserved (unused; kept for API compatibility)
 * @param {THREE.Material} windowMaterial - material for windows (transmission glass with envMap)
 */
function addWindowGrid(parentGroup, face, blockW, blockH, blockD, countX, countY, recess = RECESS, windowMaterial) {
    let sizeW, sizeH, centre, normal, rotY;
    const w2 = blockW / 2, h2 = blockH / 2, d2 = blockD / 2;

    switch (face) {
        case 'front':
            sizeW = blockW; sizeH = blockH; centre = new THREE.Vector3(0, 0, -d2); normal = new THREE.Vector3(0, 0, -1); rotY = Math.PI; break;
        case 'back':
            sizeW = blockW; sizeH = blockH; centre = new THREE.Vector3(0, 0, d2);  normal = new THREE.Vector3(0, 0, 1);  rotY = 0; break;
        default: return;
    }

    const stepX = sizeW / (countX + 1), stepY = sizeH / (countY + 1);
    const winW = Math.max(0.08, stepX * 0.85), winH = Math.max(0.15, stepY * 0.85);
    const count = countX * countY;
    const geo = getSharedWindowPlaneGeometry();
    const instanced = new THREE.InstancedMesh(geo, windowMaterial, count);
    instanced.renderOrder = 1;
    instanced.layers.set(1);

    let idx = 0;
    for (let i = 0; i < countX; i++) {
        for (let j = 0; j < countY; j++) {
            const u = (i + 1) * stepX - sizeW / 2, v = (j + 1) * stepY - sizeH / 2;
            const pos = new THREE.Vector3(centre.x, centre.y, centre.z);
            if (face === 'front' || face === 'back') { pos.x += u; pos.y += v; }
            else { pos.z += u; pos.y += v; }
            pos.add(normal.clone().multiplyScalar(WINDOW_FACE_OFFSET));

            _windowDummy.position.copy(pos);
            _windowDummy.quaternion.setFromEuler(new THREE.Euler(0, rotY, 0, 'XYZ'));
            _windowDummy.scale.set(winW, winH, 1);
            _windowDummy.updateMatrix();
            instanced.setMatrixAt(idx++, _windowDummy.matrix);
        }
    }
    instanced.instanceMatrix.needsUpdate = true;
    parentGroup.add(instanced);
}

/**
 * Create a block (box) with window grids on front and back faces only.
 * @param {number} w - width (X)
 * @param {number} h - height (Y)
 * @param {number} d - depth (Z)
 * @param {Object} windowCounts - { front:[cx,cy], back:[cx,cy] }
 * @param {THREE.Material|{front,back}} [windowMaterial] - material for front, or object with front/back materials
 * @param {THREE.Material} [windowMaterialBack] - material for back when using two materials (ignored if windowMaterial is object)
 * @returns {THREE.Group}
 */
function createBlock(w, h, d, windowCounts = {}, windowMaterial = getDefaultWindowMat(), windowMaterialBack) {
    const perFace = windowMaterial && typeof windowMaterial === 'object' && windowMaterial.front != null;
    const wFront = perFace ? windowMaterial.front : windowMaterial;
    const wBack = perFace ? windowMaterial.back : (windowMaterialBack != null ? windowMaterialBack : windowMaterial);
    const g = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), concreteMat);
    g.add(box);
    const minWindows = [2, 1];
    addWindowGrid(g, 'front', w, h, d, (windowCounts.front || minWindows)[0], (windowCounts.front || minWindows)[1], RECESS, wFront);
    addWindowGrid(g, 'back',  w, h, d, (windowCounts.back || minWindows)[0],  (windowCounts.back || minWindows)[1],  RECESS, wBack);
    return g;
}

/**
 * Create a slanted roof slab for a block as a triangular prism/wedge.
 * The highest edge is at the back (+Z), lowest at the front (-Z), so it slopes toward -Z.
 * @param {number} w - width (X size)
 * @param {number} d - depth (Z size)
 * @param {number} slantAngle - rotation around X (rad), slope down toward -Z
 * @param {number} blockTop - y of the top of the block (at z = +d/2)
 * @returns {THREE.Mesh}
 */
function createSlantedRoof(w, d, slantAngle, blockTop) {
    const thickness = 0.15;
    const overhang = 0.2;

    // Calculate vertical drop from back (+Z) to front (-Z)
    const dz = d + overhang;
    const slopeY = Math.tan(slantAngle) * dz;

    // Four bottom vertices (clockwise looking down -Y)
    // (-w/2, y, -d/2), (w/2, y, -d/2), (w/2, y, d/2), (-w/2, y, d/2)
    // Four top vertices (at thickness above, but top also slanted in Y)
    const w2 = (w + overhang) / 2;
    const d2 = (d + overhang) / 2;

    // The roof slab is thicker perpendicular to the slant, not vertical.
    // We build the bottom face at y = 0 and the back-top at y = slopeY + thickness.
    // So, for each (x,z): at z = -d/2 (front) => y = 0 or y = thickness
    //                     at z = +d/2 (back)  => y = slopeY or y = slopeY + thickness

    // Vertex positions: [x, y, z]
    const vertices = [
        // Bottom face (y = 0 at front, y = slopeY at back)
        -w2, 0,    -d2,  // 0: left-front-bottom
         w2, 0,    -d2,  // 1: right-front-bottom
         w2, slopeY, d2, // 2: right-back-bottom
        -w2, slopeY, d2, // 3: left-back-bottom

        // Top face offset by thickness perpendicular to slant
        -w2, thickness,    -d2,            // 4: left-front-top
         w2, thickness,    -d2,            // 5: right-front-top
         w2, slopeY + thickness, d2,       // 6: right-back-top
        -w2, slopeY + thickness, d2,       // 7: left-back-top
    ];

    // Faces (two triangles per quad, indices CCW)
    const indices = [
        // Bottom face
        0, 1, 2, 0, 2, 3,
        // Top face
        4, 7, 6, 4, 6, 5,
        // Side faces
        0, 4, 5, 0, 5, 1,     // front
        1, 5, 6, 1, 6, 2,     // right
        2, 6, 7, 2, 7, 3,     // back (slope)
        3, 7, 4, 3, 4, 0      // left
    ];

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(vertices, 3)
    );
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    // By default, bottom-front is at y=0, top-back at slopeY+thickness
    // We want the *highest* edge (back, z=+d/2) to be at y = blockTop + thickness/2
    // and the lowest edge (front, z=-d/2) to be at y = blockTop + thickness/2 - slopeY
    // To center the prism vertically atop the block, find the average y at the top surface,
    // but simplest: shift all y by (blockTop + slopeY/2 + thickness/2)
    // so the *center* is at blockTop + (slopeY/2) + (thickness/2)

    // (Or: you can just set bottom-front at blockTop, but below is smoother.)
    const yOffset = blockTop - (slopeY / 2);
    geometry.translate(0, yOffset, 0);

    const roof = new THREE.Mesh(geometry, concreteMat);
    return roof;
}

/**
 * Create the Durham Student Union (Dunelm House) as a THREE.Group.
 * @param {number} x - world X position
 * @param {number} z - world Z position
 * @param {number} scale - uniform scale (default 1)
 * @param {Object} [options] - { envMap?, envMapFront?, envMapBack? } or { planarReflections: { front: { renderTarget, camera }, back } }
 * @returns {THREE.Group}
 */
export function createDunelmHouse(x = 0, z = 0, scale = 1, options = {}) {
    const dunelm = new THREE.Group();
    const mat = (env) => new THREE.MeshStandardMaterial({ color: 0x383a48, metalness: 0.95, roughness: 0.04, envMap: env, envMapIntensity: 2.2, transparent: true, opacity: 0.88 });
    let windowMaterials;
    let wmat, wmatBack;

    if (options.planarReflections != null) {
        const pr = options.planarReflections;
        windowMaterials = {
            front: createPlanarReflectionMaterial(pr.front.renderTarget.texture, 'front'),
            back:  createPlanarReflectionMaterial(pr.back.renderTarget.texture,  'back'),
        };
    } else if (options.envMapFront != null && options.envMapBack != null) {
        wmat = mat(options.envMapFront);
        wmatBack = mat(options.envMapBack);
    } else if (options.envMap != null) {
        wmat = mat(options.envMap);
        wmatBack = null;
    } else {
        wmat = getDefaultWindowMat();
        wmatBack = null;
    }

    const blockMat = windowMaterials != null ? windowMaterials : wmat;
    const blockMatBack = windowMaterials != null ? null : wmatBack;

    // blockLeft: tall tower (2.5, 6, 2.5) at (-3.5, 3, 2)
    const blockLeft = createBlock(2.5, 6, 2.5, { front: [2, 3], back: [2, 3] }, blockMat, blockMatBack);
    blockLeft.position.set(-3.5, 3, 2);
    const fl = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.5, 0.02), concreteMat);
    fl.position.set(0, 0, -2.5 / 2 - 0.02);
    blockLeft.add(fl);

    // Door on left (-X) face of tall block: openable group (panel + cube handle) and black entry plane
    const doorHeight = 1.2;
    const doorWidth = 0.6;
    const doorThickness = 0.04;
    const doorCenterY = -3 + doorHeight / 2; // -2.4
    const hingeX = -2.5 / 2 - 0.02; // -1.25 - 0.02
    const doorCenterZ = 0;          // centered on left face (Z from -1.25 to 1.25)
    // Hinge at back edge of door so panel extends from doorCenterZ - doorWidth/2 to doorCenterZ + doorWidth/2
    const hingeZ = doorCenterZ + doorWidth / 2; // 0.3 (back edge of centered door)
    const doorGroup = new THREE.Group();
    doorGroup.position.set(hingeX, doorCenterY, hingeZ);
    const doorMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.6, metalness: 0.1 });
    const doorPanel = new THREE.Mesh(
        new THREE.BoxGeometry(doorThickness, doorHeight, doorWidth),
        doorMat
    );
    doorPanel.position.set(doorThickness / 2, 0, -doorWidth / 2); // hinge at group origin (front-left)
    doorGroup.add(doorPanel);
    const handleSize = 0.04;
    const doorHandle = new THREE.Mesh(
        new THREE.BoxGeometry(handleSize, handleSize, handleSize),
        railingMat
    );
    doorHandle.position.set(-doorThickness / 2 - handleSize / 2, 0, -doorWidth / 2 - 0.05); // on -X face, near free edge
    doorGroup.add(doorHandle);
    doorGroup.userData.isOpen = false;
    doorGroup.userData.open = function (angle) {
        doorGroup.rotation.y = angle;
        doorGroup.userData.isOpen = angle !== 0;
    };
    blockLeft.add(doorGroup);
    dunelm.userData.doorGroup = doorGroup;
    dunelm.userData.doorExitDirection = new THREE.Vector3(-1, 0, 0); // outward from door (-X face)

    const entryPlane = new THREE.Mesh(
        new THREE.PlaneGeometry(doorWidth, doorHeight),
        new THREE.MeshBasicMaterial({ color: 0x000000 })
    );
    entryPlane.position.set(-2.5 / 2 + 0.01, doorCenterY, doorCenterZ); // slightly inside opening, centered on left face
    entryPlane.rotation.y = -Math.PI / 2; // normal +X (facing out)
    blockLeft.add(entryPlane);

    dunelm.add(blockLeft);

    // blockMain: (5, 4, 4) at (-0.5, 2, 0)
    const blockMain = createBlock(5, 4, 4, { front: [3, 3], back: [3, 3] }, blockMat, blockMatBack);
    blockMain.position.set(-0.5, 2, 0);
    [-0.5, 0.5].forEach((ox) => {
        const f = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.2, 0.02), concreteMat);
        f.position.set(ox, 0, -4 / 2 - 0.02);
        blockMain.add(f);
    });
    dunelm.add(blockMain);

    // blockCantilever: (4, 2.5, 3) at (0, 0.8, -2), slanted roof
    const blockCantilever = createBlock(4, 2.5, 3, { front: [3, 1], back: [0, 0]}, blockMat, blockMatBack);
    blockCantilever.position.set(0, 0.8, -2);
    const cantileverRoof = createSlantedRoof(4, 3, 0.25, 2.5 / 2);
    blockCantilever.add(cantileverRoof);
    dunelm.add(blockCantilever);

    // blockRight: (3, 3.5, 3) at (3.5, 1.5, -0.5)
    const blockRight = createBlock(3, 3.5, 3, { front: [2, 3], back: [2, 2] }, blockMat, blockMatBack);
    blockRight.position.set(3.5, 1.5, -0.5);
    dunelm.add(blockRight);

    // chimney on top of blockMain: top at y=4, centre at 4+0.6=4.6
    const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.25, 1.2, 0.25), concreteMat);
    chimney.position.set(0, 4.6, 0.2);
    dunelm.add(chimney);

    // --- Terrace: floor, 3 planters, railing ---
    const terrace = new THREE.Group();
    const floor = new THREE.Mesh(new THREE.BoxGeometry(4, 0.1, 3), concreteMat);
    floor.position.set(0, 0.5, -2.5);
    terrace.add(floor);
    for (let i = -1; i <= 1; i++) {
        const p = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.5, 8), concreteMat);
        p.position.set(i * 1, 0.75, -3.5);
        terrace.add(p);
    }
    for (let i = 0; i < 5; i++) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.5, 0.04), railingMat);
        post.position.set(-2 + i * 1, 0.75, -3.5);
        terrace.add(post);
    }
    const bar = new THREE.Mesh(new THREE.BoxGeometry(4, 0.04, 0.04), railingMat);
    bar.position.set(0, 0.99, -3.5);
    terrace.add(bar);
    dunelm.add(terrace);

    // Two point lights inside the SU so transmission glass shows light through the windows
    const interiorLight = new THREE.PointLight(0xffeedd, 1.2, 8, 2);
    interiorLight.position.set(-0.5, 2, 0);
    dunelm.add(interiorLight);
    const towerLight = new THREE.PointLight(0xffddbb, 0.6, 6, 2);
    towerLight.position.set(-3.5, 2.5, 2);
    dunelm.add(towerLight);

    dunelm.position.set(x, 0, z);
    dunelm.scale.setScalar(scale);
    dunelm.userData.radius = 3 * scale;
    return dunelm;
}
