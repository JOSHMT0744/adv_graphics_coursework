import * as THREE from "three";

const _dummy = new THREE.Object3D();

/**
 * Create a staircase with cube-shaped steps and angled concrete side slabs.
 * Uses InstancedMesh for steps and slabs to minimise draw calls.
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
    const numSteps = Math.max(1, Math.ceil(pathLength / stepDepth));

    const stepMaterial = new THREE.MeshStandardMaterial({ color: stepColor });
    const slabMaterial = new THREE.MeshStandardMaterial({ color: slabColor });

    const yaw = Math.atan2(dx, dz);
    const direction = new THREE.Vector3(dx, dy, dz).divideScalar(pathLength);

    // Steps: one InstancedMesh
    const stepGeo = new THREE.BoxGeometry(width, stepHeight, stepDepth);
    const stepsInstanced = new THREE.InstancedMesh(stepGeo, stepMaterial, numSteps);
    for (let i = 0; i < numSteps; i++) {
        const dist = (i + 0.5) * stepDepth;
        _dummy.position.copy(startPos).addScaledVector(direction, dist);
        _dummy.rotation.y = yaw;
        _dummy.updateMatrix();
        stepsInstanced.setMatrixAt(i, _dummy.matrix);
    }
    stepsInstanced.instanceMatrix.needsUpdate = true;
    group.add(stepsInstanced);

    // Side slabs: one InstancedMesh (2 instances); slab length equals path length
    const slopeAngle = Math.atan2(dy, horizontalDist);
    const slabGeo = new THREE.BoxGeometry(slabThickness, slabHeight, pathLength);
    const slabsInstanced = new THREE.InstancedMesh(slabGeo, slabMaterial, 2);

    const midX = (startPos.x + endPos.x) / 2;
    const midY = (startPos.y + endPos.y) / 2;
    const midZ = (startPos.z + endPos.z) / 2;
    const offset = width / 2 + slabThickness / 2;
    const perpX = (-dz / horizontalDist) * offset;
    const perpZ = (dx / horizontalDist) * offset;

    _dummy.position.set(midX + perpX, midY, midZ + perpZ);
    _dummy.rotation.y = yaw;
    _dummy.rotation.x = slopeAngle;
    _dummy.updateMatrix();
    slabsInstanced.setMatrixAt(0, _dummy.matrix);

    _dummy.position.set(midX - perpX, midY, midZ - perpZ);
    _dummy.updateMatrix();
    slabsInstanced.setMatrixAt(1, _dummy.matrix);

    slabsInstanced.instanceMatrix.needsUpdate = true;
    group.add(slabsInstanced);

    return group;
}
