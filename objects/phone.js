import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

// Shared flash materials: 80 phones use 2 materials instead of 80, reducing state churn.
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
    emissiveIntensity: 2.5,
    side: THREE.DoubleSide,
    toneMapped: false,
});

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

        // Flash: small plane on the -Z face (screen/front when held—the side facing the viewer).
        // Plane default normal is +Z; rotate by PI around Y so it faces -Z, and place just in front of -Z face.
        // Uses sharedFlashMatOff; setFlashOn/setFlashOff swap to sharedFlashMatOn/Off.
        const flashGeo = new THREE.PlaneGeometry(flashWidth, flashHeight);
        const flashMesh = new THREE.Mesh(flashGeo, sharedFlashMatOff);
        flashMesh.position.set(width / 4, height / 2 - 0.08, -depth / 2 - 0.008); // -Z face, clearly in front to avoid z-fight
        flashMesh.rotation.y = Math.PI; // face -Z (outward from the front of the phone)
        flashMesh.renderOrder = 1;      // draw after body to reduce z-fight
        this.add(flashMesh);
        this._flashMesh = flashMesh;

        // Optional PointLight on the same -Z (front) face. Created but NOT added to scene;
        // add in setFlashOn, remove in setFlashOff, so it is only in the scene while flashing.
        this._flashLight = null;
        if (flashLight) {
            const light = new THREE.PointLight(0xffffdd, 0, 5, 2);
            light.position.set(width / 4, height / 2 - 0.08, -depth / 2 - 0.01);
            this._flashLight = light;
        }

        this.position.set(x, y, z);
    }

    setFlashOn() {
        this._flashMesh.material = sharedFlashMatOn;
        if (this._flashLight) {
            if (!this.children.includes(this._flashLight)) this.add(this._flashLight);
            this._flashLight.intensity = 1;
        }
    }

    setFlashOff() {
        this._flashMesh.material = sharedFlashMatOff;
        if (this._flashLight) {
            this._flashLight.intensity = 0;
            this.remove(this._flashLight);
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
