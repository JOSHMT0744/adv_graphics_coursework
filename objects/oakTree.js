import { COLORS } from '../constants.js';
import * as THREE from "three";
import { getTexture } from '../utils/getTexture.js';

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
        new THREE.SphereGeometry(3),
        new THREE.MeshStandardMaterial({ color: COLORS.LEAF_GREEN })
    );
    foliage.position.y = 6;
    tree.add(foliage);

    tree.position.set(x, 0, z);
    tree.scale.setScalar(scale);
    return tree;
}
