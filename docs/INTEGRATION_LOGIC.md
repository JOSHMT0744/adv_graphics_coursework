# Integration Logic: CPU Simulation Loop and GPU Rendering Pipeline

This document describes how the simulation loop (CPU) communicates with the rendering pipeline (GPU), the data flow for **hardware instancing** and **parametric geometry**, and how **CPU–GPU bus traffic** is minimised when updating thousands of objects every frame.

---

## 1. Overall data flow (CPU → GPU)

Each frame, the **animation loop** (`animate()` in `app.js`) runs on the CPU and does the following:

1. **Simulation updates**  
   Draggable Bezier and B-spline surfaces are updated (control-point positions → parametric evaluation → mesh vertex buffers).

2. **Visibility (frustum culling)**  
   The camera frustum is built from the camera’s projection and world-inverse matrices. The **octree** is queried with `queryFrustum(cameraFrustum)` to get only entities whose AABBs intersect the view frustum. This list is the set of **visible** character instances.

3. **Instance data update**  
   For each visible entity, the CPU composes a 4×4 model matrix (position + rotation around Y) and writes it into the **instanced mesh’s instance matrix buffer** via `setMatrixAt(i, matrix)`. The instanced mesh’s `count` is set to `visible.length`, and `instanceMatrix.needsUpdate = true` is set once.

4. **Render call**  
   `renderer.render(scene, camera)` is called. The renderer (and underlying WebGL/Three.js) uploads any buffers marked `needsUpdate` to the GPU, then issues draw calls. The GPU runs the vertex shader once per vertex per **visible** instance, using `gl_InstanceID` to fetch the per-instance matrix from the instance attribute.

So the flow is: **CPU simulation → CPU visibility → CPU writes instance buffer → one “needsUpdate” flag → GPU upload and single (or few) instanced draw call(s)**.

---

## 2. Hardware instancing: data flow

**Purpose:** Draw many copies of the same character (same geometry and material) with different transforms in a single draw call, instead of thousands of separate meshes and draw calls.

**LOD:** Level-of-detail is implemented as **two** instanced meshes: **near** (distance &lt; threshold) uses a merged high-res geometry (body + head + arms from `Figure.getInstanceGeometryHigh()`); **far** uses a single-box geometry (`Figure.getInstanceGeometry()`). Each frame, visible entities are partitioned by distance to the camera; matrices are written to the corresponding instanced mesh. This keeps instancing for both levels and avoids per-figure LOD nodes.

**Setup (once, at load):**

- **Shared geometry**  
  One `BufferGeometry` per LOD level: low-LOD single box and high-LOD merged body+head+arms. Each is uploaded to the GPU once and reused for every instance in that level.

- **Shared material**  
  One `MeshStandardMaterial` (or similar) from `Figure.getInstanceMaterial()`. Material and its uniforms are also effectively “one copy” on the GPU.

- **Instanced mesh**  
  `THREE.InstancedMesh(geometry, material, maxCount)` creates one mesh object that:
  - Stores a **per-instance 4×4 matrix** in an `InstancedBufferAttribute` (`instanceMatrix`).
  - Tells the renderer to draw the same geometry multiple times, with the vertex shader reading the matrix for `gl_InstanceID` and transforming vertices.

**Per-frame (CPU):**

1. **Frustum culling**  
   `visible = octree.queryFrustum(cameraFrustum)` returns only entities whose bounds intersect the camera frustum.

2. **Matrix write**  
   For `i = 0 .. visible.length - 1`, the CPU:
   - Takes entity `e = visible[i]` (position, rotationY).
   - Composes a model matrix: `_dummyMatrix.compose(_dummyPosition, _dummyQuaternion, _dummyScale)` using reused dummy objects.
   - Writes it: `characterInstancedMesh.setMatrixAt(i, _dummyMatrix)`.

