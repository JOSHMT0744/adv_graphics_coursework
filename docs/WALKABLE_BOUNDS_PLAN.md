# Plan: Constrain People to Walkable Sampler XZ (No Loss of Functionality)

## Goal
Replace axis-aligned world bounds (`WALKABLE_WORLD_BOUNDS`) with the **actual walkable regions** defined by `walkableSampler` for person movement. Characters should stay on pavements, road, bridge, path, staircase, B-spline grass, and connection surfaces—and never step into non-walkable areas (water, building footprints, etc.). All existing behaviour (flocking, goal seeking, wander, SNAPPING, QUEUING, INSIDE, boundary steering, placement) must be preserved.

---

## Current Usage of World Bounds (People)

| Location | Purpose |
|----------|---------|
| `applyPhysics()` | 1) Boundary containment: if outside AABB margin → add weak force toward centre. 2) After integration: hard-clamp `person.pos.x/z` to AABB so they never leave. |
| `modifyCrowd()` | After `walkableSampler.sampleRandom()`, reject sample if outside AABB margin (extra safety). |
| Octree | Root bounds = `WALKABLE_WORLD_BOUNDS` (spatial index; can stay as-is). |
| Dragonflies | Same AABB for boundary force and spawn range (out of scope for this plan unless you want them on walkable too). |

---

## 1. Walkable Sampler: Add “Nearest Walkable” API

**File:** `utils/walkableSampler.js`

The combined sampler already has a **height grid** where each cell is either walkable (valid height) or not. We need a way to map “current (x,z) is off walkable” → “nearest (x′, z′) on walkable” for steering and clamping.

- **Add** `getNearestWalkable(x, z)` (or `clampToWalkable(x, z)`):
  - **Returns:** `{ x, z, y, inside }` where `(x,z)` is the nearest walkable point and `y` is surface height (or from `getSurfaceInfo`).
  - **Behaviour:**
    - Call existing `getSurfaceInfo(x, z)`. If `inside` → return `(x, z, y, true)`.
    - If not inside: map `(x,z)` to grid cell `(ix, iz)`. If cell is walkable (e.g. `getCellY(ix, iz)` valid), clamp `(x,z)` to that cell’s bounds and return cell’s centre or clamped point plus `y` from grid.
    - If cell is not walkable: **expand outward** (e.g. rings of cells: 1-neighbourhood, then 2, …) until a walkable cell is found. Return that cell’s centre (or nearest point on the cell to `(x,z)`) and its height. Limit search radius (e.g. max 10–20 cells) to avoid runaway cost.
  - **Implementation detail:** Reuse existing `getCellY(ix, iz)` and grid bounds (`gridMinX`, `gridMaxX`, `cellSize`, etc.). No need to change `getSurfaceInfo` or the height grid build.

This gives a single, consistent “pull back onto walkable” point for both **steering** and **hard clamp**.

---

## 2. App.js: Use Walkable Instead of AABB for People

**File:** `app.js`

### 2.1 Boundary containment and hard-clamp in `applyPhysics(person)`

- **Replace** the current AABB-based logic:
  - **Steering:** Instead of “outside AABB margin → add force toward AABB centre”, do:
    - `const info = walkableSampler.getSurfaceInfo(person.pos.x, person.pos.z);`
    - If `!info.inside`: `const nearest = walkableSampler.getNearestWalkable(person.pos.x, person.pos.z);` and add a **steering force** toward `(nearest.x, nearest.z)` (e.g. desired velocity toward nearest, clamped to `MAX_FORCE`), so characters are pushed back toward walkable.
  - **Hard-clamp after integration:** After `person.pos.add(person.vel)`:
    - Call `getSurfaceInfo(person.pos.x, person.pos.z)`. If `!inside`, call `getNearestWalkable(person.pos.x, person.pos.z)` and set:
      - `person.pos.x = nearest.x`, `person.pos.z = nearest.z`, and `person.pos.y = nearest.y` (or keep `y = 0` if you keep everyone on a flat projection and only use walkable for XZ; otherwise use surface height for consistency with placement).
    - This replaces the current `Math.max/min` clamp to `WALKABLE_WORLD_BOUNDS`.
  - **Margin (optional):** You can keep a small “near edge” margin by treating “inside but very close to a non-walkable cell” as needing a nudge (e.g. use `getNearestWalkable` only when `!inside`, and optionally add a small inward force when distance to nearest walkable is below a threshold). Start with “only when !inside” to avoid over-complication.

