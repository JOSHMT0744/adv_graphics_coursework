import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { DragControls } from "three/examples/jsm/controls/DragControls.js";
import { createOakTree } from './objects/oakTree.js';
import { COLOURS } from './constants.js';
import { Figure, createCrowdPerson, createPersonMeshOnly, getCrowdMaterials } from './objects/character.js';
import { GUI } from 'dat.gui';
import { createDunelmHouse, createDefaultEnvMap } from './objects/su.js';
import { createKingsgateBridge } from './objects/bridge.js';
import { createStaircase } from './objects/staircase.js';
import { getSharedPetalGeometry, getSharedStemGeometry, PETAL_LAYOUT } from './objects/lilyStructure.js';
import { createConnectionSurface, createQuadSurface } from './objects/connectionSurface.js';
import Stats from 'three/examples/jsm/libs/stats.module'
import { generateTerrain } from './objects/landscape/farHill.js';
import { createBezierSurface, createDraggableBezierSurface, evalBezierSurface } from './objects/surface.js';
import { createBSplineSurface, createDraggableBSplineSurface, updateBSplineSurfaceFromPoints, getBSplineSurfaceWorldPointAtNormalized } from './objects/bsplineSurface.js';
import { getTexture } from './utils/getTexture.js';
import { Octree, createOctreeDebugLines } from './utils/Octree.js';
import { createDragonfly, getDragonflyGeometry, getDragonflyGeometryLOD, getDragonflyMaterial } from './objects/dragonfly.js';
import { createNavigationGrid, findPath } from './utils/astar.js';
import {
    createBezierSampler,
    createBSplineSampler,
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
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import { WebGPURenderer } from 'three/webgpu';

// Scene setup
const scene = new THREE.Scene();

// Slight fog (matches night gradient horizon)
scene.background = new THREE.Color(0x601da3); // scene background for bloom contrast
scene.fog = new THREE.FogExp2(0x601da3, 0.003);
// Near plane 0.5 improves depth precision so SSAO correctly occludes (objects behind planes don't show through)
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.5, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: false }); // FXAA used for antialiasing; avoids MSAA cost

// Set the size of the renderer (cap pixel ratio to reduce GPU memory and context loss risk)
const pixelRatio = Math.min(window.devicePixelRatio, 2);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(pixelRatio);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.BasicShadowMap; // Faster than PCFSoftShadowMap for 1000+ entities
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

// Unified PARAMS dictionary for all GUI-controlled values (defined early so it's available for post-processing setup)
const PARAMS = {
    // Sky gradient
    sky: {
        topColor: 0x151530,
        bottomColor: 0x050510
    },
    // People
    people: {
        count: 300
    },
    // Flocking behavior
    flocking: {
        sep: { on: true, val: 1.5 },
        ali: { on: true, val: 1.0 },
        coh: { on: true, val: 1.0 }
    },
    // Far hill
    farHill: {
        treeCount: 100
    },
    // Lilies
    lilies: {
        count: 8
    },
    // Bloom / Light Festival
    bloom: {
        strength: 0.55,
        radius: 0.3,
        threshold: 0.92
    },
    // Post-processing
    postProcessing: {
        antialiasing: 'FXAA',
        ssaoEnabled: false,
        output: 'Composite',
        exposure: 1
    },
    // Performance
    performance: {
        bloomEnabled: true,
        shadowsEnabled: true,
        usePostProcessing: true
    },
    // Bezier surface display
    bezier: {
        showHull: false,
        showControlPoints: false,
        wireframe: false
    },
    // B-spline surface display
    bspline: {
        showHull: false,
        showControlPoints: false,
        wireframe: false
    },
    // Draggable B-spline (functions will be defined later)
    draggableBSpline: {
        selectedBSpline: 'None',
        addBSplineSurface: null, // will be set later
        saveCoordinates: null // will be set later
    },
    // Draggable Bezier (functions will be defined later)
    draggableBezier: {
        selectedCurve: 'None',
        addBezierSurface: null, // will be set later
        saveCoordinates: null // will be set later
    },
    // Dragonflies
    dragonflies: {
        count: 20,
        followCursor: false,
        maxSpeed: 0.35,
        maxForce: 0.04
    }
};

// Post-processing: Bloom for Light Festival aesthetic (glow on lights and reflections)
// SSAO + HDR/Bloom

// Create a render target (no MSAA by default for FPS; use FXAA for antialiasing)
const size = renderer.getSize(new THREE.Vector2());
const renderTarget = new THREE.WebGLRenderTarget(size.width, size.height, {
    samples: 0
});
const composer = new EffectComposer(renderer, renderTarget);

// Initialise FXAA Pass (keep it disabled by default)
const fxaaPass = new ShaderPass(FXAAShader);
// FXAA needs to know pixel size
fxaaPass.material.uniforms["resolution"].value.x = 1 / (window.innerWidth * window.devicePixelRatio);
fxaaPass.material.uniforms["resolution"].value.y = 1 / (window.innerHeight * window.devicePixelRatio);
fxaaPass.enabled = true; // FXAA by default (cheaper than MSAA for 1000+ entities)

// Render Pass (Base scene)
composer.addPass(new RenderPass(scene, camera));

// SSAO Pass (applied first for depth data, typically before other effects)
const ssaoPass = new SSAOPass(scene, camera, window.innerWidth, window.innerHeight);

// Tuned settings: smaller kernel for FPS; min/maxDistance keep SSAO local (avoids bleed-through)
ssaoPass.kernelRadius = 8;
ssaoPass.minDistance = 0.005;
ssaoPass.maxDistance = 0.1;
ssaoPass.enabled = false; // Disabled by default for FPS; enable in GUI if needed
// Match double-sided surfaces (e.g. grass B-spline): depth/normal pass must render both sides so
// occluding surfaces write depth and objects behind them (e.g. bridge) don't show through when SSAO is composited
ssaoPass.normalMaterial.side = THREE.DoubleSide;
// Don't apply SSAO on fully transparent surfaces: hide them during the SSAO depth/normal pass so they don't write depth
const _ssaoTransparentCache = [];
function isFullyTransparent(material) {
    if (!material) return false;
    const mat = Array.isArray(material) ? material[0] : material;
    return mat.transparent === true && typeof mat.opacity === 'number' && mat.opacity < 0.01;
}
const _originalSSAORender = ssaoPass.render.bind(ssaoPass);
ssaoPass.render = function (renderer, writeBuffer, readBuffer, deltaTime, maskActive) {
    if (!ssaoPass.enabled) return _originalSSAORender(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
    scene.traverse((obj) => {
        if (obj.isMesh && obj.visible && isFullyTransparent(obj.material)) {
            _ssaoTransparentCache.push(obj);
            obj.visible = false;
        }
    });
    _originalSSAORender(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
    _ssaoTransparentCache.forEach((o) => { o.visible = true; });
    _ssaoTransparentCache.length = 0;
};
composer.addPass(ssaoPass);

// HDR/Unreal Bloom Pass (applied after SSAO)
// 1/8 resolution bloom to save compute
const bloomResolution = new THREE.Vector2(
    Math.floor(window.innerWidth / 8),
    Math.floor(window.innerHeight / 8)
);
const bloomPass = new UnrealBloomPass(
    bloomResolution,
    PARAMS.bloom.strength,
    PARAMS.bloom.radius,
    PARAMS.bloom.threshold
);
composer.addPass(bloomPass);

// FXAA works best when it's final or penultimate pass
composer.addPass(fxaaPass);

// Output Pass (final pass, no blending)
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
        case 'w': // Toggle wireframe on crowd (individual + instanced) materials
            controls.wireframe = !controls.wireframe;
            getCrowdMaterials().forEach(m => { m.wireframe = controls.wireframe; });
            instancedMatMedium.wireframe = controls.wireframe;
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

// Dragonfly cursor target: raycast mouse onto horizontal plane at fly height
const dragonflyRaycaster = new THREE.Raycaster();
const dragonflyMouseNDC = new THREE.Vector2();
const cursorWorldPos = new THREE.Vector3(0, 5, 0);
const dragonflyPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
dragonflyPlane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 5, 0));
window.addEventListener('mousemove', (e) => {
    dragonflyMouseNDC.x = (e.clientX / window.innerWidth) * 2 - 1;
    dragonflyMouseNDC.y = -(e.clientY / window.innerHeight) * 2 + 1;
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
    bloomPass.resolution.set(Math.floor(width / 8), Math.floor(height / 8));
    fxaaPass.material.uniforms["resolution"].value.x = 1 / (width * ratio);
    fxaaPass.material.uniforms["resolution"].value.y = 1 / (height * ratio);
}

function updateCamera() {
    if (controls.direction.left) camera.position.x -= controls.moveSpeed;
    if (controls.direction.right) camera.position.x += controls.moveSpeed;
    if (controls.direction.forward) camera.position.z -= controls.moveSpeed;
    if (controls.direction.backward) camera.position.z += controls.moveSpeed;
    orbitControls.update();
}

// Water plane (MeshPhong for FPS; envMap set below for simple reflection / light festival aesthetic)
const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(300, 300),
    new THREE.MeshPhongMaterial({ color: COLOURS.WATER, side: THREE.DoubleSide, shininess: 80, specular: 0x333366 })
);
plane.rotation.x = -Math.PI / 2;
plane.position.y = -44;
scene.add(plane);

// Night sky: cheap gradient background (replaces expensive Preetham Sky dome)
function createNightGradientTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    const top = '#' + PARAMS.sky.topColor.toString(16).padStart(6, '0');
    const bottom = '#' + PARAMS.sky.bottomColor.toString(16).padStart(6, '0');
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

const farHill = generateTerrain(300, 50, 32, { endHeight: 55 }); // 32 segments for FPS (was 64)
farHill.position.set(0, -55, -135);
farHill.rotateZ(Math.PI);
scene.add(farHill);

