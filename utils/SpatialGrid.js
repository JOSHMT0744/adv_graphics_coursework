import * as THREE from "three";

/**
 * 2D spatial grid in the XZ plane for collision and query optimization.
 * Y is taken from bounds for debug drawing; cells are axis-aligned in XZ.
 *
 * @param {THREE.Box3|{min:{x,z},max:{x,z}}} bounds
 * @param {number} nx - number of cells in X
 * @param {number} nz - number of cells in Z
 */
export class SpatialGrid {
    constructor(bounds, nx, nz) {
        this.nx = Math.max(1, nx);
        this.nz = Math.max(1, nz);
        if (bounds && bounds.isBox3) {
            this.minX = bounds.min.x;
            this.maxX = bounds.max.x;
            this.minZ = bounds.min.z;
            this.maxZ = bounds.max.z;
            this.y = (bounds.min.y + bounds.max.y) / 2;
        } else {
            this.minX = bounds?.min?.x ?? -50;
            this.maxX = bounds?.max?.x ?? 50;
            this.minZ = bounds?.min?.z ?? -50;
            this.maxZ = bounds?.max?.z ?? 50;
            this.y = 0;
        }
        this.cellW = (this.maxX - this.minX) / this.nx;
        this.cellD = (this.maxZ - this.minZ) / this.nz;
        /** @type {{ bounds: THREE.Box3, objects: unknown[] }[][]} */
        this.cells = [];
        for (let iz = 0; iz < this.nz; iz++) {
            this.cells[iz] = [];
            for (let ix = 0; ix < this.nx; ix++) {
                const cellMinX = this.minX + ix * this.cellW;
                const cellMaxX = cellMinX + this.cellW;
                const cellMinZ = this.minZ + iz * this.cellD;
                const cellMaxZ = cellMinZ + this.cellD;
                const cellBox = new THREE.Box3(
                    new THREE.Vector3(cellMinX, this.y - 1, cellMinZ),
                    new THREE.Vector3(cellMaxX, this.y + 1, cellMaxZ)
                );
                this.cells[iz][ix] = { bounds: cellBox, objects: [] };
            }
        }
    }

    /**
     * @param {number} x
     * @param {number} z
     * @returns {{ ix: number, iz: number }|null}
     */
    getCellIndex(x, z) {
        if (x < this.minX || x > this.maxX || z < this.minZ || z > this.maxZ) return null;
        const ix = Math.min(this.nx - 1, Math.floor((x - this.minX) / this.cellW));
        const iz = Math.min(this.nz - 1, Math.floor((z - this.minZ) / this.cellD));
        return { ix, iz };
    }

    /**
     * @param {number} ix
     * @param {number} iz
     * @returns {{ bounds: THREE.Box3, objects: unknown[] }|null}
     */
    getCell(ix, iz) {
        if (iz < 0 || iz >= this.nz || ix < 0 || ix >= this.nx) return null;
        return this.cells[iz][ix];
    }

    /**
     * @param {number} ix
     * @param {number} iz
     * @returns {THREE.Box3|null}
     */
    getCellBounds(ix, iz) {
        const c = this.getCell(ix, iz);
        return c ? c.bounds : null;
    }

    /** @returns {THREE.Box3} */
    getBounds() {
        return new THREE.Box3(
            new THREE.Vector3(this.minX, this.y - 1, this.minZ),
            new THREE.Vector3(this.maxX, this.y + 1, this.maxZ)
        );
    }

    /**
     * @param {THREE.Box3} box
     * @returns {{ ix: number, iz: number, cell: { bounds: THREE.Box3, objects: unknown[] } }[]}
     */
    getCellsInBox(box) {
        const out = [];
        const ix0 = Math.max(0, Math.floor((box.min.x - this.minX) / this.cellW));
        const ix1 = Math.min(this.nx - 1, Math.floor((box.max.x - this.minX) / this.cellW));
        const iz0 = Math.max(0, Math.floor((box.min.z - this.minZ) / this.cellD));
        const iz1 = Math.min(this.nz - 1, Math.floor((box.max.z - this.minZ) / this.cellD));
        for (let iz = iz0; iz <= iz1; iz++) {
            for (let ix = ix0; ix <= ix1; ix++) {
                const cell = this.cells[iz][ix];
                if (box.intersectsBox(cell.bounds)) out.push({ ix, iz, cell });
            }
        }
        return out;
    }

    /**
     * @param {Object} [options]
     * @param {number} [options.y] - optional Y for the grid plane
     * @param {number} [options.color=0x00ffff]
     * @returns {THREE.LineSegments}
     */
    debugRender(options = {}) {
        const y = options.y != null ? options.y : this.y;
        const color = options.color ?? 0x00ffff;
        const segments = [];
        for (let iz = 0; iz <= this.nz; iz++) {
            const z = this.minZ + iz * this.cellD;
            for (let ix = 0; ix < this.nx; ix++) {
                const x0 = this.minX + ix * this.cellW;
                const x1 = x0 + this.cellW;
                segments.push(x0, y, z, x1, y, z);
            }
        }
        for (let ix = 0; ix <= this.nx; ix++) {
            const x = this.minX + ix * this.cellW;
            for (let iz = 0; iz < this.nz; iz++) {
                const z0 = this.minZ + iz * this.cellD;
                const z1 = z0 + this.cellD;
                segments.push(x, y, z0, x, y, z1);
            }
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.Float32BufferAttribute(segments, 3));
        const line = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color }));
        return line;
    }
}
