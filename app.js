import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { DragControls } from "three/examples/jsm/controls/DragControls.js";
import { createOakTree } from './objects/oakTree.js';
import { COLORS } from './constants.js';
import { Figure } from './objects/character.js';
import { GUI } from 'dat.gui';
import { createDunelmHouse } from './objects/su.js';
import { createKingsgateBridge } from './objects/bridge.js';
import { createStaircase } from './objects/staircase.js';
import { createConnectionSurface } from './objects/connectionSurface.js';
import { createNightSky } from './objects/skyDome.js';
import { SpatialGrid } from './utils/SpatialGrid.js';
import Stats from 'three/examples/jsm/libs/stats.module'
import { generateTerrain } from './objects/landscape/farHill.js';
import { createBezierSurface, createDraggableBezierSurface } from './objects/surface.js';

// Scene setup
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true});

// Set the size of the renderer (cap pixel ratio to reduce GPU memory and context loss risk)
const pixelRatio = Math.min(window.devicePixelRatio, 2);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(pixelRatio);
document.body.appendChild(renderer.domElement);

// Handle WebGL context loss
let webglContextLost = false;
renderer.domElement.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    webglContextLost = true;
    console.warn('WebGL context lost. Rendering paused. Refresh the page to restore.');
}, false);
renderer.domElement.addEventListener('webglcontextrestored', () => {
    webglContextLost = false;
    console.info('WebGL context restored. You may need to refresh to ensure everything works.');
}, false);

// Initialise OrbitControls
const orbitControls = new OrbitControls(camera, renderer.domElement);
orbitControls.enableDamping = true;
orbitControls.dampingFactor = 0.05;

const controls = {
    moveSpeed: 1,
    direction: { left: false, right: false, forward: false, backward: false },
    wireframe: false
};

window.addEventListener('keydown', (e) => {
    switch (e.key) {
        case 'ArrowLeft': controls.direction.left = true; break;
        case 'ArrowRight': controls.direction.right = true; break;
        case 'ArrowUp': controls.direction.forward = true; break;
        case 'ArrowDown': controls.direction.backward = true; break;
        case 'w': // Toggle wireframe
        controls.wireframe = !controls.wireframe;
        peopleElements.forEach(meshObj => {
            if (meshObj.material) {
                meshObj.material.wireframe = controls.wireframe;
            }
        });
        break;
    }
});

window.addEventListener('keyup', (e) => {
    switch (e.key) {
        case "ArrowLeft": controls.direction.left = false; break;
        case "ArrowRight": controls.direction.right = false; break;
        case "ArrowUp": controls.direction.forward = false; break;
        case "ArrowDown": controls.direction.backward = false; break;
    }
});

window.addEventListener('resize', onWindowResize, false)
function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
}

function updateCamera() {
    if (controls.direction.left) camera.position.x -= controls.moveSpeed;
    if (controls.direction.right) camera.position.x += controls.moveSpeed;
    if (controls.direction.forward) camera.position.z -= controls.moveSpeed;
    if (controls.direction.backward) camera.position.z += controls.moveSpeed;
    orbitControls.update();
}

const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(500, 500),
    new THREE.MeshStandardMaterial({ color: COLORS.WATER, side: THREE.DoubleSide })
);
plane.rotation.x = -Math.PI / 2;
plane.position.y = -44;
scene.add(plane);

// Night sky dome (Preetham Sky, sun below horizon)
scene.background = new THREE.Color(0x0a0a18);
const skyParams = { turbidity: 0.8, rayleigh: 0.4, mieCoefficient: 0.001, sunPositionY: -400000, scale: 10000 };
let nightSky = createNightSky(skyParams);
scene.add(nightSky);

function applySkyParams() {
    if (!nightSky) return;
    const u = nightSky.material.uniforms;
    u.turbidity.value = skyParams.turbidity;
    u.rayleigh.value = skyParams.rayleigh;
    u.mieCoefficient.value = skyParams.mieCoefficient;
    u.sunPosition.value.set(100, skyParams.sunPositionY, -100);
    nightSky.scale.setScalar(skyParams.scale);
}