// Far-hill billboard trees (instanced planes that face the camera; frustum-culled)
const FAR_HILL_TREE_BOUNDS = { xMin: -95, xMax: 95, zMin: -155, zMax: -115, yFallback: -55 };
const FAR_HILL_TREE_WIDTH = 4;
const FAR_HILL_TREE_HEIGHT = 12;
// farHillParams moved to PARAMS.farHill
let farHillTreePositions = [];
const farHillTreeGeometry = new THREE.PlaneGeometry(FAR_HILL_TREE_WIDTH, FAR_HILL_TREE_HEIGHT);
const farHillTreeMaterial = new THREE.MeshStandardMaterial({
    map: getTexture('textures/tree_billboard.png', "Error loading tree billboard texture"),
    side: THREE.DoubleSide,
    transparent: true,
    alphaTest: 0.1
});

const FAR_HILL_TREE_MAX_COUNT = 500;
const FAR_HILL_CULL_DISTANCE = 80;  // tighter than character cull; rely on distance only (no per-tree frustum check)
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
const _farHillVisibleList = [];
const _farHillBillboardQuat = new THREE.Quaternion();
const _farHillAxisY = new THREE.Vector3(0, 1, 0);

function rebuildFarHillTrees() {
    farHillTreePositions.length = 0;
    scene.updateMatrixWorld(true);
    const b = FAR_HILL_TREE_BOUNDS;
    const rayOriginY = 5; // above far hill surface (terrain ~ Y -55 to 0)
    let hitCount = 0;
    const treeYOffset = FAR_HILL_TREE_HEIGHT / 3;
    for (let i = 0; i < PARAMS.farHill.treeCount; i++) {
        const x = b.xMin + Math.random() * (b.xMax - b.xMin);
        const z = b.zMin + Math.random() * (b.zMax - b.zMin);
        farHillRayOrigin.set(x, rayOriginY, z);
        farHillRaycaster.set(farHillRayOrigin, farHillRayDirection);
        const hits = farHillRaycaster.intersectObject(farHill);
        if (hits.length > 0) hitCount += 1;
        const y = hits.length > 0 ? hits[0].point.y + treeYOffset : b.yFallback + treeYOffset;
        farHillTreePositions.push(new THREE.Vector3(x, y, z));
    }
    if (PARAMS.farHill.treeCount > 0 && hitCount === 0) {
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
// Keep grid small to stay under WebGL MAX_FRAGMENT_UNIFORM_VECTORS and for FPS.
// Sphere materials use emissive so they appear to emit light and pass the bloom threshold (see bloomParams.threshold).
const WAVE_PLANE_LIGHTS_GRID = 4; // 2x2 grid of emissive spheres (no PointLights; spheres provide colour + bloom)
// Reusable vector for B-spline eval (avoids allocation in animate loop)
const _wavePlaneEvalWorldPos = new THREE.Vector3();
const wavePlaneLightSphereGeo = new THREE.IcosahedronGeometry(1, 1);
// Scale color to a target luminance so red, yellow, blue all bloom equally (perceptually even glow).
const WAVE_PLANE_LIGHT_TARGET_LUMINANCE = 1.0;
function wavePlaneColorWithEqualLuminance(hueNorm, saturation = 1, targetLum = WAVE_PLANE_LIGHT_TARGET_LUMINANCE) {
    const c = new THREE.Color().setHSL(hueNorm, saturation, 0.5);
    const r = c.r, g = c.g, b = c.b;
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    if (lum > 1e-6) {
        const scale = targetLum / lum;
        c.r = r * scale;
        c.g = g * scale;
        c.b = b * scale;
    }
    return c;
}
// Wave plane: emissive spheres only (no PointLights — spheres provide coloured glow and bloom; reduces fragment cost)
const wavePlaneLightEntries = [];
for (let i = 0; i < WAVE_PLANE_LIGHTS_GRID; i++) {
    for (let j = 0; j < WAVE_PLANE_LIGHTS_GRID; j++) {
        const xLocal = (j / (WAVE_PLANE_LIGHTS_GRID - 1)) * WAVE_PLANE_SIZE;
        const zLocal = (i / (WAVE_PLANE_LIGHTS_GRID - 1)) * WAVE_PLANE_SIZE;
        const hue = ((i * WAVE_PLANE_LIGHTS_GRID + j) / (WAVE_PLANE_LIGHTS_GRID * WAVE_PLANE_LIGHTS_GRID)) * 360;
        const color = wavePlaneColorWithEqualLuminance(hue / 360, 1);
        const sphereMesh = new THREE.Mesh(wavePlaneLightSphereGeo, new THREE.MeshStandardMaterial({
            color: color.clone(),
            emissive: color.clone(),
            emissiveIntensity: 1
        }));
        wavePlaneLightEntries.push({ mesh: sphereMesh, xLocal, zLocal });
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

// Dunelm house windows: env-map reflection (no planar mirror renders)
const dunelmEnvMap = createDefaultEnvMap();
plane.material.envMap = dunelmEnvMap;
const dunelm = createDunelmHouse(10, -40, 3, { envMap: dunelmEnvMap });
dunelm.traverse((o) => { if (o.isMesh) { o.receiveShadow = true; o.castShadow = true; } });
scene.add(dunelm);
scene.updateMatrixWorld(true);
const _doorWorldPos = new THREE.Vector3();
dunelm.userData.doorGroup.getWorldPosition(_doorWorldPos);
dunelm.userData.doorWorldPosition = _doorWorldPos.clone();

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
staircase.traverse((o) => { if (o.isMesh) { o.receiveShadow = false; o.castShadow = false; } });
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

// Lily structures (Elysium Garden style) — instanced stems + petals (2 draw calls instead of 80)
const LUMINOUS_PETAL_COLORS = [
    0xff44aa, 0x00ddcc, 0xffaa44, 0xaa44ff, 0x44ffaa, 0xff6644, 0x4488ff, 0xffcc00
];
function randomLuminousPetalColor() {
    return LUMINOUS_PETAL_COLORS[Math.floor(Math.random() * LUMINOUS_PETAL_COLORS.length)];
}
const LILY_MAX_COUNT = 40;
const PETALS_PER_LILY = PETAL_LAYOUT.length; // 9
const lilyContainer = new THREE.Group();
scene.add(lilyContainer);

const lilyStemGeometry = getSharedStemGeometry();
const lilyStemMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0x22aa88),
    emissive: new THREE.Color(0x22aa88),
    emissiveIntensity: 0.7,
    side: THREE.DoubleSide
});
const lilyStemInstancedMesh = new THREE.InstancedMesh(lilyStemGeometry, lilyStemMaterial, LILY_MAX_COUNT);
lilyStemInstancedMesh.count = 0;
lilyStemInstancedMesh.castShadow = false;
lilyStemInstancedMesh.receiveShadow = false;
lilyContainer.add(lilyStemInstancedMesh);

const lilyPetalGeometry = getSharedPetalGeometry();
const lilyPetalMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xffffff,
    emissiveIntensity: 0.7,
    side: THREE.DoubleSide,
    vertexColors: true
});
const lilyPetalInstancedMesh = new THREE.InstancedMesh(lilyPetalGeometry, lilyPetalMaterial, LILY_MAX_COUNT * PETALS_PER_LILY);
lilyPetalInstancedMesh.count = 0;
lilyPetalInstancedMesh.castShadow = false;
lilyPetalInstancedMesh.receiveShadow = true;
lilyContainer.add(lilyPetalInstancedMesh);

let lilies = [];
const _lilyEvalPos = new THREE.Vector3();
const _lilyDummy = new THREE.Object3D();
const _lilyPetalDummy = new THREE.Object3D();
const _lilyPetalWorldMatrix = new THREE.Matrix4();
const _lilyStemMatrix = new THREE.Matrix4();
// lilyParams moved to PARAMS.lilies
function updateLilies() {
    lilies = [];
    const n = Math.min(PARAMS.lilies.count, LILY_MAX_COUNT);
    lilyStemInstancedMesh.count = n;
    lilyPetalInstancedMesh.count = n * PETALS_PER_LILY;
    if (n <= 0) return;
    bsplineSurface.updateMatrixWorld(true);
    for (let i = 0; i < n; i++) {
        const u = 0.12 + Math.random() * 0.76;
        const v = 0.12 + Math.random() * 0.76;
        getBSplineSurfaceWorldPointAtNormalized(bsplineSurface, bsplineControlPointsGrass1, u, v, _lilyEvalPos);
        const x = _lilyEvalPos.x, y = _lilyEvalPos.y, z = _lilyEvalPos.z;
        const stemHeight = 4 + Math.random() * 1.5;
        const petalColor = randomLuminousPetalColor();
        _lilyDummy.position.set(x, y + stemHeight / 2, z);
        _lilyDummy.quaternion.identity();
        _lilyDummy.scale.set(1, stemHeight, 1);
        _lilyDummy.updateMatrix();
        _lilyStemMatrix.copy(_lilyDummy.matrix);
        lilyStemInstancedMesh.setMatrixAt(i, _lilyStemMatrix);
        _lilyDummy.position.set(x, y, z);
        _lilyDummy.quaternion.identity();
        _lilyDummy.scale.setScalar(1);
        _lilyDummy.updateMatrix();
        const col = new THREE.Color(petalColor);
        for (let p = 0; p < PETALS_PER_LILY; p++) {
            const { angle, azimuth } = PETAL_LAYOUT[p];
            _lilyPetalDummy.position.set(0, stemHeight, 0);
            _lilyPetalDummy.rotation.order = "YXZ";
            _lilyPetalDummy.rotation.y = azimuth;
            _lilyPetalDummy.rotation.x = angle;
            _lilyPetalDummy.quaternion.setFromEuler(_lilyPetalDummy.rotation);
            _lilyPetalDummy.scale.setScalar(1);
            _lilyPetalDummy.updateMatrix();
            _lilyPetalWorldMatrix.copy(_lilyDummy.matrix).multiply(_lilyPetalDummy.matrix);
            lilyPetalInstancedMesh.setMatrixAt(i * PETALS_PER_LILY + p, _lilyPetalWorldMatrix);
            lilyPetalInstancedMesh.setColorAt(i * PETALS_PER_LILY + p, col);
        }
        lilies.push({ x, y, z, stemHeight, petalColor });
    }
    lilyStemInstancedMesh.instanceMatrix.needsUpdate = true;
    if (lilyPetalInstancedMesh.instanceColor) lilyPetalInstancedMesh.instanceColor.needsUpdate = true;
    lilyPetalInstancedMesh.instanceMatrix.needsUpdate = true;
}
updateLilies();

