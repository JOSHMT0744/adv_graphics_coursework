/**
 * Night-themed skydome using the Preetham Sky model (three@0.126.1).
 * Sun below horizon + tuned uniforms produce a dark blue/purple night look.
 *
 * @param {Object} [params]
 * @param {number} [params.turbidity=0.8]
 * @param {number} [params.rayleigh=0.4]
 * @param {number} [params.mieCoefficient=0.001]
 * @param {number} [params.sunPositionY=-400000] - negative = below horizon (night)
 * @param {number} [params.scale=10000]
 * @returns {THREE.Mesh} Sky mesh (BoxGeometry + ShaderMaterial, BackSide, depthWrite: false)
 */
import { Sky } from "three/examples/jsm/objects/Sky.js";

export function createNightSky(params = {}) {
    const turbidity = params.turbidity ?? 0.8;
    const rayleigh = params.rayleigh ?? 0.4;
    const mieCoefficient = params.mieCoefficient ?? 0.001;
    const sunPositionY = params.sunPositionY ?? -400000;
    const scale = params.scale ?? 10000;

    const sky = new Sky();
    sky.scale.setScalar(scale);

    const uniformMaterials = sky.material.uniforms;
    uniformMaterials.turbidity.value = turbidity;
    uniformMaterials.rayleigh.value = rayleigh;
    uniformMaterials.mieCoefficient.value = mieCoefficient;
    uniformMaterials.sunPosition.value.set(100, sunPositionY, -100);

    return sky;
}
