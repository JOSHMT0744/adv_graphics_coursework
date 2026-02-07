import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { DragControls } from "three/examples/jsm/controls/DragControls.js";
import { createOakTree } from './objects/oakTree.js';
import { COLOURS } from './constants.js';
import { Figure, createPersonWithLOD } from './objects/character.js';
import { GUI } from 'dat.gui';
import { createDunelmHouse } from './objects/su.js';
import { createKingsgateBridge } from './objects/bridge.js';
import { createStaircase } from './objects/staircase.js';
import { createLilyStructure } from './objects/lilyStructure.js';
import { createConnectionSurface, createQuadSurface } from './objects/connectionSurface.js';
import Stats from 'three/examples/jsm/libs/stats.module'
import { generateTerrain } from './objects/landscape/farHill.js';
import { createBezierSurface, createDraggableBezierSurface, evalBezierSurface } from './objects/surface.js';
import { createBSplineSurface, createDraggableBSplineSurface, updateBSplineSurfaceFromPoints, getBSplineSurfaceWorldPointAtNormalized } from './objects/bsplineSurface.js';
import { getTexture } from './utils/getTexture.js';
import { Octree, createOctreeDebugLines } from './utils/Octree.js';
import {
    createBezierSampler,
    createBridgeDeckSampler,
    createConnectionSampler,
    createQuadSampler,
    createStaircaseSampler,
    createCombinedSampler
} from './utils/walkableSampler.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

// Scene setup
const scene = new THREE.Scene();
// Slight fog (matches night gradient horizon)
scene.fog = new THREE.Fog(0x050510, 100, 400);
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });

// Set the size of the renderer (cap pixel ratio to reduce GPU memory and context loss risk)
const pixelRatio = Math.min(window.devicePixelRatio, 2);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(pixelRatio);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap; // Smoother shadows
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

// Post-processing: Bloom for Light Festival aesthetic (glow on lights and reflections)
const bloomParams = { strength: 0.8, radius: 0.4, threshold: 0.85 };
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
// Half-resolution bloom for FPS (quarter the pixel cost)
const bloomResolution = new THREE.Vector2(
    Math.floor(window.innerWidth / 2),
    Math.floor(window.innerHeight / 2)
);
const bloomPass = new UnrealBloomPass(
    bloomResolution,
    bloomParams.strength,
    bloomParams.radius,
    bloomParams.threshold
);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());
composer.setSize(window.innerWidth, window.innerHeight);
composer.setPixelRatio(pixelRatio);

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
        case 'w': // Toggle wireframe (far instanced and near skinned share materials)
            controls.wireframe = !controls.wireframe;
            if (characterInstanceMaterial) characterInstanceMaterial.wireframe = controls.wireframe;
            if (skinnedCharacterTemplate && skinnedCharacterTemplate.material) skinnedCharacterTemplate.material.wireframe = controls.wireframe;
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
    const width = window.innerWidth;
    const height = window.innerHeight;
    const ratio = Math.min(window.devicePixelRatio, 2);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    renderer.setPixelRatio(ratio);
    composer.setSize(width, height);
    composer.setPixelRatio(ratio);
    bloomPass.resolution.set(Math.floor(width / 2), Math.floor(height / 2));
}

function updateCamera() {
    if (controls.direction.left) camera.position.x -= controls.moveSpeed;
    if (controls.direction.right) camera.position.x += controls.moveSpeed;
    if (controls.direction.forward) camera.position.z -= controls.moveSpeed;
    if (controls.direction.backward) camera.position.z += controls.moveSpeed;
    orbitControls.update();
}

// Water plane
const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(300, 300),
    new THREE.MeshStandardMaterial({ color: COLOURS.WATER, side: THREE.DoubleSide })
);
plane.rotation.x = -Math.PI / 2;
plane.position.y = -44;
scene.add(plane);

// Night sky: cheap gradient background (replaces expensive Preetham Sky dome)
const nightGradientParams = {
    topColor: 0x151530,    // zenith: soft blue-purple
    bottomColor: 0x050510  // horizon: very dark
};
function createNightGradientTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    const top = '#' + nightGradientParams.topColor.toString(16).padStart(6, '0');
    const bottom = '#' + nightGradientParams.bottomColor.toString(16).padStart(6, '0');
    const gradient = ctx.createLinearGradient(0, canvas.height, 0, 0);
    gradient.addColorStop(0, bottom);
    gradient.addColorStop(1, top);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const tex = new THREE.CanvasTexture(canvas);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    return tex;
}
scene.background = createNightGradientTexture();
function applyNightGradient() {
    scene.background.dispose();
    scene.background = createNightGradientTexture();
}

const farHill = generateTerrain(200, 50, 64, { endHeight: 55 });
farHill.position.set(0, -55, -135);
farHill.rotateZ(Math.PI);
scene.add(farHill);

// Far-hill billboard trees (instanced planes that face the camera; frustum-culled)
const FAR_HILL_TREE_BOUNDS = { xMin: -95, xMax: 95, zMin: -155, zMax: -115, yFallback: -55 };
const FAR_HILL_TREE_WIDTH = 4;
const FAR_HILL_TREE_HEIGHT = 12;
const farHillParams = { treeCount: 100 };
let farHillTreePositions = [];
const farHillTreeGeometry = new THREE.PlaneGeometry(FAR_HILL_TREE_WIDTH, FAR_HILL_TREE_HEIGHT);
const farHillTreeMaterial = new THREE.MeshStandardMaterial({
    map: getTexture('textures/tree_billboard.png', "Error loading tree billboard texture"),
    side: THREE.DoubleSide,
    transparent: true,
    alphaTest: 0.1
});

const FAR_HILL_TREE_MAX_COUNT = 500;
const farHillBillboardInstancedMesh = new THREE.InstancedMesh(
    farHillTreeGeometry,
    farHillTreeMaterial,
    FAR_HILL_TREE_MAX_COUNT
);
farHillBillboardInstancedMesh.count = 0;
scene.add(farHillBillboardInstancedMesh);

const farHillRaycaster = new THREE.Raycaster();
const farHillRayOrigin = new THREE.Vector3();
const farHillRayDirection = new THREE.Vector3(0, -1, 0);
const _farHillDummyObject = new THREE.Object3D();
const _farHillVisibleList = [];