// Disable matrix auto-update on static objects so Three.js skips recursive updateMatrixWorld (Lecture 1: dirty flags).
scene.updateMatrixWorld(true);
function disableMatrixAutoUpdateForStatic(...objects) {
    for (const obj of objects) {
        if (!obj) continue;
        obj.matrixAutoUpdate = false;
        if (obj.children && obj.children.length) obj.traverse((c) => { c.matrixAutoUpdate = false; });
    }
}
disableMatrixAutoUpdateForStatic(
    plane, farHill, roadSurface, farPavementSurface, nearPavementSurface,
    bsplineSurface, bsplineSurfaceGrass2, wavePlaneGroup, dunelm, bridge, staircase,
    connectionSurface, pathSurface, treeElement, lilyContainer, farHillBillboardInstancedMesh
);

// --- Instanced characters with octree, frustum culling, walkable placement ---
const WALKABLE_WORLD_BOUNDS = new THREE.Box3(
    new THREE.Vector3(-75, -25, -165),
    new THREE.Vector3(90, 12, 15)
);
const octree = new Octree(WALKABLE_WORLD_BOUNDS, { maxDepth: 6, minSize: 2 });
const MAX_PLACEMENT_RETRIES = 20;

const walkableRegions = [
    createBezierSampler(farPavementControlPoints),
    createBezierSampler(nearPavementControlPoints),
    createBSplineSampler(bsplineSurface, bsplineControlPointsGrass1),
    createBridgeDeckSampler(-20, 0.8, -100, bridgeScale, bridgeDeckLength),
    createConnectionSampler(connectionSurfacePoints),
    createQuadSampler(pathQuadPoints),
    createStaircaseSampler(staircaseStart, staircaseEnd, 6, 1.0)
];
const walkableSampler = createCombinedSampler(walkableRegions, {
    bounds: {
        minX: WALKABLE_WORLD_BOUNDS.min.x,
        maxX: WALKABLE_WORLD_BOUNDS.max.x,
        minZ: WALKABLE_WORLD_BOUNDS.min.z,
        maxZ: WALKABLE_WORLD_BOUNDS.max.z
    },
    cellSize: 1
});

// Sampled pos is the surface (plane) where feet should stand. We add getFeetSurfaceYOffset() so the
// mesh origin (which sits above the feet in bind pose) is placed above the surface and feet touch the plane.
const CHARACTER_HEIGHT = 3.65; // feet to top of head for bounds
const PERSON_RADIUS = 0.8; // for bounds and placement
const LILY_AVOID_RADIUS = 1; // avoid placing and walking through lilies (same manner as Dunelm)
const FEET_SURFACE_Y_OFFSET = Figure.getFeetSurfaceYOffset();
const FLOCK_RADIUS = 10; // max distance for separation/alignment/cohesion (tighter for visible group behaviour)
const FLOCK_MAX_NEIGHBORS = 20; // cap neighbor count to bound flocking cost

// peopleParams moved to PARAMS.people
const ENABLE_PROFILING = false; // set true to log crowd/bucket/composer ms and draw calls once per second
let _profileLastLog = 0;
let _profileCrowdMs = 0;
let _profileBucketMs = 0;
const _dummyMatrix = new THREE.Matrix4();
const _flockBox = new THREE.Box3();
const _flockBoxSize = new THREE.Vector3(FLOCK_RADIUS * 2, FLOCK_RADIUS * 2, FLOCK_RADIUS * 2);
const _flockNeighbors = []; // reused for octree.queryBounds in applyPhysics
const _flockSeenIds = new Set(); // dedupe octree results in applyPhysics
const _dummyPosition = new THREE.Vector3();
const _dummyQuaternion = new THREE.Quaternion();
const _dummyScale = new THREE.Vector3(1, 1, 1);
const _lilyWorldPos = new THREE.Vector3();
// Reusable temporaries for applyPhysics (avoid per-frame allocations)
const _physicsForce = new THREE.Vector3();
const _physicsSep = new THREE.Vector3();
const _physicsAli = new THREE.Vector3();
const _physicsCoh = new THREE.Vector3();
const _physicsPush = new THREE.Vector3();
const _physicsDestination = new THREE.Vector3();
const _physicsAwayFromLily = new THREE.Vector3();
const _physicsCandidatePos = new THREE.Vector3();
const _physicsAvoid = new THREE.Vector3();
const _physicsClampResult = new THREE.Vector3();
const _physicsWanderVec = new THREE.Vector3();

// Dragonfly physics temporaries
const _dfDesired = new THREE.Vector3();
const _dfSteer = new THREE.Vector3();
const _dfWanderCentre = new THREE.Vector3();
const _dfWanderDisplacement = new THREE.Vector3();
const _dfSep = new THREE.Vector3();
const _dfAvoid = new THREE.Vector3();
const WANDER_CIRCLE_RADIUS = 0.8;
const WANDER_JITTER = 0.15;
const WANDER_OFFSET_DIST = 1.2;
const DRAGONFLY_SLOW_RADIUS = 3;

// Hybrid crowd: InstancedMesh for medium (40-100m); characters beyond 100m are culled
const INSTANCED_MAX = 1000;
const instancedGeoMedium = Figure.getInstanceGeometryMedium();
const instancedMatMedium = Figure.getInstanceMaterial();
const instancedMeshMedium = new THREE.InstancedMesh(instancedGeoMedium, instancedMatMedium, INSTANCED_MAX);
instancedMeshMedium.count = 0;
instancedMeshMedium.geometry.setAttribute('instanceColor', new THREE.InstancedBufferAttribute(new Float32Array(INSTANCED_MAX * 3), 3));
instancedMeshMedium.castShadow = false;
scene.add(instancedMeshMedium);

// Dragonfly instanced meshes (close = body+wings, far = cube LOD)
const DRAGONFLY_MAX = 500;
const dfInstancedClose = new THREE.InstancedMesh(getDragonflyGeometry(), getDragonflyMaterial(), DRAGONFLY_MAX);
dfInstancedClose.count = 0;
dfInstancedClose.geometry.setAttribute('instanceColor', new THREE.InstancedBufferAttribute(new Float32Array(DRAGONFLY_MAX * 3), 3));
dfInstancedClose.castShadow = false;
dfInstancedClose.receiveShadow = false;
scene.add(dfInstancedClose);
const dfInstancedFar = new THREE.InstancedMesh(getDragonflyGeometryLOD(), getDragonflyMaterial(), DRAGONFLY_MAX);
dfInstancedFar.count = 0;
dfInstancedFar.geometry.setAttribute('instanceColor', new THREE.InstancedBufferAttribute(new Float32Array(DRAGONFLY_MAX * 3), 3));
dfInstancedFar.castShadow = false;
dfInstancedFar.receiveShadow = false;
scene.add(dfInstancedFar);

// Torso/legs and skin colour for instanced tier (blended via skinPart vertex attribute)
const INSTANCE_TORSO_COLOR = new THREE.Color().setHex(0x4A7BA7);
const INSTANCE_SKIN_COLOR = new THREE.Color().setHex(0xF1C27D);
const INSTANCE_BRIGHTNESS = 1.45;
[instancedMatMedium].forEach(mat => {
    mat.uniforms = mat.uniforms || {};
    mat.uniforms.torsoColor = { value: INSTANCE_TORSO_COLOR.clone() };
    mat.uniforms.skinColor = { value: INSTANCE_SKIN_COLOR.clone() };
    mat.uniforms.instanceBrightness = { value: INSTANCE_BRIGHTNESS };
    mat.onBeforeCompile = (shader) => {
        shader.uniforms.torsoColor = mat.uniforms.torsoColor;
        shader.uniforms.skinColor = mat.uniforms.skinColor;
        shader.uniforms.instanceBrightness = mat.uniforms.instanceBrightness;
        shader.vertexShader = shader.vertexShader.replace(
            '#include <common>',
            '#include <common>\n\tattribute float skinPart;\n\tvarying float vSkinPart;'
        );
        shader.vertexShader = shader.vertexShader.replace(
            '#include <begin_vertex>',
            '#include <begin_vertex>\n\tvSkinPart = skinPart;'
        );
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <common>',
            '#include <common>\n\tuniform vec3 torsoColor;\n\tuniform vec3 skinColor;\n\tuniform float instanceBrightness;\n\tvarying float vSkinPart;'
        );
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <color_fragment>',
            '#include <color_fragment>\n\tdiffuseColor.rgb = mix(torsoColor, skinColor, vSkinPart) * instanceBrightness;'
        );
    };
});

const _dummyAxisY = new THREE.Vector3(0, 1, 0);
const _dummyAxisX = new THREE.Vector3(1, 0, 0);
const _dummyQuatBank = new THREE.Quaternion();
const _listClose = [];
const _listMid = [];

let people = [];
modifyCrowd(PARAMS.people.count);

