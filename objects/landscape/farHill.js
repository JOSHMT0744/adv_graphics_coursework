import { PlaneGeometry, MeshStandardMaterial, Mesh } from 'three';
import { SimplexNoise } from 'three/addons/math/SimplexNoise.js';
import { getTexture } from '../../utils/getTexture.js';

/**
 * @param {number} [width=100]
 * @param {number} [height=100]
 * @param {number} [segments=10]
 * @param {Object} [options]
 * @param {number} [options.freq=0.005]
 * @param {number} [options.amp=4]
 * @param {number} [options.endHeight=60]
 */
export function generateTerrain(width = 100, height = 100, segments = 10, options = {}) {
    const { freq = 0.01, amp = 7, endHeight = 30 } = options;
    const geometry = new PlaneGeometry(width, height, segments, segments);
    const posAttribute = geometry.getAttribute("position");

    const hillTexture = getTexture('textures/ground_05_2k/ground_05_2k/ground_05_baseColor_2k.png', "Error loading hill texture");

    const simplexNoise = new SimplexNoise();

    const height_discretised = Array.from({ length: posAttribute.count }, (_, i) => (endHeight/posAttribute.count) * i)

    for (let i = 0; i < posAttribute.count; i++) {
        let x = posAttribute.getX(i);
        let y = posAttribute.getY(i);

        // Parametric noise (fractal Brownian motion)
        let z = 0;
        z += simplexNoise.noise(x * freq, y * freq) * amp;
        z += simplexNoise.noise(x * freq * 2, y * freq * 2) * (amp * 0.5);
        z += simplexNoise.noise(x * freq * 4, y * freq * 4) * (amp * 0.25);

        // Steepness: exponentiation for deeper valleys and sharper peaks
        z = Math.pow(Math.abs(z), 1.2) * Math.sign(z);

        // Overall slope: tilt the plane so one side is higher (after rotation.x=π/2, this becomes world Y)
        z += height_discretised[i];

        posAttribute.setZ(i, z);
    }

    geometry.computeVertexNormals(); // essential for proper lighting
    const material = new MeshStandardMaterial({ map: hillTexture, wireframe: false });
    const terrain = new Mesh(geometry, material);
    terrain.rotation.x = -Math.PI / 2;
    return terrain;
}