function rebuildFarHillTrees() {
    farHillTreePositions.length = 0;
    scene.updateMatrixWorld(true);
    const b = FAR_HILL_TREE_BOUNDS;
    const rayOriginY = 5; // above far hill surface (terrain ~ Y -55 to 0)
    let hitCount = 0;
    const treeYOffset = FAR_HILL_TREE_HEIGHT / 3;
    for (let i = 0; i < farHillParams.treeCount; i++) {
        const x = b.xMin + Math.random() * (b.xMax - b.xMin);
        const z = b.zMin + Math.random() * (b.zMax - b.zMin);
        farHillRayOrigin.set(x, rayOriginY, z);
        farHillRaycaster.set(farHillRayOrigin, farHillRayDirection);
        const hits = farHillRaycaster.intersectObject(farHill);
        if (hits.length > 0) hitCount += 1;
        const y = hits.length > 0 ? hits[0].point.y + treeYOffset : b.yFallback + treeYOffset;
        farHillTreePositions.push(new THREE.Vector3(x, y, z));
    }
    if (farHillParams.treeCount > 0 && hitCount === 0) {
        console.warn("Far-hill trees: raycaster hit nothing; check farHill transform and bounds. Using yFallback for all.");
    }
}

rebuildFarHillTrees();

// Road surface: control points captured from draggable Bezier editor (logs/bezier.txt)
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
farPavementSurface.traverse((o) => { if (o.isMesh) o.receiveShadow = true; });
scene.add(farPavementSurface);

// Near Pavement: shares road's j=0 edge as its j=3 edge, extends in negative z (towards camera)
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
nearPavementSurface.traverse((o) => { if (o.isMesh) o.receiveShadow = true; });
scene.add(nearPavementSurface);

// Fixed B-spline surface (4x4 grid from given control point coordinates)
const bsplineControlPointsGrass1 = [
    // Row 0 (i=0)
    new THREE.Vector3(-15.07, -0.41, -6.81),   // P0 (0,0)
    new THREE.Vector3(-11.56, -1.05, -0.19),   // P1 (0,1)
    new THREE.Vector3(-11.5, -1.25, 2.35),     // P2 (0,2)
    new THREE.Vector3(-7.2, -3.99, 13.34),    // P3 (0,3)
    // Row 1 (i=1)
    new THREE.Vector3(-3.81, -0.18, -10.93),   // P4 (1,0)
    new THREE.Vector3(-1, 2, -1),               // P5 (1,1)
    new THREE.Vector3(12.81, -1.71, 1.61),     // P6 (1,2)
    new THREE.Vector3(29.78, -11.5, 14.08),   // P7 (1,3)
    // Row 2 (i=2)
    new THREE.Vector3(4.63, 0.8, -16.05),      // P8 (2,0)
    new THREE.Vector3(7.58, 5.08, -10.17),     // P9 (2,1)
    new THREE.Vector3(23.69, 0.25, 0.68),     // P10 (2,2)
    new THREE.Vector3(46.1, -15.4, 18.27),    // P11 (2,3)
    // Row 3 (i=3)
    new THREE.Vector3(23.97, 0.41, -15.83),   // P12 (3,0)
    new THREE.Vector3(34.02, -1.05, -24.84),  // P13 (3,1)
    new THREE.Vector3(106.14, -19.19, -28.23), // P14 (3,2)
    new THREE.Vector3(83.97, -21.84, 15.02)   // P15 (3,3)
];

const grassTexture = getTexture('textures/grass_01_2k/grass_01_color_2k.png', 'Error loading grass texture');
grassTexture.wrapS = grassTexture.wrapT = THREE.RepeatWrapping;
grassTexture.repeat.set(4, 4);
const grassMaterial = new THREE.MeshPhongMaterial({
    map: grassTexture,
    side: THREE.DoubleSide,
    shininess: 80
});
const bsplineSurface = createBSplineSurface(bsplineControlPointsGrass1, {
    dimU: 4,
    dimV: 4,
    segments: 10,
    showHull: false,
    showControlPoints: false,
    wireframe: false,
    color: 0x00aaff,
    material: grassMaterial
});
bsplineSurface.position.set(0, 0, -20);
scene.add(bsplineSurface);

const bsplineControlPointsGrass2 = [
        // Row 0 (i=0)
        new THREE.Vector3(-46.42, 4.71, 7.23),   // P0 (0,0)
        new THREE.Vector3(-49.01, 5.25, 8.14),   // P1 (0,1)
        new THREE.Vector3(-49.53, 5.14, 10.09),  // P2 (0,2)
        new THREE.Vector3(-51.86, 5.79, 13.05),   // P3 (0,3)
        // Row 1 (i=1)
        new THREE.Vector3(-37.41, 2.12, 2.44),   // P4 (1,0)
        new THREE.Vector3(-24.34, 2.56, 9.28),   // P5 (1,1)
        new THREE.Vector3(-34.76, 4.45, 7.43),   // P6 (1,2)
        new THREE.Vector3(-26.42, 0.42, 12.18),   // P7 (1,3)
        // Row 2 (i=2)
        new THREE.Vector3(-27.66, 1.12, -0.16),   // P8 (2,0)
        new THREE.Vector3(-20.08, 3.04, 9.57),    // P9 (2,1)
        new THREE.Vector3(-29.99, 2.39, 3.19),   // P10 (2,2)
        new THREE.Vector3(-44.7, 4.38, 11.24),   // P11 (2,3)
        // Row 3 (i=3)
        new THREE.Vector3(-21.12, 0.04, -2.95),   // P12 (3,0)
        new THREE.Vector3(-17.21, -1.84, 4.89),   // P13 (3,1)
        new THREE.Vector3(-16.25, -2.86, 4.2),    // P14 (3,2)
        new THREE.Vector3(-13.17, -3.02, 14.91)   // P15 (3,3)
]
const bsplineSurfaceGrass2 = createBSplineSurface(bsplineControlPointsGrass2, {
    dimU: 4,
    dimV: 4,
    segments: 10,
    showHull: false,
    showControlPoints: false,
    wireframe: false,
    color: 0x00aaff,
    material: grassMaterial
});
bsplineSurfaceGrass2.position.set(0, 0, -20);
scene.add(bsplineSurfaceGrass2);

// Transparent 50x50 B-spline wave plane at y=20 (animated in animate())
const WAVE_PLANE_SIZE = 150;
const WAVE_PLANE_BASE_Y = 26;
const WAVE_PLANE_AMP = 14;
const wavePlaneControlPoints = [];
for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
        const x = (j / 3) * WAVE_PLANE_SIZE;
        const z = (i / 3) * WAVE_PLANE_SIZE;
        wavePlaneControlPoints.push(new THREE.Vector3(x, WAVE_PLANE_BASE_Y, z));
    }
}
const wavePlaneMaterial = new THREE.MeshPhongMaterial({
    color: 0xaaccff,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
    shininess: 80
});
const wavePlaneGroup = createBSplineSurface(wavePlaneControlPoints, {
    dimU: 4,
    dimV: 4,
    segments: 4,
    material: wavePlaneMaterial,
    showHull: false,
    showControlPoints: false
});
wavePlaneGroup.position.set(-75, 0, -150);
scene.add(wavePlaneGroup);