const farHill = generateTerrain(200, 50, 64, { endHeight: 55 });
farHill.position.set(0, -55, -120);
farHill.rotateZ(Math.PI);
scene.add(farHill);

// Road surface: control points captured from draggable Bezier editor (logs/bezier.txt)
// Grid layout: index = i * 4 + j, where i = row (0-3), j = column (0-3)
// j=0 is nearest to camera, j=3 is furthest from camera
const roadControlPoints = [
    // Row 0 (i=0)
    new THREE.Vector3(-70.25, 10.19, -7.58),  // P0 (0,0)
    new THREE.Vector3(-69.15, 9.55, -3.89),   // P1 (0,1)
    new THREE.Vector3(-67.93, 8.91, 0.85),    // P2 (0,2)
    new THREE.Vector3(-67.21, 9.66, 5.03),    // P3 (0,3)
    // Row 1 (i=1)
    new THREE.Vector3(-22.31, -1.41, -4.58),  // P4 (1,0)
    new THREE.Vector3(-0.81, -4.52, -1.88),   // P5 (1,1)
    new THREE.Vector3(-4.22, -4.84, 6.29),    // P6 (1,2)
    new THREE.Vector3(-25.84, -2.19, 8.8),    // P7 (1,3)
    // Row 2 (i=2)
    new THREE.Vector3(58.77, -17.89, -1.82),  // P8 (2,0)
    new THREE.Vector3(29.99, -10.68, -0.14),  // P9 (2,1)
    new THREE.Vector3(11.29, -10.27, 8.76),   // P10 (2,2)
    new THREE.Vector3(39.73, -11.16, 9.36),   // P11 (2,3)
    // Row 3 (i=3)
    new THREE.Vector3(86.5, -21.88, -3.53),   // P12 (3,0)
    new THREE.Vector3(85.83, -22.02, 1.06),   // P13 (3,1)
    new THREE.Vector3(85.59, -21.02, 5.89),   // P14 (3,2)
    new THREE.Vector3(86.45, -21.02, 10.31)   // P15 (3,3)
];

const roadSurface = createBezierSurface(roadControlPoints, {
    segments: 20,
    showHull: false,
    showControlPoints: false,
    wireframe: false,
    color: 0x333333 // dark grey for asphalt
});
scene.add(roadSurface);

// Far Pavement: shares road's j=3 edge as its j=0 edge, extends in positive z
// j=0 column matches road's j=3 exactly (no height change for seamless connection)
// j=1, j=2, j=3 raised by 0.4 units (curb effect), width reduced to 1/3 (~3 units)
const farPavementControlPoints = [
    // Row 0 (i=0): j=0 = Road P3, then curb height (+0.4y) and narrower width (+1z per column)
    new THREE.Vector3(-67.21, 9.66, 5.03),    // P0 (0,0) = Road P3 (exact match)
    new THREE.Vector3(-67.21, 10.06, 6.03),   // P1 (0,1) +0.4y, +1z
    new THREE.Vector3(-67.21, 10.06, 7.03),   // P2 (0,2) +0.4y, +2z
    new THREE.Vector3(-67.21, 10.06, 8.03),   // P3 (0,3) +0.4y, +3z
    // Row 1 (i=1): j=0 = Road P7
    new THREE.Vector3(-25.84, -2.19, 8.8),    // P4 (1,0) = Road P7 (exact match)
    new THREE.Vector3(-25.84, -1.79, 9.8),    // P5 (1,1) +0.4y, +1z
    new THREE.Vector3(-25.84, -1.79, 10.8),   // P6 (1,2) +0.4y, +2z
    new THREE.Vector3(-25.84, -1.79, 11.8),   // P7 (1,3) +0.4y, +3z
    // Row 2 (i=2): j=0 = Road P11
    new THREE.Vector3(39.73, -11.16, 9.36),   // P8 (2,0) = Road P11 (exact match)
    new THREE.Vector3(39.73, -10.76, 10.36),  // P9 (2,1) +0.4y, +1z
    new THREE.Vector3(39.73, -10.76, 11.36),  // P10 (2,2) +0.4y, +2z
    new THREE.Vector3(39.73, -10.76, 12.36),  // P11 (2,3) +0.4y, +3z
    // Row 3 (i=3): j=0 = Road P15
    new THREE.Vector3(86.45, -21.02, 10.31),  // P12 (3,0) = Road P15 (exact match)
    new THREE.Vector3(86.45, -20.62, 11.31),  // P13 (3,1) +0.4y, +1z
    new THREE.Vector3(86.45, -20.62, 12.31),  // P14 (3,2) +0.4y, +2z
    new THREE.Vector3(86.45, -20.62, 13.31)   // P15 (3,3) +0.4y, +3z
];