let dragonflies = [];
const _listDfClose = [];
const _listDfFar = [];
const DRAGONFLY_LOD_CLOSE = 40;
const DRAGONFLY_CULL_DISTANCE = 80;

function updateDragonflies() {
    const targetCount = Math.min(Math.max(0, Math.floor(PARAMS.dragonflies.count)), DRAGONFLY_MAX);
    const delta = targetCount - dragonflies.length;
    if (delta > 0) {
        const bounds = WALKABLE_WORLD_BOUNDS;
        for (let i = 0; i < delta; i++) {
            const x = bounds.min.x + Math.random() * (bounds.max.x - bounds.min.x);
            const z = bounds.min.z + Math.random() * (bounds.max.z - bounds.min.z);
            const y = 2 + Math.random() * 8;
            dragonflies.push(createDragonfly({ position: new THREE.Vector3(x, y, z) }));
        }
    } else if (delta < 0) {
        dragonflies.length = targetCount;
    }
}

updateDragonflies();

// Dragonfly flight bounds (Y range for flying)
const DRAGONFLY_MIN_Y = 0;
const DRAGONFLY_MAX_Y = 15;

function getDragonflyNavGrid() {
    const bounds = {
        minX: WALKABLE_WORLD_BOUNDS.min.x,
        maxX: WALKABLE_WORLD_BOUNDS.max.x,
        minY: DRAGONFLY_MIN_Y,
        maxY: DRAGONFLY_MAX_Y,
        minZ: WALKABLE_WORLD_BOUNDS.min.z,
        maxZ: WALKABLE_WORLD_BOUNDS.max.z
    };
    // Block cells that sit below (or inside) ground/walkable surfaces
    const isBlocked = (x, y, z) => {
        const info = walkableSampler.getSurfaceInfo(x, z);
        if (info.inside && info.y != null && y <= info.y + 0.5) return true;
        return false;
    };
    // Spherical obstacles (buildings/lilies extruded into 3D)
    const dunelmY = dunelm.position.y || 0;
    const sphereObstacles = [
        { x: dunelm.position.x, y: dunelmY, z: dunelm.position.z, radius: dunelm.userData.radius }
    ];
    for (let i = 0; i < lilies.length; i++) {
        sphereObstacles.push({
            x: lilies[i].x,
            y: lilies[i].y,
            z: lilies[i].z,
            radius: LILY_AVOID_RADIUS
        });
    }
    return createNavigationGrid(bounds, 2, isBlocked, sphereObstacles);
}

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
const ambientLight = new THREE.AmbientLight(0x202040, 1.0);
scene.add(ambientLight);
ambientLight.matrixAutoUpdate = false;

const directionalLight = new THREE.DirectionalLight(0xaaccff, 0.6);
directionalLight.position.set(2, 5, 3);
directionalLight.castShadow = true;
// Shadow camera must cover scene bounds (~ -75..90 x, -165..15 z) for shadows to appear
directionalLight.shadow.mapSize.set(512, 512); // Lower resolution for FPS
directionalLight.shadow.camera.near = 0.5;
directionalLight.shadow.camera.far = 400;
directionalLight.shadow.camera.left = -120;
directionalLight.shadow.camera.right = 120;
directionalLight.shadow.camera.top = 120;
directionalLight.shadow.camera.bottom = -120;
directionalLight.shadow.bias = -0.0001;
scene.add(directionalLight);
directionalLight.matrixAutoUpdate = false;

// Hemisphere light: sky (top) and ground (bottom) fill for night; replaces expensive sky dome
const hemisphereLight = new THREE.HemisphereLight(0x1a1a2e, 0x080810, 0.7);
scene.add(hemisphereLight);
hemisphereLight.matrixAutoUpdate = false;

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
axesHelper.matrixAutoUpdate = false;

// PARAMS is now defined earlier (before post-processing setup)
// Set up draggable function references now that scene and other dependencies are available
PARAMS.draggableBSpline.addBSplineSurface = function () {
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
};

PARAMS.draggableBSpline.saveCoordinates = function () {
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
};

PARAMS.draggableBezier.addBezierSurface = function () {
    const initialPoints = [];
    for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
            const x = (i - 1.5) * 2;
            const z = (j - 1.5) * 2;
            const y = (i === 1 || i === 2) && (j === 1 || j === 2) ? 2 : 0;
            initialPoints.push(new THREE.Vector3(x, y, z));
        }
    }
    const draggableSurface = createDraggableBezierSurface(initialPoints, {
        segments: 20,
        showHull: true,
        showControlPoints: true,
        wireframe: false
    });
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
};

PARAMS.draggableBezier.saveCoordinates = function () {
    if (selectedDraggableIndex < 0 || selectedDraggableIndex >= draggableBezierSurfaces.length) {
        console.log('No draggable Bezier surface selected');
        return;
    }
    const selected = draggableBezierSurfaces[selectedDraggableIndex];
    const controlPointMeshes = selected.userData.bezier.controlPoints;
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
};

// Creating a GUI with options
const gui = new GUI({ name: "Lumiere GUI" });
const cameraFolder = gui.addFolder("Camera");
cameraFolder.add(camera.position, "z", 0, 10);
cameraFolder.open();

const skyFolder = gui.addFolder("Sky (gradient)");
skyFolder.addColor(PARAMS.sky, "topColor").name("Zenith").onChange(applyNightGradient);
skyFolder.addColor(PARAMS.sky, "bottomColor").name("Horizon").onChange(applyNightGradient);
skyFolder.open();

const peopleFolder = gui.addFolder("People");
peopleFolder.add(PARAMS.people, "count", 0, 600).step(1).onChange((newCount) => {
    const targetCount = Math.max(0, Math.min(600, Math.floor(Number(newCount))));
    const delta = targetCount - people.length;
    if (delta !== 0) modifyCrowd(delta);
});
peopleFolder.open();

const flockingFolder = gui.addFolder("Flocking Behavior");
const sepCheckbox = flockingFolder.add(PARAMS.flocking.sep, "on").name("Separation");
const sepSlider = flockingFolder.add(PARAMS.flocking.sep, "val", 0, 3, 0.1).name("Separation Weight");
sepCheckbox.onChange((v) => {
    PARAMS.flocking.sep.on = v;
    sepSlider.__li.style.opacity = v ? 1 : 0.5;
    sepSlider.domElement.disabled = !v;
});
sepSlider.__li.style.opacity = PARAMS.flocking.sep.on ? 1 : 0.5;
sepSlider.domElement.disabled = !PARAMS.flocking.sep.on;

const aliCheckbox = flockingFolder.add(PARAMS.flocking.ali, "on").name("Alignment");
const aliSlider = flockingFolder.add(PARAMS.flocking.ali, "val", 0, 1, 0.05).name("Alignment Weight");
aliCheckbox.onChange((v) => {
    PARAMS.flocking.ali.on = v;
    aliSlider.__li.style.opacity = v ? 1 : 0.5;
    aliSlider.domElement.disabled = !v;
});
aliSlider.__li.style.opacity = PARAMS.flocking.ali.on ? 1 : 0.5;
aliSlider.domElement.disabled = !PARAMS.flocking.ali.on;

const cohCheckbox = flockingFolder.add(PARAMS.flocking.coh, "on").name("Cohesion");
const cohSlider = flockingFolder.add(PARAMS.flocking.coh, "val", 0, 3, 0.1).name("Cohesion Weight");
cohCheckbox.onChange((v) => {
    PARAMS.flocking.coh.on = v;
    cohSlider.__li.style.opacity = v ? 1 : 0.5;
    cohSlider.domElement.disabled = !v;
});
cohSlider.__li.style.opacity = PARAMS.flocking.coh.on ? 1 : 0.5;
cohSlider.domElement.disabled = !PARAMS.flocking.coh.on;

flockingFolder.open();

const farHillFolder = gui.addFolder("Far hill");
farHillFolder.add(PARAMS.farHill, "treeCount", 0, 500).step(1).name("Tree count").onChange(rebuildFarHillTrees);
farHillFolder.open();

const lilyFolder = gui.addFolder("Lilies");
lilyFolder.add(PARAMS.lilies, "count", 0, 40).step(1).name("Count").onChange(updateLilies);
lilyFolder.open();

const dragonflyFolder = gui.addFolder("Dragonflies");
dragonflyFolder.add(PARAMS.dragonflies, "count", 0, 500).step(1).name("Count").onChange((v) => {
    const targetCount = Math.max(0, Math.min(500, Math.floor(Number(v))));
    PARAMS.dragonflies.count = targetCount;
    updateDragonflies();
});
dragonflyFolder.add(PARAMS.dragonflies, "followCursor").name("Follow cursor").onChange((v) => {
    if (!v) {
        for (let i = 0; i < dragonflies.length; i++) dragonflies[i].path = [];
    }
});
dragonflyFolder.add(PARAMS.dragonflies, "maxSpeed", 0.1, 1, 0.05).name("Max speed");
dragonflyFolder.add(PARAMS.dragonflies, "maxForce", 0.01, 0.1, 0.005).name("Max force");
dragonflyFolder.open();

const lightFestivalFolder = gui.addFolder("Light Festival");
lightFestivalFolder.add(PARAMS.bloom, "strength", 0, 2).name("Bloom strength").onChange((v) => { bloomPass.strength = v; PARAMS.bloom.strength = v; });
lightFestivalFolder.add(PARAMS.bloom, "radius", 0, 1).name("Bloom radius").onChange((v) => { bloomPass.radius = v; PARAMS.bloom.radius = v; });
lightFestivalFolder.add(PARAMS.bloom, "threshold", 0, 1).name("Bloom threshold").onChange((v) => { bloomPass.threshold = v; PARAMS.bloom.threshold = v; });
lightFestivalFolder.open();

