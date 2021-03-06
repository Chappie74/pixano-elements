/**
 * @copyright CEA-LIST/DIASI/SIALV/LVA (2019)
 * @author CEA-LIST/DIASI/SIALV/LVA <pixano@cea.fr>
 * @license CECILL-C
 */

import { ObservableSet, observable } from "@pixano/core";
import { css, customElement, html, LitElement } from 'lit-element';
import { ModeManager } from "./cuboid-manager";
import { GroundPlot, PointCloudPlot } from './plots';
import { CuboidSetManager } from "./cuboid-set-manager";
import { SceneView } from './scene-view';
import { Cuboid } from "./types";
import { normalizeAngle } from './utils';

/** An interactive 3D editor window to manipulate cuboid objects. -
 *
 * @fires CustomEvent#create upon creating an new cuboid { detail: Cuboid }
 * @fires CustomEvent#update upon editing a cuboid { detail: Cuboid }
 * @fires CustomEvent#delete upon deletion of a cuboid { detail: Cuboid }
 * @fires CustomEvent#selection upon deletion of a cuboid { detail: Cuboid[] }
 */
@customElement('pxn-cuboid-editor' as any)
export class CuboidEditor extends LitElement {

  // viewer of scene
  private viewer: SceneView;

  // set of 3d annotation objects
  private _editableCuboids: ObservableSet<Cuboid>;
  private cuboidPlots: CuboidSetManager;
  // private innerPointsPainter: InnerPointsPainter;
  private groundPlot: GroundPlot;
  private pclPlot: PointCloudPlot;
  private modeManager: ModeManager;

  constructor() {
    super();

    this.viewer = new SceneView();

    this.pclPlot = new PointCloudPlot(200000);
    this.pclPlot.positionBuffer = new Float32Array(0);
    this.viewer.scene.add(this.pclPlot);

    this.groundPlot = new GroundPlot();
    this.viewer.scene.add(this.groundPlot);

    this._editableCuboids = new ObservableSet<Cuboid>();
    this.cuboidPlots = new CuboidSetManager(this.viewer, this.editableCuboids);

    // decomment this if you want to paint inner points of cuboids
    // this.innerPointsPainter = new InnerPointsPainter(this.pclPlot, this.editableCuboids);

    this.modeManager = new ModeManager(
        this.viewer, this, this.editableCuboids,
        this.cuboidPlots, this.groundPlot, this.getPcl.bind(this));

    window.addEventListener("keydown", this.defaultOnKeyDown.bind(this));
  }

  destroy() {
    this.cuboidPlots.destroy();
    // this.innerPointsPainter.destroy();
    this.groundPlot.destroy();
    this.pclPlot.destroy();
    this.modeManager.destroy();
  }

  // LitElement implementation
  static get styles() {
    return [
      css`
      :host {
        width: 100%;
        height: 100%;
        min-height: 300px;
        min-width: 100px;
        position: relative;
        display: block;
      }
      #root {
        width: 100%;
        height: 100%;
        position: relative;
        background-color: black;
        background-repeat: no-repeat;
        margin: 0px;
        overflow: hidden;
      }
      /* Medium Devices, Desktops */
      @media only screen and (min-width : 992px) {
        #root {
          min-height: 600px;
          max-height: 100vh;
        }
      }
      `
    ];
  }

  firstUpdated() {
    const container = this.shadowRoot!.getElementById("root") as HTMLElement;
    container.appendChild(this.viewer.domElement);
    this.viewer.onResize();
    window.addEventListener("resize", () => this.viewer.onResize());
    this.viewer.render();
  }

  render() {
    return html`<div id="root"></div>`;
  }

  // Exposed API

  get cameraMode() {
    return this.viewer.cameraMode;
  }
  set cameraMode(value) {
    const mode = this.mode;
    this.mode = null;
    this.viewer.cameraMode = value;
    this.mode = mode;
    this.viewer.render();
  }

  /** Point cloud as flattened array of [x, y, z] point coordinates. */
  get pcl() {
    return this.pclPlot.positionBuffer;
  }
  set pcl(value: Float32Array) {
    this.pclPlot.positionBuffer = value;
    this.viewer.render();
  }

  getPcl() {
    return this.pclPlot;
  }

  /** Current editing mode - Either "edit", "create" or null. */
  get mode() {
    return this.modeManager.mode;
  }
  set mode(mode: string | null) {
    this.modeManager.setMode(mode);
  }

  swap() {
    const sel = this.editTarget as Cuboid;
    if (sel) {
      sel.size = [sel.size[1], sel.size[0], sel.size[2]];
      sel.heading = normalizeAngle(sel.heading - Math.PI / 2);
    }
    return sel;
  }

  rotate() {
    const sel = this.editTarget as Cuboid;
    if (sel) {
      sel.heading = normalizeAngle(sel.heading - Math.PI / 2);
    }
    return sel;
  }

  /** The set of editable cuboid. - The cuboid must be observable. */
  get editableCuboids() {
    return this._editableCuboids;
  }
  set editableCuboids(value) {
    this._editableCuboids.clear();
    value = value || [];
    for (const v of value) {
      this._editableCuboids.add(observable(v));
    }
  }

  /** Sets the object of interest for editing */
  get editTarget(): Cuboid | null {
    return this.modeManager.editTarget;
  }
  set editTarget(cuboid) {
      if (cuboid) {
        if (!this.editableCuboids.has(cuboid)) {
          throw new Error("target is not an existing annotation");
        }
        this.modeManager.editTarget = cuboid;
        this.mode = 'edit';
      } else {
        this.modeManager.editTarget = null;
      }
  }

  /**
   * Insert a new annotation in the scene.
   *
   * @deprecated add directly to {@link CuboidEditor#editableCuboids}.
   */
  addAnnotation(annotation: Cuboid) {
    const newObj = observable(annotation);
    this.editableCuboids.add(newObj);
    return newObj;
  }

  /**
   * Default keybindings
   * @param e Keyboard event
   */
  protected defaultOnKeyDown(e: KeyboardEvent) {
    if (e.key === " " && this.editTarget !== null) {
      this.editTarget.heading = this.editTarget.heading - Math.PI / 2;
      this.dispatchEvent(new CustomEvent('update', { detail: this.editTarget }));

    } else if (e.key === 'Escape') {
      this.mode = null;
      this.editTarget = null;

    } else if ((e.key === 'Delete') && this.editTarget) {
      const annotation = this.editTarget;
      this.editableCuboids.delete(this.editTarget!);
      this.dispatchEvent(new CustomEvent('delete', { detail: annotation }));

    } else if (e.key === 'c') {
      this.mode = 'create';
    }
  }
}
