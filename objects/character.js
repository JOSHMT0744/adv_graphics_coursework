// https://tympanus.net/codrops/2021/10/04/creating-3d-characters-in-three-js/
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { createPhone } from './phone.js';
import { COLOURS } from '../constants.js';

// Bone indices for skinned character (order matches bones array)
const BONE_ROOT = 0;
const BONE_SPINE = 1;
const BONE_HEAD = 2;
const BONE_ARM_L = 3;
const BONE_ARM_R = 4;
const BONE_LEG_L = 5;
const BONE_LEG_R = 6;
const MAX_SPEED = 0.5;

export class Figure {
    constructor(params) {
        this.params = {
            x: 0,
            y: 1.5,
            ry: 0,
            ...params
        }
        this.group = new THREE.Group();
        this._phone = null;

        this.headHue = Math.random() * 360;
        this.bodyHue = Math.random() * 360;
        this.headMaterial = new THREE.MeshStandardMaterial({ color: `hsl(${this.headHue}, 30%, 50%)` });
        this.bodyMaterial = new THREE.MeshStandardMaterial({ color: `hsl(${this.bodyHue}, 80%, 50%)` });

        this.group.position.x = this.params.x
		this.group.position.y = this.params.y
		this.group.position.z = this.params.z
		this.group.rotation.y = this.params.ry

        this.pos = new THREE.Vector3();
        this.vel = new THREE.Vector3((Math.random() - 0.5) * 120, 0, (Math.random() - 0.5) * 120);
        this.acc = new THREE.Vector3();
        this.state = "WANDER";
        this.target = null;
        this.timer = 0;
        this.maxSpeed = MAX_SPEED * (0.9 + Math.random() * 0.2);
        this.mesh = new THREE.Group();
        this.group.add(this.mesh);
    }

    createBody() {
        const geometry = new THREE.BoxGeometry(1, 1.5, 1);
        const body = new THREE.Mesh(geometry, this.bodyMaterial);
        this.group.add(body);
    }

    createHead() {
        const geometry = new THREE.BoxGeometry(1.4, 1.4, 1.4);
        const head = new THREE.Mesh(geometry, this.headMaterial);
        this.group.add(head);

        // position it above the body
        head.position.y = 1.65;
    }

    createArms(highResolution = false) {
        // set necessary variables
        const height = 1;
        const geometry = new THREE.BoxGeometry(0.25, height, 0.25);

        // With probability 0.5, at most one arm holds a phone at its lower end (hand), but only if highResolution
        let phoneArm = -1;
        if (highResolution) {
            const addPhone = Math.random() < 0.8;
            phoneArm = addPhone ? (Math.random() < 0.5 ? 0 : 1) : -1;
        }

        for (let i = 0; i < 2; i++) {
            const arm = new THREE.Mesh(geometry, this.bodyMaterial);
            const m = i % 2 === 0 ? 1 : -1;

            // create group for each arm
            const armGroup = new THREE.Group();

            // add arm to group
            armGroup.add(arm)
            this.group.add(armGroup);

            // Arm box centered at shoulder: body half-width 0.5 + arm half-width 0.125 = 0.625; shoulder at top of body ~1.1
            arm.position.y = height * -0.5;
            arm.position.x = m * 0.625;
            arm.position.y = 1.1;
            arm.rotation.z = Math.PI / 12 * m;

            if (i === phoneArm) {
                const phone = createPhone(0, 0, 0, { width: 0.24, height: 0.48, depth: 0.04, flashLight: true, flashWidth: 0.5, flashHeight: 0.5 });
                // Place phone so its lower end (bottom) is at the arm's hand; z=0.14 to sit in front of the arm and avoid z-fight
                phone.position.set(0, -0.5 + 0.24 / 2, 0.14);
                this._phone = phone;
                arm.add(phone);
            }
        }
    }

    initHighResolution() {
        this.createBody();
        this.createHead();
        this.createArms(true);
    }

    initLowResolution() {
        this.createBody();
        this.createHead();
    }

    /** Returns the Phone in this figure's group, or null. Uses _phone if set, else finds by traversing. */
    getPhone() {
        if (this._phone) return this._phone;
        let found = null;
        this.group.traverse(obj => {
            if (obj.setFlashOn && !found) found = obj;
        });
        if (found) this._phone = found;
        return found;
    }

