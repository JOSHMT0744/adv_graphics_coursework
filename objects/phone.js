import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

// Shared flash materials and geometry: all phones reuse these (no per-phone geometry allocation).
const sharedFlashMatOff = new THREE.MeshStandardMaterial({
    color: 0x444444,
    emissive: 0x000000,
    emissiveIntensity: 0,
    side: THREE.DoubleSide,
    toneMapped: false,
});
const sharedFlashMatOn = new THREE.MeshStandardMaterial({
    color: 0x444444,
    emissive: 0xffffdd,
    emissiveIntensity: 15,
    side: THREE.DoubleSide,
    toneMapped: false,
});
const SHARED_FLASH_WIDTH = 0.1;
const SHARED_FLASH_HEIGHT = 0.06;
const sharedFlashGeometry = new THREE.PlaneGeometry(SHARED_FLASH_WIDTH, SHARED_FLASH_HEIGHT);

const DEFAULTS = {
    width: 0.7,
    height: 1.4,
    depth: 0.1,
    radius: 0.04,
    segments: 2,
    color: 0x1a1a1a,
    flashWidth: 0.1,
    flashHeight: 0.06,
    flashLight: true,
};

/**
 * Phone object: rounded rectangular body with a flash on the -Z face (screen/front when held—faces the viewer).
 * setFlashOn() / setFlashOff() toggle the emissive and optional PointLight.
 */
class Phone extends THREE.Group {
    constructor(x = 0, y = 0, z = 0, options = {}) {
        super();
        const phoneOptions = { ...DEFAULTS, ...options };
        const { width, height, depth, radius, segments, color, flashWidth, flashHeight, flashLight } = phoneOptions;

        // Body: rounded box
        const bodyGeo = new RoundedBoxGeometry(width, height, depth, segments, radius);
        const bodyMat = new THREE.MeshStandardMaterial({ color });
        const body = new THREE.Mesh(bodyGeo, bodyMat);
        this.add(body);

        // Flash: shared geometry (no per-phone allocation). Scale if this phone's flash size differs.
        const flashMesh = new THREE.Mesh(sharedFlashGeometry, sharedFlashMatOff);
        flashMesh.position.set(width / 4, height / 2 - 0.08, -depth / 2 - 0.008); // -Z face, clearly in front to avoid z-fight
        flashMesh.rotation.y = Math.PI; // face -Z (outward from the front of the phone)
        flashMesh.scale.set(flashWidth / SHARED_FLASH_WIDTH, flashHeight / SHARED_FLASH_HEIGHT, 1);
        flashMesh.renderOrder = 1;      // draw after body to reduce z-fight
        this.add(flashMesh);
        this._flashMesh = flashMesh;

        // SpotLight on the -Z (front) face: visible beam emanating from the phone (slower decay than PointLight).
        this._flashLight = null;
        this._flashTarget = null;
        if (flashLight) {
            const light = new THREE.SpotLight(0xffffdd, 0, 12, Math.PI / 4, 0.3, 1);
            light.position.set(width / 4, height / 2 - 0.08, -depth / 2 - 0.01);
            const target = new THREE.Object3D();
            target.position.set(width / 4, height / 2 - 0.08, -depth / 2 - 10);
            this.add(light);
            this.add(target);
            light.target = target;
            this._flashLight = light;
            this._flashTarget = target;
        }

        this.position.set(x, y, z);
    }

    setFlashOn() {
        this._flashMesh.material = sharedFlashMatOn;
        if (this._flashLight) {
            this._flashLight.intensity = 20;
        }
    }

    setFlashOff() {
        this._flashMesh.material = sharedFlashMatOff;
        if (this._flashLight) {
            this._flashLight.intensity = 0;
        }
    }
}

/**
 * @param {number} [x=0]
 * @param {number} [y=0]
 * @param {number} [z=0]
 * @param {Object} [options] - width, height, depth, radius, segments, color, flashWidth, flashHeight, flashLight
 * @returns {Phone}
 */
export function createPhone(x = 0, y = 0, z = 0, options = {}) {
    return new Phone(x, y, z, options);
}
