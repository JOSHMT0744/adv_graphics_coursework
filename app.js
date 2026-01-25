import * as THREE from  "https://unpkg.com/three@0.126.1/build/three.module.js";    
import { OrbitControls } from "https://unpkg.com/three@0.126.1/examples/jsm/controls/OrbitControls.js";
import { createOakTree } from './objects/oakTree.js';
import { COLORS } from './constants.js';
import { Figure } from './objects/character.js';
import { GUI } from 'dat.gui';
import { createDunelmHouse } from './objects/su.js';
import { createKingsgateBridge } from './objects/bridge.js';
import { createNightSky } from './objects/skyDome.js';
import { createRoadSurface, createGreenMoundSurface, createPathSurface, getDefaultRoadProfile } from './objects/surface.js';
import { createArchFromCurve } from './objects/arch.js';
import { ParametricCurve } from './utils/ParametricCurve.js';
import { createParametricCurveEditor } from './utils/ParametricCurveEditor.js';
import { SpatialGrid } from './utils/SpatialGrid.js';
import Stats from 'three/examples/jsm/libs/stats.module'

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

// B-spline surfaces: road, green with mound, path around green
let road = createRoadSurface({ worldOffset: [0, 0, 0] });
//road.rotation.y = -Math.PI / 2;
scene.add(road);
const green = createGreenMoundSurface({ worldOffset: [0, 0, 0] });
scene.add(green);
const path = createPathSurface({ worldOffset: [0, 0, 0] });
scene.add(path);

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

// Two cube cameras: front (tree side) and back (behind building) so each window face reflects its correct side.
const cubeOpts = { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter };
const cubeRtFront = new THREE.WebGLCubeRenderTarget(512, cubeOpts);
cubeRtFront.texture.mapping = THREE.CubeReflectionMapping;

// Create camera to capture the content of the mirror
const cubeCamFront = new THREE.CubeCamera(1, 100, cubeRtFront);
cubeCamFront.position.set(0, 2, -10); // between tree (0,0,0) and building (~-20): sees tree, ground, approach
cubeCamFront.layers.set(0); // only layer 0; windows use layer 1 to avoid recursion
scene.add(cubeCamFront);

const cubeRtBack = new THREE.WebGLCubeRenderTarget(512, cubeOpts);
cubeRtBack.texture.mapping = THREE.CubeReflectionMapping;
const cubeCamBack = new THREE.CubeCamera(1, 100, cubeRtBack);
cubeCamBack.position.set(0, 2, -28); // behind the building: sees back of building, far ground
cubeCamBack.layers.set(0);
scene.add(cubeCamBack);

// Dunelm House: front/left use envMapFront (tree, approach), back/right use envMapBack (behind building)
const dunelm = createDunelmHouse(0, -20, 3, { envMapFront: cubeRtBack.texture, envMapBack: cubeRtFront.texture });
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
camera.layers.enable(1); // see window meshes (layer 1); cube camera only captures layer 0

// Gather stats on performance
const stats = Stats();
document.body.appendChild(stats.dom);

// Axis helper
const axesHelper = new THREE.AxesHelper( 5 );
scene.add( axesHelper );

// Parametric curve editor state
let curveEditor = null;
const curveParams = { editMode: false, selectedPoint: 0, samples: 64 };
const curvePointer = new THREE.Vector2();
const curveRaycaster = new THREE.Raycaster();

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

// Parametric Curve folder
const curveFolder = gui.addFolder("Parametric Curve");
const curveActions = {
    addCurve: () => {
        if (curveEditor) {
            scene.remove(curveEditor.getGroup());
            curveEditor.destroy();
        }
        const curve = ParametricCurve.createDefault();
        curveEditor = createParametricCurveEditor(curve, {
            camera,
            domElement: renderer.domElement,
            orbitControls,
            scene,
            samples: curveParams.samples
        });
        scene.add(curveEditor.getGroup());
        curveParams.editMode = false;
        curveParams.selectedPoint = 0;
        curveEditor.setEditMode(false);
        curveEditor.setSelectedIndex(0);
    },
    addRoadProfileCurve: () => {
        if (curveEditor) {
            scene.remove(curveEditor.getGroup());
            curveEditor.destroy();
        }
        const curve = new ParametricCurve({ controlPoints: getDefaultRoadProfile() });
        curveEditor = createParametricCurveEditor(curve, {
            camera,
            domElement: renderer.domElement,
            orbitControls,
            scene,
            samples: curveParams.samples
        });
        scene.add(curveEditor.getGroup());
        curveParams.editMode = false;
        curveParams.selectedPoint = 0;
        curveEditor.setEditMode(false);
        curveEditor.setSelectedIndex(0);
    },
    applyToRoad: () => {
        if (!curveEditor) return;
        const pts = curveEditor.getCurve().getControlPoints();
        if (pts.length < 4) {
            console.warn("Apply curve to road: need at least 4 control points.");
            return;
        }
        scene.remove(road);
        road = createRoadSurface({ controlPoints: pts.map((p) => p.clone()), worldOffset: [0, 0, 0] });
        scene.add(road);
    },
    bakeArch: () => {
        if (!curveEditor) return;
        const arch = createArchFromCurve(curveEditor.getCurve(), { width: 4, position: [10, 0, 0] });
        scene.add(arch);
    }
};
curveFolder.add(curveActions, "addCurve").name("Add curve");
curveFolder.add(curveActions, "addRoadProfileCurve").name("Add road profile curve");
curveFolder.add(curveActions, "applyToRoad").name("Apply curve to road");
curveFolder.add(curveActions, "bakeArch").name("Create arch from curve");
curveFolder.add(curveParams, "editMode").name("Edit mode").onChange((v) => { if (curveEditor) curveEditor.setEditMode(v); });
curveFolder.add(curveParams, "selectedPoint", 0, 31).step(1).name("Selected point").onChange((v) => { if (curveEditor) curveEditor.setSelectedIndex(v); });
curveFolder.add(curveParams, "samples", 4, 256).step(1).name("Samples").onChange((v) => { if (curveEditor) curveEditor.setSamples(v); });

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

// Pointer down for curve control-point selection (edit mode)
renderer.domElement.addEventListener("pointerdown", (event) => {
    if (!curveEditor || !curveEditor.getEditMode() || event.button !== 0) return;
    const rect = renderer.domElement.getBoundingClientRect();
    curvePointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    curvePointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    curveRaycaster.setFromCamera(curvePointer, camera);
    const hits = curveRaycaster.intersectObjects(curveEditor.getControlPointMeshes());
    if (hits.length > 0) {
        const i = hits[0].object.userData.controlIndex;
        curveEditor.setSelectedIndex(i);
        curveParams.selectedPoint = i;
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
    // Update both cube env maps (throttled to every 2nd frame to reduce cost)
    frameCount += 1;
    if (frameCount % 3 === 0) {
        cubeCamFront.update(renderer, scene);
        cubeCamBack.update(renderer, scene);
    }
    renderer.render(scene, camera);
    stats.update();
}

animate();