    /** Turns the phone flash on, then off after 500ms. No-op if this figure has no phone. */
    triggerFlash() {
        const phone = this.getPhone();
        if (phone) {
            phone.setFlashOn();
            setTimeout(() => {
                phone.setFlashOff();
            }, 2000);
        }
    }

    /**
     * Create an array of LOD objects (Figure high/low) with random positions.
     * @param {number} objectCount
     * @returns {THREE.LOD[]}
     */
    static createPeopleLOD(objectCount) {
        const objects = [];
        for (let i = 0; i < objectCount; i++) {
            const lod = new THREE.LOD();

            const high = new Figure({ x: 0, y: 0, z: 0, ry: 0 });
            high.initHighResolution();
            lod.addLevel(high.group, 0);
            lod.userData.highFigure = high;

            const low = new Figure({ x: 0, y: 0, z: 0, ry: 0 });
            low.initLowResolution();
            lod.addLevel(low.group, 150);

            lod.position.set((Math.random() - 0.5) * 500, 1.0, (Math.random() - 0.5) * 500);
            objects.push(lod);
        }
        return objects;
    }

    /**
     * Build humanoid bone hierarchy for skinned character. Origin at feet (y=0).
     * Order: root, spine, head, armL, armR, legL, legR (indices 0..6).
     * @returns {THREE.Bone[]}
     */
    static createSkeletonBones() {
        const root = new THREE.Bone();
        root.position.set(0, 0, 0);

        const spine = new THREE.Bone();
        spine.position.set(0, 0.75, 0); // body center
        root.add(spine);

        const head = new THREE.Bone();
        head.position.set(0, 0.9, 0); // 0.75 + 0.9 = 1.65
        spine.add(head);

        const armL = new THREE.Bone();
        armL.position.set(0.625, 0.35, 0); // shoulder: just outside body (0.5 + 0.125), above spine (0.75 + 0.35 = 1.1)
        spine.add(armL);

        const armR = new THREE.Bone();
        armR.position.set(-0.625, 0.35, 0);
        spine.add(armR);

        const legL = new THREE.Bone();
        legL.position.set(-0.36, 0.375, 0); // leg center from root
        root.add(legL);

        const legR = new THREE.Bone();
        legR.position.set(0.36, 0.375, 0);
        root.add(legR);

        return [root, spine, head, armL, armR, legL, legR];
    }

