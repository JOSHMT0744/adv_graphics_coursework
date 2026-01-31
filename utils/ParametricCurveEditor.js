import * as THREE from "three";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { ParametricCurve } from "./ParametricCurve.js";

/**
 * Interactive editor for a ParametricCurve: curve line, control-point meshes,
 * control polygon, TransformControls, and click-to-select.
 *
 * @param {ParametricCurve} curve
 * @param {Object} opts
 * @param {THREE.Camera} opts.camera
 * @param {HTMLCanvasElement} opts.domElement
 * @param {import("three/examples/jsm/controls/OrbitControls").OrbitControls} [opts.orbitControls]
 * @param {THREE.Scene} opts.scene - where to add TransformControls
 * @param {number} [opts.samples=64]
 */
export function createParametricCurveEditor(curve, opts) {
    const { camera, domElement, orbitControls, scene, samples: initialSamples = 64 } = opts;
    let samples = initialSamples;
    let editMode = false;
    let selectedIndex = 0;

    const group = new THREE.Group();

    const curveLine = new THREE.Line(
        curve.toLineGeometry(samples),
        new THREE.LineBasicMaterial({ color: 0x00ff88 })
    );
    group.add(curveLine);

    const controlPointMeshes = [];
    const sphereGeo = new THREE.SphereGeometry(0.15, 16, 12);
    const pointMat = new THREE.MeshBasicMaterial({ color: 0xffaa00 });
    const controlPointGroup = new THREE.Group();
    group.add(controlPointGroup);

    const controlPolygonLine = new THREE.LineSegments(
        buildControlPolygonGeo(curve.getControlPoints()),
        new THREE.LineBasicMaterial({ color: 0x888888 })
    );
    group.add(controlPolygonLine);

    const transformControls = new TransformControls(camera, domElement);
    transformControls.setMode("translate");
    transformControls.setSpace("world");
    transformControls.setSize(0.8);
    scene.add(transformControls);

    function buildControlPolygonGeo(pts) {
        const pos = [];
        for (let i = 0; i < pts.length - 1; i++) {
            pos.push(pts[i].x, pts[i].y, pts[i].z, pts[i + 1].x, pts[i + 1].y, pts[i + 1].z);
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
        return g;
    }

    function syncControlPointMeshes() {
        const pts = curve.getControlPoints();
        while (controlPointMeshes.length > pts.length) {
            const m = controlPointMeshes.pop();
            controlPointGroup.remove(m);
            m.geometry.dispose();
        }
        while (controlPointMeshes.length < pts.length) {
            const m = new THREE.Mesh(sphereGeo, pointMat);
            m.userData.controlIndex = controlPointMeshes.length;
            controlPointMeshes.push(m);
            controlPointGroup.add(m);
        }
        for (let i = 0; i < pts.length; i++) {
            controlPointMeshes[i].position.copy(pts[i]);
            controlPointMeshes[i].userData.controlIndex = i;
        }
    }

    function refreshCurveLine() {
        if (curveLine.geometry) curveLine.geometry.dispose();
        curveLine.geometry = curve.toLineGeometry(samples);
    }

    function refreshControlPolygon() {
        if (controlPolygonLine.geometry) controlPolygonLine.geometry.dispose();
        controlPolygonLine.geometry = buildControlPolygonGeo(curve.getControlPoints());
    }

    function refresh() {
        refreshCurveLine();
        refreshControlPolygon();
        syncControlPointMeshes();
    }

    function attachTransformTo(i) {
        if (i < 0 || i >= controlPointMeshes.length) {
            transformControls.detach();
            return;
        }
        transformControls.attach(controlPointMeshes[i]);
    }

    transformControls.addEventListener("objectChange", () => {
        const obj = transformControls.object;
        if (obj && obj.userData.controlIndex != null) {
            curve.setControlPoint(obj.userData.controlIndex, obj.position);
            refreshCurveLine();
            refreshControlPolygon();
        }
    });

    transformControls.addEventListener("mouseDown", () => {
        if (orbitControls) orbitControls.enabled = false;
    });

    transformControls.addEventListener("mouseUp", () => {
        if (orbitControls) orbitControls.enabled = true;
    });

    syncControlPointMeshes();
    attachTransformTo(selectedIndex);

    function setEditMode(on) {
        editMode = on;
        controlPointGroup.visible = on;
        controlPolygonLine.visible = on;
        if (!on) {
            transformControls.detach();
        } else {
            attachTransformTo(selectedIndex);
        }
    }

    function setSelectedIndex(i) {
        selectedIndex = Math.max(0, Math.min(i, curve.getControlPoints().length - 1));
        if (editMode) attachTransformTo(selectedIndex);
    }

    function setSamples(n) {
        samples = Math.max(4, n);
        refreshCurveLine();
    }

    refresh();

    return {
        getGroup: () => group,
        getCurve: () => curve,
        getControlPointMeshes: () => controlPointMeshes,
        setEditMode,
        setSelectedIndex,
        setSamples,
        getSelectedIndex: () => selectedIndex,
        getSamples: () => samples,
        getEditMode: () => editMode,
        refresh,
        destroy: () => {
            transformControls.detach();
            scene.remove(transformControls);
            if (curveLine.geometry) curveLine.geometry.dispose();
            if (controlPolygonLine.geometry) controlPolygonLine.geometry.dispose();
        }
    };
}