// Post-processing: Antialiasing, SSAO, HDR/Bloom
const f_aa = gui.addFolder('Antialiasing');
f_aa.add(PARAMS.postProcessing, 'antialiasing', ['None', 'MSAA', 'FXAA']).name('AA Method').onChange(value => {
    PARAMS.postProcessing.antialiasing = value;
    let samples = 0;
    switch (value) {
        case 'None':
            samples = 0;
            fxaaPass.enabled = false;
            break;
        case 'MSAA':
            samples = 4;
            fxaaPass.enabled = false;
            break;
        case 'FXAA':
            samples = 0;
            fxaaPass.enabled = true;
            break;
    }
    const size = renderer.getSize(new THREE.Vector2());
    const w = size.width * renderer.getPixelRatio();
    const h = size.height * renderer.getPixelRatio();
    composer.renderTarget1.dispose();
    composer.renderTarget1 = new THREE.WebGLRenderTarget(w, h, { samples });
    composer.writeBuffer = composer.renderTarget1;
});
const f_ssao = gui.addFolder('SSAO Parameters');
f_ssao.add(PARAMS.postProcessing, 'ssaoEnabled').name('Enable SSAO').onChange(v => {
    ssaoPass.enabled = v;
    PARAMS.postProcessing.ssaoEnabled = v;
});
f_ssao.add(ssaoPass, 'kernelRadius', 0, 64).name('Kernel Radius');
f_ssao.add(ssaoPass, 'minDistance', 0.001, 0.1).name('Min Distance');
f_ssao.add(ssaoPass, 'maxDistance', 0.01, 0.5).name('Max Distance');
const f_hdr = gui.addFolder('HDR/Bloom Parameters');
f_hdr.add(PARAMS.postProcessing, 'exposure', 0.1, 2.0).name('Exposure').onChange(v => {
    renderer.toneMappingExposure = v;
    PARAMS.postProcessing.exposure = v;
});
// Use PARAMS.bloom as single source of truth so Light Festival and HDR/Bloom stay in sync
f_hdr.add(PARAMS.bloom, 'threshold', 0.0, 1.0).name('Threshold').onChange(v => {
    bloomPass.threshold = v;
    PARAMS.bloom.threshold = v;
});
f_hdr.add(PARAMS.bloom, 'strength', 0.0, 3.0).name('Strength').onChange(v => {
    bloomPass.strength = v;
    PARAMS.bloom.strength = v;
});
f_hdr.add(PARAMS.bloom, 'radius', 0.0, 1.0).name('Radius').onChange(v => {
    bloomPass.radius = v;
    PARAMS.bloom.radius = v;
});

// Performance / High-FPS toggles
const perfFolder = gui.addFolder('Performance');
perfFolder.add(PARAMS.performance, 'bloomEnabled').name('Bloom').onChange(v => {
    bloomPass.enabled = v;
    PARAMS.performance.bloomEnabled = v;
});
perfFolder.add(PARAMS.performance, 'shadowsEnabled').name('Shadows').onChange(v => {
    renderer.shadowMap.enabled = v;
    directionalLight.castShadow = v;
    PARAMS.performance.shadowsEnabled = v;
});
perfFolder.add(PARAMS.performance, 'usePostProcessing').name('Post-processing (Bloom/FXAA)').onChange(() => {});

const bezierFolder = gui.addFolder("Bezier surface");
bezierFolder.add(PARAMS.bezier, "showHull").name("Show control hull").onChange((v) => {
    PARAMS.bezier.showHull = v;
    if (roadSurface.userData.bezier?.hull) roadSurface.userData.bezier.hull.visible = v;
    if (farPavementSurface.userData.bezier?.hull) farPavementSurface.userData.bezier.hull.visible = v;
    if (nearPavementSurface.userData.bezier?.hull) nearPavementSurface.userData.bezier.hull.visible = v;
});
bezierFolder.add(PARAMS.bezier, "showControlPoints").name("Show control points").onChange((v) => {
    PARAMS.bezier.showControlPoints = v;
    (roadSurface.userData.bezier?.controlPoints || []).forEach(sp => { sp.visible = v; });
    (farPavementSurface.userData.bezier?.controlPoints || []).forEach(sp => { sp.visible = v; });
    (nearPavementSurface.userData.bezier?.controlPoints || []).forEach(sp => { sp.visible = v; });
});
bezierFolder.add(PARAMS.bezier, "wireframe").name("Wireframe overlay").onChange((v) => {
    PARAMS.bezier.wireframe = v;
    if (roadSurface.userData.bezier?.wireframe) roadSurface.userData.bezier.wireframe.visible = v;
    if (farPavementSurface.userData.bezier?.wireframe) farPavementSurface.userData.bezier.wireframe.visible = v;
    if (nearPavementSurface.userData.bezier?.wireframe) nearPavementSurface.userData.bezier.wireframe.visible = v;
});

const bsplineFolder = gui.addFolder("B-spline surface");
bsplineFolder.add(PARAMS.bspline, "showHull").name("Show control hull").onChange((v) => {
    PARAMS.bspline.showHull = v;
    if (bsplineSurface?.userData.bspline?.hull) bsplineSurface.userData.bspline.hull.visible = v;
    draggableBSplineSurfaces.forEach(s => {
        if (s.userData.bspline?.hull) s.userData.bspline.hull.visible = v;
    });
});
bsplineFolder.add(PARAMS.bspline, "showControlPoints").name("Show control points").onChange((v) => {
    PARAMS.bspline.showControlPoints = v;
    if (bsplineSurface?.userData.bspline?.controlPoints) {
        bsplineSurface.userData.bspline.controlPoints.forEach(sp => { sp.visible = v; });
    }
    draggableBSplineSurfaces.forEach(s => {
        (s.userData.bspline?.controlPoints || []).forEach(sp => { sp.visible = v; });
    });
});
bsplineFolder.add(PARAMS.bspline, "wireframe").name("Wireframe overlay").onChange((v) => {
    PARAMS.bspline.wireframe = v;
    if (bsplineSurface?.userData.bspline?.wireframe) bsplineSurface.userData.bspline.wireframe.visible = v;
    draggableBSplineSurfaces.forEach(s => {
        if (s.userData.bspline?.wireframe) s.userData.bspline.wireframe.visible = v;
    });
});

// draggableBSplineParams is now PARAMS.draggableBSpline
const draggableBSplineParams = PARAMS.draggableBSpline;

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

// draggableParams is now PARAMS.draggableBezier
const draggableParams = PARAMS.draggableBezier;

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
        PARAMS.draggableBezier.selectedCurve = selectedDraggableIndex >= 0 ? selectedDraggableIndex : 0;
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
    PARAMS.people.count = people.length;
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
                    const person = createCrowdPerson({ position, rotationY: Math.random() * Math.PI * 2 });
                    person.bounds = bounds;
                    person.id = people.length;
                    person.facingAngle = person.rotationY;
                    person._lastOctreePos = person.pos.clone();
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
            const p = people.pop();
            if (p?.mesh?.parent) p.mesh.parent.remove(p.mesh);
            p.mesh = null;
            p.parts = null;
        }
        octree.clear();
        for (const p of people) octree.insert(p);
        if (octreeDebugLine) updateOctreeDebugLine();
    }
}

// PARAMS moved to unified PARAMS object at top of GUI section
const MAX_FORCE = 0.03;
const MAX_SPEED = 0.25;
const SURFACE_SAMPLE_EVERY = 2;        // call getSurfaceInfo at most every N frames per agent (close)
const SURFACE_SAMPLE_EVERY_FAR = 10;    // distant agents: sample less often (LOD)
const SURFACE_SAMPLE_DISTANCE = 0.5;   // or when moved this far in XZ from last sample
const SURFACE_LOD_DISTANCE = 40;      // beyond this distance from camera, use SURFACE_SAMPLE_EVERY_FAR