    /**
     * Build skinned geometry: same part boxes as getInstanceGeometryHigh, with skinIndex and skinWeight.
     * Part order: body, head, legL, legR, armL, armR (matches merge order for vertex ranges).
     * @returns {{ geometry: THREE.BufferGeometry, vertexRanges: number[] }}
     */
    static createSkinnedGeometry() {
        const bodyGeo = new THREE.BoxGeometry(1, 1.5, 1);
        bodyGeo.translate(0, 0.75, 0);
        const headGeo = new THREE.BoxGeometry(1.4, 1.4, 1.4);
        headGeo.translate(0, 1.65, 0);
        const legHeight = 0.75;
        const legGeo = new THREE.BoxGeometry(0.28, legHeight, 0.28);
        legGeo.translate(0, -legHeight / 2, 0);
        const legLeft = legGeo.clone();
        legLeft.applyMatrix4(new THREE.Matrix4().makeTranslation(-0.36, legHeight / 2, 0));
        const legRight = legGeo.clone();
        legRight.applyMatrix4(new THREE.Matrix4().makeTranslation(0.36, legHeight / 2, 0));
        legGeo.dispose();
        const armHeight = 1;
        const armGeo = new THREE.BoxGeometry(0.25, armHeight, 0.25);
        armGeo.translate(0, -armHeight / 2, 0);
        const armLeft = armGeo.clone();
        armLeft.applyMatrix4(
            new THREE.Matrix4().makeTranslation(0.625, 1.1, 0).multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 12))
        );
        const armRight = armGeo.clone();
        armRight.applyMatrix4(
            new THREE.Matrix4().makeTranslation(-0.625, 1.1, 0).multiply(new THREE.Matrix4().makeRotationZ(-Math.PI / 12))
        );
        armGeo.dispose();

        const parts = [bodyGeo, headGeo, legLeft, legRight, armLeft, armRight];
        const vertexRanges = [0];
        let total = 0;
        for (const g of parts) {
            total += g.attributes.position.count;
            vertexRanges.push(total);
        }
        const geometry = mergeGeometries(parts);
        bodyGeo.dispose();
        headGeo.dispose();
        legLeft.dispose();
        legRight.dispose();
        armLeft.dispose();
        armRight.dispose();

        const boneForPart = [BONE_SPINE, BONE_HEAD, BONE_LEG_L, BONE_LEG_R, BONE_ARM_L, BONE_ARM_R];
        const n = geometry.attributes.position.count;
        const skinIndex = new Uint16Array(n * 4);
        const skinWeight = new Float32Array(n * 4);
        for (let i = 0; i < n; i++) {
            let partIdx = 0;
            for (let p = 0; p < vertexRanges.length - 1; p++) {
                if (i >= vertexRanges[p] && i < vertexRanges[p + 1]) {
                    partIdx = p;
                    break;
                }
            }
            const b = boneForPart[partIdx];
            skinIndex[i * 4] = b;
            skinIndex[i * 4 + 1] = 0;
            skinIndex[i * 4 + 2] = 0;
            skinIndex[i * 4 + 3] = 0;
            skinWeight[i * 4] = 1;
            skinWeight[i * 4 + 1] = 0;
            skinWeight[i * 4 + 2] = 0;
            skinWeight[i * 4 + 3] = 0;
        }
        geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
        geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
        return { geometry, vertexRanges };
    }

    /**
     * Create one skinned character (template). Clone with SkeletonUtils.clone() for pool instances.
     * @returns {THREE.SkinnedMesh}
     */
    static createSkinnedCharacter() {
        const { geometry } = Figure.createSkinnedGeometry();
        const bones = Figure.createSkeletonBones();
        const skeleton = new THREE.Skeleton(bones);
        skeleton.calculateInverses();
        const material = Figure.getInstanceMaterial();
        const mesh = new THREE.SkinnedMesh(geometry, material);
        mesh.add(bones[0]);
        mesh.bind(skeleton);
        mesh.normalizeSkinWeights();
        mesh.castShadow = false; // off for crowd to save shadow pass cost (plan: FPS optimization)
        mesh.userData.boneIndices = { spine: BONE_SPINE, head: BONE_HEAD, armL: BONE_ARM_L, armR: BONE_ARM_R, legL: BONE_LEG_L, legR: BONE_LEG_R };
        return mesh;
    }

    /**
     * Clone a skinned character for pool use (each clone has its own skeleton).
     * @param {THREE.SkinnedMesh} templateMesh
     * @returns {THREE.SkinnedMesh}
     */
    static cloneSkinnedCharacter(templateMesh) {
        return cloneSkinned(templateMesh);
    }

    /**
     * Y offset from mesh origin to bottom of feet (local y=0). Used so placement at (x, surfaceY + this, z)
     * puts the character's feet just on the surface. SkinnedMesh/skeleton can make the effective origin
     * @returns {number}
     */
    static getFeetSurfaceYOffset() {
        return 0.75; // leg length / distance from root to feet bottom in bind pose
    }

    /**
     * Geometry for instanced character rendering (low-LOD: single box approximating body+head).
     * Bottom of box at y=0 in local space so instance matrix position = feet on ground.
     * @returns {THREE.BufferGeometry}
     */
    static getInstanceGeometry() {
        const height = 3.1; // match figure height (body -0.75 to 2.35)
        const geo = new THREE.BoxGeometry(1, height, 1);
        geo.translate(0, height / 2, 0); // bottom at y=0
        Figure.addSkinPartAttribute(geo, []); // no skin parts, all body
        return geo;
    }

    /**
     * High-LOD geometry for instanced characters: merged body + head + arms + legs (no phones).
     * Same proportions as createBody/createHead/createArms; origin at feet (y=0).
     * Limbs use reference technique: BoxGeometry, translate(0, -halfHeight, 0), then position.
     * Geometry has groups so head uses matSkin; use returned materials array when creating the mesh.
     * @returns {{ geometry: THREE.BufferGeometry, materials: THREE.Material[] }}
     */
    static getInstanceGeometryHigh() {
        const skin = [0xFFDBAC, 0xF1C27D, 0xE0AC69, 0x8D5524][Math.floor(Math.random() * 4)];
        const matSkin = new THREE.MeshStandardMaterial({ color: skin });
        const matBody = Figure.getInstanceMaterial();

        // Match buildPersonMesh: torso center 1.25 (legs 0–0.75, torso 0.5–2.0)
        const bodyGeo = new THREE.BoxGeometry(1, 1.5, 1);
        bodyGeo.translate(0, 1.25, 0);

        const headGeo = new THREE.BoxGeometry(1.4, 1.4, 1.4);
        headGeo.translate(0, 2.45, 0); // head center = torsoCenter + torsoHeight/2 + 0.7 = 1.25 + 0.5 + 0.7

        // Legs: same as buildPersonMesh — hip at y=legHeight (0.75), feet at y=0; geometry has hip at local y=0 after translate
        const legHeight = 0.75;
        const legGeo = new THREE.BoxGeometry(0.28, legHeight, 0.28);
        legGeo.translate(0, -legHeight / 2, 0);
        const legLeft = legGeo.clone();
        legLeft.applyMatrix4(new THREE.Matrix4().makeTranslation(-0.36, legHeight, 0));
        const legRight = legGeo.clone();
        legRight.applyMatrix4(new THREE.Matrix4().makeTranslation(0.36, legHeight, 0));
        legGeo.dispose();

        // Arms: shoulder at 1.55 to match buildPersonMesh (torsoCenter + torsoHeight/2 - 0.2)
        const armHeight = 1;
        const shoulderY = 1.55;
        const armGeo = new THREE.BoxGeometry(0.25, armHeight, 0.25);
        armGeo.translate(0, -armHeight / 2, 0);
        const armLeft = armGeo.clone();
        armLeft.applyMatrix4(
            new THREE.Matrix4().makeTranslation(0.625, shoulderY, 0).multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 12))
        );
        const armRight = armGeo.clone();
        armRight.applyMatrix4(
            new THREE.Matrix4().makeTranslation(-0.625, shoulderY, 0).multiply(new THREE.Matrix4().makeRotationZ(-Math.PI / 12))
        );
        armGeo.dispose();

        const merged = mergeGeometries([bodyGeo, headGeo, legLeft, legRight, armLeft, armRight]);
        bodyGeo.dispose();
        headGeo.dispose();
        legLeft.dispose();
        legRight.dispose();
        armLeft.dispose();
        armRight.dispose();

        // Each box has 24 vertices (6 faces × 4). Order: body, head, legL, legR, armL, armR.
        const vertsPerBox = 24;
        merged.groups = [
            { start: 0, count: vertsPerBox, materialIndex: 0 },
            { start: vertsPerBox, count: vertsPerBox, materialIndex: 1 },
            { start: vertsPerBox * 2, count: vertsPerBox * 4, materialIndex: 0 }
        ];
        return { geometry: merged, materials: [matBody, matSkin] };
    }

    /**
     * Add skinPart vertex attribute: 0 = torso/legs (torsoColor), 1 = head/arms (skinColor). Used for shader color blending.
     * @param {THREE.BufferGeometry} geo - Merged geometry
     * @param {number[]} skinPartIndices - Indices of parts that are skin: head and arms. Parts: 0=body, 1=head, 2=legL, 3=legR, 4=armL, 5=armR.
     */
    static addSkinPartAttribute(geo, skinPartIndices) {
        const vertsPerBox = 24;
        const count = geo.attributes.position.count;
        const arr = new Float32Array(count);
        for (let i = 0; i < count; i++) {
            const partIdx = Math.floor(i / vertsPerBox);
            arr[i] = skinPartIndices.includes(partIdx) ? 1.0 : 0.0;
        }
        geo.setAttribute('skinPart', new THREE.BufferAttribute(arr, 1));
    }

    /**
     * Medium-LOD geometry for instanced characters: body + head only (no arms/legs). Origin at feet (y=0).
     * @returns {THREE.BufferGeometry}
     */
    static getInstanceGeometryMedium() {
        const bodyGeo = new THREE.BoxGeometry(1, 1.5, 1);
        bodyGeo.translate(0, 0.75, 0);
        const headGeo = new THREE.BoxGeometry(1.4, 1.4, 1.4);
        headGeo.translate(0, 1.65, 0);
        const merged = mergeGeometries([bodyGeo, headGeo]);
        bodyGeo.dispose();
        headGeo.dispose();
        Figure.addSkinPartAttribute(merged, [1]); // part 1 = head (arms not present in medium LOD)
        return merged;
    }

    /**
     * High-LOD geometry for instancing (single material; use instance color for variation).
     * Same as getInstanceGeometryHigh but returns only geometry, no materials.
     * Parts: 0=body, 1=head, 2=legL, 3=legR, 4=armL, 5=armR.
     */
    static getInstanceGeometryHighOnly() {
        // Match buildPersonMesh: torso center 1.25, head center 2.45, shoulder 1.55; feet at y=0; leg hip at y=legHeight (0.75)
        const bodyGeo = new THREE.BoxGeometry(1, 1.5, 1);
        bodyGeo.translate(0, 1.25, 0);
        const headGeo = new THREE.BoxGeometry(1.4, 1.4, 1.4);
        headGeo.translate(0, 2.45, 0);
        const legHeight = 0.75;
        const legGeo = new THREE.BoxGeometry(0.28, legHeight, 0.28);
        legGeo.translate(0, -legHeight / 2, 0);
        const legLeft = legGeo.clone();
        legLeft.applyMatrix4(new THREE.Matrix4().makeTranslation(-0.36, legHeight, 0));
        const legRight = legGeo.clone();
        legRight.applyMatrix4(new THREE.Matrix4().makeTranslation(0.36, legHeight, 0));
        legGeo.dispose();
        const armHeight = 1;
        const shoulderY = 1.55;
        const armGeo = new THREE.BoxGeometry(0.25, armHeight, 0.25);
        armGeo.translate(0, -armHeight / 2, 0);
        const armLeft = armGeo.clone();
        armLeft.applyMatrix4(
            new THREE.Matrix4().makeTranslation(0.625, shoulderY, 0).multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 12))
        );
        const armRight = armGeo.clone();
        armRight.applyMatrix4(
            new THREE.Matrix4().makeTranslation(-0.625, shoulderY, 0).multiply(new THREE.Matrix4().makeRotationZ(-Math.PI / 12))
        );
        armGeo.dispose();
        const merged = mergeGeometries([bodyGeo, headGeo, legLeft, legRight, armLeft, armRight]);
        bodyGeo.dispose();
        headGeo.dispose();
        legLeft.dispose();
        legRight.dispose();
        armLeft.dispose();
        armRight.dispose();
        Figure.addSkinPartAttribute(merged, [1, 4, 5]); // parts 1=head, 4=armL, 5=armR = skin; 0=body, 2=legL, 3=legR = torso
        return merged;
    }

    /**
     * Default material for instanced characters (single color; per-instance color can be set on InstancedMesh).
     * @returns {THREE.Material}
     */
    static getInstanceMaterial() {
        return new THREE.MeshStandardMaterial({
            color: 0x6688aa,
            roughness: 0.6,
            metalness: 0.1
        });
    }
}

