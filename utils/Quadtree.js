import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * 2D box overlap test. Bounds are { minX, maxX, minZ, maxZ }.
 */
function intersects2D(a, b) {
    return !(a.maxX < b.minX || a.minX > b.maxX || a.maxZ < b.minZ || a.minZ > b.maxZ);
}

/**
 * Point-in-box test for 2D bounds.
 */
function containsPoint2D(bounds, x, z) {
    return x >= bounds.minX && x <= bounds.maxX && z >= bounds.minZ && z <= bounds.maxZ;
}

/**
 * 2D Quadtree for spatial partitioning in XZ plane. Subdivides a rectangle into 4 children.
 * Entity contract: { id, bounds2D } where bounds2D is { minX, maxX, minZ, maxZ }.
 * @param {{ minX: number, maxX: number, minZ: number, maxZ: number }} rootBounds - Root rectangle in XZ
 * @param {Object} [options]
 * @param {number} [options.maxDepth=6]
 * @param {number} [options.minSize=2]
 */
export class Quadtree {
    constructor(rootBounds, options = {}) {
        const { maxDepth = 6, minSize = 2 } = options;
        this.rootBounds = {
            minX: rootBounds.minX,
            maxX: rootBounds.maxX,
            minZ: rootBounds.minZ,
            maxZ: rootBounds.maxZ
        };
        this.maxDepth = maxDepth;
        this.minSize = minSize;
        this.root = new QuadtreeNode({ ...this.rootBounds }, 0, this);
    }

    /**
     * Insert an entity. Entity must have { id, bounds2D } with bounds2D = { minX, maxX, minZ, maxZ }.
     * @param {{ id: number, bounds2D: { minX: number, maxX: number, minZ: number, maxZ: number } }} entity
     */
    insert(entity) {
        this.root.insert(entity);
    }

    /**
     * Return all entities in cells that intersect the 2D box.
     * @param {{ minX: number, maxX: number, minZ: number, maxZ: number }} box2D
     * @param {Array} [out] - Optional array to fill (cleared first)
     * @returns {Array}
     */
    queryBounds(box2D, out) {
        const arr = out || [];
        arr.length = 0;
        this.root.queryBounds(box2D, arr);
        return arr;
    }

    clear() {
        this.root.clear();
    }

    /**
     * Remove one entity from all leaves it was in.
     * @param {{ id: number, bounds2D: object }} entity
     */
    remove(entity) {
        this.root.remove(entity);
    }

    /**
     * Return all leaf cell bounds for debug (2D boxes: { minX, maxX, minZ, maxZ }).
     * @returns {Array<{ minX: number, maxX: number, minZ: number, maxZ: number }>}
     */
    getCells() {
        const cells = [];
        this.root.getCells(cells);
        return cells;
    }
}

class QuadtreeNode {
    constructor(bounds, depth, tree) {
        this.bounds = bounds;
        this.depth = depth;
        this.tree = tree;
        this.entities = [];
        this.children = null;
    }

    get size() {
        return Math.max(this.bounds.maxX - this.bounds.minX, this.bounds.maxZ - this.bounds.minZ);
    }

    split() {
        if (this.children) return;
        const { minX, maxX, minZ, maxZ } = this.bounds;
        const midX = (minX + maxX) / 2;
        const midZ = (minZ + maxZ) / 2;
        const t = this.tree;
        this.children = [
            new QuadtreeNode({ minX: midX, maxX, minZ: midZ, maxZ }, this.depth + 1, t),
            new QuadtreeNode({ minX, maxX: midX, minZ: midZ, maxZ }, this.depth + 1, t),
            new QuadtreeNode({ minX: midX, maxX, minZ, maxZ: midZ }, this.depth + 1, t),
            new QuadtreeNode({ minX, maxX: midX, minZ, maxZ: midZ }, this.depth + 1, t)
        ];
    }