function applyPhysics(person) {
    if (!person || !person.pos) return person;
    _physicsForce.set(0, 0, 0);
    _physicsPush.set(0, 0, 0);
    _physicsSep.set(0, 0, 0);
    _physicsAli.set(0, 0, 0);
    _physicsCoh.set(0, 0, 0);
    let count = 0;

    // FLOCKING ALGORITHM (spatial: use octree so O(n*k) not O(n^2))
    _flockBox.setFromCenterAndSize(person.pos, _flockBoxSize);
    octree.queryBounds(_flockBox, _flockNeighbors);
    _flockSeenIds.clear();
    for (let k = 0; k < _flockNeighbors.length; k++) {
        const other = _flockNeighbors[k];
        if (other === person || _flockSeenIds.has(other.id) || other.state === "INSIDE") continue;
        _flockSeenIds.add(other.id);
        const dist = person.pos.distanceTo(other.pos);
        if (dist > 0 && dist < FLOCK_RADIUS) {
            if (PARAMS.flocking.sep.on) {
                _physicsPush.subVectors(person.pos, other.pos).normalize().divideScalar(dist);
                _physicsSep.add(_physicsPush);
            }
            if (PARAMS.flocking.ali.on) _physicsAli.add(other.vel);
            if (PARAMS.flocking.coh.on) _physicsCoh.add(other.pos);
            count++;
            if (count >= FLOCK_MAX_NEIGHBORS) break;
        }
    }

    if (count > 0) {
        // Apply slider weights
        if (PARAMS.flocking.sep.on) _physicsForce.add(_physicsSep.multiplyScalar(0.2 * PARAMS.flocking.sep.val));
        if (PARAMS.flocking.ali.on) {
            _physicsAli.divideScalar(count).normalize().multiplyScalar(MAX_SPEED).sub(person.vel);
            _physicsForce.add(_physicsAli.multiplyScalar(0.05 * PARAMS.flocking.ali.val));
        }
        if (PARAMS.flocking.coh.on) {
            _physicsCoh.divideScalar(count).sub(person.pos).normalize().multiplyScalar(MAX_SPEED).sub(person.vel);
            _physicsForce.add(_physicsCoh.multiplyScalar(0.05 * PARAMS.flocking.coh.val));
        }
    }

    // avoid dunelm building (static objects)
    const distDunelm = person.pos.distanceTo(dunelm.position);
    if (distDunelm < dunelm.userData.radius) {
        _physicsAvoid.subVectors(person.pos, dunelm.position).normalize().multiplyScalar((dunelm.userData.radius - distDunelm) * 0.5);
        _physicsForce.add(_physicsAvoid);
    }

    // avoid lilies (same manner as Dunelm)
    for (let L = 0; L < lilies.length; L++) {
        _lilyWorldPos.set(lilies[L].x, lilies[L].y, lilies[L].z);
        const distLily = Math.hypot(person.pos.x - _lilyWorldPos.x, person.pos.z - _lilyWorldPos.z);
        if (distLily < LILY_AVOID_RADIUS) {
            _physicsAvoid.subVectors(person.pos, _lilyWorldPos).normalize().multiplyScalar((LILY_AVOID_RADIUS - distLily) * 0.5);
            _physicsForce.add(_physicsAvoid);
        }
    }

    // Goal Seeking
    if (person.target) {
        _physicsDestination.subVectors(person.target, person.pos);
        const dist = _physicsDestination.length();
        _physicsDestination.normalize();
        if (dist < 5) {
            _physicsDestination.multiplyScalar(person.maxSpeed * (dist / 5));
        } else {
            _physicsDestination.multiplyScalar(person.maxSpeed);
        }
        _physicsClampResult.subVectors(_physicsDestination, person.vel).clampLength(0, MAX_FORCE);
        _physicsForce.add(_physicsClampResult);
    } else if (person.state === 'WANDER') {
        _physicsWanderVec.set(Math.random() - 0.5, 0, Math.random() - 0.5).normalize().multiplyScalar(MAX_FORCE * 0.8);
        _physicsForce.add(_physicsWanderVec);
        if (person.pos.length() > 120) {
            _physicsWanderVec.add(person.pos.clone().multiplyScalar(-0.02)); // boundary
        }
    }

    person.acc.add(_physicsForce);
    person.vel.add(person.acc);
    if (person.state === 'SNAPPING') {
        const snapTimer = person.snapTimer || 0;
        if (snapTimer < 15) person.vel.multiplyScalar(0.92);
        else if (snapTimer < SNAP_END_FRAME) person.vel.multiplyScalar(0.95);
        else {
            person.state = 'WANDER';
            delete person.snapTimer;
            delete person.snapFlashDone;
            const nudge = person.maxSpeed * 0.35;
            person.vel.set((Math.random() - 0.5) * 2 * nudge, 0, (Math.random() - 0.5) * 2 * nudge);
        }
        person.lastSnapFrame = frameCount;
    }

    person.vel.clampLength(0, person.maxSpeed);

    _physicsCandidatePos.copy(person.pos).add(person.vel);
    const distToCam = person.pos.distanceTo(camera.position);
    const surfaceSampleEvery = distToCam > SURFACE_LOD_DISTANCE ? SURFACE_SAMPLE_EVERY_FAR : SURFACE_SAMPLE_EVERY;
    const shouldSample = person._surfaceSampleFrame === undefined ||
        (frameCount - person._surfaceSampleFrame >= surfaceSampleEvery) ||
        (person._lastSurfaceX !== undefined && Math.hypot(_physicsCandidatePos.x - person._lastSurfaceX, _physicsCandidatePos.z - person._lastSurfaceZ) > SURFACE_SAMPLE_DISTANCE);
    let info;
    if (shouldSample) {
        info = walkableSampler.getSurfaceInfo(_physicsCandidatePos.x, _physicsCandidatePos.z, person._surfaceCache);
        person._surfaceSampleFrame = frameCount;
        person._lastSurfaceY = info.y;
        person._lastSurfaceInside = info.inside;
        person._lastSurfaceX = _physicsCandidatePos.x;
        person._lastSurfaceZ = _physicsCandidatePos.z;
    } else {
        info = { inside: !!person._lastSurfaceInside, y: person._lastSurfaceY != null ? person._lastSurfaceY : null };
    }
    if (info.inside && info.y !== null) {
        person.pos.set(_physicsCandidatePos.x, info.y + FEET_SURFACE_Y_OFFSET / 2, _physicsCandidatePos.z);
        if (person.prevPosition) person.prevPosition.copy(person.pos);
    } else {
        person.vel.multiplyScalar(-0.2);
    }
    person.acc.set(0, 0, 0);

    if (person.state === 'SNAPPING') {
        person.snapTimer = (person.snapTimer || 0) + 1;
    }

    return person;
}

function applyDragonflyPhysics(dragonfly) {
    if (!dragonfly || !dragonfly.pos) return dragonfly;
    dragonfly.acc.set(0, 0, 0);

    const maxSpeed = dragonfly.maxSpeed * (PARAMS.dragonflies.maxSpeed / 0.35);
    const maxForce = dragonfly.maxForce * (PARAMS.dragonflies.maxForce / 0.04);

    // Separation from other dragonflies (within forceRadius 0.5)
    _dfSep.set(0, 0, 0);
    let sepCount = 0;
    for (let i = 0; i < dragonflies.length; i++) {
        const other = dragonflies[i];
        if (other === dragonfly) continue;
        const dist = dragonfly.pos.distanceTo(other.pos);
        if (dist > 0 && dist < dragonfly.forceRadius) {
            _dfAvoid.subVectors(dragonfly.pos, other.pos).normalize().divideScalar(dist);
            _dfSep.add(_dfAvoid);
            sepCount++;
        }
    }
    if (sepCount > 0) {
        _dfSep.divideScalar(sepCount).normalize().multiplyScalar(maxSpeed).sub(dragonfly.vel);
        dragonfly.acc.add(_dfSteer.copy(_dfSep).clampLength(0, maxForce).multiplyScalar(2));
    }

    // Avoid Dunelm
    const dunelmPos = dunelm.position;
    const distDunelm = dragonfly.pos.distanceTo(dunelmPos);
    if (distDunelm < dunelm.userData.radius) {
        _dfAvoid.subVectors(dragonfly.pos, dunelmPos).normalize().multiplyScalar((dunelm.userData.radius - distDunelm) * 0.5);
        dragonfly.acc.add(_dfAvoid);
    }

    // Avoid lilies
    for (let L = 0; L < lilies.length; L++) {
        _dfAvoid.set(dragonfly.pos.x - lilies[L].x, dragonfly.pos.y - lilies[L].y, dragonfly.pos.z - lilies[L].z);
        const distLily = _dfAvoid.length();
        if (distLily < LILY_AVOID_RADIUS && distLily > 0) {
            _dfAvoid.normalize().multiplyScalar((LILY_AVOID_RADIUS - distLily) * 0.5);
            dragonfly.acc.add(_dfAvoid);
        }
    }

    // Boundary containment (XZ from world bounds, Y from flight bounds)
    const bounds = WALKABLE_WORLD_BOUNDS;
    const margin = 5;
    if (dragonfly.pos.x < bounds.min.x + margin) dragonfly.acc.x += 0.5;
    if (dragonfly.pos.x > bounds.max.x - margin) dragonfly.acc.x -= 0.5;
    if (dragonfly.pos.z < bounds.min.z + margin) dragonfly.acc.z += 0.5;
    if (dragonfly.pos.z > bounds.max.z - margin) dragonfly.acc.z -= 0.5;
    if (dragonfly.pos.y < DRAGONFLY_MIN_Y + 1) dragonfly.acc.y += 0.3;
    if (dragonfly.pos.y > DRAGONFLY_MAX_Y - 1) dragonfly.acc.y -= 0.3;

    // Seek/Arrive (A* waypoint or cursor target) vs Wander
    const target = dragonfly.path && dragonfly.path.length > 0 && dragonfly.pathIndex < dragonfly.path.length
        ? dragonfly.path[dragonfly.pathIndex]
        : (PARAMS.dragonflies.followCursor ? cursorWorldPos : null);

    if (target) {
        _dfDesired.subVectors(target, dragonfly.pos);
        const dist = _dfDesired.length();
        if (dist < 0.5 && dragonfly.path && dragonfly.pathIndex < dragonfly.path.length) {
            dragonfly.pathIndex++;
        } else if (dist > 0.01) {
            _dfDesired.normalize();
            if (dist < DRAGONFLY_SLOW_RADIUS) {
                _dfDesired.multiplyScalar(maxSpeed * (dist / DRAGONFLY_SLOW_RADIUS));
            } else {
                _dfDesired.multiplyScalar(maxSpeed);
            }
            _dfSteer.subVectors(_dfDesired, dragonfly.vel).clampLength(0, maxForce);
            dragonfly.acc.add(_dfSteer);
        }
    } else {
        // Wander: "carrot on a stick"
        const velLen = dragonfly.vel.length();
        if (velLen > 0.01) {
            _dfWanderCentre.copy(dragonfly.vel).normalize().multiplyScalar(WANDER_OFFSET_DIST);
        } else {
            _dfWanderCentre.set(1, 0, 0);
        }
        dragonfly.wanderTheta += (Math.random() - 0.5) * WANDER_JITTER;
        _dfWanderDisplacement.set(Math.cos(dragonfly.wanderTheta), (Math.random() - 0.5) * 0.3, Math.sin(dragonfly.wanderTheta)).multiplyScalar(WANDER_CIRCLE_RADIUS);
        _dfWanderCentre.add(_dfWanderDisplacement);
        _dfDesired.copy(dragonfly.pos).add(_dfWanderCentre);
        _dfSteer.subVectors(_dfDesired, dragonfly.pos).normalize().multiplyScalar(maxSpeed).sub(dragonfly.vel).clampLength(0, maxForce);
        dragonfly.acc.add(_dfSteer);
    }

    // Gentle vertical bobbing (wander in Y)
    dragonfly.acc.y += (Math.random() - 0.5) * 0.02;

    dragonfly.vel.add(dragonfly.acc);
    dragonfly.vel.clampLength(0, maxSpeed);
    dragonfly.pos.add(dragonfly.vel);

    if (dragonfly.vel.length() > 0.02) {
        const newFacing = Math.atan2(dragonfly.vel.x, dragonfly.vel.z);
        let turnRate = newFacing - dragonfly.facingAngle;
        while (turnRate > Math.PI) turnRate -= 2 * Math.PI;
        while (turnRate < -Math.PI) turnRate += 2 * Math.PI;
        dragonfly.bankAngle = dragonfly.bankAngle * 0.9 + (-turnRate * 0.15) * 0.1;
        dragonfly.facingAngle = newFacing;
    } else {
        dragonfly.bankAngle *= 0.95;
    }

    dragonfly.acc.set(0, 0, 0);
    return dragonfly;
}

