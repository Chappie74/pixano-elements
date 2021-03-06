/**
 * @copyright CEA-LIST/DIASI/SIALV/LVA (2019)
 * @author CEA-LIST/DIASI/SIALV/LVA <pixano@cea.fr>
 * @license CECILL-C
 */

import { observe, ObservableSet, Observer, unobserve } from '@pixano/core';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CuboidSetManager } from "./cuboid-set-manager";
import { CuboidPlot, PointCloudPlot } from './plots';
import { SceneView } from './scene-view';
import { Cuboid } from './types';
import { EditModeController } from './edit-controller';
import { CreateModeController } from './create-controller';

/** Edit mode manager - Handles mode switching and monitors neceassary events */
export class ModeManager {
    private viewer: SceneView;
    private eventTarget: EventTarget;
    private annotations: ObservableSet<Cuboid>;
    private annotationPlots: CuboidSetManager;
    private groundPlot: THREE.Object3D;

    private observers = new Map<object, Observer>();  // to ensure proper disposal

    private mouseUpListener: any;
    private mouseMoveListener: any;
    private lastMouseMouseEvt = new MouseEvent("mousemove");
    private orbitControls: OrbitControls;
    private navigating = false;

    private editMode: EditModeController | null = null;
    private editing = false;  // mousedown
    private updatePending = false;  // mousedown+drag
    public editTarget: Cuboid | null = null;
    private pclPlot: () => PointCloudPlot;

    private createMode: CreateModeController | null = null;

    /** 'edit', 'create' or null depending on the currently active mode. */
    get mode() {
        if (this.editMode) { return 'edit'; }
        if (this.createMode) { return 'create'; }
        return null;
    }

    constructor(
            viewer: SceneView, eventTarget: EventTarget,
            annotations: ObservableSet<Cuboid>,
            annotationPlots: CuboidSetManager,
            groundPlot: THREE.Object3D,
            pclPlot: () => PointCloudPlot) {
        this.viewer = viewer;
        this.pclPlot = pclPlot;
        this.eventTarget = eventTarget;
        this.annotations = annotations;
        this.annotationPlots = annotationPlots;
        this.groundPlot = groundPlot;

        this.orbitControls = new OrbitControls(viewer.camera, viewer.domElement);
        // this.orbitControls.minDistance = 5;
        this.orbitControls.maxDistance = 150;
        this.orbitControls.enableKeys = false;

        // Event
        this.orbitControls.addEventListener("change", () => {
            this.navigating = true;
            this.viewer.render();
        });

        window.addEventListener('keydown', (evt: KeyboardEvent) => {
            if (evt.key === '+') {
                const pcl = this.pclPlot();
                if (pcl) {
                    pcl.plusSize();
                    this.viewer.render();
                }
            } else if (evt.key === '-') {
                const pcl = this.pclPlot();
                if (pcl) {
                    pcl.minusSize();
                    this.viewer.render();
                }
            }
          })

        // mouse movement to have the mouse position ready when needed
        this.mouseMoveListener = (evt: MouseEvent) => { this.lastMouseMouseEvt = evt; };
        this.viewer.domElement.addEventListener("mousemove", this.mouseMoveListener);

        // clicks
        this.mouseUpListener = (evt: MouseEvent) => {
            if (this.navigating || this.editing) {
                this.navigating = false;
                this.editing = false;
                return;
            }

            const plot = this.viewer.raycast(
                evt.clientX, evt.clientY, ...this.annotationPlots.plotsMap.values())[0] as CuboidPlot;
            const target = plot ? this.annotationPlots.annotationsMap.get(plot)! : null;
            if (this.editMode && !target) {
                this.setMode();
                this.editTarget = target;
            } else if (this.editMode && target && target !== this.editTarget) {
                this.setMode();
                this.editTarget = target;
                this.setMode("edit");
            } else if (this.editMode && target && target === this.editTarget) {
                this.editMode.toggleMode();
                this.viewer.render();
            } else if (!this.editMode && target) {
                this.editTarget = target;
                this.setMode('edit');
            }
        };

        this.viewer.domElement.addEventListener('mouseup', this.mouseUpListener);

        // Track exernal events on annotations
        const observer1 = observe(annotations, (op, value?) => {
            if (op === "add") {
                const observer = observe(value!, cubOp => {
                    if (cubOp === "position" || cubOp === "size" || cubOp === "heading" || cubOp === "color") {
                        this.viewer.render();
                    }
                }, Infinity);
                this.observers.set(value!, observer);
            } else if (op === "delete") {
                this.setMode();
                this.editTarget = null;
                unobserve(value, this.observers.get(value)!);
                this.observers.delete(value!);
            } else if (op === "clear") {
                if (this.editMode) { this.setMode() };
                this.editTarget = null;
                for (const [target, observer] of this.observers.entries()) {
                    if (target !== annotations) {  // unobserve cuboids
                        unobserve(target, observer);
                        this.observers.delete(target!);
                    }
                }
            }
        });
        this.observers.set(annotations, observer1);

        const observer2 = observe(annotations, (op: string) => {
            if (op === "add" || op === "delete" || op === "clear") {
                this.viewer.render();
            }
        }, Infinity);
        this.observers.set(annotations, observer2);
    }

