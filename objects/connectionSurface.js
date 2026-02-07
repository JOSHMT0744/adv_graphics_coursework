import * as THREE from "three";

/**
 * Create a surface connecting 6 reference points using user-defined edges.
 * Points must be in perimeter order so that edges are: 0-1, 1-2, 2-3, 3-4, 4-5, 5-0.
 * Triangulates hexagon by fanning from vertex 0: (0,1,2), (0,2,3), (0,3,4), (0,4,5).
 *
 * @param {THREE.Vector3[]} points - Array of 6 Vector3 in perimeter order (each consecutive pair + last-to-first form edges)
 * @param {Object} [options]
 * @param {number} [options.color=0x666666]
 * @param {THREE.Material} [options.material]
 * @returns {THREE.Mesh}
 */
export function createConnectionSurface(points, options = {}) {
    const { color = 0x666666, material: customMaterial } = options;

    if (!points || points.length !== 6) {
        throw new Error("createConnectionSurface: requires exactly 6 points");
    }

    // Vertices: the 6 input points in order (edges: 0-1, 1-2, 2-3, 3-4, 4-5, 5-0)
    const vertices = [];
    for (let i = 0; i < 6; i++) {
        vertices.push(points[i].x, points[i].y, points[i].z);
    }

    // Triangulate hexagon by fanning from vertex 0
    const indices = [
        0, 1, 2,
        0, 2, 3,
        0, 3, 4,
        0, 4, 5
    ];

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    const mat = customMaterial ?? new THREE.MeshStandardMaterial({
        color,
        side: THREE.DoubleSide
    });

    return new THREE.Mesh(geo, mat);
}

/**
 * Create a quad surface from 4 corner points (e.g. for a path strip).
 * Points in order: A, B, C, D so edges are A-B, B-C, C-D, D-A. Triangulation: (0,1,2), (0,2,3).
 *
 * @param {THREE.Vector3[]} points - Array of 4 Vector3 in perimeter order
 * @param {Object} [options]
 * @param {number} [options.color=0x666666]
 * @param {THREE.Material} [options.material]
 * @returns {THREE.Mesh}
 */
export function createQuadSurface(points, options = {}) {
    const { color = 0x666666, material: customMaterial } = options;

    if (!points || points.length !== 4) {
        throw new Error("createQuadSurface: requires exactly 4 points");
    }

    const vertices = [];
    for (let i = 0; i < 4; i++) {
        vertices.push(points[i].x, points[i].y, points[i].z);
    }

    const indices = [0, 1, 2, 0, 2, 3];

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    const mat = customMaterial ?? new THREE.MeshStandardMaterial({
        color,
        side: THREE.DoubleSide
    });

    return new THREE.Mesh(geo, mat);
}