// Grid of point lights on the wave plane (raycasting each frame to follow surface y).
// Keep grid small (e.g. 10x10) to stay under WebGL MAX_FRAGMENT_UNIFORM_VECTORS (often 1024).
// Sphere materials use emissive so they appear to emit light and pass the bloom threshold (see bloomParams.threshold).
const WAVE_PLANE_LIGHTS_GRID = 5; // 25 lights (FPS: was 8 -> 64)
const WAVE_PLANE_LIGHT_INTENSITY = 1.8;
const WAVE_PLANE_LIGHT_DISTANCE = 120; // large so light projects far over the scene
// Reusable vector for B-spline eval (avoids allocation in animate loop)
const _wavePlaneEvalWorldPos = new THREE.Vector3();
const wavePlaneLightSphereGeo = new THREE.IcosahedronGeometry(1, 5);
// Scale color to a target luminance so red, yellow, blue all bloom equally (perceptually even glow).
const WAVE_PLANE_LIGHT_TARGET_LUMINANCE = 1.0;
function wavePlaneColorWithEqualLuminance(hueNorm, saturation = 1, targetLum = WAVE_PLANE_LIGHT_TARGET_LUMINANCE) {
    const c = new THREE.Color().setHSL(hueNorm, saturation, 0.5);
    const r = c.r, g = c.g, b = c.b;
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (lum > 1e-6) {
        const scale = targetLum / lum;
        c.r = r * scale;
        c.g = g * scale;
        c.b = b * scale;
    }
    return c;
}
const wavePlaneLightEntries = [];
for (let i = 0; i < WAVE_PLANE_LIGHTS_GRID; i++) {
    for (let j = 0; j < WAVE_PLANE_LIGHTS_GRID; j++) {
        const xLocal = (j / (WAVE_PLANE_LIGHTS_GRID - 1)) * WAVE_PLANE_SIZE;
        const zLocal = (i / (WAVE_PLANE_LIGHTS_GRID - 1)) * WAVE_PLANE_SIZE;
        const hue = ((i * WAVE_PLANE_LIGHTS_GRID + j) / (WAVE_PLANE_LIGHTS_GRID * WAVE_PLANE_LIGHTS_GRID)) * 360;
        const color = wavePlaneColorWithEqualLuminance(hue / 360, 1);
        const light = new THREE.PointLight(color, WAVE_PLANE_LIGHT_INTENSITY, WAVE_PLANE_LIGHT_DISTANCE);
        const sphereMesh = new THREE.Mesh(wavePlaneLightSphereGeo, new THREE.MeshStandardMaterial({
            color: color.clone(),
            emissive: color.clone(),
            emissiveIntensity: 1
        }));
        wavePlaneLightEntries.push({ light, mesh: sphereMesh, xLocal, zLocal });
        scene.add(light);
        scene.add(sphereMesh);
    }
}

// Draggable Bezier surfaces state
const draggableBezierSurfaces = [];
let selectedDraggableIndex = -1; // -1 means no selection
let dragControls = null;

// Draggable B-spline surfaces state
const draggableBSplineSurfaces = [];
let selectedBSplineIndex = -1;
let dragControlsBSpline = null;

// Planar reflections: one render per face (front and back only).
const REFLECTION_SIZE = 256; // reduced for FPS (was 512)
const reflectionTargets = {
    front: new THREE.WebGLRenderTarget(REFLECTION_SIZE, REFLECTION_SIZE),
    back: new THREE.WebGLRenderTarget(REFLECTION_SIZE, REFLECTION_SIZE)
};
const reflectionCameras = {
    front: new THREE.PerspectiveCamera(75, 1, 0.1, 1000),
    back: new THREE.PerspectiveCamera(75, 1, 0.1, 1000)
};
reflectionCameras.front.aspect = reflectionCameras.back.aspect = 1;
reflectionCameras.front.updateProjectionMatrix();
reflectionCameras.back.updateProjectionMatrix();
// Building at (0, 0, -20) scale 3; front/back planes for window faces
const reflectionPlanes = {
    front: new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 4.5, -27.5)),
    back: new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 4.5, -14))
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
        back: { renderTarget: reflectionTargets.back, camera: reflectionCameras.back }
    }
});
dunelm.traverse((o) => { if (o.isMesh) { o.receiveShadow = true; o.castShadow = true; } });
scene.add(dunelm);

// Kingsgate Bridge
const bridgeDeckLength = 30;
const bridgeScale = 4;
const bridge = createKingsgateBridge(-20, -0.4, -100, bridgeScale, { deckLength: bridgeDeckLength });
bridge.traverse((o) => { if (o.isMesh) { o.receiveShadow = true; o.castShadow = true; } });
scene.add(bridge);

// Staircase from pavement to bridge
const staircaseStart = new THREE.Vector3(-10, -3.7, -6.8);   // pavement edge center
const staircaseEnd = new THREE.Vector3(-18, -0.4, -100 + (bridgeDeckLength / 2) * bridgeScale + 15); // bridge level
const staircase = createStaircase(staircaseStart, staircaseEnd, {
    width: 6,
    stepHeight: 1.0,
    stepDepth: 3.0
});
staircase.traverse((o) => { if (o.isMesh) { o.receiveShadow = true; o.castShadow = true; } });
scene.add(staircase);

// floor at end of staircase, bridge and SU entrance
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

