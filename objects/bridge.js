import * as THREE from "three";
import { getTexture } from '../utils/getTexture.js';

/**
 * -----------------------------------------------------------------------------
 * PLAN: Durham Kingsgate Bridge – Three.js mesh
 * -----------------------------------------------------------------------------
 *
 * COORDINATE SYSTEM (local, Y-up)
 * - Origin: centre of deck in XZ; Y = 0 at deck bottom (walking surface at deck top).
 * - X: deck width; Z: span along the crossing; Y: up.
 * - Span runs local +Z = "near" bank, -Z = "far" bank (when placed, near aligns with
 *   the flat base from planeMesh).
 *
 * DEFAULTS (tunable via options)
 * - Deck: length L=20 (Z), width W=6 (X), thickness T=0.8. BoxGeometry(W, T, L);
 *   mesh shifted up by T/2 so deck bottom is at y=0.
 * - Railings: solid concrete blocks along each long edge; floor point lights at
 *   each spacing at the corner between deck and railing.
 * - Bases (piers): two, at z = ±L/2 = ±10.
 *   - Cylinder: 6-sided, tapered. CylinderGeometry(radiusTop=0.6, radiusBottom=0.9, height=3, 6).
 *     y from -baseHeight to -baseHeight+3 = -4 to -1. Slightly wider at bottom.
 *   - Prongs: two per base, from cylinder top (0, -1, ±10) to deck underside at (±W/2, 0, ±10).
 *     Vector (±3, 1, 0); length = √10. Box cross-section ~0.45×0.5, aligned along prong.
 *
 * GROUP STRUCTURE
 * - deck (Mesh)
 * - railingLeft, railingRight (Group: solid block + point lights)
 * - baseLeft (z=+L/2): Group { taperedCylinder, prongNegX, prongPosX }
 * - baseRight (z=-L/2): Group { taperedCylinder, prongNegX, prongPosX }
 *
 * PLACEMENT IN WORLD
 * - createKingsgateBridge(x, y, z, scale): (x,y,z) = world position of local origin
 *   (centre, deck bottom). To align near end with flat base front at zBaseStart: use
 *   z = zBaseStart - L/2 (e.g. -30 - 10 = -40 for L=20). y = yBaseTop (e.g. -0.4) so
 *   deck sits on the base level.
 *
 * IMPLEMENTATION ORDER
 * 1. createTaperedHexCylinder(radiusTop, radiusBottom, height)
 * 2. createProng(length, runX, riseY, crossX, crossZ) → mesh from (0,0,0) to (runX, riseY, 0)
 * 3. createBase(z, baseHeight, cylHeight, W2, deckBottomY, material)
 * 4. createRailing(side, L, W, T, material)
 * 5. createKingsgateBridge(x, y, z, scale, options)
 * -----------------------------------------------------------------------------
 */

const BRIDGE_DEFAULTS = {
    deckLength: 30,
    deckWidth: 2,
    deckThickness: 0.3,
    baseHeight: 11,
    cylHeight: 2,
    radiusTop: 0.6,
    radiusBottom: 0.9,
    prongCrossX: 0.45,
    prongCrossZ: 0.5,
    railingHeight: 0.9,
    railingWidth: 0.18,
    lightSpacing: 5.0,  // distance between lights along the bridge (larger = fewer lights)
    lightIntensity: 1.0,
    lightDistance: 6,
    lightColor: 0xfff5e6,
    concreteColor: 0x9a9a9a,
};

/**
 * Tapered 6-sided cylinder (hexagonal prism). Bottom at y=0, top at y=height.
 * @param {number} radiusTop - at y=height
 * @param {number} radiusBottom - at y=0
 * @param {number} height
 * @returns {THREE.CylinderGeometry}
 */
function createTaperedHexCylinder(radiusTop, radiusBottom, height) {
    return new THREE.CylinderGeometry(radiusTop, radiusBottom, height, 10);
}

const _dummy = new THREE.Object3D();

/**
 * Railing lights only (for use with instanced railing blocks).
 * @param {number} side - +1 or -1
 * @param {number} L - deck length
 * @param {number} W - deck width
 * @param {number} T - deck thickness
 * @param {number} lightSpacing
 * @param {Object} lightOpts - lightIntensity, lightDistance
 * @returns {THREE.Group}
 */
function createRailingLightsOnly(side, L, W, T, lightSpacing, lightOpts) {
    const railingGroup = new THREE.Group();
    const numLights = Math.max(2, Math.floor(L / lightSpacing) + 1);
    const lightColors = Array.from({ length: numLights }, () => Math.floor(Math.random() * 0x1000000));
    const step = L / (numLights - 1);
    const xCorner = side * (W / 2 - 0.001);
    const { lightIntensity, lightDistance } = lightOpts;
    for (let i = 0; i < numLights; i++) {
        const z = -L / 2 + i * step;
        const pl = new THREE.PointLight(lightColors[i], lightIntensity, lightDistance, 2);
        pl.position.set(xCorner, T + 0.02, z);
        railingGroup.add(pl);
    }
    return railingGroup;
}

/**
 * Kingsgate Bridge as a THREE.Group. Local origin: centre of deck in XZ, y=0 at deck bottom.
 * @param {number} [x=0] - world X
 * @param {number} [y=0] - world Y (deck bottom; match yBaseTop to align with flat base)
 * @param {number} [z=0] - world Z (centre). Near end at z + L/2; set z = zBaseStart - L/2 to align.
 * @param {number} [scale=1]
 * @param {Object} [options] - overrides for BRIDGE_DEFAULTS
 * @returns {THREE.Group}
 */