3. **Count and dirty flag**  
   - `characterInstancedMesh.count = visible.length` so only that many instances are drawn.
   - `characterInstancedMesh.instanceMatrix.needsUpdate = true` so the instance buffer is re-uploaded to the GPU this frame.

**GPU side:**

- When the instanced mesh is drawn, the renderer uploads the `instanceMatrix` buffer to the GPU (because `needsUpdate` was true), then issues **one** (or a small number of) instanced draw call(s) (e.g. `drawElementsInstanced`). The vertex shader uses `gl_InstanceID` to index into the instance matrix and transforms each vertex. So: **one geometry, one material, one buffer update, one draw call** for all visible characters.

---

## 3. Parametric geometry: data flow

**Purpose:** Surfaces (Bezier, B-spline) are defined by **control points** and a **parametric formula** S(u,v). The mesh is a grid of vertices whose positions are **computed on the CPU** by evaluating S(u,v) at (u,v) ∈ [0,1]².

**Generation (CPU):**

- **Fixed surfaces**  
  Control points are constant. The CPU evaluates the parametric formula (e.g. `evalBezierSurface(u, v, controlPoints)` in `objects/surface.js`, or the B-spline equivalent in `objects/bsplineSurface.js`) at each (u,v) of a fixed grid (e.g. 50×50 segments). Results are written into the mesh’s `BufferGeometry` **position** attribute. This is done once at creation; the buffer is uploaded to the GPU once.

- **Draggable surfaces**  
  Control points are movable (e.g. spheres). Each frame (or on drag), an `update()` function:
  - Reads the current control-point positions.
  - For each vertex index k, gets (u,v) from the UV attribute, computes `S(u,v)` with the current control points, and writes the result with `positions.setXYZ(k, x, y, z)`.
  - Sets `positions.needsUpdate = true` (and typically `computeVertexNormals()`).
  - On the next render, the position buffer is re-uploaded to the GPU and the surface mesh is redrawn with the new shape.

So parametric geometry flow is: **control points (CPU) → evaluate S(u,v) on CPU → fill position buffer → set needsUpdate → GPU upload and normal draw**.

---

## 4. Minimising CPU–GPU bus traffic

**Instancing (characters):**

- **Single geometry and material**  
  One copy of vertex/index and material data is sent to the GPU and reused for all instances. No per-character geometry or material upload.

- **Single buffer for transforms**  
  All per-instance data is one `instanceMatrix` buffer (16 floats per instance). Only this buffer is updated each frame, and only for the first `visible.length` instances. We do **not** use a separate mesh or draw call per character, which would multiply state and draw-call overhead.

- **Frustum culling**  
  `characterInstancedMesh.count = visible.length` means the GPU only draws visible instances. We still update the same instance buffer (typically the whole buffer is re-uploaded when `needsUpdate` is true), but we avoid drawing off-screen instances and reduce overdraw and GPU work.

- **No per-instance colour**  
  The implementation does not use `instanceColor` or other per-instance attributes that would increase the amount of per-instance data sent every frame.

- **Reused temporaries**  
  `_dummyMatrix`, `_dummyPosition`, `_dummyQuaternion`, `_dummyScale` are reused in the loop to compose matrices. This avoids allocating new objects every frame, reducing GC and keeping the CPU side efficient.

**Parametric surfaces:**

- **Update only when needed**  
  Fixed Bezier/B-spline surfaces are generated once; their position buffers are uploaded once. Only **draggable** surfaces have their position buffers updated when control points change, so bus traffic is limited to the surfaces that actually moved.

- **Single buffer per mesh**  
  For each parametric mesh, only the **position** (and possibly normals) buffer is updated; the rest of the geometry (topology, UVs) is unchanged and not re-sent.

**Summary:**  
Bus traffic is minimised by (1) instancing (one geometry, one material, one instance buffer, one draw call for all visible characters), (2) frustum culling (fewer instances drawn and less overdraw), (3) no per-instance colour or extra per-instance attributes, (4) reusing CPU temporaries, and (5) updating parametric surface buffers only when control points change.
