import { COLOURS } from '../constants.js';
import * as THREE from "three";
import { getTexture } from '../utils/getTexture.js';

/** Horizontal radius of the foliage sphere (used for collision). */
const FOLIAGE_RADIUS = 3;

export function createOakTree(x, z, scale = 1) {
    const barkTexture = getTexture('textures/bark_01_2k/bark_01_color_2k.png', "Error loading bark texture");

    const tree = new THREE.Group();

    const trunk = new  THREE.Mesh(
        new THREE.CylinderGeometry(0.5, 0.5, 4),
        new THREE.MeshStandardMaterial({ map: barkTexture })
    );
    trunk.position.y = 2;
    tree.add(trunk);

    const foliage = new THREE.Mesh(
        new THREE.IcosahedronGeometry(FOLIAGE_RADIUS, 0),
        new THREE.MeshStandardMaterial({ color: COLOURS.LEAF_GREEN })
    );
    foliage.position.y = 6;
    tree.add(foliage);

    tree.position.set(x, 0, z);
    tree.scale.setScalar(scale);
    /** Horizontal radius for collision (foliage radius × scale). Use for overlap/collision checks. */
    tree.userData.radius = FOLIAGE_RADIUS * scale;
    return tree;
}
