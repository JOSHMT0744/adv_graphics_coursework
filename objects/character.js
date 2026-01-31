// https://tympanus.net/codrops/2021/10/04/creating-3d-characters-in-three-js/
import * as THREE from "three";    
import { createPhone } from './phone.js';

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

            // Translate the arm (not group) downwards by half the height
            arm.position.y = height * -0.5

            arm.position.x = m * 0.8;
            arm.position.y = 0.6;
            arm.rotation.z = Math.PI / 12 * m;

            if (i === phoneArm) {
                const phone = createPhone(0, 0, 0, { width: 0.24, height: 0.48, depth: 0.04, flashLight: true });
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
            }, 500);
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
}