const farPavementSurface = createBezierSurface(farPavementControlPoints, {
    segments: 20,
    showHull: false,
    showControlPoints: false,
    wireframe: false,
    color: 0x888888 // lighter grey for pavement
});
scene.add(farPavementSurface);

// Near Pavement: shares road's j=0 edge as its j=3 edge, extends in negative z (towards camera)
// j=3 column matches road's j=0 exactly (no height change for seamless connection)
// j=0, j=1, j=2 raised by 0.4 units (curb effect), width ~3 units
const nearPavementControlPoints = [
    // Row 0 (i=0): j=3 = Road P0, curb extends towards camera (-z)
    new THREE.Vector3(-70.25, 10.59, -10.58), // P0 (0,0) +0.4y, -3z from road
    new THREE.Vector3(-70.25, 10.59, -9.58),  // P1 (0,1) +0.4y, -2z from road
    new THREE.Vector3(-70.25, 10.59, -8.58),  // P2 (0,2) +0.4y, -1z from road
    new THREE.Vector3(-70.25, 10.19, -7.58),  // P3 (0,3) = Road P0 (exact match)
    // Row 1 (i=1): j=3 = Road P4
    new THREE.Vector3(-22.31, -1.01, -7.58),  // P4 (1,0) +0.4y, -3z from road
    new THREE.Vector3(-22.31, -1.01, -6.58),  // P5 (1,1) +0.4y, -2z from road
    new THREE.Vector3(-22.31, -1.01, -5.58),  // P6 (1,2) +0.4y, -1z from road
    new THREE.Vector3(-22.31, -1.41, -4.58),  // P7 (1,3) = Road P4 (exact match)
    // Row 2 (i=2): j=3 = Road P8
    new THREE.Vector3(58.77, -17.49, -4.82),  // P8 (2,0) +0.4y, -3z from road
    new THREE.Vector3(58.77, -17.49, -3.82),  // P9 (2,1) +0.4y, -2z from road
    new THREE.Vector3(58.77, -17.49, -2.82),  // P10 (2,2) +0.4y, -1z from road
    new THREE.Vector3(58.77, -17.89, -1.82),  // P11 (2,3) = Road P8 (exact match)
    // Row 3 (i=3): j=3 = Road P12
    new THREE.Vector3(86.5, -21.48, -6.53),   // P12 (3,0) +0.4y, -3z from road
    new THREE.Vector3(86.5, -21.48, -5.53),   // P13 (3,1) +0.4y, -2z from road
    new THREE.Vector3(86.5, -21.48, -4.53),   // P14 (3,2) +0.4y, -1z from road
    new THREE.Vector3(86.5, -21.88, -3.53)    // P15 (3,3) = Road P12 (exact match)
];

const nearPavementSurface = createBezierSurface(nearPavementControlPoints, {
    segments: 20,
    showHull: false,
    showControlPoints: false,
    wireframe: false,
    color: 0x888888 // lighter grey for pavement
});
scene.add(nearPavementSurface);

