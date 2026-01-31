import * as THREE from 'three';
import { CatmullRomCurve3, Vector3, MeshBasicMaterial, Mesh, ExtrudeGeometry } from 'three';
import { getTexture } from '../../utils/getTexture.js';

function createRoadProfile(width, archHeight) {
    const shape = new THREE.Shape();

    // Create a shallow arc for the road surface
    shape.moveTo(-width/2, 0);

    // Quadratic curve creates the "arch"
    shape.quadraticCurveTo(0, archHeight, width/2, 0);

    return shape;
}

export function generateRoad(pointsArray) {
    // Create profile for the road
    /*const roadProfile = createRoadProfile(innerWidth, 0.1);

    // Define the mathematical path
    const curve = new CatmullRomCurve3(
        pointsArray.map(p => new Vector3(p.x, p.y, p.z))
    )

    // Extrude the profile along the curve
    const extrudeSettings = {
        steps: 20,
        extrudePath: curve,
        curveSegments: 12,
        bevelEnabled: false
    };

    
    // Parametric surface: Extrue a circle aong the curve
    const geometry = new ExtrudeGeometry(roadProfile, extrudeSettings);
    const material = new MeshBasicMaterial({ map: getTexture('textures/TH_Road_Asphalt_2k_8b_zZYJnsk/textures/TH_Road_Asphalt_baseColor.png', 'Error loading road texture') });
    const road = new Mesh(geometry, material);

    // Offset slightly upward to avoid "Z-fighting" with terrain
    road.position.y += 0.1;

    return { road, curve };*/

    const curve = new THREE.CatmullRomCurve3(pointsArray.map(p => new THREE.Vector3(p.x, p.y, p.z)));
    const points = curve.getPoints(64); // length of each segment
    const len = curve.getLength();
    const lenList = curve.getLengths(64);

    const geo = new BufferGeometry();
    geo.setIndex( new THREE.BufferAttribute(new Uint32Array(indices), 1));
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(uvs), 2));

    et id