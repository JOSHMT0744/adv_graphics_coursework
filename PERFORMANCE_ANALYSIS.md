# Scene performance analysis and fix plan

## 1. Feature-by-feature cost

| Feature | What it does | Estimated cost | Notes |
|--------|----------------|----------------|-------|
| **Cube cameras (×2)** | `cubeCamFront` (256³) and `cubeCamBack` (512³) render the scene 6 times each for window reflections. Both run when `frameCount % 20 === 0`. | **Very high** | 12 full scene renders in a single frame every 20 frames. Each render draws the entire scene (100+ people, terrain, building, tree, bridge, etc.). Back target is 512px → 4× pixels of front. |
| **People (100 LODs)** | `Figure.createPeopleLOD(100)` → 100 LOD nodes. Each LOD: low-res = 2 meshes (body, head), high-res = 4–6 meshes (+ arms, phone body + flash). Each figure has **unique** `headMaterial` and `bodyMaterial` (random HSL). | **High** | 200–600 meshes depending on LOD; no batching because every figure has different materials. Hundreds of draw calls and material switches. |
| **Dunelm House windows** | ~98 window planes (blockLeft 30, blockMain 30, blockCantilever 18, blockRight 20), each a separate mesh with envMap (cube reflection) material. | **High** | 98 draw calls with expensive envMap sampling. Windows on layer 1 so not in cube render, but main view still draws all 98. |
| **Pixel ratio** | `renderer.setPixelRatio(window.devicePixelRatio)` | **Medium–high** | On Retina/HiDPI this is 2–3 → 4–9× pixel count. Direct multiplier on fill rate. |
| **Far hill terrain** | `generateTerrain(50, 50, 64, …)` → PlaneGeometry 64×64 segments = 8192 triangles, one texture. | **Medium** | Single draw call, but 8k tris and texture sample. |
| **Sky (Preetham)** | Sky box scaled to 10000, ShaderMaterial (atmospheric scattering). | **Low–medium** | One draw; cost is fragment shader over visible sky pixels. |
| **Water plane** | PlaneGeometry(500, 500) no segments → 2 triangles. | **Negligible** | |
| **Bezier surface** | PlaneGeometry 20×20 segments → 800 tris. | **Low** | |
| **Oak tree** | Trunk (Cylinder) + foliage (Sphere), 2 meshes, bark texture. | **Low** | |
| **Kingsgate Bridge** | Deck, railings, bases, lights. Dozens of meshes but shared materials. | **Low–medium** | |
| **LOD updates** | Every 100 ms, `peopleElements.forEach(lod => lod.update(camera))`. | **Low** | CPU-only, 100 distance checks. |
| **Antialiasing** | `WebGLRenderer({ antialias: true })`. | **Low–medium** | MSAA cost depends on resolution. |

---

## 2. Root causes of &lt;5 FPS (in order of impact)

### 2.1 Cube cameras (dominant)

- **What happens:** Every 20th frame, `cubeCamFront.update()` and `cubeCamBack.update()` run. Each `update()` renders the scene **6 times** (one per cube face). So **12 full scene renders** in that one frame.
- **Why it kills FPS:** The scene contains 100 people (200–600 meshes), 98 window meshes, terrain (8k tris), building blocks, tree, bridge, sky, etc. One normal frame is already heavy; doing 12 extra full renders in the same frame causes a huge spike (e.g. 200–300 ms per frame → 3–5 FPS on that frame). **Average FPS is dominated by these spike frames.**
- **Extra:** `cubeRtBack` is 512px (back cube is higher res than front), so 4× more pixels per face than front.

### 2.2 People: count and material count

- **Draw calls:** 100 figures × 2 (low) or ~6 (high) meshes ⇒ 200–600 meshes. Each figure uses its own `MeshStandardMaterial` for head and body (random HSL), so **no batching** → 200+ draw calls for people alone when many are in LOD range.
- **LOD distance 150:** With camera near origin and people spread over 500×500, many can be within 150 units ⇒ many high-res (with phone) figures at once ⇒ peak mesh count.

### 2.3 Building: 98 window meshes with envMap

- Each window is a separate mesh with a reflective material sampling the cube map. Many small meshes + envMap in fragment shader ⇒ many draw calls and expensive shading.