// Draggable Bezier surfaces state
const draggableBezierSurfaces = [];
let selectedDraggableIndex = -1; // -1 means no selection
let dragControls = null;

// Planar reflections: one render per face (front and back only).
const REFLECTION_SIZE = 512;
const reflectionTargets = {
    front: new THREE.WebGLRenderTarget(REFLECTION_SIZE, REFLECTION_SIZE),
    back:  new THREE.WebGLRenderTarget(REFLECTION_SIZE, REFLECTION_SIZE)
};
const reflectionCameras = {
    front: new THREE.PerspectiveCamera(75, 1, 0.1, 1000),
    back:  new THREE.PerspectiveCamera(75, 1, 0.1, 1000)
};
reflectionCameras.front.aspect = reflectionCameras.back.aspect = 1;
reflectionCameras.front.updateProjectionMatrix();
reflectionCameras.back.updateProjectionMatrix();
// Building at (0, 0, -20) scale 3; front/back planes for window faces
const reflectionPlanes = {
    front: new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 4.5, -27.5)),
    back:  new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 4.5, -14))
};
reflectionCameras.front.layers.set(0);
reflectionCameras.back.layers.set(0);
const textureMatrixReflection = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
const clipBiasReflection = 0.003;
const _reflectorPlane = new THREE.Plane();
const _reflectorNormal = new THREE.Vector3();
const _reflectorWorldPos = new THREE.Vector3();
const _cameraWorldPos = new THREE.Vector3();
const _clipPlane = new THREE.Vector4();
const _q = new THREE.Vector4();

function mirrorCameraAcrossPlane(mainCam, plane, reflectionCam) {
    plane.coplanarPoint(_reflectorWorldPos);
    _reflectorNormal.copy(plane.normal);
    _cameraWorldPos.setFromMatrixPosition(mainCam.matrixWorld);
    const view = new THREE.Vector3().subVectors(_reflectorWorldPos, _cameraWorldPos);
    view.reflect(_reflectorNormal).negate();
    view.add(_reflectorWorldPos);
    reflectionCam.position.copy(view);
    const lookAt = new THREE.Vector3(0, 0, -1).applyMatrix4(mainCam.matrixWorld).add(_cameraWorldPos);
    const target = new THREE.Vector3().subVectors(_reflectorWorldPos, lookAt).reflect(_reflectorNormal).negate().add(_reflectorWorldPos);
    reflectionCam.up.set(0, 1, 0).applyMatrix4(mainCam.matrixWorld).reflect(_reflectorNormal);
    reflectionCam.lookAt(target);
    reflectionCam.updateMatrixWorld();
    reflectionCam.fov = mainCam.fov;
    reflectionCam.updateProjectionMatrix();
    _reflectorPlane.setFromNormalAndCoplanarPoint(_reflectorNormal, _reflectorWorldPos);
    _reflectorPlane.applyMatrix4(reflectionCam.matrixWorldInverse);
    _clipPlane.set(_reflectorPlane.normal.x, _reflectorPlane.normal.y, _reflectorPlane.normal.z, _reflectorPlane.constant);
    const proj = reflectionCam.projectionMatrix.elements;
    _q.x = (Math.sign(_clipPlane.x) + proj[8]) / proj[0];
    _q.y = (Math.sign(_clipPlane.y) + proj[9]) / proj[5];
    _q.z = -1;
    _q.w = (1 + proj[10]) / proj[14];
    _clipPlane.multiplyScalar(2 / _clipPlane.dot(_q));
    proj[2] = _clipPlane.x;
    proj[6] = _clipPlane.y;
    proj[10] = _clipPlane.z + 1 - clipBiasReflection;
    proj[14] = _clipPlane.w;
}