/**
 * Lightweight crowd entity with Figure-like attributes (pos, rotationY) for octree/LOD and animate loop.
 * @param {{ position: THREE.Vector3, id: number, bounds: THREE.Box3, rotationY?: number }} options
 */
export class CrowdCharacter {
    constructor(options = {}) {
        const { position, id, bounds, rotationY = Math.random() * Math.PI * 2 } = options;
        this.id = id;
        this.pos = position ? position.clone() : new THREE.Vector3();
        this.prevPosition = this.pos.clone();
        this.rotationY = rotationY;
        this.bounds = bounds;
    }
}

// Shared geometries and material palette for crowd LOD (efficiency: fewer allocations, material batching)
let _sharedGeoBody = null, _sharedGeoHead = null, _sharedGeoArm = null, _sharedGeoLeg = null;
function getSharedGeoBody() {
    if (!_sharedGeoBody) _sharedGeoBody = new THREE.BoxGeometry(1, 1.5, 1);
    return _sharedGeoBody;
}
function getSharedGeoHead() {
    if (!_sharedGeoHead) _sharedGeoHead = new THREE.BoxGeometry(1.4, 1.4, 1.4);
    return _sharedGeoHead;
}
function getSharedGeoArm() {
    if (!_sharedGeoArm) {
        _sharedGeoArm = new THREE.BoxGeometry(0.25, 1, 0.25);
        _sharedGeoArm.translate(0, -0.5, 0); // shoulder at y=0, arm extends down to y=-1 (rotates at shoulder joint)
    }
    return _sharedGeoArm;
}
function getSharedGeoLeg() {
    if (!_sharedGeoLeg) {
        _sharedGeoLeg = new THREE.BoxGeometry(0.28, 0.75, 0.28);
        _sharedGeoLeg.translate(0, -0.375, 0); // hip at y=0, leg extends down to y=-0.75 (feet)
    }
    return _sharedGeoLeg;
}