    insert(entity) {
        if (!intersects2D(this.bounds, entity.bounds2D)) return;
        if (this.children) {
            for (let i = 0; i < 4; i++) this.children[i].insert(entity);
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

    queryBounds(box2D, out) {
        if (!intersects2D(this.bounds, box2D)) return;
        if (this.children) {
            for (let i = 0; i < 4; i++) this.children[i].queryBounds(box2D, out);
            return;
        }
        for (let i = 0; i < this.entities.length; i++) out.push(this.entities[i]);
    }

    clear() {
        this.entities = [];
        if (this.children) {
            for (let i = 0; i < 4; i++) this.children[i].clear();
        }
    }

    remove(entity) {
        if (!intersects2D(this.bounds, entity.bounds2D)) return;
        if (this.children) {
            for (let i = 0; i < 4; i++) this.children[i].remove(entity);
            return;
        }
        const idx = this.entities.indexOf(entity);
        if (idx !== -1) this.entities.splice(idx, 1);
    }

    getCells(cells) {
        if (this.children) {
            for (let i = 0; i < 4; i++) this.children[i].getCells(cells);
            return;
        }
        cells.push({
            minX: this.bounds.minX,
            maxX: this.bounds.maxX,
            minZ: this.bounds.minZ,
            maxZ: this.bounds.maxZ
        });
    }
}

const REGION1 = { minX: -23.94, maxX: 78.6, minZ: -40.2, maxZ: 12.2 };
const REGION2 = { minX: -23.94, maxX: -16.12, minZ: -159, maxZ: -40.2 };

const AREA1 = (REGION1.maxX - REGION1.minX) * (REGION1.maxZ - REGION1.minZ);
const AREA2 = (REGION2.maxX - REGION2.minX) * (REGION2.maxZ - REGION2.minZ);
const TOTAL_AREA = AREA1 + AREA2;

/**
 * Distance from point (px, pz) to axis-aligned segment and nearest point on segment.
 * Segment: either horizontal (z0, x in [x0,x1]) or vertical (x0, z in [z0,z1]).
 * @param {number} px - point x
 * @param {number} pz - point z
 * @param {{ type: 'h'|'v', x0: number, x1: number, z0: number, z1: number }} seg - h: z=z0, x in [x0,x1]; v: x=x0, z in [z0,z1]
 * @returns {{ distSq: number, nx: number, nz: number }}
 */
function pointToSegment(px, pz, seg) {
    if (seg.type === 'h') {
        const x = Math.max(seg.x0, Math.min(seg.x1, px));
        const z = seg.z0;
        return { distSq: (px - x) ** 2 + (pz - z) ** 2, nx: x, nz: z };
    }
    const x = seg.x0;
    const z = Math.max(seg.z0, Math.min(seg.z1, pz));
    return { distSq: (px - x) ** 2 + (pz - z) ** 2, nx: x, nz: z };
}

const BOUNDARY_SEGMENTS = [
    { type: 'h', x0: -23.94, x1: 78.6, z0: 12.2, z1: 12.2 },
    { type: 'v', x0: 78.6, x1: 78.6, z0: -40.2, z1: 12.2 },
    { type: 'h', x0: -16.12, x1: 78.6, z0: -40.2, z1: -40.2 },
    { type: 'v', x0: -23.94, x1: -23.94, z0: -40.2, z1: 12.2 },
    { type: 'v', x0: -23.94, x1: -23.94, z0: -159, z1: -40.2 },
    { type: 'v', x0: -16.12, x1: -16.12, z0: -159, z1: -40.2 },
    { type: 'h', x0: -23.94, x1: -16.12, z0: -159, z1: -159 }
];

/**
 * Composite quadtree over two connected rectangular regions. Behaves as a single spatial index.
 * insert/remove use the region that contains the entity center; queryBounds queries both trees and dedupes.
 */
export class CompositeQuadtree {
    constructor(options = {}) {
        const { maxDepth = 5, minSize = 2 } = options;
        this.tree1 = new Quadtree(REGION1, { maxDepth, minSize });
        this.tree2 = new Quadtree(REGION2, { maxDepth, minSize });
        this._queryOut = [];
    }

    /** True if (x,z) is inside Region 1 or Region 2. */
    containsPoint(x, z) {
        return containsPoint2D(REGION1, x, z) || containsPoint2D(REGION2, x, z);
    }

    /** Which region (1 or 2) contains the center of bounds2D; 0 if neither. */
    _regionForEntity(entity) {
        const b = entity.bounds2D;
        const cx = (b.minX + b.maxX) / 2;
        const cz = (b.minZ + b.maxZ) / 2;
        if (containsPoint2D(REGION1, cx, cz)) return 1;
        if (containsPoint2D(REGION2, cx, cz)) return 2;
        return 1; // fallback to region 1
    }

    insert(entity) {
        const r = this._regionForEntity(entity);
        entity._quadtreeRegion = r;
        if (r === 1) this.tree1.insert(entity);
        else this.tree2.insert(entity);
    }

    remove(entity) {
        const r = entity._quadtreeRegion;
        if (r === 1) this.tree1.remove(entity);
        else if (r === 2) this.tree2.remove(entity);
        delete entity._quadtreeRegion;
    }

    queryBounds(box2D, out) {
        const arr = out || [];
        arr.length = 0;
        this.tree1.queryBounds(box2D, arr);
        const seen = new Set(arr.map((e) => e.id));
        this._queryOut.length = 0;
        this.tree2.queryBounds(box2D, this._queryOut);
        for (let i = 0; i < this._queryOut.length; i++) {
            const e = this._queryOut[i];
            if (!seen.has(e.id)) {
                seen.add(e.id);
                arr.push(e);
            }
        }
        return arr;
    }

    clear() {
        this.tree1.clear();
        this.tree2.clear();
    }

    getCells() {
        const c1 = this.tree1.getCells();
        const c2 = this.tree2.getCells();
        return c1.concat(c2);
    }

    /**
     * Sample a random (x,z) point uniformly from the union of the two regions (area-weighted).
     * @returns {{ x: number, z: number }}
     */
    sampleRandomPoint() {
        if (Math.random() < AREA1 / TOTAL_AREA) {
            return {
                x: REGION1.minX + Math.random() * (REGION1.maxX - REGION1.minX),
                z: REGION1.minZ + Math.random() * (REGION1.maxZ - REGION1.minZ)
            };
        }
        return {
            x: REGION2.minX + Math.random() * (REGION2.maxX - REGION2.minX),
            z: REGION2.minZ + Math.random() * (REGION2.maxZ - REGION2.minZ)
        };
    }

    /**
     * Boundary info for the union of the two regions: distance to edge, nearest boundary point, outward normal.
     * @param {number} x - world X
     * @param {number} z - world Z
     * @returns {{ distanceToEdge: number, nearestBoundaryX: number, nearestBoundaryZ: number, outwardNormalX: number, outwardNormalZ: number, outside: boolean }}
     */
    getBoundaryInfo(x, z) {
        let bestDistSq = Infinity;
        let bestNx = 0, bestNz = 0;
        for (let i = 0; i < BOUNDARY_SEGMENTS.length; i++) {
            const r = pointToSegment(x, z, BOUNDARY_SEGMENTS[i]);
            if (r.distSq < bestDistSq) {
                bestDistSq = r.distSq;
                bestNx = r.nx;
                bestNz = r.nz;
            }
        }
        const dist = Math.sqrt(bestDistSq);
        const outside = !this.containsPoint(x, z);
        let outwardNormalX = 0, outwardNormalZ = 0;
        if (dist > 1e-10) {
            outwardNormalX = (x - bestNx) / dist;
            outwardNormalZ = (z - bestNz) / dist;
        }
        return {
            distanceToEdge: outside ? -dist : dist,
            nearestBoundaryX: bestNx,
            nearestBoundaryZ: bestNz,
            outwardNormalX,
            outwardNormalZ,
            outside
        };
    }

    /**
     * Nearest point on the quadtree boundary (union of the two regions).
     * @param {number} x - world X
     * @param {number} z - world Z
     * @returns {{ x: number, z: number }}
     */
    getNearestPointOnBoundary(x, z) {
        const info = this.getBoundaryInfo(x, z);
        return { x: info.nearestBoundaryX, z: info.nearestBoundaryZ };
    }
}

/**
 * Create LineSegments for debug view from 2D cells. Each cell is extruded in Y to form a Box3.
 * @param {Array<{ minX: number, maxX: number, minZ: number, maxZ: number }>} boxes2D
 * @param {{ color?: number, minY?: number, maxY?: number }} [options]
 * @returns {THREE.LineSegments}
 */
export function createQuadtreeDebugLines(boxes2D, options = {}) {
    if (!boxes2D || boxes2D.length === 0) return null;
    const minY = options.minY ?? -1;
    const maxY = options.maxY ?? 1;
    const boxes3 = boxes2D.map((b) => new THREE.Box3(
        new THREE.Vector3(b.minX, minY, b.minZ),
        new THREE.Vector3(b.maxX, maxY, b.maxZ)
    ));
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    const edgeGeometries = [];
    for (let i = 0; i < boxes3.length; i++) {
        const box = boxes3[i];
        box.getSize(size);
        box.getCenter(center);
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
        color: options.color ?? 0x00ff88,
        depthTest: false,
        depthWrite: false
    }));
    line.renderOrder = 999;
    line.frustumCulled = false;
    return line;
}
