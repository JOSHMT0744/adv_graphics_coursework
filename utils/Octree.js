import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * 3D Octree for spatial partitioning. Subdivides an AABB into 8 children.
 * Entities are stored in leaves (and optionally internal nodes) for queryFrustum/queryBounds.
 * @param {THREE.Box3} worldBounds - Root AABB
 * @param {Object} [options]
 * @param {number} [options.maxDepth=6]
 * @param {number} [options.minSize=2]
 */
export class Octree {
    constructor(worldBounds, options = {}) {
        const { maxDepth = 6, minSize = 2 } = options;
        this.worldBounds = worldBounds.clone();
        this.maxDepth = maxDepth;
        this.minSize = minSize;
        this.root = new OctreeNode(worldBounds.clone(), 0, this);
    }

    /**
     * Insert an entity with the given AABB. Entity is stored in every leaf it intersects.
     * @param {{ id: number, bounds: THREE.Box3 }} entity - Must have id and bounds
     */
    insert(entity) {
        this.root.insert(entity);
    }

    /**
     * Return all entities in cells that intersect the frustum.
     * @param {THREE.Frustum} frustum
     * @returns {Array} Entities (deduplicated by id)
     */
    queryFrustum(frustum) {
        const set = new Set();
        const out = [];
        this.root.queryFrustum(frustum, set, out);
        return out;
    }

    /**
     * Return all entities in cells that intersect the box.
     * @param {THREE.Box3} box
     * @param {Array} [out] - Optional array to fill (cleared first); avoids allocation when reused
     * @returns {Array}
     */
    queryBounds(box, out) {
        const arr = out || [];
        arr.length = 0;
        this.root.queryBounds(box, arr);
        return arr;
    }

    /**
     * Remove all entities from the tree (structure remains).
     */
    clear() {
        this.root.clear();
    }

    /**
     * Return all leaf cell bounds for debug rendering.
     * @returns {THREE.Box3[]}
     */
    getCells() {
        const cells = [];
        this.root.getCells(cells);
        return cells;
    }
}

class OctreeNode {
    constructor(bounds, depth, tree) {
        this.bounds = bounds;
        this.depth = depth;
        this.tree = tree;
        this.entities = [];
        this.children = null;
    }

    get size() {
        const s = this.bounds.getSize(new THREE.Vector3());
        return Math.max(s.x, s.y, s.z);
    }

    split() {
        if (this.children) return;
        const min = this.bounds.min;
        const max = this.bounds.max;
        const mid = new THREE.Vector3(
            (min.x + max.x) / 2,
            (min.y + max.y) / 2,
            (min.z + max.z) / 2
        );
        const t = this.tree;
        this.children = [
            new OctreeNode(new THREE.Box3(new THREE.Vector3(min.x, mid.y, min.z), new THREE.Vector3(mid.x, max.y, mid.z)), this.depth + 1, t),
            new OctreeNode(new THREE.Box3(new THREE.Vector3(mid.x, mid.y, min.z), new THREE.Vector3(max.x, max.y, mid.z)), this.depth + 1, t),
            new OctreeNode(new THREE.Box3(new THREE.Vector3(min.x, min.y, min.z), new THREE.Vector3(mid.x, mid.y, mid.z)), this.depth + 1, t),
            new OctreeNode(new THREE.Box3(new THREE.Vector3(mid.x, min.y, min.z), new THREE.Vector3(max.x, mid.y, mid.z)), this.depth + 1, t),
            new OctreeNode(new THREE.Box3(new THREE.Vector3(min.x, mid.y, mid.z), new THREE.Vector3(mid.x, max.y, max.z)), this.depth + 1, t),
            new OctreeNode(new THREE.Box3(new THREE.Vector3(mid.x, mid.y, mid.z), new THREE.Vector3(max.x, max.y, max.z)), this.depth + 1, t),
            new OctreeNode(new THREE.Box3(new THREE.Vector3(min.x, min.y, mid.z), new THREE.Vector3(mid.x, mid.y, max.z)), this.depth + 1, t),
            new OctreeNode(new THREE.Box3(new THREE.Vector3(mid.x, min.y, mid.z), new THREE.Vector3(max.x, mid.y, max.z)), this.depth + 1, t)
        ];
    }

    insert(entity) {
        if (!this.bounds.intersectsBox(entity.bounds)) return;
        if (this.children) {
            for (let i = 0; i < 8; i++) this.children[i].insert(entity);
            return;
        }
        this.entities.push(entity);
        if (this.depth < this.tree.maxDepth && this.size > this.tree.minSize) {
            this.split();
            const e = this.entities;
            this.entities = [];
            for (let i = 0; i < e.length; i++) this.insert(e[i]);
        }
    }

    queryFrustum(frustum, seen, out) {
        if (!frustum.intersectsBox(this.bounds)) return;
        if (this.children) {
            for (let i = 0; i < 8; i++) this.children[i].queryFrustum(frustum, seen, out);
            return;
        }
        for (let i = 0; i < this.entities.length; i++) {
            const e = this.entities[i];
            if (!seen.has(e.id)) {
                seen.add(e.id);
                out.push(e);
            }
        }
    }

    queryBounds(box, out) {
        if (!this.bounds.intersectsBox(box)) return;
        if (this.children) {
            for (let i = 0; i < 8; i++) this.children[i].queryBounds(box, out);
            return;
        }
        for (let i = 0; i < this.entities.length; i++) out.push(this.entities[i]);
    }

    clear() {
        this.entities = [];
        if (this.children) {
            for (let i = 0; i < 8; i++) this.children[i].clear();
        }
    }

    getCells(cells) {
        if (this.children) {
            for (let i = 0; i < 8; i++) this.children[i].getCells(cells);
            return;
        }
        cells.push(this.bounds.clone());
    }
}

/**
 * Create LineSegments from an array of Box3 for debug view.
 * Uses EdgesGeometry + BoxGeometry per cell and merges into one mesh so it always renders.
 * @param {THREE.Box3[]} boxes
 * @returns {THREE.LineSegments}
 */
export function createOctreeDebugLines(boxes) {
    if (!boxes || boxes.length === 0) return null;
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    const edgeGeometries = [];
    for (let b = 0; b < boxes.length; b++) {
        const box = boxes[b];
        box.getSize(size);
        box.getCenter(center);
        // Avoid degenerate box (EdgesGeometry needs non-zero size)
        const eps = 1e-6;
        const sx = Math.max(size.x, eps);
        const sy = Math.max(size.y, eps);
        const sz = Math.max(size.z, eps);
        const boxGeo = new THREE.BoxGeometry(sx, sy, sz);
        boxGeo.translate(center.x, center.y, center.z);
        const edgeGeo = new THREE.EdgesGeometry(boxGeo, 1);
        boxGeo.dispose();
        edgeGeometries.push(edgeGeo);
    }
    const merged = edgeGeometries.length > 1
        ? mergeGeometries(edgeGeometries)
        : edgeGeometries[0];
    edgeGeometries.forEach((g) => { if (g !== merged) g.dispose(); });
    const line = new THREE.LineSegments(merged, new THREE.LineBasicMaterial({
        color: 0x00ff88,
        depthTest: false,
        depthWrite: false,
        renderOrder: 999
    }));
    line.renderOrder = 999;
    line.frustumCulled = false;
    return line;
}