Result: characters never leave the walkable XZ set defined by the sampler; steering and clamping both use the same definition of “on walkable”.

### 2.2 Placement in `modifyCrowd()`

- **Keep** `walkableSampler.sampleRandom()` as the source of positions (already on walkable).
- **Replace** the AABB margin check: instead of “inside `WALKABLE_WORLD_BOUNDS` with margin”, use `walkableSampler.getSurfaceInfo(pos.x, pos.z).inside` (and optionally reject if too close to non-walkable if you add margin logic elsewhere). This avoids rejecting valid walkable points that lie outside the AABB (e.g. narrow strips).
- **Keep** obstacle check (e.g. `environmentObjects` boxes) and octree overlap check unchanged.

### 2.3 What stays the same

- **Octree:** Keep root bounds as `WALKABLE_WORLD_BOUNDS` for the crowd octree. It’s only a spatial index; people will stay inside walkable and thus inside the box.
- **Flocking, goal seeking, wander, SNAPPING, QUEUING, INSIDE:** No change to state machine or forces; only the “boundary” part of the force and the final position clamp use walkable instead of AABB.
- **Dragonflies:** Leave as-is (still AABB) unless you explicitly want them constrained to walkable later; that can be a follow-up using the same `getNearestWalkable` idea.

---

## 3. Optional: Surface height (Y) for people

- **Current:** `person.pos.y = 0` (or similar) in `applyPhysics`.
- **Optional improvement:** When clamping or when `getSurfaceInfo` is `inside`, set `person.pos.y` from `getSurfaceInfo(...).y` (or from `getNearestWalkable(...).y`) so characters sit on the actual surface (bridge, stairs, terrain). This is a small extra step once the XZ logic uses the sampler; no change to the plan above except that you assign `person.pos.y` from the sampler when you set XZ.

---

## 4. Implementation order

1. **walkableSampler.js:** Implement `getNearestWalkable(x, z)` (grid-based search from current cell outward; return nearest walkable cell centre or nearest point on that cell, plus height).
2. **app.js – applyPhysics:** Switch boundary steering and hard-clamp to `getSurfaceInfo` + `getNearestWalkable` as above.
3. **app.js – modifyCrowd:** Replace AABB margin check with `getSurfaceInfo(...).inside`.
4. **Test:** Run scene; verify no one walks off pavements/road/bridge/path/stairs/grass; verify flocking, seeking, wander, SNAPPING, QUEUING, INSIDE still work; verify new characters spawn only on walkable.
5. **(Optional)** Set `person.pos.y` from sampler when updating position for proper surface following.

---

## 5. Edge cases to handle

- **Person exactly on boundary between two regions:** `getSurfaceInfo` already returns the first region that contains the point; no change needed.
- **No walkable within search radius:** If `getNearestWalkable` fails (e.g. teleported into void), fallback: e.g. don’t move this frame, or snap to last known good position / `sampleRandom()` once. Prefer a safe fallback that avoids NaN or infinite loop.
- **Performance:** `getNearestWalkable` is called only when `!getSurfaceInfo(...).inside` (and once per clamp when outside). Grid search is O(radius²) in cells; keep max radius small (e.g. 10–15 cells) so cost stays bounded.

---

## Summary

- **walkableSampler:** Add `getNearestWalkable(x, z)` using the existing height grid and cell walkability.
- **app.js:** In `applyPhysics`, use `getSurfaceInfo` + `getNearestWalkable` for boundary force and for final position clamp; in `modifyCrowd`, use `getSurfaceInfo(...).inside` instead of AABB margin.
- **Everything else:** Unchanged (octree, states, flocking, goals, placement checks other than bounds). Optionally add surface Y from the sampler for correct height on stairs/bridge/terrain.
