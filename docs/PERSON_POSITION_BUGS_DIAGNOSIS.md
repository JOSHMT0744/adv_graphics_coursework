# Person Position Bugs – Diagnosis

## Symptoms
- Some people's y coordinate shoots way above the surface
- People glitching up and down
- Medium/far LOD people translating unnaturally, teleporting between planes, shifting position irregularly (including in y)

---

## Key Bug Sources

### 1. **getSurfaceInfoRaycast hits wrong surface (Y shooting up)**
**Location:** `utils/walkableSampler.js` lines 655–663

The raycast shoots from `(x, yCeiling, z)` downward (yCeiling = 50) and uses the first hit from `walkableMeshes`. That gives the highest surface along the ray, not necessarily the one the person is meant to stand on.

- If a person is under a bridge, deck, or raised structure, the ray can hit the structure above instead of the ground.
- People near overlapping surfaces (bridge over terrain, steps, etc.) can snap to the higher surface and appear to jump upward.

**Fix direction:** Restrict raycast to surfaces below the person’s current position, or prefer the hit closest to the current y.

---

### 2. **Batching + infrequent sampling → stale pos and jumps**
**Location:** `app.js` lines 2273–2291, 1864–1868

- Physics runs for only `PEOPLE_PER_BATCH` people each frame (e.g. ~150 of 300).
- For medium/far people, `SURFACE_SAMPLE_EVERY_FAR = 18` skips surface sampling for many frames.
- `person.pos` only updates when the person is in the batch **and** `shouldSample` is true.

Effect:
- `person.pos` can be several frames old when it finally updates.
- When it updates, the new sampled position can be far from the previous one, especially across surface boundaries or slopes, causing visible teleportation.

---

### 3. **_displayPos interpolation chasing unstable pos**
**Location:** `app.js` lines 2428–2432 (fillInstancedMesh)

```javascript
person._displayPos.lerp(person.pos, PERSON_POS_INTERP);
```

- For mid-tier instanced people, the rendered position comes from `_displayPos`, which lerps toward `person.pos`.
- If `person.pos` jumps (from surface sampling or batching), `_displayPos` follows, producing smooth-looking but wrong motion (e.g. drifting up/down or across surfaces).

---

### 4. **Same-cell cache returns coarse y**
**Location:** `utils/walkableSampler.js` lines 578–587

When the agent stays in the same grid cell, the cache returns the last sampled y without re-evaluating at the new (x,z). On slopes or multi-surface cells, that y can be wrong for the current position, causing vertical jitter and occasional big corrections when the cache is invalidated.

---

### 5. **Height grid out-of-bounds**
**Location:** `utils/walkableSampler.js` lines 574–577, 549–552

For `(x,z)` outside the height grid, `cellIx`/`cellIz` can be negative or exceed the grid. `getCellY` returns NaN for out-of-bounds cells. The code then falls back to region iteration and raycast. At boundaries, that can lead to inconsistent y between height grid, regions, and raycast, causing sudden height changes.

---

### 6. **Placement only when shouldSample**
**Location:** `app.js` lines 1872–1939

Position updates happen only when `shouldSample` is true. When it is false:
- `person.pos` is not updated.
- Velocity still changes in physics.
- The next sample uses `_physicsCandidatePos = person.pos + person.vel` with a large accumulated displacement, so the sampled position can be far away and on a different surface, producing large jumps.

---

### 7. **Region boundary / ordering**
**Location:** `utils/walkableSampler.js` lines 632–651

The first region that contains (x,z) is used. At region boundaries or overlaps, small (x,z) changes can switch regions, and different regions can have very different heights. That yields:
- Flickering between surfaces
- People appearing to “teleport” between planes.

---

## Summary

| Source                     | Symptom                  | Severity |
|---------------------------|--------------------------|----------|
| Raycast hits wrong surface| Y shooting up            | High     |
| Batching + infrequent sample | Teleporting, irregular motion | High |
| _displayPos chasing pos   | Unnatural translation    | Medium   |
| Same-cell cache           | Up/down glitching        | Medium   |
| Height grid OOB           | Boundary discontinuities | Medium   |
| shouldSample gating       | Occasional large jumps   | Medium   |
| Region boundaries         | Plane switching          | Medium   |

---

## Recommended Fix Order

1. **Raycast:** Restrict hits to surfaces below or near the current person height.
2. **Batching:** Revisit how often mid/far people are sampled, or avoid large jumps by limiting how far `pos` can move per update.
3. **Clamp/filter y:** Reject or dampen surface samples whose y differs from the current value by more than a threshold (e.g. max step height).
4. **Cache:** Invalidate or refine the same-cell cache when (x,z) moves enough within the cell.
5. **Grid bounds:** Add bounds checks and safe fallbacks for out-of-bounds (x,z).
