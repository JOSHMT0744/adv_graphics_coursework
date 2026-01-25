import * as THREE from  "https://unpkg.com/three@0.126.1/build/three.module.js";

export function getTexture(texturePath, errorMessage) {
    const textureLoader = new THREE.TextureLoader();
    const texture = textureLoader.load(texturePath,
        function (texture) {
            texture.minFilter = THREE.LinearMipmapLinearFilter; // enable mipmapping
            texture.magFilter = THREE.LinearFilter; // enable linear filtering
        },
        undefined,
        function(err) {
            console.error(errorMessage, err);
        }
    );
    return texture;
}