export function createKingsgateBridge(x = 0, y = 0, z = 0, scale = 1, options = {}) {
    const bridgeOptions = { ...BRIDGE_DEFAULTS, ...options };
    const L = bridgeOptions.deckLength, W = bridgeOptions.deckWidth, T = bridgeOptions.deckThickness;
    const W2 = W / 2;
    const L2 = L / 2 - 5;
    const baseHeight = bridgeOptions.baseHeight;
    const cylHeight = bridgeOptions.cylHeight;
    const cylTop = -baseHeight + cylHeight;
    const riseY = -cylTop;

    const concreteMaterial = new THREE.MeshStandardMaterial({ color: bridgeOptions.concreteColor });
    const deckTexture = getTexture('textures/concrete_tiles_01_2k/concrete_tiles_01_2k/concrete_tiles_01_color_2k.png', "Error loading deck texture");
    const deckMaterial = new THREE.MeshStandardMaterial({ map: deckTexture });

    const bridgeGroup = new THREE.Group();

    // 1. Deck
    const deck = new THREE.Mesh(new THREE.BoxGeometry(W, T, L), deckMaterial);
    deck.position.y = T / 2;
    bridgeGroup.add(deck);

    // 2. Railings: one InstancedMesh for both blocks + two light groups
    const lightOpts = {
        lightIntensity: bridgeOptions.lightIntensity,
        lightDistance: bridgeOptions.lightDistance,
    };
    const railingGeo = new THREE.BoxGeometry(bridgeOptions.railingWidth, bridgeOptions.railingHeight, L);
    const railingsInstanced = new THREE.InstancedMesh(railingGeo, concreteMaterial, 2);
    _dummy.position.set(W / 2 + bridgeOptions.railingWidth / 2, T + bridgeOptions.railingHeight / 2, 0);
    _dummy.rotation.set(0, 0, 0);
    _dummy.updateMatrix();
    railingsInstanced.setMatrixAt(0, _dummy.matrix);
    _dummy.position.set(-(W / 2 + bridgeOptions.railingWidth / 2), T + bridgeOptions.railingHeight / 2, 0);
    _dummy.updateMatrix();
    railingsInstanced.setMatrixAt(1, _dummy.matrix);
    railingsInstanced.instanceMatrix.needsUpdate = true;
    bridgeGroup.add(railingsInstanced);
    bridgeGroup.add(createRailingLightsOnly(1, L, W, T, bridgeOptions.lightSpacing, lightOpts));
    bridgeGroup.add(createRailingLightsOnly(-1, L, W, T, bridgeOptions.lightSpacing, lightOpts));

    // 3. Bases: one InstancedMesh for both cylinders, one for all four prongs
    const cylGeo = createTaperedHexCylinder(bridgeOptions.radiusTop, bridgeOptions.radiusBottom, cylHeight);
    const cylindersInstanced = new THREE.InstancedMesh(cylGeo, concreteMaterial, 2);
    _dummy.position.set(0, -baseHeight + cylHeight / 2, L2);
    _dummy.rotation.set(0, 0, 0);
    _dummy.updateMatrix();
    cylindersInstanced.setMatrixAt(0, _dummy.matrix);
    _dummy.position.set(0, -baseHeight + cylHeight / 2, -L2);
    _dummy.updateMatrix();
    cylindersInstanced.setMatrixAt(1, _dummy.matrix);
    cylindersInstanced.instanceMatrix.needsUpdate = true;
    bridgeGroup.add(cylindersInstanced);

    const prongLength = Math.sqrt(W2 * W2 + riseY * riseY);
    const prongGeo = new THREE.BoxGeometry(bridgeOptions.prongCrossX, prongLength, bridgeOptions.prongCrossZ);
    const prongAngleR = Math.atan2(W2, riseY);
    const prongAngleL = Math.atan2(-W2, riseY);
    const prongsInstanced = new THREE.InstancedMesh(prongGeo, concreteMaterial, 4);
    const prongY = cylTop + riseY / 2;
    _dummy.position.set(W2 / 2, prongY, L2);
    _dummy.rotation.z = -prongAngleR;
    _dummy.updateMatrix();
    prongsInstanced.setMatrixAt(0, _dummy.matrix);
    _dummy.position.set(-W2 / 2, prongY, L2);
    _dummy.rotation.z = -prongAngleL;
    _dummy.updateMatrix();
    prongsInstanced.setMatrixAt(1, _dummy.matrix);
    _dummy.position.set(W2 / 2, prongY, -L2);
    _dummy.rotation.z = -prongAngleR;
    _dummy.updateMatrix();
    prongsInstanced.setMatrixAt(2, _dummy.matrix);
    _dummy.position.set(-W2 / 2, prongY, -L2);
    _dummy.rotation.z = -prongAngleL;
    _dummy.updateMatrix();
    prongsInstanced.setMatrixAt(3, _dummy.matrix);
    prongsInstanced.instanceMatrix.needsUpdate = true;
    bridgeGroup.add(prongsInstanced);

    bridgeGroup.position.set(x, y, z);
    bridgeGroup.scale.setScalar(scale);
    return bridgeGroup;
}