function updatePlanarReflectionTextures() {
    const faces = ['front', 'back'];
    const currentTarget = renderer.getRenderTarget();
    for (const face of faces) {
        mirrorCameraAcrossPlane(camera, reflectionPlanes[face], reflectionCameras[face]);
        const refCam = reflectionCameras[face];
        textureMatrixReflection.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
        textureMatrixReflection.multiply(refCam.projectionMatrix).multiply(refCam.matrixWorldInverse);
        renderer.setRenderTarget(reflectionTargets[face]);
        renderer.clear();
        renderer.render(scene, refCam);
        dunelm.traverse((obj) => {
            if (obj.material && obj.material.userData && obj.material.userData.planarReflectionFace === face) {
                obj.material.uniforms.textureMatrix.value.copy(textureMatrixReflection);
            }
        });
    }
    renderer.setRenderTarget(currentTarget);
}

const dunelm = createDunelmHouse(10, -40, 3, {
    planarReflections: {
        front: { renderTarget: reflectionTargets.front, camera: reflectionCameras.front },
        back:  { renderTarget: reflectionTargets.back,  camera: reflectionCameras.back }
    }
});
scene.add(dunelm);

const bridgeDeckLength = 30;
const bridgeScale = 4;
const staircaseStart = new THREE.Vector3(-10, -3.7, -6.8);   // pavement edge center
const staircaseEnd = new THREE.Vector3(-18, -0.4, -100 + (bridgeDeckLength/2)*bridgeScale + 15); // bridge level
const staircase = createStaircase(staircaseStart, staircaseEnd, {
    width: 6,
    stepHeight: 1.0,
    stepDepth: 3.0
});
scene.add(staircase);

// Kingsgate Bridge: align near end (local +Z) with flat base front. planeMesh: zBaseStart = -roadLength - stepCount*stepTread = -30, yBaseTop = -roadDrop + stepCount*stepHeight = -0.4. Bridge L/2=10, so z = -30 - 10 = -40.
const bridge = createKingsgateBridge(-20, -0.4, -100, bridgeScale, { deckLength: bridgeDeckLength });
scene.add(bridge);

const connectionSurfacePoints = [
    new THREE.Vector3(-4.25, 0, -37.75),   // 0: SU left (near bridge)
    new THREE.Vector3(-4.25, 0, -30.25),   // 1: SU left (near camera)
    new THREE.Vector3(-15.25, -0.4, -26.21), // 2: staircase right
    new THREE.Vector3(-20.75, -0.4, -23.79), // 3: staircase left
    new THREE.Vector3(-24, 0.8, -40),     // 4: bridge left
    new THREE.Vector3(-16, 0.8, -40)      // 5: bridge right
];
const connectionSurface = createConnectionSurface(connectionSurfacePoints, { color: 0x666666 });
scene.add(connectionSurface);

// Create tree element
const treeElement = createOakTree(0, 0);
scene.add(treeElement);

const peopleParams = { count: 20 };
let peopleElements = [];
let withPhoneCache = [];

function rebuildPeople() {
    peopleElements.forEach((el) => scene.remove(el));
    peopleElements = Figure.createPeopleLOD(peopleParams.count);
    peopleElements.forEach((el) => scene.add(el));
    withPhoneCache = peopleElements.filter(lod =>
        lod.userData.highFigure && lod.userData.highFigure.getPhone()
    );
}

const LOD_HIGH_DISTANCE = 150;
let frameCount = 0;

function getPhonesInRange() {
    return withPhoneCache.filter(lod =>
        camera.position.distanceTo(lod.position) < LOD_HIGH_DISTANCE
    );
}

function flashTick() {
    const inRange = getPhonesInRange();
    if (inRange.length === 0) return;
    const count = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) {
        const lod = inRange[Math.floor(Math.random() * inRange.length)];
        lod.userData.highFigure.triggerFlash();
    }
}

rebuildPeople();
setInterval(flashTick, 1200);

// Night lighting: dim ambient, blue-tinted moon, hemisphere for sky/ground
const ambientLight = new THREE.AmbientLight(0x202040, 0.4);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xaaccff, 0.3);
directionalLight.position.set(2, 5, 3);
scene.add(directionalLight);

