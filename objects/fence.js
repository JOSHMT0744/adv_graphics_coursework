import * as THREE from "three";

const FENCE_DEFAULTS = {
    railingWidth: 0.18,
    railingHeight: 0.9,
    color: 0x9a9a9a,
};

/**
 * Create a fence from fixed points: one segment between each consecutive pair of points.
 * Given N points, creates N-1 segments. The bottom edge of each segment runs from one
 * control point to the next, so the bottom corners align with the control points.
 *
 * @param {THREE.Vector3[]} controlPoints - fixed points (length >= 2)
 * @param {Object} [options]
 * @param {number} [options.railingWidth=0.18] - match bridge railing width
 * @param {number} [options.railingHeight=0.9] - match bridge railing height
 * @param {number} [options.color=0x9a9a9a] - concrete color
 * @returns {THREE.Group}
 */
export function createFence(controlPoints, options = {}) {
    const opts = { ...FENCE_DEFAULTS, ...options };
    const points = controlPoints.map(p => p instanceof THREE.Vector3 ? p.clone() : new THREE.Vector3(p.x, p.y, p.z));
    if (points.length < 2) throw new Error("createFence: need at least 2 control points");

    const material = new THREE.MeshStandardMaterial({ color: opts.color });
    const group = new THREE.Group();
    const worldUp = new THREE.Vector3(0, 1, 0);

    for (let i = 0; i < points.length - 1; i++) {
        const a = points[i];
        const b = points[i + 1];
        const length = a.distanceTo(b);
        if (length < 1e-6) continue;

        const segmentGeo = new THREE.BoxGeometry(opts.railingWidth, opts.railingHeight, length);
        const mesh = new THREE.Mesh(segmentGeo, material);

        const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
        const segmentDir = new THREE.Vector3().subVectors(b, a).normalize();
        const crossUpSeg = new THREE.Vector3().crossVectors(worldUp, segmentDir);
        const fenceUp = crossUpSeg.lengthSq() > 1e-10
            ? new THREE.Vector3().crossVectors(segmentDir, crossUpSeg).normalize()
            : new THREE.Vector3(1, 0, 0);
        const localX = new THREE.Vector3().crossVectors(fenceUp, segmentDir).normalize();

        mesh.position.copy(mid).addScaledVector(fenceUp, opts.railingHeight / 2);
        const basis = new THREE.Matrix4().makeBasis(localX, fenceUp, segmentDir);
        mesh.quaternion.setFromRotationMatrix(basis);
        group.add(mesh);
    }

    return group;
}
