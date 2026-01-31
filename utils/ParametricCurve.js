import * as THREE from "three";
import { evalBSplineCurve, evalBSplineTangent } from "./bspline.js";

/**
 * Parametric curve (B-spline) with editable control points.
 * For n >= 4 control points, there are n-3 cubic segments over t in [0,1].
 */
export class ParametricCurve {
    /**
     * @param {Object} [options]
     * @param {THREE.Vector3[]} [options.controlPoints]
     * @param {string} [options.type='bspline'] - reserved for 'bezier' later
     */
    constructor(options = {}) {
        const pts = options.controlPoints ?? ParametricCurve.createDefault().getControlPoints();
        /** @type {THREE.Vector3[]} */
        this.controlPoints = Array.isArray(pts) ? pts.map(p => p instanceof THREE.Vector3 ? p.clone() : new THREE.Vector3(p.x, p.y, p.z)) : [];
        if (this.controlPoints.length < 4) {
            throw new Error("ParametricCurve: need at least 4 control points");
        }
    }

    /**
     * @param {number} t - in [0,1]
     * @returns {THREE.Vector3}
     */
    getPoint(t) {
        const s = Math.max(0, Math.min(1, t));
        return evalBSplineCurve(s, this.controlPoints);
    }

    /**
     * @param {number} t - in [0,1]
     * @returns {THREE.Vector3} unit tangent
     */
    getTangent(t) {
        return evalBSplineTangent(t, this.controlPoints);
    }

    /** @returns {THREE.Vector3[]} same references (caller may mutate; use clone for a copy) */
    getControlPoints() {
        return this.controlPoints;
    }

    /**
     * @param {number} i
     * @param {THREE.Vector3|{x,y,z}} v
     */
    setControlPoint(i, v) {
        const p = this.controlPoints[i];
        if (!p) return;
        p.set(v.x, v.y, v.z);
    }

    /**
     * @param {THREE.Vector3|{x,y,z}} v
     * @param {number} [index] - insert at index; append if undefined
     */
    addControlPoint(v, index) {
        const p = v instanceof THREE.Vector3 ? v.clone() : new THREE.Vector3(v.x, v.y, v.z);
        if (index == null || index >= this.controlPoints.length) {
            this.controlPoints.push(p);
        } else {
            this.controlPoints.splice(Math.max(0, index), 0, p);
        }
    }

    /** @param {number} i */
    removeControlPoint(i) {
        if (this.controlPoints.length <= 4) return;
        this.controlPoints.splice(i, 1);
    }

    /**
     * @param {number} [numSamples=64]
     * @returns {THREE.BufferGeometry}
     */
    toLineGeometry(numSamples = 64) {
        const n = Math.max(2, numSamples);
        const positions = [];
        for (let i = 0; i < n; i++) {
            const t = i / (n - 1);
            const p = this.getPoint(t);
            positions.push(p.x, p.y, p.z);
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
        return geo;
    }

    /**
     * @param {number} [numSamples=64]
     * @returns {THREE.Vector3[]}
     */
    toPoints(numSamples = 64) {
        const n = Math.max(2, numSamples);
        const out = [];
        for (let i = 0; i < n; i++) {
            out.push(this.getPoint(i / (n - 1)));
        }
        return out;
    }

    /**
     * @returns {ParametricCurve} curve with 5–6 control points in a gentle XZ arc
     */
    static createDefault() {
        const pts = [
            new THREE.Vector3(-4, 0, 4),
            new THREE.Vector3(-2, 1, 2),
            new THREE.Vector3(0, 1.5, 0),
            new THREE.Vector3(2, 1, -2),
            new THREE.Vector3(4, 0, -4)
        ];
        return new ParametricCurve({ controlPoints: pts });
    }
}
