import * as THREE from "three";

// 26-connected neighbors in 3D (all combinations of -1, 0, +1 except (0,0,0))
const NEIGHBORS_26 = [];
for (let di = -1; di <= 1; di++) {
    for (let dj = -1; dj <= 1; dj++) {
        for (let dk = -1; dk <= 1; dk++) {
            if (di === 0 && dj === 0 && dk === 0) continue;
            NEIGHBORS_26.push([di, dj, dk]);
        }
    }
}

/**
 * Creates a 3D navigation grid for A* pathfinding.
 * Cells are blocked if isBlocked(x,y,z) returns true or within any spherical obstacle.
 * @param {{ minX: number, maxX: number, minY: number, maxY: number, minZ: number, maxZ: number }} bounds World bounds
 * @param {number} cellSize Grid cell size in world units
 * @param {(x: number, y: number, z: number) => boolean} isBlocked Returns true if (x,y,z) is impassable
 * @param {Array<{ x: number, y: number, z: number, radius: number }>} [sphereObstacles] Spherical obstacles
 * @returns {Object} Navigation grid object
 */
export function createNavigationGrid(bounds, cellSize, isBlocked, sphereObstacles = []) {
    const { minX, maxX, minY, maxY, minZ, maxZ } = bounds;
    const numX = Math.max(1, Math.ceil((maxX - minX) / cellSize));
    const numY = Math.max(1, Math.ceil((maxY - minY) / cellSize));
    const numZ = Math.max(1, Math.ceil((maxZ - minZ) / cellSize));
    const grid = new Uint8Array(numX * numY * numZ); // 0 = free, 1 = blocked

    for (let i = 0; i < numX; i++) {
        const x = minX + (i + 0.5) * cellSize;
        for (let j = 0; j < numY; j++) {
            const y = minY + (j + 0.5) * cellSize;
            for (let k = 0; k < numZ; k++) {
                const z = minZ + (k + 0.5) * cellSize;
                const idx = (i * numY + j) * numZ + k;

                if (isBlocked(x, y, z)) {
                    grid[idx] = 1;
                    continue;
                }

                for (const obs of sphereObstacles) {
                    const dx = x - obs.x;
                    const dy = y - obs.y;
                    const dz = z - obs.z;
                    if (dx * dx + dy * dy + dz * dz <= obs.radius * obs.radius) {
                        grid[idx] = 1;
                        break;
                    }
                }
            }
        }
    }

    function gridIsBlocked(i, j, k) {
        if (i < 0 || i >= numX || j < 0 || j >= numY || k < 0 || k >= numZ) return true;
        return grid[(i * numY + j) * numZ + k] === 1;
    }

    function cellToWorld(i, j, k) {
        return {
            x: minX + (i + 0.5) * cellSize,
            y: minY + (j + 0.5) * cellSize,
            z: minZ + (k + 0.5) * cellSize
        };
    }

    return {
        grid,
        numX,
        numY,
        numZ,
        minX, maxX,
        minY, maxY,
        minZ, maxZ,
        cellSize,
        isBlocked: gridIsBlocked,
        cellToWorld
    };
}

/**
 * World position to 3D grid cell indices.
 */
function worldToCell(navGrid, x, y, z) {
    const i = Math.floor((x - navGrid.minX) / navGrid.cellSize);
    const j = Math.floor((y - navGrid.minY) / navGrid.cellSize);
    const k = Math.floor((z - navGrid.minZ) / navGrid.cellSize);
    return { i, j, k };
}

/**
 * 3D Euclidean heuristic for A*.
 */
function heuristic(i1, j1, k1, i2, j2, k2) {
    const di = i2 - i1;
    const dj = j2 - j1;
    const dk = k2 - k1;
    return Math.sqrt(di * di + dj * dj + dk * dk);
}

/**
 * Finds a path from start to end using A* in a 3D grid.
 * @param {Object} navGrid Result of createNavigationGrid
 * @param {THREE.Vector3 | { x: number, y: number, z: number }} start Start position
 * @param {THREE.Vector3 | { x: number, y: number, z: number }} end End position
 * @returns {THREE.Vector3[]} Array of waypoints (world coordinates), or empty if no path
 */
