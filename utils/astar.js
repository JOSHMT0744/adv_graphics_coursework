import * as THREE from "three";

const _leafCenter = new THREE.Vector3();
const _neighborLeaves = [];

/**
 * Finds a path from start to end using A* over octree leaf cells.
 * Uses the existing octree structure; no separate grid construction.
 * @param {import('./Octree.js').Octree} octree - The octree (e.g. dragonflyOctree)
 * @param {THREE.Vector3 | { x: number, y: number, z: number }} start Start position
 * @param {THREE.Vector3 | { x: number, y: number, z: number }} end End position
 * @param {(leaf: OctreeNode) => boolean} isLeafBlocked Returns true if the leaf is impassable
 * @returns {THREE.Vector3[]} Array of waypoints (world coordinates)
 */
export function findPathOctree(octree, start, end, isLeafBlocked) {
    const ex = end.x;
    const ey = end.y;
    const ez = end.z;
    const endPos = new THREE.Vector3(ex, ey, ez);

    const startLeaf = octree.getLeafAt(start);
    const endLeaf = octree.getLeafAt(end);

    if (!startLeaf || !endLeaf) {
        return [endPos];
    }
    if (isLeafBlocked(startLeaf)) {
        return [];
    }
    if (isLeafBlocked(endLeaf)) {
        return [endPos];
    }
    if (startLeaf === endLeaf) {
        return [endPos];
    }

    const goalCenter = endLeaf.bounds.getCenter(new THREE.Vector3());

    const openSet = [{ leaf: startLeaf, g: 0, h: 0, f: 0 }];
    openSet[0].h = openSet[0].leaf.bounds.getCenter(_leafCenter).distanceTo(goalCenter);
    openSet[0].f = openSet[0].h;

    const cameFrom = new Map();
    const gScore = new Map();
    gScore.set(startLeaf, 0);

    const MAX_ITERATIONS = 2000;
    let iterations = 0;

    while (openSet.length > 0 && iterations < MAX_ITERATIONS) {
        iterations++;

        let bestIdx = 0;
        for (let n = 1; n < openSet.length; n++) {
            if (openSet[n].f < openSet[bestIdx].f) bestIdx = n;
        }
        const current = openSet[bestIdx];
        openSet[bestIdx] = openSet[openSet.length - 1];
        openSet.pop();

        const { leaf } = current;

        if (leaf === endLeaf) {
            const path = [];
            let node = current;
            while (node) {
                const center = node.leaf.bounds.getCenter(new THREE.Vector3());
                path.unshift(center);
                node = cameFrom.get(node.leaf);
            }
            path.push(endPos);
            return path;
        }

        octree.getLeafNeighbors(leaf, _neighborLeaves);
        const currentCenter = leaf.bounds.getCenter(_leafCenter);

        for (let k = 0; k < _neighborLeaves.length; k++) {
            const neighborLeaf = _neighborLeaves[k];
            if (isLeafBlocked(neighborLeaf)) continue;

            const neighborCenter = neighborLeaf.bounds.getCenter(_leafCenter);
            const moveCost = currentCenter.distanceTo(neighborCenter);
            const tentativeG = (gScore.get(leaf) ?? Infinity) + moveCost;

            if (tentativeG >= (gScore.get(neighborLeaf) ?? Infinity)) continue;

            cameFrom.set(neighborLeaf, current);
            gScore.set(neighborLeaf, tentativeG);
            const h = neighborCenter.distanceTo(goalCenter);
            openSet.push({ leaf: neighborLeaf, g: tentativeG, h, f: tentativeG + h });
        }
    }

    return [endPos];
}
