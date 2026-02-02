import * as THREE from "three";

/**
 * Create a staircase with cube-shaped steps and angled concrete side slabs.
 * Connects a start point (e.g. pavement edge) to an end point (e.g. bridge level).
 * Based on Dunelm House reference: concrete steps with large angled slabs on either side.
 *
 * @param {THREE.Vector3} startPos - Start point (pavement end)
 * @param {THREE.Vector3} endPos - End point (bridge level)
 * @param {Object} [options]
 * @param {number} [options.width=6] - Width of staircase (x-direction)
 * @param {number} [options.stepHeight=0.5] - Height of each step
 * @param {number} [options.stepDepth=1.0] - Depth (tread) of each step
 * @param {number} [options.slabThickness=1.5] - Thickness of side slabs
 * @param {number} [options.slabHeight=2.0] - Height of side slabs
 * @param {number} [options.stepColor=0x888888] - Material color for steps
 * @param {number} [options.slabColor=0x666666] - Material color for side slabs
 * @returns {THREE.Group}
 */
export function createStaircase(startPos, endPos, options = {}) {
    const {
        width = 6,
        stepHeight = 0.5,
        stepDepth = 1.0,
        slabThickness = 1.0,
        slabHeight = 2.0,
        stepColor = 0x888888,
        slabColor = 0x666666
    } = options;

    const group = new THREE.Group();

    const dx = endPos.x - startPos.x;
    const dy = endPos.y - startPos.y;
    const dz = endPos.z - startPos.z;
    const pathLength = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const horizontalDist = Math.sqrt(dx * dx + dz * dz);
    // Space step centers by stepDepth so each step abuts the next (no gaps)
    const numSteps = Math.max(1, Math.ceil(pathLength / stepDepth));

    const stepMaterial = new THREE.MeshStandardMaterial({ color: stepColor });
    const slabMaterial = new THREE.MeshStandardMaterial({ color: slabColor });

    const yaw = Math.atan2(dx, dz);
    const direction = new THREE.Vector3(dx, dy, dz).divideScalar(pathLength);

    // Create cube-shaped steps - each step center spaced by stepDepth along the path
    const stepGeo = new THREE.BoxGeometry(width, stepHeight, stepDepth);
    for (let i = 0; i < numSteps; i++) {
        const dist = (i + 0.5) * stepDepth;
        const step = new THREE.Mesh(stepGeo, stepMaterial);
        step.position.copy(startPos).addScaledVector(direction, dist);
        step.rotation.y = yaw;
        group.add(step);
    }

    // Side slabs: angled rectangles following the staircase
    const slopeAngle = Math.atan2(dy, horizontalDist);
    const slabLength = Math.sqrt(horizontalDist * horizontalDist + dy * dy);
    const slabGeo = new THREE.BoxGeometry(slabThickness, slabHeight, slabLength);

    const midX = (startPos.x + endPos.x) / 2;
    const midY = (startPos.y + endPos.y) / 2;
    const midZ = (startPos.z + endPos.z) / 2;
    const offset = width / 2 + slabThickness / 2;
    // Perpendicular to direction (dx, dz): left = (-dz, dx), right = (dz, -dx)
    const perpX = (-dz / horizontalDist) * offset;
    const perpZ = (dx / horizontalDist) * offset;

    // Left slab
    const leftSlab = new THREE.Mesh(slabGeo, slabMaterial);
    leftSlab.position.set(midX + perpX, midY, midZ + perpZ);
    leftSlab.rotation.y = yaw;
    leftSlab.rotation.x = slopeAngle;
    group.add(leftSlab);

    // Right slab
    const rightSlab = new THREE.Mesh(slabGeo, slabMaterial);
    rightSlab.position.set(midX - perpX, midY, midZ - perpZ);
    rightSlab.rotation.y = yaw;
    rightSlab.rotation.x = slopeAngle;
    group.add(rightSlab);

    return group;
}