let _skinMaterials = null, _bodyMaterials = null;
function getSkinMaterial(i) {
    if (!_skinMaterials) _skinMaterials = COLOURS.SKIN_PALETTE.map(c => new THREE.MeshStandardMaterial({ color: c }));
    return _skinMaterials[i % _skinMaterials.length];
}
function getBodyMaterial(i) {
    if (!_bodyMaterials) _bodyMaterials = COLOURS.BODY_PALETTE.map(c => new THREE.MeshStandardMaterial({ color: c }));
    return _bodyMaterials[i % _bodyMaterials.length];
}
/** Materials used by crowd (for wireframe toggle). */
export function getCrowdMaterials() {
    if (!_skinMaterials) getSkinMaterial(0);
    if (!_bodyMaterials) getBodyMaterial(0);
    return [..._skinMaterials, ..._bodyMaterials];
}

/**
 * Build high-detail character mesh (body, head, arms, legs, optional phone).
 * Shared by createPerson and createPersonMeshOnly. Uses shared geometries and material palette.
 * @param {{ position?: THREE.Vector3, rotationY?: number }} options
 * @returns {{ mesh: THREE.Group, parts: Object, _phone: object|null }}
 */
function buildPersonMesh(options = {}) {
    const position = options.position || new THREE.Vector3(0, 0, 0);
    const rotationY = options.rotationY ?? 0;
    const mesh = new THREE.Group();
    let _phone = null;

    const matSkin = getSkinMaterial(Math.floor(Math.random() * COLOURS.SKIN_PALETTE.length));
    const matBody = getBodyMaterial(Math.floor(Math.random() * COLOURS.BODY_PALETTE.length));

    const legHeight = 0.75;
    const torsoHeight = 1;
    const torsoBottom = legHeight; // legs end at y=0.75, torso starts there
    const torsoCenter = torsoBottom + torsoHeight / 2;

    const torso = new THREE.Mesh(getSharedGeoBody(), matBody);
    torso.position.set(0, torsoCenter, 0); // torso y in [0.75, 2.25], above legs [0, 0.75]

    const head = new THREE.Mesh(getSharedGeoHead(), matSkin);
    head.position.set(0, torsoCenter + torsoHeight / 2 + 0.7, 0); // on top of torso (head 1.4 tall)

    const legLeft = new THREE.Mesh(getSharedGeoLeg(), matBody);
    legLeft.position.set(-0.36, legHeight, 0); // hip at y=0.75 (meets torso bottom)
    const legRight = new THREE.Mesh(getSharedGeoLeg(), matBody);
    legRight.position.set(0.36, legHeight, 0);

    const armHeight = 1;
    const shoulderY = torsoCenter + torsoHeight / 2 - 0.2; // just below torso top
    const armLeftMesh = new THREE.Mesh(getSharedGeoArm(), matBody);
    armLeftMesh.position.set(0.625, shoulderY, 0); // shoulder at y=0 in geometry, so position mesh at shoulderY
    armLeftMesh.rotation.z = Math.PI / 12;
    const armLeft = new THREE.Group();
    armLeft.add(armLeftMesh);

    const armRightMesh = new THREE.Mesh(getSharedGeoArm(), matBody);
    armRightMesh.position.set(-0.625, shoulderY, 0); // shoulder at y=0 in geometry, so position mesh at shoulderY
    armRightMesh.rotation.z = -Math.PI / 12;
    const armRight = new THREE.Group();
    armRight.add(armRightMesh);

    if (Math.random() < 0.9) {
        const phone = createPhone(0, 0, 0, { width: 0.36, height: 0.72, depth: 0.06, flashLight: false });
        phone.position.set(0, -1 + 0.24 / 2, 0.14); // hand end at y=-1, phone positioned near hand
        phone.rotation.x = Math.PI / 2;
        phone.rotation.y = Math.PI / 2;
        _phone = phone;
        armRightMesh.add(phone);
    }

    mesh.add(torso, head, legLeft, legRight, armLeft, armRight);
    mesh.position.copy(position);
    mesh.rotation.y = rotationY;
    mesh.traverse(c => c.castShadow = false);

    const parts = { legLeft: legLeft, legRight: legRight, armLeft: armLeftMesh, armRight: armRightMesh, torso: torso, head: head };
    return { mesh, parts, _phone };
}