const hemisphereLight = new THREE.HemisphereLight(0x111122, 0x080810, 0.6);
scene.add(hemisphereLight);

// Position the camera
camera.position.set(5, 5, 5);
camera.lookAt(0, 0, 0);
camera.layers.enable(1); // see window meshes (layer 1)

// Gather stats on performance
const stats = Stats();
document.body.appendChild(stats.dom);

// Axis helper
const axesHelper = new THREE.AxesHelper( 5 );
scene.add( axesHelper );

// Creating a GUI with options
const gui = new GUI({ name: "Lumiere GUI" });
const cameraFolder = gui.addFolder("Camera");
cameraFolder.add(camera.position, "z", 0, 10);
cameraFolder.open();

const skyFolder = gui.addFolder("Sky");
skyFolder.add(skyParams, "turbidity", 0, 3).onChange(applySkyParams);
skyFolder.add(skyParams, "rayleigh", 0, 2).onChange(applySkyParams);
skyFolder.add(skyParams, "mieCoefficient", 0, 0.02).onChange(applySkyParams);
skyFolder.add(skyParams, "sunPositionY", -500000, 500000).onChange(applySkyParams);
skyFolder.add(skyParams, "scale", 1000, 20000).onChange(applySkyParams);
skyFolder.open();

const peopleFolder = gui.addFolder("People");
peopleFolder.add(peopleParams, "count", 0, 300).step(1).onChange(rebuildPeople);

function triggerRandomPhoneFlash() {
    if (withPhoneCache.length === 0) return;
    const inRange = withPhoneCache.filter(lod =>
        camera.position.distanceTo(lod.position) < LOD_HIGH_DISTANCE
    );
    if (inRange.length === 0) {
        console.log('No phones in range');
        return;
    }
    console.log('Phones in range', inRange.length);
    const count = Math.max(1, Math.ceil(inRange.length / 4));
    console.log('Count', count);
    for (let i = 0; i < count; i++) {
        const lod = inRange[Math.floor(Math.random() * inRange.length)];
        console.log('Triggering flash for', lod.userData.highFigure.getPhone());
        lod.userData.highFigure.triggerFlash();
    }
    console.log('Flashes triggered');
}
const peopleActions = { flashRandomPhone: triggerRandomPhoneFlash };
peopleFolder.add(peopleActions, 'flashRandomPhone').name('Flash random phone');

peopleFolder.open();

const bezierParams = {
    showHull: false,
    showControlPoints: false,
    wireframe: false
};
const bezierFolder = gui.addFolder("Bezier surface");
bezierFolder.add(bezierParams, "showHull").name("Show control hull").onChange((v) => {
    if (roadSurface.userData.bezier?.hull) roadSurface.userData.bezier.hull.visible = v;
    if (farPavementSurface.userData.bezier?.hull) farPavementSurface.userData.bezier.hull.visible = v;
    if (nearPavementSurface.userData.bezier?.hull) nearPavementSurface.userData.bezier.hull.visible = v;
});
bezierFolder.add(bezierParams, "showControlPoints").name("Show control points").onChange((v) => {
    (roadSurface.userData.bezier?.controlPoints || []).forEach(sp => { sp.visible = v; });
    (farPavementSurface.userData.bezier?.controlPoints || []).forEach(sp => { sp.visible = v; });
    (nearPavementSurface.userData.bezier?.controlPoints || []).forEach(sp => { sp.visible = v; });
});
bezierFolder.add(bezierParams, "wireframe").name("Wireframe overlay").onChange((v) => {
    if (roadSurface.userData.bezier?.wireframe) roadSurface.userData.bezier.wireframe.visible = v;
    if (farPavementSurface.userData.bezier?.wireframe) farPavementSurface.userData.bezier.wireframe.visible = v;
    if (nearPavementSurface.userData.bezier?.wireframe) nearPavementSurface.userData.bezier.wireframe.visible = v;
});

