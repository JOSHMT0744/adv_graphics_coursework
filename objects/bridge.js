import * as THREE from "https://unpkg.com/three@0.126.1/build/three.module.js";
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
    lightSpacing: 2.0,
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

/**
 * Prong as a box from (0,0,0) to (runX, riseY, 0). Box length = Euclidean distance;
 * cross-section (crossX, crossZ). Box center stays at origin; parent positions it.
 * @param {number} runX - signed (positive = +X)
 * @param {number} riseY
 * @param {number} crossX - width in X when runX=0
 * @param {number} crossZ - depth in Z
 * @param {THREE.Material} material
 * @returns {THREE.Mesh}
 */
function createProng(runX, riseY, crossX, crossZ, material) {
    const length = Math.sqrt(runX * runX + riseY * riseY);
    const geo = new THREE.BoxGeometry(crossX, length, crossZ);
    const mesh = new THREE.Mesh(geo, material);
    // Default box Y is "length"; rotate so +Y aligns with (runX, riseY, 0)
    const angle = Math.atan2(runX, riseY);
    mesh.rotation.z = -angle;
    return mesh;
}

/**
 * One pier: tapered cylinder + two prongs. Local: cylinder bottom at y=-baseHeight,
 * top at y=-baseHeight+cylHeight. Prongs from (0, -baseHeight+cylHeight, 0) to
 * (±(deckWidth/2), deckBottomY, 0). Here deckBottomY=0, so run=±W/2, rise=baseHeight-cylHeight.
 * Group positioned at (0, 0, zBase).
 * @param {number} zBase - z of this pier (e.g. +L/2 or -L/2)
 * @param {number} baseHeight // height of the footbridge
 * @param {number} cylHeight
 * @param {number} W2 - deck half-width
 * @param {number} deckBottomY - y of deck underside (0 in our schema)
 * @param {THREE.Material} material
 * @param {number} radiusTop
 * @param {number} radiusBottom
 * @param {number} prongCrossX
 * @param {number} prongCrossZ
 * @returns {THREE.Group}
 */
function createBase(zBase, baseHeight, cylHeight, W2, deckBottomY, material, radiusTop, radiusBottom, prongCrossX, prongCrossZ) {
    const pier = new THREE.Group();
    pier.position.z = zBase;

    const cylTop = -baseHeight + cylHeight;
    const cylGeo = createTaperedHexCylinder(radiusTop, radiusBottom, cylHeight);
    const cyl = new THREE.Mesh(cylGeo, material);
    cyl.position.y = -baseHeight + cylHeight / 2;
    pier.add(cyl);

    const riseY = deckBottomY - cylTop;
    // Place prong so its start (at cylinder) is (0, cylTop, 0). Box center is at
    // ±(runX/2, riseY/2, 0) from start; so position = (0, cylTop, 0) + (runX/2, riseY/2, 0).
    // Right prong (+X): runX=+W2
    const prongR = createProng(W2, riseY, prongCrossX, prongCrossZ, material);
    prongR.position.set(W2 / 2, cylTop + riseY / 2, 0);
    pier.add(prongR);
    // Left prong (-X): runX=-W2 → offset (-W2/2, riseY/2, 0)
    const prongL = createProng(-W2, riseY, prongCrossX, prongCrossZ, material);
    prongL.position.set(-W2 / 2, cylTop + riseY / 2, 0);
    pier.add(prongL);

    return pier;
}

/**
 * Railing on one long edge: solid concrete block with floor point lights at each
 * spacing, at the corner between the deck and the railing.
 * @param {number} side - +1 for +X (right), -1 for -X (left)
 * @param {number} L - deck length
 * @param {number} W - deck width
 * @param {number} T - deck thickness
 * @param {THREE.Material} material - for the concrete railing
 * @param {number} railingHeight
 * @param {number} railingWidth - thickness of the block outward from the deck
 * @param {number} lightSpacing - distance between lights along Z
 * @param {Object} lightOpts - lightIntensity, lightDistance, lightColor
 * @returns {THREE.Group}
 */
function createRailing(side, L, W, T, material, railingHeight, railingWidth, lightSpacing, lightOpts) {
    const railingGroup = new THREE.Group();
    const xCenter = side * (W / 2 + railingWidth / 2);

    // Solid concrete block railing: runs full length L, sits on deck from y=T
    const block = new THREE.Mesh(
        new THREE.BoxGeometry(railingWidth, railingHeight, L),
        material
    );
    block.position.set(xCenter, T + railingHeight / 2, 0);
    railingGroup.add(block);

    // Floor lights at each spacing: small point lights at the corner (deck / railing base)
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

    const concreteMaterial = new THREE.MeshStandardMaterial({ color: bridgeOptions.concreteColor });
    const deckTexture = getTexture('textures/concrete_tiles_01_2k/concrete_tiles_01_2k/concrete_tiles_01_color_2k.png', "Error loading deck texture");
    const deckMaterial = new THREE.MeshStandardMaterial({ map: deckTexture });

    const bridgeGroup = new THREE.Group();

    // 1. Deck (Box X=W, Y=T, Z=L); lift by T/2 so bottom at y=0
    const deck = new THREE.Mesh(new THREE.BoxGeometry(W, T, L), deckMaterial);
    deck.position.y = T / 2;
    bridgeGroup.add(deck);

    // 2. Railings: solid concrete blocks with floor point lights at each spacing
    const lightOpts = {
        lightIntensity: bridgeOptions.lightIntensity,
        lightDistance: bridgeOptions.lightDistance,
    };

    bridgeGroup.add(createRailing(1, L, W, T, concreteMaterial, bridgeOptions.railingHeight, bridgeOptions.railingWidth, bridgeOptions.lightSpacing, lightOpts));
    bridgeGroup.add(createRailing(-1, L, W, T, concreteMaterial, bridgeOptions.railingHeight, bridgeOptions.railingWidth, bridgeOptions.lightSpacing, lightOpts));

    // 3. Bases at z = ±L/2
    bridgeGroup.add(createBase(L2, bridgeOptions.baseHeight, bridgeOptions.cylHeight, W2, 0, concreteMaterial, bridgeOptions.radiusTop, bridgeOptions.radiusBottom, bridgeOptions.prongCrossX, bridgeOptions.prongCrossZ));
    bridgeGroup.add(createBase(-L2, bridgeOptions.baseHeight, bridgeOptions.cylHeight, W2, 0, concreteMaterial, bridgeOptions.radiusTop, bridgeOptions.radiusBottom, bridgeOptions.prongCrossX, bridgeOptions.prongCrossZ));

    bridgeGroup.position.set(x, y, z);
    bridgeGroup.scale.setScalar(scale);
    return bridgeGroup;
}