export function createPerson(options = {}) {
    const position = options.position;
    const pos = position ? position.clone() : new THREE.Vector3((Math.random() - 0.5) * 120, 0, (Math.random() - 0.5) * 120);
    const rotationY = position ? (options.rotationY ?? Math.random() * Math.PI * 2) : Math.random() * Math.PI * 2;
    const { mesh, parts, _phone } = buildPersonMesh({ position: pos, rotationY });
    const person = {
        pos,
        prevPosition: position ? position.clone() : pos.clone(),
        rotationY,
        vel: new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5),
        acc: new THREE.Vector3(),
        state: 'WANDER', target: null, timer: 0,
        maxSpeed: MAX_SPEED * (0.9 + Math.random() * 0.2),
        mesh,
        _phone,
        parts
    };
    person.getPhone = function () { return this._phone || null; };
    person.triggerFlash = function () {
        const phone = this.getPhone();
        if (phone) { phone.setFlashOn(); setTimeout(() => phone.setFlashOff(), 500); }
    };
    return person;
}

/**
 * Create mesh/parts only for high-detail character. Used when promoting crowd person to close range.
 * @param {{ position?: THREE.Vector3, rotationY?: number }} options
 * @returns {{ mesh: THREE.Group, parts: Object, _phone: object|null }}
 */