const draggableParams = {
    selectedCurve: 'None',
    addBezierSurface: function() {
        const initialPoints = [];
        for (let i = 0; i < 4; i++) {
            for (let j = 0; j < 4; j++) {
                const x = (i - 1.5) * 2;
                const z = (j - 1.5) * 2;
                // Hump in the middle
                const y = (i === 1 || i === 2) && (j === 1 || j === 2) ? 2 : 0;
                initialPoints.push(new THREE.Vector3(x, y, z));
            }
        }

        // Create draggable surface
        const draggableSurface = createDraggableBezierSurface(initialPoints, {
            segments: 20,
            showHull: true,
            showControlPoints: true,
            wireframe: false
        });

        // Position so multiple surfaces don't overlap (offset by index)
        const offset = draggableBezierSurfaces.length * 10;
        draggableSurface.position.set(offset, 0, -4);
        scene.add(draggableSurface);
        draggableBezierSurfaces.push(draggableSurface);
        selectedDraggableIndex = draggableBezierSurfaces.length - 1;
        updateDragControls();
        updateSelectionDropdown();
        updateCoordsDisplay();
    },
    saveCoordinates: function() {
        if (selectedDraggableIndex < 0 || selectedDraggableIndex >= draggableBezierSurfaces.length) {
            console.log('No draggable Bezier surface selected');
            return;
        }

        const selected = draggableBezierSurfaces[selectedDraggableIndex];
        const controlPointMeshes = selected.userData.bezier.controlPoints;
        
        // Get positions
        const positions = controlPointMeshes.map((mesh, idx) => {
            const i = Math.floor(idx / 4);
            const j = idx % 4;
            return {
                index: idx,
                grid: [i, j],
                position: {
                    x: parseFloat(mesh.position.x.toFixed(2)),
                    y: parseFloat(mesh.position.y.toFixed(2)),
                    z: parseFloat(mesh.position.z.toFixed(2))
                }
            };
        });

        console.log('=== Draggable Bezier Surface ' + (selectedDraggableIndex + 1) + ' Control Points ===');
        console.log(JSON.stringify(positions, null, 2));
        console.log('\nHuman-readable format:');
        positions.forEach(p => {
            console.log(`P${p.index} (${p.grid[0]},${p.grid[1]}): (${p.position.x}, ${p.position.y}, ${p.position.z})`);
        });
    }
};

const draggableFolder = gui.addFolder("Draggable Bezier");
draggableFolder.add(draggableParams, 'addBezierSurface').name('Add Bezier surface');

let selectionController = null;
function updateSelectionDropdown() {
    if (selectionController) {
        draggableFolder.remove(selectionController);
    }
    if (draggableBezierSurfaces.length > 0) {
        const options = {};
        for (let i = 0; i < draggableBezierSurfaces.length; i++) {
            options['Bezier ' + (i + 1)] = i;
        }
        draggableParams.selectedCurve = selectedDraggableIndex >= 0 ? selectedDraggableIndex : 0;
        selectionController = draggableFolder.add(draggableParams, 'selectedCurve', options).name('Selected curve').onChange((value) => {
            selectedDraggableIndex = parseInt(value);
            updateDragControls();
            updateCoordsDisplay();
        });
    }
}

draggableFolder.add(draggableParams, 'saveCoordinates').name('Save control coordinates');

// Create coordinate display panel
const coordsPanel = document.createElement('div');
coordsPanel.id = 'coords';
coordsPanel.style.cssText = `
    position: absolute;
    top: 10px;
    left: 340px;
    max-width: 280px;
    max-height: 80vh;
    background: rgba(0, 0, 0, 0.8);
    padding: 15px;
    border-radius: 8px;
    border-left: 5px solid #2ecc71;
    pointer-events: none;
    user-select: none;
    overflow: auto;
    font-size: 12px;
    line-height: 1.5;
    font-family: 'Segoe UI', sans-serif;
    color: #eee;
`;
coordsPanel.innerHTML = `
    <h2 style="margin: 0 0 8px 0; font-size: 14px; color: #2ecc71; text-transform: uppercase;">Control point coordinates</h2>
    <pre id="coordsList" style="margin: 0; color: #bdc3c7; font-family: 'Consolas', 'Monaco', monospace; white-space: pre-wrap; word-break: break-all;">—</pre>
`;
document.body.appendChild(coordsPanel);