// Path from connection surface (edge 3-4: staircase left to bridge left) to road at y>7 (so path does not cross staircase)
const PATH_WIDTH = 10;
const pathConnectionA = connectionSurfacePoints[4]; // bridge left (-24, 0.8, -40)
const pathConnectionB = connectionSurfacePoints[3]; // staircase left (-20.75, -0.4, -23.79)
const pathMidpoint = new THREE.Vector3().addVectors(pathConnectionA, pathConnectionB).multiplyScalar(0.5);
// Road v=0 edge: y is high at u=0, drops with u. Find uMax so that eval(uMax, 0).y >= 7.
const PATH_ROAD_MIN_Y = 7;
let uMax = 1;
for (let i = 0; i <= 100; i++) {
    const u = i / 100;
    if (evalBezierSurface(u, 0, roadControlPoints).y < PATH_ROAD_MIN_Y) {
        uMax = u;
        break;
    }
}
// u_center in [0, uMax] closest to path midpoint in xz
let uCenter = 0;
let bestDistSq = Infinity;
for (let i = 0; i <= 100; i++) {
    const u = (i / 100) * uMax;
    const P = evalBezierSurface(u, 0, roadControlPoints);
    const dSq = (P.x - pathMidpoint.x) ** 2 + (P.z - pathMidpoint.z) ** 2;
    if (dSq < bestDistSq) {
        bestDistSq = dSq;
        uCenter = u;
    }
}
// u0, u1 in [0, uMax] so road segment length is PATH_WIDTH
let pathLow = 0, pathHigh = 0.5;
for (let iter = 0; iter < 50; iter++) {
    const d = (pathLow + pathHigh) / 2;
    const u0 = Math.max(0, uCenter - d);
    const u1 = Math.min(uMax, uCenter + d);
    const P0 = evalBezierSurface(u0, 0, roadControlPoints);
    const P1 = evalBezierSurface(u1, 0, roadControlPoints);
    const dist = P0.distanceTo(P1);
    if (dist < PATH_WIDTH) pathLow = d;
    else pathHigh = d;
}
const pathU0 = Math.max(0, uCenter - (pathLow + pathHigh) / 2);
const pathU1 = Math.min(uMax, uCenter + (pathLow + pathHigh) / 2);
const pathRoadP0 = evalBezierSurface(pathU0, 0, roadControlPoints);
const pathRoadP1 = evalBezierSurface(pathU1, 0, roadControlPoints);
const pathQuadPoints = [
    pathConnectionA,
    pathConnectionB,
    pathRoadP1,
    pathRoadP0
];
const pathSurface = createQuadSurface(pathQuadPoints, { color: 0x666666 });
pathSurface.traverse((o) => { if (o.isMesh) { o.receiveShadow = true; o.castShadow = true; } });
scene.add(pathSurface);

// Oak tree in front of SU entrance
const treeElement = createOakTree(0, 0);
treeElement.traverse((o) => { if (o.isMesh) o.castShadow = true; });
treeElement.position.set(-28, 1, -12);
scene.add(treeElement);

// Lily structures (Elysium Garden style) — randomly placed on grass B-spline surface, count controlled by GUI
const LUMINOUS_PETAL_COLORS = [
    0xff44aa, 0x00ddcc, 0xffaa44, 0xaa44ff, 0x44ffaa, 0xff6644, 0x4488ff, 0xffcc00
];
function randomLuminousPetalColor() {
    return LUMINOUS_PETAL_COLORS[Math.floor(Math.random() * LUMINOUS_PETAL_COLORS.length)];
}
const lilyContainer = new THREE.Group();
scene.add(lilyContainer);
const _lilyEvalPos = new THREE.Vector3();
const lilyParams = { count: 8 };
function updateLilies() {
    while (lilyContainer.children.length > 0) lilyContainer.remove(lilyContainer.children[0]);
    if (lilyParams.count <= 0) return;
    bsplineSurface.updateMatrixWorld(true);
    for (let i = 0; i < lilyParams.count; i++) {
        const u = 0.12 + Math.random() * 0.76;
        const v = 0.12 + Math.random() * 0.76;
        getBSplineSurfaceWorldPointAtNormalized(bsplineSurface, bsplineControlPointsGrass1, u, v, _lilyEvalPos);
        const lily = createLilyStructure(_lilyEvalPos.x, _lilyEvalPos.y, _lilyEvalPos.z, {
            stemHeight: 4 + Math.random() * 1.5,
            petalColor: randomLuminousPetalColor()
        });
        lilyContainer.add(lily);
    }
}
updateLilies();

// --- Instanced characters with octree, frustum culling, walkable placement ---
const WALKABLE_WORLD_BOUNDS = new THREE.Box3(
    new THREE.Vector3(-75, -25, -165),
    new THREE.Vector3(90, 12, 15)
);
const octree = new Octree(WALKABLE_WORLD_BOUNDS, { maxDepth: 6, minSize: 2 });
const MAX_PLACEMENT_RETRIES = 50;

const walkableRegions = [
    createBezierSampler(farPavementControlPoints),
    createBezierSampler(nearPavementControlPoints),
    createBridgeDeckSampler(-20, 0.8, -100, bridgeScale, bridgeDeckLength),
    createConnectionSampler(connectionSurfacePoints),
    createQuadSampler(pathQuadPoints),
    createStaircaseSampler(staircaseStart, staircaseEnd, 6, 1.0)
];
const walkableSampler = createCombinedSampler(walkableRegions);

// Sampled pos is the surface (plane) where feet should stand. We add getFeetSurfaceYOffset() so the
// mesh origin (which sits above the feet in bind pose) is placed above the surface and feet touch the plane.
const CHARACTER_HEIGHT = 3.65; // feet to top of head for bounds
const PERSON_RADIUS = 0.8; // for bounds and placement
const FEET_SURFACE_Y_OFFSET = Figure.getFeetSurfaceYOffset();
const FLOCK_RADIUS = 20; // max distance for separation/alignment/cohesion

const peopleParams = { count: 1200 };
const _dummyMatrix = new THREE.Matrix4();
const _flockBox = new THREE.Box3();
const _flockBoxSize = new THREE.Vector3(FLOCK_RADIUS * 2, FLOCK_RADIUS * 2, FLOCK_RADIUS * 2);
const _flockNeighbors = []; // reused for octree.queryBounds in applyPhysics
const _flockSeenIds = new Set(); // dedupe octree results in applyPhysics
const _visiblePeopleSet = new Set(); // for frustum culling
const _dummyPosition = new THREE.Vector3();
const _dummyQuaternion = new THREE.Quaternion();
const _dummyScale = new THREE.Vector3(1, 1, 1);

let people = [];
modifyCrowd(peopleParams.count);

let cameraFrustum = new THREE.Frustum();
let frustumMatrix = new THREE.Matrix4();

let frameCount = 0;
let octreeDebugLine = null;
const animationClock = new THREE.Clock();

function applyWalkCycle(skinnedMesh, entity, time) {
    const bi = skinnedMesh.userData.boneIndices;
    if (!bi || !skinnedMesh.skeleton) return;

    const bones = skinnedMesh.skeleton.bones;
    const phase = (entity.id * 0.1 + time) % (2 * Math.PI);
    const legSwing = 0.4;
    const armSwing = 0.3;
    if (bones[bi.legL]) bones[bi.legL].rotation.x = phase < Math.PI ? -legSwing : legSwing;
    if (bones[bi.legR]) bones[bi.legR].rotation.x = phase < Math.PI ? legSwing : -legSwing;
    if (bones[bi.armL]) bones[bi.armL].rotation.x = phase < Math.PI ? armSwing : -armSwing;
    if (bones[bi.armR]) bones[bi.armR].rotation.x = phase < Math.PI ? -armSwing : armSwing;
}