export function findPath(navGrid, start, end) {
    const sx = start.x, sy = start.y, sz = start.z;
    const ex = end.x, ey = end.y, ez = end.z;

    const startCell = worldToCell(navGrid, sx, sy, sz);
    const endCell = worldToCell(navGrid, ex, ey, ez);

    const si = Math.max(0, Math.min(navGrid.numX - 1, startCell.i));
    const sj = Math.max(0, Math.min(navGrid.numY - 1, startCell.j));
    const sk = Math.max(0, Math.min(navGrid.numZ - 1, startCell.k));
    const ei = Math.max(0, Math.min(navGrid.numX - 1, endCell.i));
    const ej = Math.max(0, Math.min(navGrid.numY - 1, endCell.j));
    const ek = Math.max(0, Math.min(navGrid.numZ - 1, endCell.k));

    if (navGrid.isBlocked(si, sj, sk)) {
        return [];
    }
    if (navGrid.isBlocked(ei, ej, ek)) {
        return [new THREE.Vector3(ex, ey, ez)];
    }
    if (si === ei && sj === ej && sk === ek) {
        return [new THREE.Vector3(ex, ey, ez)];
    }

    const openSet = [{
        i: si, j: sj, k: sk,
        g: 0,
        h: heuristic(si, sj, sk, ei, ej, ek),
        f: heuristic(si, sj, sk, ei, ej, ek)
    }];
    const cameFrom = new Map();
    const gScore = new Map();
    const startKey = `${si},${sj},${sk}`;
    gScore.set(startKey, 0);

    // Cap iterations to prevent runaway searches in large grids
    const MAX_ITERATIONS = 5000;
    let iterations = 0;

    while (openSet.length > 0 && iterations < MAX_ITERATIONS) {
        iterations++;

        // Find node with lowest f (linear scan; good enough for moderate grids)
        let bestIdx = 0;
        for (let n = 1; n < openSet.length; n++) {
            if (openSet[n].f < openSet[bestIdx].f) bestIdx = n;
        }
        const current = openSet[bestIdx];
        openSet[bestIdx] = openSet[openSet.length - 1];
        openSet.pop();

        const { i, j, k } = current;
        const key = `${i},${j},${k}`;

        if (i === ei && j === ej && k === ek) {
            // Reconstruct path
            const path = [];
            let node = current;
            while (node) {
                const w = navGrid.cellToWorld(node.i, node.j, node.k);
                path.unshift(new THREE.Vector3(w.x, w.y, w.z));
                node = cameFrom.get(`${node.i},${node.j},${node.k}`);
            }
            // Append exact target position as final waypoint
            path.push(new THREE.Vector3(ex, ey, ez));
            return path;
        }

        for (const [di, dj, dk] of NEIGHBORS_26) {
            const ni = i + di;
            const nj = j + dj;
            const nk = k + dk;
            const nKey = `${ni},${nj},${nk}`;

            if (navGrid.isBlocked(ni, nj, nk)) continue;

            // Movement cost: 1 for face, sqrt(2) for edge, sqrt(3) for corner
            const axes = (di !== 0 ? 1 : 0) + (dj !== 0 ? 1 : 0) + (dk !== 0 ? 1 : 0);
            const moveCost = Math.sqrt(axes);
            const tentativeG = (gScore.get(key) ?? Infinity) + moveCost;

            if (tentativeG >= (gScore.get(nKey) ?? Infinity)) continue;

            cameFrom.set(nKey, current);
            gScore.set(nKey, tentativeG);
            const h = heuristic(ni, nj, nk, ei, ej, ek);
            openSet.push({ i: ni, j: nj, k: nk, g: tentativeG, h, f: tentativeG + h });
        }
    }

    // No path found (or iteration cap hit): return direct line
    return [new THREE.Vector3(ex, ey, ez)];
}