function updateDragControls() {
    if (dragControls) {
        dragControls.dispose();
        dragControls = null;
    }

    // Create new DragControls for selected surface
    if (selectedDraggableIndex >= 0 && selectedDraggableIndex < draggableBezierSurfaces.length) {
        const selectedGroup = draggableBezierSurfaces[selectedDraggableIndex];
        const controlPointMeshes = selectedGroup.userData.bezier.controlPoints;

        dragControls = new DragControls(controlPointMeshes, camera, renderer.domElement);
        dragControls.addEventListener('dragstart', () => {
            orbitControls.enabled = false;
        });
        dragControls.addEventListener('dragend', () => {
            orbitControls.enabled = true;
        });

        // Hover effects
        dragControls.addEventListener('hoveron', (e) => {
            e.object.material.color.set(0xffaa00);
        });
        dragControls.addEventListener('hoveroff', (e) => {
            e.object.material.color.set(0xcccccc);
        });
    }
}

function updateCoordsDisplay() {
    const coordsList = document.getElementById('coordsList');
    if (!coordsList) return;

    if (selectedDraggableIndex < 0 || selectedDraggableIndex >= draggableBezierSurfaces.length) {
        coordsList.textContent = '—';
        return;
    }

    const selected = draggableBezierSurfaces[selectedDraggableIndex];
    const controlPointMeshes = selected.userData.bezier.controlPoints;
    
    const lines = [];
    for (let idx = 0; idx < controlPointMeshes.length; idx++) {
        const i = Math.floor(idx / 4);
        const j = idx % 4;
        const pos = controlPointMeshes[idx].position;
        lines.push(`P${idx} (${i},${j}): (${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)})`);
    }
    coordsList.textContent = lines.join('\n');
}

// Debug: Spatial grid (2(b))
let spatialGridDebugLine = null;
const stageBounds = new THREE.Box3(new THREE.Vector3(-20, -30, -35), new THREE.Vector3(15, 15, 30));
const debugParams = { spatialGrid: false };
const debugFolder = gui.addFolder("Debug");
debugFolder.add(debugParams, "spatialGrid").name("Spatial grid").onChange((v) => {
    if (v) {
        if (!spatialGridDebugLine) {
            const grid = new SpatialGrid(stageBounds, 20, 20);
            spatialGridDebugLine = grid.debugRender({ y: 0 });
        }
        scene.add(spatialGridDebugLine);
    } else {
        if (spatialGridDebugLine) scene.remove(spatialGridDebugLine);
    }
});

function animate() {
    requestAnimationFrame(animate);
    if (webglContextLost) return; // stop rendering when context is lost to avoid errors

    // Update all draggable Bezier surfaces
    for (let i = 0; i < draggableBezierSurfaces.length; i++) {
        const group = draggableBezierSurfaces[i];
        if (group.userData.bezier?.update) {
            group.userData.bezier.update();
        }
    }
    if (selectedDraggableIndex >= 0 && selectedDraggableIndex < draggableBezierSurfaces.length) {
        updateCoordsDisplay();
    }

    // update LOD levels (throttled to reduce per-frame work)
    if (frameCount % 20 === 0) {
        peopleElements.forEach(lod => lod.update(camera));
    }
    updateCamera();
    frameCount += 1;
    if (frameCount % 40 === 0) {
        updatePlanarReflectionTextures();
    }
    renderer.render(scene, camera);
    stats.update();
}

animate();