function applyIdle(skinnedMesh) {
    const bi = skinnedMesh.userData.boneIndices;
    if (!bi || !skinnedMesh.skeleton) return;
    const bones = skinnedMesh.skeleton.bones;
    if (bones[bi.legL]) bones[bi.legL].rotation.x = 0;
    if (bones[bi.legR]) bones[bi.legR].rotation.x = 0;
    if (bones[bi.armL]) bones[bi.armL].rotation.x = 0;
    if (bones[bi.armR]) bones[bi.armR].rotation.x = 0;
}

function updateOctreeDebugLine() {
    if (octreeDebugLine) {
        scene.remove(octreeDebugLine);
        octreeDebugLine.geometry.dispose();
        octreeDebugLine.material.dispose();
        octreeDebugLine = null;
    }
    const cells = octree.getCells();
    const boxes = cells.length > 0 ? cells : [octree.worldBounds.clone()];
    octreeDebugLine = createOctreeDebugLines(boxes);
    if (octreeDebugLine) scene.add(octreeDebugLine);
}

// Night lighting: dim ambient, blue-tinted moon, hemisphere for sky/ground
const ambientLight = new THREE.AmbientLight(0x202040, 0.8);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xaaccff, 0.6);
directionalLight.position.set(2, 5, 3);
directionalLight.castShadow = true;
// Shadow camera must cover scene bounds (~ -75..90 x, -165..15 z) for shadows to appear
directionalLight.shadow.mapSize.set(1024, 1024); // reduced for FPS (was 2048)
directionalLight.shadow.camera.near = 0.5;
directionalLight.shadow.camera.far = 500;
directionalLight.shadow.camera.left = -120;
directionalLight.shadow.camera.right = 120;
directionalLight.shadow.camera.top = 120;
directionalLight.shadow.camera.bottom = -120;
directionalLight.shadow.bias = -0.0001;
scene.add(directionalLight);

// Hemisphere light: sky (top) and ground (bottom) fill for night; replaces expensive sky dome
const hemisphereLight = new THREE.HemisphereLight(0x1a1a2e, 0x080810, 0.7);
scene.add(hemisphereLight);

// Position the camera
camera.position.set(5, 5, 5);
camera.lookAt(0, 0, 0);
camera.layers.enable(1); // see window meshes (layer 1)

// Gather stats on performance
const stats = Stats();
document.body.appendChild(stats.dom);

// Axis helper
const axesHelper = new THREE.AxesHelper(5);
scene.add(axesHelper);

// Creating a GUI with options
const gui = new GUI({ name: "Lumiere GUI" });
const cameraFolder = gui.addFolder("Camera");
cameraFolder.add(camera.position, "z", 0, 10);
cameraFolder.open();

const skyFolder = gui.addFolder("Sky (gradient)");
skyFolder.addColor(nightGradientParams, "topColor").name("Zenith").onChange(applyNightGradient);
skyFolder.addColor(nightGradientParams, "bottomColor").name("Horizon").onChange(applyNightGradient);
skyFolder.open();

const peopleFolder = gui.addFolder("People");
peopleFolder.add(peopleParams, "count", 0, 2000).step(1).onChange((newCount) => {
        const delta = newCount - people.length;
        if (delta !== 0) modifyCrowd(delta);
    });
peopleFolder.open();

const farHillFolder = gui.addFolder("Far hill");
farHillFolder.add(farHillParams, "treeCount", 0, 500).step(1).name("Tree count").onChange(rebuildFarHillTrees);
farHillFolder.open();

const lilyFolder = gui.addFolder("Lilies");
lilyFolder.add(lilyParams, "count", 0, 40).step(1).name("Count").onChange(updateLilies);
lilyFolder.open();

const lightFestivalFolder = gui.addFolder("Light Festival");
lightFestivalFolder.add(bloomParams, "strength", 0, 2).name("Bloom strength").onChange((v) => { bloomPass.strength = v; });
lightFestivalFolder.add(bloomParams, "radius", 0, 1).name("Bloom radius").onChange((v) => { bloomPass.radius = v; });
lightFestivalFolder.add(bloomParams, "threshold", 0, 1).name("Bloom threshold").onChange((v) => { bloomPass.threshold = v; });
lightFestivalFolder.open();

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

const bsplineParams = {
    showHull: false,
    showControlPoints: false,
    wireframe: false
};
const bsplineFolder = gui.addFolder("B-spline surface");
bsplineFolder.add(bsplineParams, "showHull").name("Show control hull").onChange((v) => {
    if (bsplineSurface?.userData.bspline?.hull) bsplineSurface.userData.bspline.hull.visible = v;
    draggableBSplineSurfaces.forEach(s => {
        if (s.userData.bspline?.hull) s.userData.bspline.hull.visible = v;
    });
});
bsplineFolder.add(bsplineParams, "showControlPoints").name("Show control points").onChange((v) => {
    if (bsplineSurface?.userData.bspline?.controlPoints) {
        bsplineSurface.userData.bspline.controlPoints.forEach(sp => { sp.visible = v; });
    }
    draggableBSplineSurfaces.forEach(s => {
        (s.userData.bspline?.controlPoints || []).forEach(sp => { sp.visible = v; });
    });
});
bsplineFolder.add(bsplineParams, "wireframe").name("Wireframe overlay").onChange((v) => {
    if (bsplineSurface?.userData.bspline?.wireframe) bsplineSurface.userData.bspline.wireframe.visible = v;
    draggableBSplineSurfaces.forEach(s => {
        if (s.userData.bspline?.wireframe) s.userData.bspline.wireframe.visible = v;
    });
});