// SNAPPING phase lengths (frames); total ~0.7 s at 60fps
const SNAP_ARM_UP_DURATION = 16;
const SNAP_FLASH_FRAME = 17;
const SNAP_ARM_DOWN_START = 24;
const SNAP_ARM_DOWN_END = 38;
const SNAP_ARM_UP_ANGLE = -1.2;
const SNAP_END_FRAME = 40;  // return to WANDER after this
// Frames before a person who just finished SNAPPING can enter SEEK_LILY again (~2.5 s at 60fps)
const SEEK_LILY_COOLDOWN_FRAMES = 150;

function animatePerson(person) {
    if (!person.mesh) {
        if (person.vel.length() > 0.02) {
            const newFacing = Math.atan2(person.vel.x, person.vel.z);
            let turnRate = newFacing - person.facingAngle;
            while (turnRate > Math.PI) turnRate -= 2 * Math.PI;
            while (turnRate < -Math.PI) turnRate += 2 * Math.PI;
            person.bankAngle = person.bankAngle * 0.85 + (-turnRate * 0.2) * 0.15;
            person.facingAngle = newFacing;
        } else {
            person.bankAngle *= 0.9;
        }
        return;
    }
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

const _lilyTargetPos = new THREE.Vector3();
// Flow/queue waypoints for group behaviours (Q3a)
const BRIDGE_FLOW_TARGET = new THREE.Vector3(-20, 0.8, -40); // bridge deck center
// Queue target must be on a walkable surface; use connection surface left edge near door (door at ~(-4.3,1.8,-33) is unwalkable)
const DUNELM_QUEUE_TARGET = new THREE.Vector3(-4.25, 0, -33);
const DUNELM_DOOR_OPEN_RADIUS = 2;
const DUNELM_INSIDE_MIN_FRAMES = 90;
const DUNELM_INSIDE_MAX_FRAMES = 210;

function updateDecision(person) {
    // SNAPPING -> WANDER is handled in applyPhysics (velocity + lastSnapFrame set there)
    if (person.state === "WANDER") {
        if (Math.random() < 0.001) {
            const framesSinceSnap = frameCount - (person.lastSnapFrame ?? -SEEK_LILY_COOLDOWN_FRAMES);
            if (framesSinceSnap > SEEK_LILY_COOLDOWN_FRAMES && lilies.length > 0) {
                person.state = "SEEK_LILY";
                const idx = Math.floor(Math.random() * lilies.length);
                _lilyTargetPos.set(lilies[idx].x, lilies[idx].y, lilies[idx].z);
                person.target = _lilyTargetPos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 4, 0, (Math.random() - 0.5) * 4));
            }
        } else if (Math.random() < 0.0008) {
            person.state = "FLOW";
            person.target = BRIDGE_FLOW_TARGET.clone();
        } else if (Math.random() < 0.0008) {
            person.state = "QUEUING";
            person.target = DUNELM_QUEUE_TARGET.clone();
        }
    } else if (person.state === "SEEK_LILY") {
        if (person.target != null && person.pos.distanceTo(person.target) < 10) {
            person.state = "SNAPPING";
            person.snapPosition = person.target.clone();
            person.target = null;
            person.snapTimer = 0;
            person.snapFlashDone = false;
        }
    } else if (person.state === "FLOW") {
        if (person.target != null && person.pos.distanceTo(person.target) < 8) {
            person.state = "WANDER";
            person.target = null;
        }
    }
    // QUEUING -> INSIDE is handled in animate loop when person is within DUNELM_DOOR_OPEN_RADIUS
    return person;
}