    destroy() {
        if (this.editMode)  {
            this.editMode.destroy();
        }
        if (this.createMode)  {
            this.createMode.destroy();
        }

        this.orbitControls.dispose();

        this.viewer.domElement.removeEventListener("mousemove", this.mouseMoveListener);
        this.viewer.domElement.removeEventListener("mouseup", this.mouseUpListener);

        for (const [target, observer] of this.observers) {
            unobserve(target, observer);
        }
    }

    /** Switch to another mode -
     *  @param mode 'edit', 'create' or null
     */
    setMode(mode: string | null = null) {
        // Restore default state
        if (this.editMode)  {
            this.editMode.destroy();
            this.editMode = null;

            if (this.updatePending) {
                // commit pending update
                this.eventTarget.dispatchEvent(new CustomEvent("update", { detail: this.editTarget }));
                this.updatePending = false;
            }

            this.eventTarget.dispatchEvent(new CustomEvent("selection", { detail: [] }));
        }

        if (this.createMode)  {
            this.createMode.destroy();
            this.createMode = null;
        }

        if (this.orbitControls.object !== this.viewer.camera) {
            this.orbitControls = new OrbitControls(this.viewer.camera, this.viewer.domElement);
        }
        this.orbitControls.enabled = true;
        this.navigating = false;
        this.editing = false;

        if (mode === "edit") {
            if (!this.editTarget) {
                throw new Error("cannot go into edit mode without a target");
            }

            // Set up edit mode
            const targetPlot = this.annotationPlots.plotsMap.get(this.editTarget)!;
            this.editMode = new EditModeController(this.viewer, this.editTarget, targetPlot);

            this.editMode.addEventListener("start", () => {
                this.orbitControls.enabled = false;
                this.editing = true;
            });
            this.editMode.addEventListener("change", () => { this.updatePending = true; });
            this.editMode.addEventListener("stop", () => {
                this.orbitControls.enabled = true;
                if (this.updatePending) {
                    this.eventTarget.dispatchEvent(new CustomEvent("update", { detail: this.editTarget }));
                }
                this.updatePending = false;
            });

            // notify about switch to editing mode
            this.eventTarget.dispatchEvent(new CustomEvent("selection", { detail: [ this.editTarget ] }));

        // Activate creation
        } else if (mode === "create") {
            this.orbitControls.enabled = false;
            this.createMode = new CreateModeController(
                this.viewer, this.groundPlot, this.annotations,
                this.lastMouseMouseEvt, this.pclPlot);
            this.createMode.addEventListener('create', (evt: CustomEvent) => {
                this.editTarget = evt.detail;
                this.setMode("edit");
                this.eventTarget.dispatchEvent(evt);
            });
        }

        this.viewer.render();
    }
}


