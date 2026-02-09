import { COLOURS } from '../constants.js';
import * as THREE from "three";
import { getTexture } from '../utils/getTexture.js';

/** Horizontal radius of the foliage sphere (used for collision). */
const FOLIAGE_RADIUS = 3;

/** Distance beyond which the low-detail (box) LOD is used. */
const LOD_DISTANCE = 50;

export function createOakTree(x, z, scale = 1) {
    const barkTexture = getTexture('textures/bark_01_2k/bark_01_color_2k.png', "Error loading bark texture");

    // High-detail: cylinder trunk + icosahedron foliage
    const highDetail = new THREE.Group();
    const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.5, 0.5, 4),
        new THREE.MeshStandardMaterial({ map: barkTexture })
    );
    trunk.position.y = 2;
    highDetail.add(trunk);
    const foliage = new THREE.Mesh(
        new THREE.IcosahedronGeometry(FOLIAGE_RADIUS, 0),
        new THREE.MeshStandardMaterial({ color: COLOURS.LEAF_GREEN })
    );
    foliage.position.y = 6;
    highDetail.add(foliage);

    // Low-detail: box trunk + box foliage (fewer draws at distance)
    const lowDetail = new THREE.Group();
    const trunkBox = new THREE.Mesh(
        new THREE.BoxGeometry(1, 4, 1),
        new THREE.MeshStandardMaterial({ map: barkTexture })
    );
    trunkBox.position.y = 2;
    lowDetail.add(trunkBox);
    lowDetail.add(foliage.clone());

    const lod = new THREE.LOD();
    lod.addLevel(highDetail, 0);
    lod.addLevel(lowDetail, LOD_DISTANCE);

    lod.position.set(x, 0, z);
    lod.scale.setScalar(scale);
    /** Horizontal radius for collision (foliage radius × scale). Use for overlap/collision checks. */
    lod.userData.radius = FOLIAGE_RADIUS * scale;
    return lod;
}