export function createPersonMeshOnly(options = {}) {
    return buildPersonMesh(options);
}

/** Distance thresholds for LOD levels (camera distance). */
export const LOD_DISTANCE_HIGH = 0;
export const LOD_DISTANCE_MED = 40;   // medium: torso + head + arms
export const LOD_DISTANCE_LOW = 70;   // far: torso + head only (current medium format)
export const LOD_DISTANCE_BOX = 100;  // single box

// High-detail total height (feet at 0 to top of head): legs 0.75 + torso overlap + head; head top = 1.25+0.5+0.7+0.7 = 3.15
const FIGURE_TOTAL_HEIGHT = 3.15;

/**
 * Medium-detail mesh: torso + head + arms (no legs). Offset and scaled so height matches high-detail (feet at y=0, same total height).
 * @param {THREE.Material} matSkin - material for head
 * @param {THREE.Material} matBody - material for torso and arms
 * @returns {THREE.Group}
 */
function createMediumDetailMesh(matSkin, matBody) {
    const group = new THREE.Group();
    const legHeight = 0.75;
    const torsoHeight = 1;
    const torsoCenter = legHeight + torsoHeight / 2;
    const shoulderY = torsoCenter + torsoHeight / 2 - 0.2;
    const armHeight = 1;
    const torso = new THREE.Mesh(getSharedGeoBody(), matBody);
    torso.position.set(0, torsoCenter, 0);
    const head = new THREE.Mesh(getSharedGeoHead(), matSkin);
    head.position.set(0, torsoCenter + torsoHeight / 2 + 0.7, 0);
    const armLeft = new THREE.Mesh(getSharedGeoArm(), matBody);
    armLeft.position.set(0.625, shoulderY, 0); // shoulder at y=0 in geometry, so position mesh at shoulderY
    armLeft.rotation.z = Math.PI / 12;
    const armRight = new THREE.Mesh(getSharedGeoArm(), matBody);
    armRight.position.set(-0.625, shoulderY, 0); // shoulder at y=0 in geometry, so position mesh at shoulderY
    armRight.rotation.z = -Math.PI / 12;
    const inner = new THREE.Group();
    inner.add(torso, head, armLeft, armRight);
    // Medium mesh bottom is torso bottom at 0.5; shift down so feet plane is at 0 (match high-detail)
    inner.position.y += 0.75;
    // Medium mesh height without legs is 2.65; scale to match high-detail total height
    group.add(inner);
    group.traverse(c => c.castShadow = false);
    return group;
}