function animate() {
    requestAnimationFrame(animate);
    if (webglContextLost) return; // stop rendering when context is lost to avoid errors

    // Keep frustum current (used for people visibility and far-hill culling)
    frustumMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    cameraFrustum.setFromProjectionMatrix(frustumMatrix);

    if (frameCount % 10 === 0) {
        treeElement.update(camera);
    }

    // Update cursor world position for dragonfly follow mode (raycast onto y=5 plane)
    if (PARAMS.dragonflies.followCursor && frameCount % 10 === 0) {
        dragonflyRaycaster.setFromCamera(dragonflyMouseNDC, camera);
        const cursorIntersect = dragonflyRaycaster.ray.intersectPlane(dragonflyPlane, cursorWorldPos);
        if (cursorIntersect) cursorWorldPos.copy(cursorIntersect);
    }

    let _t0;
    if (ENABLE_PROFILING) _t0 = performance.now();

    // Update person bounds; incremental octree update (only re-insert movers); skip INSIDE
    const OCTREE_MOVE_EPS_SQ = 1e-6;
    for (let i = 0; i < people.length; i++) {
        const person = people[i];
        if (person.state === "INSIDE") continue;
        person.bounds.min.set(person.pos.x - PERSON_RADIUS, person.pos.y, person.pos.z - PERSON_RADIUS);
        person.bounds.max.set(person.pos.x + PERSON_RADIUS, person.pos.y + CHARACTER_HEIGHT, person.pos.z + PERSON_RADIUS);
        if (person.pos.distanceToSquared(person._lastOctreePos) > OCTREE_MOVE_EPS_SQ) {
            octree.remove(person);
            octree.insert(person);
            person._lastOctreePos.copy(person.pos);
        }
    }

    const CULL_DISTANCE = 100;  // cull characters beyond 100m (no far box LOD)
    const LOD_CLOSE = 40;      // 0-40m: individual mesh with phone, 40-100m: instanced medium
    const SHADOW_DISTANCE = 15; // only characters within this distance of camera cast shadows
    const camPos = camera.position;

    // Door animation and INSIDE transition (QUEUING person within radius -> INSIDE)
    const doorGroup = dunelm.userData.doorGroup;
    if (doorGroup) {
        let someoneNearDoor = false;
        let someoneInside = false;
        for (let i = 0; i < people.length; i++) {
            const person = people[i];
            if (person.state === "INSIDE") {
                someoneInside = true;
            } else if (person.state === "QUEUING" && person.target != null && person.target.distanceToSquared(DUNELM_QUEUE_TARGET) < 0.25 && person.pos.distanceTo(DUNELM_QUEUE_TARGET) < DUNELM_DOOR_OPEN_RADIUS) {
                someoneNearDoor = true;
                octree.remove(person);
                person.state = "INSIDE";
                person.respawnAt = frameCount + DUNELM_INSIDE_MIN_FRAMES + Math.floor(Math.random() * (DUNELM_INSIDE_MAX_FRAMES - DUNELM_INSIDE_MIN_FRAMES));
            }
        }
        const doorShouldStayOpen = someoneNearDoor || someoneInside;
        if (doorShouldStayOpen) {
            const openAngle = Math.PI / 2; // open outward (clearer visibility)
            doorGroup.rotation.y += (openAngle - doorGroup.rotation.y) * 0.15;
        } else {
            doorGroup.rotation.y += (0 - doorGroup.rotation.y) * 0.1;
        }
    }

    // Respawn INSIDE people when time is up
    const doorWorldPos = dunelm.userData.doorWorldPosition;
    const doorExitDir = dunelm.userData.doorExitDirection;
    for (let i = 0; i < people.length; i++) {
        const person = people[i];
        if (person.state === "INSIDE" && frameCount >= person.respawnAt) {
            person.pos.copy(doorWorldPos).addScaledVector(doorExitDir, 1.0);
            person.vel.copy(doorExitDir).multiplyScalar(person.maxSpeed * 0.5);
            person.facingAngle = Math.atan2(doorExitDir.x, doorExitDir.z);
            person._lastOctreePos.copy(person.pos);
            octree.insert(person);
            person.state = "WANDER";
            person.target = null;
            delete person.respawnAt;
        }
    }

    // Apply physics and decision to all people (every 2 frames to save CPU); skip INSIDE
    if (frameCount % 2 === 0) {
        for (let i = 0; i < people.length; i++) {
            const person = people[i];
            if (!person || !person.pos || person.state === "INSIDE") continue;
            if (frameCount % SNAP_END_FRAME === 0) {
                if ((person.getPhone() != null) && (person.state !== "SNAPPING") && (Math.random() < 0.05)) {
                    person.state = "SNAPPING";
                    person.snapTimer = 0;
                    person.snapFlashDone = false;
                }
            }
            person = updateDecision(person);
            person = applyPhysics(person);
            animatePerson(person);
        }
    }

    // Dragonfly A* path recomputation (every 60 frames when follow cursor enabled)
    if (PARAMS.dragonflies.followCursor && dragonflies.length > 0 && frameCount % 60 === 0) {
        const navGrid = getDragonflyNavGrid();
        for (let i = 0; i < dragonflies.length; i++) {
            const dragonfly = dragonflies[i];
            dragonfly.path = findPath(navGrid, dragonfly.pos, cursorWorldPos);
            dragonfly.pathIndex = 0;
        }
    }

    // Dragonfly physics (every frame)
    for (let i = 0; i < dragonflies.length; i++) {
        const dragonfly = dragonflies[i];
        applyDragonflyPhysics(dragonfly);
    }

    if (ENABLE_PROFILING) {
        _profileCrowdMs = performance.now() - _t0;
        _t0 = performance.now();
    }

    // Hybrid crowd: bucket by distance; characters beyond CULL_DISTANCE are not rendered; INSIDE are hidden
    _listClose.length = 0;
    _listMid.length = 0;
    for (let i = 0; i < people.length; i++) {
        const person = people[i];
        if (person.state === "INSIDE") {
            if (person.mesh) {
                if (person.mesh.parent) person.mesh.parent.remove(person.mesh);
                person.mesh = null;
                person.parts = null;
                person._phone = null;
                person.getPhone = () => null;
                person.triggerFlash = () => { };
            }
            continue;
        }
        const dist = person.pos.distanceTo(camPos);
        if (dist > CULL_DISTANCE) {
            // Culled: remove mesh if they had one (e.g. just moved out of range)
            if (person.mesh) {
                if (person.mesh.parent) person.mesh.parent.remove(person.mesh);
                person.mesh = null;
                person.parts = null;
                person._phone = null;
                person.getPhone = () => null;
                person.triggerFlash = () => { };
            }
            continue;
        }
        if (dist < LOD_CLOSE) _listClose.push(person);
        else _listMid.push(person);  // 40-100m: instanced medium
    }

    // Demote: remove mesh from people in mid tier
    for (let i = 0; i < _listMid.length; i++) {
        const p = _listMid[i];
        if (p.mesh) {
            if (p.mesh.parent) p.mesh.parent.remove(p.mesh);
            p.mesh = null;
            p.parts = null;
            p._phone = null;
            p.getPhone = () => null;
            p.triggerFlash = () => { };
        }
    }

    // Promote: create mesh for people in close tier
    for (let i = 0; i < _listClose.length; i++) {
        const p = _listClose[i];
        if (!p.mesh) {
            const { mesh, parts, _phone } = createPersonMeshOnly({ position: p.pos, rotationY: p.facingAngle });
            p.mesh = mesh;
            p.parts = parts;
            p._phone = _phone;
            p.getPhone = function () { return this._phone || null; };
            p.triggerFlash = function () {
                const phone = this.getPhone();
                if (phone) {
                    phone.setFlashOn();
                    setTimeout(() => phone.setFlashOff(), 500);
                }
            };
            scene.add(p.mesh);
        }
    }

    // Only characters within SHADOW_DISTANCE of camera cast shadows
    for (let i = 0; i < _listClose.length; i++) {
        const p = _listClose[i];
        if (p.mesh) {
            const cast = p.pos.distanceTo(camPos) < SHADOW_DISTANCE;
            p.mesh.traverse((o) => { if (o.isMesh) o.castShadow = cast; });
        }
    }

    // Fill instanced meshes for mid and far
    function fillInstancedMesh(mesh, list) {
        if (list.length === 0) {
            mesh.count = 0;
            return;
        }
        for (let i = 0; i < list.length; i++) {
            const person = list[i];
            _dummyPosition.copy(person.pos);
            _dummyQuaternion.setFromAxisAngle(_dummyAxisY, person.facingAngle);
            _dummyQuatBank.setFromAxisAngle(_dummyAxisX, person.bankAngle ?? 0);
            _dummyQuaternion.multiply(_dummyQuatBank);
            _dummyMatrix.compose(_dummyPosition, _dummyQuaternion, _dummyScale);
            mesh.setMatrixAt(i, _dummyMatrix);
            mesh.setColorAt(i, person.bodyColor);
        }
        mesh.count = list.length;
        mesh.instanceMatrix.needsUpdate = true;
        const colorAttr = mesh.geometry.attributes.instanceColor;
        if (colorAttr) colorAttr.needsUpdate = true;
    }
    fillInstancedMesh(instancedMeshMedium, _listMid);

    // Dragonfly LOD: bucket by distance, fill instanced meshes
    _listDfClose.length = 0;
    _listDfFar.length = 0;
    for (let i = 0; i < dragonflies.length; i++) {
        const df = dragonflies[i];
        const dist = df.pos.distanceTo(camPos);
        if (dist > DRAGONFLY_CULL_DISTANCE) continue;
        if (dist < DRAGONFLY_LOD_CLOSE) _listDfClose.push(df);
        else _listDfFar.push(df);
    }

    for (let i = 0; i < _listDfClose.length; i++) {
        const df = _listDfClose[i];
        _dummyPosition.copy(df.pos);
        _dummyQuaternion.setFromAxisAngle(_dummyAxisY, df.facingAngle);
        _dummyQuatBank.setFromAxisAngle(_dummyAxisX, df.bankAngle ?? 0);
        _dummyQuaternion.multiply(_dummyQuatBank);
        _dummyMatrix.compose(_dummyPosition, _dummyQuaternion, _dummyScale);
        dfInstancedClose.setMatrixAt(i, _dummyMatrix);
        dfInstancedClose.setColorAt(i, df.color);
    }
    dfInstancedClose.count = _listDfClose.length;
    dfInstancedClose.instanceMatrix.needsUpdate = true;
    if (dfInstancedClose.geometry.attributes.instanceColor) dfInstancedClose.geometry.attributes.instanceColor.needsUpdate = true;
    for (let i = 0; i < _listDfFar.length; i++) {
        const df = _listDfFar[i];
        _dummyPosition.copy(df.pos);
        _dummyQuaternion.setFromAxisAngle(_dummyAxisY, df.facingAngle);
        _dummyQuatBank.setFromAxisAngle(_dummyAxisX, df.bankAngle ?? 0);
        _dummyQuaternion.multiply(_dummyQuatBank);
        _dummyMatrix.compose(_dummyPosition, _dummyQuaternion, _dummyScale);
        dfInstancedFar.setMatrixAt(i, _dummyMatrix);
        dfInstancedFar.setColorAt(i, df.color);
    }
    dfInstancedFar.count = _listDfFar.length;
    dfInstancedFar.instanceMatrix.needsUpdate = true;
    if (dfInstancedFar.geometry.attributes.instanceColor) dfInstancedFar.geometry.attributes.instanceColor.needsUpdate = true;

    if (ENABLE_PROFILING) {
        _profileBucketMs = performance.now() - _t0;
        _t0 = performance.now();
    }

    /*
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
    */

    // Wave plane: animate control points y = 20 + 8*sin(t + phase) then update surface
    const waveT = performance.now() * 0.001;
    const k1 = 0.8, k2 = 0.8;
    for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
            const idx = i * 4 + j;
            wavePlaneControlPoints[idx].y = WAVE_PLANE_BASE_Y + WAVE_PLANE_AMP * Math.sin(waveT + i * k1 + j * k2);
        }
    }
    // Throttle wave-plane geometry + light updates to every 6 frames to reduce CPU and buffer uploads
    if (frameCount % 6 === 0) {
        updateBSplineSurfaceFromPoints(wavePlaneGroup, wavePlaneControlPoints, true); // skipNormals: invisible surface

        // Wave plane lights: evaluate B-spline at (u,v) for each grid point (cheaper than raycasting)
        wavePlaneGroup.updateMatrixWorld(true);
        for (let idx = 0; idx < wavePlaneLightEntries.length; idx++) {
            const { mesh, xLocal, zLocal } = wavePlaneLightEntries[idx];
            const uNorm = xLocal / WAVE_PLANE_SIZE;
            const vNorm = zLocal / WAVE_PLANE_SIZE;
            getBSplineSurfaceWorldPointAtNormalized(wavePlaneGroup, wavePlaneControlPoints, uNorm, vNorm, _wavePlaneEvalWorldPos);
            mesh.position.copy(_wavePlaneEvalWorldPos);
        }
    }

    // Far-hill billboards: single camera-facing quaternion (cylindrical billboard in XZ), distance cull only (InstancedMesh frustum culling handles visibility)
    _farHillBillboardQuat.setFromAxisAngle(_farHillAxisY, Math.atan2(camera.position.x, camera.position.z));
    _farHillVisibleList.length = 0;
    for (let i = 0; i < farHillTreePositions.length; i++) {
        const pos = farHillTreePositions[i];
        if (pos.distanceTo(camPos) <= FAR_HILL_CULL_DISTANCE) _farHillVisibleList.push(pos);
    }
    for (let i = 0; i < _farHillVisibleList.length; i++) {
        _dummyMatrix.compose(_farHillVisibleList[i], _farHillBillboardQuat, _dummyScale);
        farHillBillboardInstancedMesh.setMatrixAt(i, _dummyMatrix);
    }
    farHillBillboardInstancedMesh.count = _farHillVisibleList.length;
    farHillBillboardInstancedMesh.instanceMatrix.needsUpdate = true;

    updateCamera();
    frameCount += 1;
    if (ENABLE_PROFILING) _t0 = performance.now();
    if (PARAMS.performance.usePostProcessing) {
        composer.render();
    } else {
        renderer.render(scene, camera);
    }
    if (ENABLE_PROFILING) {
        const now = performance.now();
        const renderMs = now - _t0;
        if (now - _profileLastLog >= 1000) {
            console.log(`[perf] crowd: ${_profileCrowdMs.toFixed(2)}ms, bucket: ${_profileBucketMs.toFixed(2)}ms, composer: ${renderMs.toFixed(2)}ms, drawCalls: ${renderer.info.render.calls}`);
            _profileLastLog = now;
        }
    }
    stats.update();
}

animate();