const draggableBSplineParams = {
    selectedBSpline: 'None',
    addBSplineSurface: function () {
        const initialPoints = [];
        for (let i = 0; i < 4; i++) {
            for (let j = 0; j < 4; j++) {
                const x = (i - 1.5) * 2;
                const z = (j - 1.5) * 2;
                const y = (i === 1 || i === 2) && (j === 1 || j === 2) ? 2 : 0;
                initialPoints.push(new THREE.Vector3(x, y, z));
            }
        }
        const draggableSurface = createDraggableBSplineSurface(initialPoints, {
            dimU: 4,
            dimV: 4,
            segments: 20,
            showHull: true,
            showControlPoints: true,
            wireframe: false
        });
        const offset = draggableBSplineSurfaces.length * 10;
        draggableSurface.position.set(offset, 0, -20);
        scene.add(draggableSurface);
        draggableBSplineSurfaces.push(draggableSurface);
        selectedBSplineIndex = draggableBSplineSurfaces.length - 1;
        selectedDraggableIndex = -1;
        updateDragControls();
        updateBSplineDragControls();
        updateBSplineSelectionDropdown();
        updateCoordsDisplay();
    },
    saveCoordinates: function () {
        if (selectedBSplineIndex < 0 || selectedBSplineIndex >= draggableBSplineSurfaces.length) {
            console.log('No draggable B-spline surface selected');
            return;
        }
        const selected = draggableBSplineSurfaces[selectedBSplineIndex];
        const controlPointMeshes = selected.userData.bspline.controlPoints;
        const dimU = selected.userData.bspline.dimU;
        const dimV = selected.userData.bspline.dimV;
        const positions = controlPointMeshes.map((mesh, idx) => {
            const i = Math.floor(idx / dimV);
            const j = idx % dimV;
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
        console.log('=== Draggable B-spline Surface ' + (selectedBSplineIndex + 1) + ' Control Points ===');
        console.log(JSON.stringify(positions, null, 2));
        positions.forEach(p => {
            console.log(`P${p.index} (${p.grid[0]},${p.grid[1]}): (${p.position.x}, ${p.position.y}, ${p.position.z})`);
        });
    }
};

const draggableBSplineFolder = gui.addFolder("Draggable B-spline");
draggableBSplineFolder.add(draggableBSplineParams, 'addBSplineSurface').name('Add B-spline surface');

let bsplineSelectionController = null;
function updateBSplineSelectionDropdown() {
    if (bsplineSelectionController) {
        draggableBSplineFolder.remove(bsplineSelectionController);
    }
    if (draggableBSplineSurfaces.length > 0) {
        const options = {};
        for (let i = 0; i < draggableBSplineSurfaces.length; i++) {
            options['B-spline ' + (i + 1)] = i;
        }
        draggableBSplineParams.selectedBSpline = selectedBSplineIndex >= 0 ? selectedBSplineIndex : 0;
        bsplineSelectionController = draggableBSplineFolder.add(draggableBSplineParams, 'selectedBSpline', options).name('Selected surface').onChange((value) => {
            selectedBSplineIndex = parseInt(value);
            selectedDraggableIndex = -1;
            updateDragControls();
            updateBSplineDragControls();
            updateCoordsDisplay();
        });
    }
}
draggableBSplineFolder.add(draggableBSplineParams, 'saveCoordinates').name('Save control coordinates');

const draggableParams = {
    selectedCurve: 'None',
    addBezierSurface: function () {
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
        selectedBSplineIndex = -1;
        updateBSplineDragControls();
        updateDragControls();
        updateSelectionDropdown();
        updateCoordsDisplay();
    },
    saveCoordinates: function () {
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
            selectedBSplineIndex = -1;
            updateBSplineDragControls();
            updateDragControls();
            updateCoordsDisplay();
        });
    }
}

draggableFolder.add(draggableParams, 'saveCoordinates').name('Save control coordinates');

// Debug: Octree visualisation
const debugParams = { octree: false };
const debugFolder = gui.addFolder("Debug");
debugFolder.add(debugParams, "octree").name("Octree").onChange((v) => {
    if (v) {
        updateOctreeDebugLine();
    } else {
        if (octreeDebugLine) {
            scene.remove(octreeDebugLine);
            octreeDebugLine = null;
        }
    }
});

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
    <h2 style="margin: 0 0 4px 0; font-size: 14px; color: #2ecc71; text-transform: uppercase;">Control point coordinates</h2>
    <div id="coordsType" style="margin: 0 0 6px 0; font-size: 11px; color: #888;">—</div>
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
    const coordsType = document.getElementById('coordsType');
    if (!coordsList) return;

    // B-spline selected: show B-spline control point coordinates
    if (selectedBSplineIndex >= 0 && selectedBSplineIndex < draggableBSplineSurfaces.length) {
        if (coordsType) coordsType.textContent = 'B-spline ' + (selectedBSplineIndex + 1);
        const selected = draggableBSplineSurfaces[selectedBSplineIndex];
        const controlPointMeshes = selected.userData.bspline.controlPoints;
        const dimV = selected.userData.bspline.dimV;
        const lines = [];
        for (let idx = 0; idx < controlPointMeshes.length; idx++) {
            const i = Math.floor(idx / dimV);
            const j = idx % dimV;
            const pos = controlPointMeshes[idx].position;
            lines.push(`P${idx} (${i},${j}): (${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)})`);
        }
        coordsList.textContent = lines.join('\n');
        return;
    }

    // Bezier selected: show Bezier control point coordinates
    if (selectedDraggableIndex >= 0 && selectedDraggableIndex < draggableBezierSurfaces.length) {
        if (coordsType) coordsType.textContent = 'Bezier ' + (selectedDraggableIndex + 1);
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
        return;
    }

    // No draggable selected: show fixed B-spline control point coordinates if available
    if (bsplineSurface?.userData?.bspline?.controlPoints?.length) {
        if (coordsType) coordsType.textContent = 'B-spline (fixed)';
        const controlPointMeshes = bsplineSurface.userData.bspline.controlPoints;
        const dimV = bsplineSurface.userData.bspline.dimV;
        const lines = [];
        for (let idx = 0; idx < controlPointMeshes.length; idx++) {
            const i = Math.floor(idx / dimV);
            const j = idx % dimV;
            const pos = controlPointMeshes[idx].position;
            lines.push(`P${idx} (${i},${j}): (${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)})`);
        }
        coordsList.textContent = lines.join('\n');
        return;
    }

    if (coordsType) coordsType.textContent = '—';
    coordsList.textContent = '—';
}

function updateBSplineDragControls() {
    if (dragControlsBSpline) {
        dragControlsBSpline.dispose();
        dragControlsBSpline = null;
    }
    if (selectedBSplineIndex >= 0 && selectedBSplineIndex < draggableBSplineSurfaces.length) {
        const selectedGroup = draggableBSplineSurfaces[selectedBSplineIndex];
        const controlPointMeshes = selectedGroup.userData.bspline.controlPoints;
        dragControlsBSpline = new DragControls(controlPointMeshes, camera, renderer.domElement);
        dragControlsBSpline.addEventListener('dragstart', () => { orbitControls.enabled = false; });
        dragControlsBSpline.addEventListener('dragend', () => { orbitControls.enabled = true; });
        dragControlsBSpline.addEventListener('hoveron', (e) => { e.object.material.color.set(0xffaa00); });
        dragControlsBSpline.addEventListener('hoveroff', (e) => { e.object.material.color.set(0xcccccc); });
    }
}

function updateCrowdCount() {
    peopleParams.count = people.length;
}