/**
 * Far (low) detail mesh: torso + head only (shared geometry).
 * @param {THREE.Material} matSkin - material for head
 * @param {THREE.Material} matBody - material for torso
 * @returns {THREE.Group}
 */
function createFarDetailMesh(matSkin, matBody) {
    const group = new THREE.Group();
    const legHeight = 0.75;
    const torsoHeight = 1;
    const torsoCenter = legHeight + torsoHeight / 2;
    const torso = new THREE.Mesh(getSharedGeoBody(), matBody);
    torso.position.set(0, torsoCenter, 0);
    const head = new THREE.Mesh(getSharedGeoHead(), matSkin);
    head.position.set(0, torsoCenter + torsoHeight / 2 + 0.7, 0);
    group.add(torso, head);
    group.traverse(c => c.castShadow = false);
    return group;
}

let _sharedBoxLODGeometry = null;
function getLowLODGeometry() {
    if (!_sharedBoxLODGeometry) _sharedBoxLODGeometry = Figure.getInstanceGeometry();
    return _sharedBoxLODGeometry;
}

/**
 * Single box for 3rd LOD level (furthest: just a rectangular box).
 * Same height as figure, bottom at y=0; uses body material color.
 * @param {THREE.Material} matBody - material for the box
 * @returns {THREE.Mesh}
 */
function createLowDetailMesh(matBody) {
    const mesh = new THREE.Mesh(getLowLODGeometry(), matBody);
    mesh.castShadow = false;
    return mesh;
}

/**
 * Create a person with a THREE.LOD: high → medium (with arms) → far (torso+head) → box.
 * @param {Object} options - same as createPerson (position, rotationY, etc.)
 * @returns {Object} person object with mesh (THREE.LOD), parts, pos, vel, etc.
 */
export function createPersonWithLOD(options = {}) {
    const person = createPerson(options);
    const highMesh = person.mesh;
    const matSkin = person.parts.head.material;
    const matBody = person.parts.torso.material;
    const mediumMesh = createMediumDetailMesh(matSkin, matBody);
    const farMesh = createFarDetailMesh(matSkin, matBody);
    const boxMesh = createLowDetailMesh(matBody);
    const lod = new THREE.LOD();
    lod.addLevel(highMesh, LOD_DISTANCE_HIGH);
    lod.addLevel(mediumMesh, LOD_DISTANCE_MED);
    lod.addLevel(farMesh, LOD_DISTANCE_LOW);
    lod.addLevel(boxMesh, LOD_DISTANCE_BOX);
    person.mesh = lod;
    return person;
}

/**
 * Create crowd person data for instanced rendering (no mesh). Has pos, vel, bounds, bodyColor, facingAngle.
 * getPhone() returns null; triggerFlash() is no-op.
 */
export function createCrowdPerson(options = {}) {
    const position = options.position;
    const pos = position ? position.clone() : new THREE.Vector3((Math.random() - 0.5) * 120, 0, (Math.random() - 0.5) * 120);
    const rotationY = position ? (options.rotationY ?? Math.random() * Math.PI * 2) : Math.random() * Math.PI * 2;
    const hue = Math.random() * 360;
    const bodyColor = new THREE.Color().setHSL(hue / 360, 0.6, 0.62);
    const surfaceType = options.surfaceType;
    const u = options.u;
    const v = options.v;
    const regionIndex = options.regionIndex;
    const _surfaceCache = {
        regionIndex: regionIndex ?? 0,
        ...(surfaceType && { surfaceType }),
        ...(typeof u === 'number' && { u }),
        ...(typeof v === 'number' && { v })
    };
    const person = {
        pos,
        prevPosition: position ? position.clone() : pos.clone(),
        rotationY,
        facingAngle: rotationY,
        bankAngle: 0,
        vel: new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5),
        acc: new THREE.Vector3(),
        state: 'WANDER',
        target: null,
        timer: 0,
        maxSpeed: MAX_SPEED * (0.9 + Math.random() * 0.2),
        mesh: null,
        parts: null,
        bounds: null,
        bodyColor,
        getPhone: () => null,
        triggerFlash: () => {},
        _surfaceCache,
        _lastOctreePos: position ? position.clone() : pos.clone()
    };
    return person;
}