import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { createOakTree } from './objects/oakTree.js';
import { COLORS } from './constants.js';
import { Figure } from './objects/character.js';
import { GUI } from 'dat.gui';
import { createDunelmHouse } from './objects/su.js';
import { createKingsgateBridge } from './objects/bridge.js';
import { createNightSky } from './objects/skyDome.js';
import { SpatialGrid } from './utils/SpatialGrid.js';
import Stats from 'three/examples/jsm/libs/stats.module'
import { generateTerrain } from './objects/landscape/farHill.js';
import { createBezierSurface } from './objects/surface.js';
//import { generateRoad } from './objects/landscape/road.js';

// Scene setup
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true});

// Set the size of the renderer
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
//renderer.gammaFactor = 2.2;
//renderer.outputEncoding = THREE.sRGBEncoding;
document.body.appendChild(renderer.domElement);

// Initialise OrbitControls
const orbitControls = new OrbitControls(camera, renderer.domElement);
orbitControls.enableDamping = true; // smooth movement
orbitControls.dampingFactor = 0.05; // adjust damping factor

// Keyboard controls
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
  renderer.setPixelRatio(window.devicePixelRatio)
}

function updateCamera() {
    if (controls.direction.left) camera.position.x -= controls.moveSpeed;
    if (controls.direction.right) camera.position.x += controls.moveSpeed;
    if (controls.direction.forward) camera.position.z -= controls.moveSpeed;
    if (controls.direction.backward) camera.position.z += controls.moveSpeed;
    orbitControls.update();
}

// Create flat plane for water
const planeGeometry = new THREE.PlaneGeometry(500, 500);
const planeMaterial = new THREE.MeshStandardMaterial({ color: COLORS.WATER, side: THREE.DoubleSide });
const plane = new THREE.Mesh(planeGeometry, planeMaterial);
plane.rotation.x = -Math.PI / 2; // rotate to lay flat
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

// Generate far hill terrain
const farHill = generateTerrain(50, 50, 64, { endHeight: 20 });
farHill.position.set(0, -30, -20);
scene.add(farHill);

// Bezier surface: 4×4 control points, row-major index i*4+j. Hump: inner 2×2 at y=2, rest y=0; x,z grid (i-1.5)*2, (j-1.5)*2
const bezierControlPoints = [];
for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
        const x = (i - 1.5) * 2;
        const z = (j - 1.5) * 2;
        const y = (i === 1 || i === 2) && (j === 1 || j === 2) ? 2 : 0;
        bezierControlPoints.push(new THREE.Vector3(x, y, z));
    }
}
const bezierSurface = createBezierSurface(bezierControlPoints, { segments: 20, showHull: false });
bezierSurface.position.set(0, 0, -15);
scene.add(bezierSurface);

// add road
// The curve can be used to update an agent's progress along the road
const waypoints = [
    new THREE.Vector3(-50, 40, -2),
    new THREE.Vector3(-30, 10, -1),
    new THREE.Vector3(0, -5, 0),
    new THREE.Vector3(40, -10, -1)
];
//const { road, _curve } = generateRoad(waypoints);
//scene.add(road);
//road.position.set(0, 0, 0);

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

const dunelm = createDunelmHouse(0, -20, 3, {
    planarReflections: {
        front: { renderTarget: reflectionTargets.front, camera: reflectionCameras.front },
        back:  { renderTarget: reflectionTargets.back,  camera: reflectionCameras.back }
    }
});
scene.add(dunelm);

// Kingsgate Bridge: align near end (local +Z) with flat base front. planeMesh: zBaseStart = -roadLength - stepCount*stepTread = -30, yBaseTop = -roadDrop + stepCount*stepHeight = -0.4. Bridge L/2=10, so z = -30 - 10 = -40.
const bridge = createKingsgateBridge(-20, -0.4, -40, 4);
scene.add(bridge);

// Create tree element
const treeElement = createOakTree(0, 0);
scene.add(treeElement);

// Create people elements (rebuildPeople updates count from peopleParams.count)
const peopleParams = { count: 100 };
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

const LOD_HIGH_DISTANCE = 150; // LOD shows high-res (with phone) when camera distance < this
const LOD_UPDATE_INTERVAL_MS = 100;
let lastLODUpdate = 0;
let frameCount = 0;

function flashTick() {
    if (withPhoneCache.length === 0) return;
    const inRange = withPhoneCache.filter(lod =>
        camera.position.distanceTo(lod.position) < LOD_HIGH_DISTANCE
    );
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

const directionalLight = new THREE.DirectionalLight(0xaaccff, 0.3); // moon
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

    // update LOD levels (throttled to reduce per-frame work)
    const now = performance.now();
    if (now - lastLODUpdate >= LOD_UPDATE_INTERVAL_MS) {
        lastLODUpdate = now;
        peopleElements.forEach(lod => lod.update(camera));
    }

    // Update camera
    updateCamera();
    frameCount += 1;
    if (frameCount % 20 === 0) {
        updatePlanarReflectionTextures();
    }
    renderer.render(scene, camera);
    stats.update();
}

animate();