function modifyCrowd(n) {
    if (n > 0) {
        for (let i = 0; i < n; i++) {
            let placed = false;
            for (let retry = 0; retry < MAX_PLACEMENT_RETRIES && !placed; retry++) {
                const pos = walkableSampler.sampleRandom();
                const bounds = new THREE.Box3(
                    new THREE.Vector3(pos.x - PERSON_RADIUS, pos.y, pos.z - PERSON_RADIUS),
                    new THREE.Vector3(pos.x + PERSON_RADIUS, pos.y + CHARACTER_HEIGHT, pos.z + PERSON_RADIUS)
                );
                const existing = octree.queryBounds(bounds);
                if (existing.length === 0) {
                    const position = new THREE.Vector3(pos.x, pos.y + FEET_SURFACE_Y_OFFSET / 2, pos.z);
                    const person = createPersonWithLOD({ position, rotationY: Math.random() * Math.PI * 2 });
                    person.bounds = bounds;
                    person.id = people.length;
                    person.mesh.position.copy(position);
                    person.mesh.rotation.y = person.rotationY;
                    scene.add(person.mesh);
                    octree.insert(person);
                    people.push(person);
                    placed = true;
                }
            }
        }
        updateCrowdCount();
    } else {
        const count = Math.min(people.length, Math.abs(n));
        for (let i = 0; i < count; i++) {
            scene.remove(people.pop().mesh);
        }
        updateCrowdCount();
        octree.clear();
        for (const p of people) octree.insert(p);
        if (octreeDebugLine) updateOctreeDebugLine();
    }
}

const PARAMS = {
    sep: { on: true, val: 1.5 },
    ali: { on: true, val: 1.0 },
    coh: { on: true, val: 1.0 },
}
const MAX_FORCE = 0.03;

function applyPhysics(person) {
    const force = new THREE.Vector3();
    const sep = new THREE.Vector3(), ali = new THREE.Vector3(), coh = new THREE.Vector3();
    let count = 0;

    // FLOCKING ALGORITHM (spatial: use octree so O(n*k) not O(n^2))
    _flockBox.setFromCenterAndSize(person.pos, _flockBoxSize);
    octree.queryBounds(_flockBox, _flockNeighbors); // output to _flockNeighbours all characters within a certain range of a person
    _flockSeenIds.clear();
    for (let k = 0; k < _flockNeighbors.length; k++) {
        const other = _flockNeighbors[k];
        if (other === person || _flockSeenIds.has(other.id)) continue;
        _flockSeenIds.add(other.id);
        const dist = person.pos.distanceTo(other.pos);
        if (dist > 0 && dist < FLOCK_RADIUS) {
            if (PARAMS.sep.on) {
                const push = new THREE.Vector3().subVectors(person.pos, other.pos).normalize().divideScalar(dist);
                sep.add(push);
            }
            if (PARAMS.ali.on) ali.add(other.vel);
            if (PARAMS.coh.on) coh.add(other.pos);
            count++;
        }
    }

    // avoid tree and dunelm building (static objects)
    const distTree = person.pos.distanceTo(treeElement.position);
    if (distTree < treeElement.userData.radius) {
        const push = new THREE.Vector3().subVectors(person.pos, treeElement.position).normalize().multiplyScalar((treeElement.userData.radius - distTree) * 0.5);
        force.add(push);
    }

    const distDunelm = person.pos.distanceTo(dunelm.position);
    if (distDunelm < dunelm.userData.radius) {
        const push = new THREE.Vector3().subVectors(person.pos, dunelm.position).normalize().multiplyScalar((dunelm.userData.radius - distDunelm) * 0.5);
        force.add(push);
    }

    // Goal Seeking
    if (person.target) {
        const destination = new THREE.Vector3().subVectors(person.target, person.pos);
        const dist = destination.length();
        destination.normalize();
        if (destination < 15) {
            destination.multiplyScalar(person.maxSpeed * (dist / 15));
        } else {
            destination.multiplyScalar(person.maxSpeed);
        }
        force.add(new THREE.Vector3().subVectors(destination, person.vel).clampLength(0, MAX_FORCE));
    } else if (person.state === 'WANDER') {
        // Random wander; boundary enforced by walkable regions in applyPhysics
        const wander = new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize().multiplyScalar(MAX_FORCE * 0.8);
        force.add(wander);
    }

    person.acc.add(force);
    person.vel.add(person.acc);
    if (person.state === 'SNAPPING') {
        const snapTimer = person.snapTimer || 0;
        if (snapTimer < 15) person.vel.multiplyScalar(0.92);
        else if (snapTimer < SNAP_END_FRAME) person.vel.multiplyScalar(0.95);
        else person.state = 'WANDER';
    }
    if (person.state === "WATCHING") person.vel.multiplyScalar(0.85);
    else person.vel.clampLength(0, person.maxSpeed);

    const candidatePos = person.pos.clone().add(person.vel);
    const info = walkableSampler.getSurfaceInfo(candidatePos.x, candidatePos.z);
    if (info.inside && info.y !== null) {
        person.pos.set(candidatePos.x, info.y + FEET_SURFACE_Y_OFFSET / 2, candidatePos.z);
        if (person.prevPosition) person.prevPosition.copy(person.pos);
    } else {
        person.vel.multiplyScalar(-0.2);
    }
    person.acc.set(0, 0, 0);

    if (person.state === 'SNAPPING') {
        person.snapTimer = (person.snapTimer || 0) + 1;
        if (person.snapTimer > SNAP_END_FRAME) {
            person.state = 'WANDER';
            delete person.snapTimer;
            delete person.snapFlashDone;
        }
    }

    return person;
}

// SNAPPING phase lengths (frames); total ~0.7 s at 60fps
const SNAP_ARM_UP_DURATION = 16;
const SNAP_FLASH_FRAME = 17;
const SNAP_ARM_DOWN_START = 24;
const SNAP_ARM_DOWN_END = 38;
const SNAP_ARM_UP_ANGLE = -1.2;
const SNAP_END_FRAME = 40;  // return to WANDER after this

