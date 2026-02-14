# Plan: Avoid characters getting stuck inside environment obstacles

## Current behaviour

- For each `environmentObjects` entry with a `userData.boundingBox` (Box3):
  - `box.clampPoint(person.pos, _physicsClampedPoint)` → nearest point on or inside the box.
  - When **outside**: that point is on the box surface; distance &lt; margin → repulsion force.
  - When **inside**: clampPoint returns `person.pos` itself, so `distEnv === 0`. The condition `distEnv > 0.001` then **skips** the force, so no push-out.

So characters that end up inside a box (spawn, teleport, physics glitch) are never steered out.

---

## Goal

- **Outside (unchanged):** Keep current logic: repulsion when distance to box &lt; margin.
- **Inside (new):** Detect when the person is inside the box and apply a force toward the **nearest point on the box surface** so they are pushed out.

---

## 1. Detect “inside”

- Use **`box.containsPoint(person.pos)`** (Box3 already has this).
- Optional: treat “almost on surface” as outside by using a tiny tolerance, e.g. only consider “inside” when the point is strictly inside (no change needed if we rely on `containsPoint` as-is).

---

## 2. Closest point on box *surface* when point is inside

When the point is inside the box, `clampPoint` is no longer the right tool (it returns the point itself). We need the **nearest point on the box boundary**.

**Algorithm:**

- For each axis, compute distance to the two faces:
  - `dxMin = person.pos.x - box.min.x`, `dxMax = box.max.x - person.pos.x` (and similarly for y, z).
- Find which of the six faces is closest: the face for which the corresponding distance is smallest (e.g. if `dxMin` is the smallest, the closest face is the one at `x = box.min.x`).
- The nearest **point on the surface** is the point projected onto that face:
  - Copy `person.pos` into a temporary vector, then set the coordinate of the chosen face to that face’s value (e.g. if the closest face is `x = box.min.x`, set `x = box.min.x`; clamp the other two coordinates to the box so the point lies on the face rectangle).

**Example (closest face is min X):**

- `out.x = box.min.x`
- `out.y = clamp(person.pos.y, box.min.y, box.max.y)`
- `out.z = clamp(person.pos.z, box.min.z, box.max.z)`

Repeat the idea for the other five faces (max X, min Y, max Y, min Z, max Z). Result: one vector `_physicsClampedPoint` (or a dedicated “surface point” temporary) holding the nearest point on the box surface.

---

## 3. Force when inside

- **Direction:** From the nearest surface point **toward** the person: `person.pos - surfacePoint` (same as current repulsion: “push away from the obstacle”).
- **Magnitude:** Use a fixed strength so they are pushed out reliably, e.g. `PERSON_ENV_INSIDE_STRENGTH` (e.g. 0.15–0.3). Avoid making it huge so movement stays smooth.
- Add this force to `_physicsForce` in the same way as the existing `_physicsAvoid` block.

---

## 4. Code structure (single loop)

Keep one loop over `environmentObjects`. For each object with a valid `box`:

1. **Inside:**  
   `if (box.containsPoint(person.pos))`  
   - Compute nearest point on box surface (helper or inline).  
   - `_physicsAvoid.subVectors(person.pos, surfacePoint).normalize().multiplyScalar(PERSON_ENV_INSIDE_STRENGTH)`.  
   - `_physicsForce.add(_physicsAvoid)`.

2. **Outside:**  
   `else`  
   - Current logic: `box.clampPoint(person.pos, _physicsClampedPoint)`, `distEnv = person.pos.distanceTo(_physicsClampedPoint)`.  
   - If `distEnv < PERSON_ENV_AVOID_MARGIN && distEnv > 0.001`: repulsion as now.

So we only do clampPoint when the point is not inside; when inside we use the custom “nearest surface point” and a fixed push-out strength.

---

## 5. Helper (optional but recommended)

Add a small function, e.g. **`getClosestPointOnBoxSurface(box, point, target)`**, that:

- Returns the nearest point on the box **surface** when `point` is **inside** the box (and optionally when outside, for consistency; when outside, it can match `clampPoint`).
- Writes the result into `target` (Vector3) and returns it.
- Implementation: if `!box.containsPoint(point)` return `box.clampPoint(point, target)`; else compute the six distances to faces, pick the closest face, and set `target` to the point on that face as above.

Call this from the avoidance loop when `box.containsPoint(person.pos)` to get `surfacePoint`, then apply the inside force.

---

## 6. Constants

- **`PERSON_ENV_INSIDE_STRENGTH`** (e.g. `0.2`): magnitude of the push-out force when inside. Tune so characters leave the box within a few frames without overshooting badly.

---

## 7. Edge cases

- **Exactly on the surface:** `containsPoint` is typically exclusive (point on boundary may be “inside” or “outside” depending on implementation). If the point is on the boundary, clampPoint gives that point, `distEnv === 0`, and we still skip the current force. With the new branch, if we only push when `containsPoint` is true, we might not push when exactly on the surface; that’s acceptable. If desired, treat “distEnv &lt; ε” as inside and use the same push-out (then we need the surface-point computation for points on the boundary too).
- **Multiple overlapping boxes:** Each object is handled separately; forces add. So being inside two boxes yields two push-out forces; that’s acceptable.
- **Dragonfly:** The same idea can be applied later to the dragonfly obstacle loop (around line 2060) if needed: detect inside with `box.containsPoint(dragonfly.pos)` and push out using the same surface-point logic.

---

## 8. File and location

- **File:** [app.js](app.js)
- **Location:** The existing “Avoid environment obstacles” block (around lines 1895–1910).
- **Change:** Add an `if (box.containsPoint(person.pos)) { ... } else { ... }`; in the `else`, keep the current clampPoint + margin logic; in the `if`, compute nearest surface point and add the inside push-out force. Optionally extract `getClosestPointOnBoxSurface` to a small helper in the same file or a `utils` module if you want to reuse it for the dragonfly.

No changes to how bounding boxes are created or stored; only the avoidance logic in this loop is extended.