### 2.4 Pixel ratio and resolution

- `setPixelRatio(devicePixelRatio)` on a 2× or 3× display multiplies render resolution (e.g. 1920×1080 → 3840×2160 or 5760×3240). Fill rate and MSAA cost scale with pixel count.

### 2.5 Terrain resolution

- 64×64 segments ⇒ 8192 triangles. Not the main bottleneck but non-trivial for a single mesh.

---

## 3. Fix plan (priority order)

### P0 – Cube cameras (must fix)

1. **Update cube cameras much less often**  
   - Change from every 20 frames to e.g. every **90–120 frames** (~1.5–2 s at 60 FPS) so spike frames are rare.  
   - Or use a **time-based** throttle: e.g. update at most once every 2 seconds (store `lastCubeUpdate` and skip if `now - lastCubeUpdate < 2000`).

2. **Reduce cube map resolution**  
   - Use **256** for both front and back (currently back is 512).  
   - Optionally try **128** for both if reflections can look softer.

3. **Optional: static env map**  
   - If dynamic reflections are not required, use a static `CubeTexture` (e.g. procedural or prebaked) for window materials and **remove** the two CubeCameras. This removes 12× scene renders entirely.

### P1 – People

4. **Lower default people count**  
   - Change `peopleParams.count` default from **100 to 25–30** (or expose in GUI with max 50 for testing). Cuts people draw calls and LOD cost roughly proportionally.

5. **Share materials across figures**  
   - In `Figure` (character.js), replace per-figure random `headMaterial` / `bodyMaterial` with a **small pool** of shared materials (e.g. 5–10 body colors, 5–10 head colors). Instances pick from the pool. This allows Three.js to batch more meshes and reduces state changes.

6. **Reduce LOD distance or high-res complexity**  
   - Reduce `LOD_HIGH_DISTANCE` from 150 to e.g. **80** so fewer figures use the high-res (arms + phone) model at once.  
   - Optionally simplify high-res (e.g. fewer arms/phone meshes) if needed.

### P2 – Resolution and fill rate

7. **Cap pixel ratio**  
   - Use `renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))` to avoid 3× (and 9× pixels) on very high-DPI displays.

8. **Optional: disable antialias**  
   - If still short on FPS, try `antialias: false` and rely on browser scaling or post-FX later.

### P3 – Terrain and building (if still needed)

9. **Reduce terrain segments**  
   - Change far hill from `64` to **32** or **48** (e.g. `generateTerrain(50, 50, 32, …)`). Cuts triangle count roughly 4× or 2×.

10. **Building windows (optional)**  
   - If FPS is still low: reduce window counts in `createBlock` (e.g. fewer windows per face) or merge some window quads into fewer meshes (same material). Lower priority than P0–P2.

---

## 4. Implementation order (recommended)

1. **app.js:** Throttle cube camera updates (time-based, e.g. every 2 s) and set both cube targets to 256px.  
2. **app.js:** Cap pixel ratio at 2.  
3. **app.js:** Reduce default people count to 30 (and optionally LOD distance to 80).  
4. **character.js:** Introduce shared material pools for head/body and assign from pool in `Figure` constructor.  
5. **app.js:** Reduce terrain segments to 32 (or 48).  
6. Re-measure FPS; if still below target, consider static env map (remove cube cams) and/or further people/terrain/window reductions.

---

## 5. Quick wins summary

| Change | File | Effect |
|--------|------|--------|
| Update cube cams every ~2 s instead of every 20 frames | app.js | Removes most spike frames; average FPS can jump into double digits. |
| Both cube targets 256px | app.js | Cuts back-cube pixel count by 4×. |
| `setPixelRatio(Math.min(devicePixelRatio, 2))` | app.js | Avoids 9× pixels on 3× displays. |
| Default people 30, LOD distance 80 | app.js | Fewer meshes and fewer high-res figures. |
| Shared materials for figures | character.js | Fewer draw calls and material switches. |
| Terrain segments 32 | app.js | Fewer terrain triangles. |

The single most impactful fix is **P0 – cube camera throttling and resolution**; the second is **P1 – people count and shared materials**.