function animatePerson(person) {
    person.mesh.position.copy(person.pos);
    person.mesh.position.y = person.pos.y;

    if (person.state === 'SNAPPING') {
        const snapTimer = person.snapTimer || 0;
        const ang = Math.atan2(person.vel.x, person.vel.z);
        person.mesh.quaternion.slerp(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ang), 0.1);
        if (snapTimer < SNAP_ARM_UP_DURATION) {
            const u = snapTimer / SNAP_ARM_UP_DURATION;
            person.parts.armRight.rotation.x = SNAP_ARM_UP_ANGLE * u;
        } else if (snapTimer >= SNAP_ARM_DOWN_START && snapTimer < SNAP_ARM_DOWN_END) {
            const u = (snapTimer - SNAP_ARM_DOWN_START) / (SNAP_ARM_DOWN_END - SNAP_ARM_DOWN_START);
            person.parts.armRight.rotation.x = SNAP_ARM_UP_ANGLE * (1 - u);
        } else if (snapTimer >= SNAP_ARM_UP_DURATION && snapTimer < SNAP_ARM_DOWN_START) {
            person.parts.armRight.rotation.x = SNAP_ARM_UP_ANGLE;
        }
        if (snapTimer === SNAP_FLASH_FRAME && !person.snapFlashDone) {
            person.triggerFlash();
            person.snapFlashDone = true;
        }
        person.parts.legLeft.rotation.x *= 0.9;
        person.parts.legRight.rotation.x *= 0.9;
        person.parts.armLeft.rotation.x *= 0.9;
        return;
    }

    if (person.vel.length() > 0.02) {
        const ang = Math.atan2(person.vel.x, person.vel.z);
        person.mesh.quaternion.slerp(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ang), 0.1);
        const t = Date.now() * 0.02;
        person.parts.legLeft.rotation.x = Math.sin(t) * 0.6;
        person.parts.legRight.rotation.x = -Math.sin(t) * 0.6;
        person.parts.armLeft.rotation.x = -Math.sin(t) * 0.5;
        person.parts.armRight.rotation.x = Math.sin(t) * 0.5;
    } else {
        person.parts.legLeft.rotation.x *= 0.9;
        person.parts.legRight.rotation.x *= 0.9;
        person.parts.armLeft.rotation.x *= 0.9;
        person.parts.armRight.rotation.x *= 0.9;
    }
}

function updateDecision(person) {
    // SNAPPING is set only by selection before people loop (every 10 frames, 50% with phones); cleared only in applyPhysics when snapTimer > SNAP_END_FRAME.
}

function animate() {
    requestAnimationFrame(animate);
    if (webglContextLost) return; // stop rendering when context is lost to avoid errors

    // Keep frustum current (used for people visibility and far-hill culling)
    frustumMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    cameraFrustum.setFromProjectionMatrix(frustumMatrix);

    // Update person bounds and rebuild octree for spatial queries (physics + frustum culling)
    for (let i = 0; i < people.length; i++) {
        const p = people[i];
        p.bounds.min.set(p.pos.x - PERSON_RADIUS, p.pos.y, p.pos.z - PERSON_RADIUS);
        p.bounds.max.set(p.pos.x + PERSON_RADIUS, p.pos.y + CHARACTER_HEIGHT, p.pos.z + PERSON_RADIUS);
    }
    octree.clear();
    for (let i = 0; i < people.length; i++) octree.insert(people[i]);

    // Frustum + distance cull people: only render if in frustum and within CULL_DISTANCE
    const CULL_DISTANCE = 100;
    const visiblePeople = octree.queryFrustum(cameraFrustum);
    _visiblePeopleSet.clear();
    for (let k = 0; k < visiblePeople.length; k++) _visiblePeopleSet.add(visiblePeople[k]);
    const camPos = camera.position;
    for (let i = 0; i < people.length; i++) {
        const p = people[i];
        people[i].mesh.visible = _visiblePeopleSet.has(p) && p.pos.distanceTo(camPos) <= CULL_DISTANCE;
    }

    // Apply physics to all people (applyPhysics uses octree.queryBounds for flocking)
    for (let i = 0; i < people.length; i++) {
        if (frameCount % SNAP_END_FRAME === 0) {
            if ((people[i].getPhone() != null) && (people[i].state !== "SNAPPING") && (Math.random() < 0.6)) {
                people[i].state = "SNAPPING";
                people[i].snapTimer = 0;
                people[i].snapFlashDone = false;
            }
        }
        people[i] = applyPhysics(people[i]);
        animatePerson(people[i]);
    }

    // Update all draggable Bezier surfaces
    for (let i = 0; i < draggableBezierSurfaces.length; i++) {
        const group = draggableBezierSurfaces[i];
        if (group.userData.bezier?.update) {
            group.userData.bezier.update();
        }
    }
    // Update all draggable B-spline surfaces
    for (let i = 0; i < draggableBSplineSurfaces.length; i++) {
        const group = draggableBSplineSurfaces[i];
        if (group.userData.bspline?.update) {
            group.userData.bspline.update();
        }
    }
    if (selectedDraggableIndex >= 0 && selectedDraggableIndex < draggableBezierSurfaces.length) {
        updateCoordsDisplay();
    }
    if (selectedBSplineIndex >= 0 && selectedBSplineIndex < draggableBSplineSurfaces.length) {
        updateCoordsDisplay();
    }

    // Wave plane: animate control points y = 20 + 8*sin(t + phase) then update surface
    const waveT = performance.now() * 0.001;
    const k1 = 0.8, k2 = 0.8;
    for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
            const idx = i * 4 + j;
            wavePlaneControlPoints[idx].y = WAVE_PLANE_BASE_Y + WAVE_PLANE_AMP * Math.sin(waveT + i * k1 + j * k2);
        }
    }
    if (frameCount % 3 === 0) {
        updateBSplineSurfaceFromPoints(wavePlaneGroup, wavePlaneControlPoints);
    }

    // Wave plane lights: evaluate B-spline at (u,v) for each grid point (cheaper than raycasting)
    wavePlaneGroup.updateMatrixWorld(true);
    for (let idx = 0; idx < wavePlaneLightEntries.length; idx++) {
        const { light, mesh, xLocal, zLocal } = wavePlaneLightEntries[idx];
        const uNorm = xLocal / WAVE_PLANE_SIZE;
        const vNorm = zLocal / WAVE_PLANE_SIZE;
        getBSplineSurfaceWorldPointAtNormalized(wavePlaneGroup, wavePlaneControlPoints, uNorm, vNorm, _wavePlaneEvalWorldPos);
        light.position.copy(_wavePlaneEvalWorldPos);
        mesh.position.copy(_wavePlaneEvalWorldPos);
    }

    // Far-hill billboards: frustum + distance cull (within CULL_DISTANCE), then update only visible instance matrices
    _farHillVisibleList.length = 0;
    for (let i = 0; i < farHillTreePositions.length; i++) {
        const pos = farHillTreePositions[i];
        _farHillVisibleList.push(pos);
    }
    for (let i = 0; i < _farHillVisibleList.length; i++) {
        const pos = _farHillVisibleList[i];
        _farHillDummyObject.position.copy(pos);
        _farHillDummyObject.lookAt(camera.position);
        _dummyMatrix.compose(_farHillDummyObject.position, _farHillDummyObject.quaternion, _dummyScale);
        farHillBillboardInstancedMesh.setMatrixAt(i, _dummyMatrix);
    }
    farHillBillboardInstancedMesh.count = _farHillVisibleList.length;
    farHillBillboardInstancedMesh.instanceMatrix.needsUpdate = true;

    updateCamera();
    frameCount += 1;
    if (frameCount % 20 === 0) {
        updatePlanarReflectionTextures();
    }
    composer.render();
    stats.update();
}

animate();