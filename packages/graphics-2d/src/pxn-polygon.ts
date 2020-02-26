/**
 * Implementation of polygon canvas editor.
 * @copyright CEA-LIST/DIASI/SIALV/LVA (2019)
 * @author CEA-LIST/DIASI/SIALV/LVA <pixano@cea.fr>
 * @license CECILL-C
 */

import { customElement } from 'lit-element';
import { Canvas2d } from './pxn-canvas-2d';
import { ShapesManager } from './shapes-manager';
import { Shape, PolygonShape, Decoration } from './shapes-2d';
import { ShapeData } from './types';
import { observable } from '@pixano/core';
import { insertMidNode } from './utils';

function getFlattenVertices(s: ShapeData["geometry"]): number[][] {
    if (s.type === 'multi_polygon') {
        return s.mvertices!.map((v) => {
            return v;
        }) as number[][];
    } else {
        return [s.vertices];
    }
}

/**
 * Inherit Canvas2d to handle polygons.
 */
@customElement('pxn-polygon' as any)
export class Polygon extends Canvas2d {

    protected createShapeManager() {
        const shManager = new PolygonsManager(this.renderer, this.shapes);
        return shManager;
    }

    protected initShapeManagerListeners() {
        super.initShapeManagerListeners();
        this.shManager.on('creating-polygon', () => {
            this.showTooltip('Press Enter or double click to close polygon. Escape to cancel.')
        });
    }

    /**
     * Group selected shapes into a single
     * multi polygon.
     */
    merge() {
        if (this.shManager.targetShapes.size > 1) {
            const shapes = [...this.shManager.targetShapes];
            // split all selected groups
            const newAnn: ShapeData = shapes.reduce((prev, curr) => {
                // update geometry
                const currVertices = getFlattenVertices(curr.geometry);
                return {
                    ...prev,
                    id: prev.id + curr.id,
                    geometry: {
                        ...prev.geometry,
                        mvertices: [...prev.geometry.mvertices!, ...currVertices]
                    }
                };
            }, {
                ...shapes[0],
                geometry: {
                    mvertices: [],
                    vertices: [],
                    type: 'multi_polygon'
                }
            });
            this.shapes.add(observable(newAnn));
            shapes.forEach((s) => {
                this.shapes.delete(s);
            });
        }
    }

    /**
     * Split multi polygon
     * into multiple polygons.
     */
    split() {
        if (this.shManager.targetShapes.size === 1) {
        const shape = this.shManager.targetShapes.values().next().value;
        if (shape.geometry.type === 'multi_polygon') {
            shape.geometry.mvertices.forEach((v: number[], idx: number) => {
                this.shapes.add(observable({
                    ...shape,
                    id: shape.id + String(idx),
                    geometry: {
                        mvertices: [],
                        vertices: v,
                        type: 'polygon'
                    }
                }));
            });
            this.shapes.delete(shape);
        }

        }
    }
}

/**
 * Inherit ShapesManager to handle polygon shapes.
 */
class PolygonsManager extends ShapesManager {

    private isDbClick: number = -1;

    private activeNodeIdx: number = -1;

    private isNodeTranslating: boolean = false;

    private isMidNodeTranslating: boolean = false;

    public setMode(mode: string) {
        super.setMode(mode);
        if (mode === 'create') {
            this.renderer.stage.interactive = true;
            // this.renderer.stage.removeAllListeners();
            this.renderer.objects.forEach((o) => {
                this.applyMode(o);
            });
        } else {
            const shape = this.tmpShape as PolygonShape;
            if (shape) {
                this.removeChild(shape);
                shape.destroy();
                this.tmpShape = null;
            }
        }
    }

    protected applyNodeState(obj: PolygonShape) {
        obj.controls.forEach((c) => {
            c.interactive = false;
            c.buttonMode = false;
        });
        if (obj.data.geometry.type === 'polygon') {
            obj.addNodeListener('pointerdown', (evt: any) => {
                evt.stopPropagation();
                this.onNodeDown(evt);
            });
            obj.addMidnodeListener('pointerdown', (evt: any) => {
                evt.stopPropagation();
                this.onMidNodeDown(evt);
            });
        }
    }

    protected toggle(obj: PolygonShape): PolygonShape {
        if (obj.state === Decoration.Box) {
            obj.state = Decoration.Nodes;
            this.applyNodeState(obj);
        } else if (obj.state === Decoration.Nodes) {
            obj.state = Decoration.Box;
        }
        obj.draw();
        return obj;
    }

    protected applyMode(s: Shape) {
        if (this.mode === 'update') {
            s.interactive = true;
            s.removeAllListeners('pointerdown');
            s.on('pointerdown', this.onObjectDown.bind(this));
            // const selType = this.targetIds.size <= 1 ? Decoration.Box: Decoration.Contour;
            // // only one is selected
            // this.renderer.objects.forEach((o) => {
            //     if (this.targetIds.has(o.data.id)) {
            //         o.state = selType;
            //         if (selType === Decoration.Box) {
            //             o.controls.forEach((c, idx) => {
            //                 c.removeAllListeners();
            //                 c.on('pointerdown', (evt: any) => {
            //                     evt.stopPropagation();
            //                     evt.idx = idx;
            //                     this.onControlDown(evt);
            //                 });
            //             });
            //         }
            //     } else {
            //         o.state = Decoration.None;
            //     }
            //     o.draw();
            // });
        } else if (this.mode === 'create') {
            s.interactive = false;
            s.removeAllListeners('pointerdown');
        }
    }

    protected onKeyDownCreate = (event: KeyboardEvent) => {
        switch (event.key) {
            case 'Enter': {
                // close path and create object
                this.isCreating = false;
                if (this.updated) {
                    this.updated = false;
                    this.createPolygon();
                }
                window.removeEventListener('keydown', this.onKeyDownCreate.bind(this), false);
                break;
            }
            case 'Escape': {
                // abort creation of the shape
                this.isCreating = false;
                if (this.updated && this.tmpShape) {
                    this.updated = false;
                    this.removeChild(this.tmpShape);
                    this.tmpShape.destroy();
                    this.tmpShape = null;
                    break;
                }
                window.removeEventListener('keydown', this.onKeyDownCreate.bind(this), false);
                break;
            }
            case 'Backspace': {
                // delete last node
                const obj = this.tmpShape as PolygonShape;
                if (obj.data.geometry.vertices.length > 6) {
                    obj.popNode(false);
                }
            }
        }
    }

    protected onRootDown(evt: any) {
        super.onRootDown(evt);
        if (this.mode === 'create' && evt.data.originalEvent.buttons !== 2) {
            this.isCreating = true;
            const mouseData = evt.data.getLocalPosition(this.renderer.stage);
            this.mouseX = mouseData.x  / this.renderer.imageWidth;
            this.mouseY = mouseData.y  / this.renderer.imageHeight;
            this.mouseX = Math.max(Math.min(this.mouseX, 1), 0);
            this.mouseY = Math.max(Math.min(this.mouseY, 1), 0);
            const shape = this.tmpShape as PolygonShape;
            if (shape) {
                if(this.isDbClick >= 0 && (mouseData.x - shape.lastX)*(mouseData.x - shape.lastX) +
                    (mouseData.y - shape.lastY)*(mouseData.y - shape.lastY) < 2) {
                    this.updated = false;
                    this.createPolygon();
                    return;
                } else {
                    clearTimeout(this.isDbClick);
                    shape.pushNode(this.mouseX, this.mouseY);
                    // time for double click detection
                    this.isDbClick = window.setTimeout(() => { this.isDbClick = -1; }, 180);
                }
            } else {
                // start new polygon
                this.emit('creating-polygon');
                const data = observable({
                    id: 'tmp',
                    geometry: {
                        vertices: [this.mouseX, this.mouseY, this.mouseX, this.mouseY],
                        type: 'polygon'
                    },
                    color: 'red'
                } as ShapeData);
                this.tmpShape = new PolygonShape(data) as PolygonShape;
                window.addEventListener('keydown', this.onKeyDownCreate.bind(this), false);
                this.addChild(this.tmpShape);
                this.tmpShape.scaleX = this.renderer.imageWidth;
                this.tmpShape.scaleY = this.renderer.imageHeight;
                this.tmpShape.draw();
                this.renderer.stage.on('pointerupoutside', this.onRootUp.bind(this));
            }
        }
    }

    protected onRootMove(evt: any) {
        super.onRootMove(evt);
        if (this.mode === 'create') {
            const mouseData = evt.data.getLocalPosition(this.renderer.stage);
            this.mouseX = mouseData.x  / this.renderer.imageWidth;
            this.mouseY = mouseData.y  / this.renderer.imageHeight;
            this.mouseX = Math.max(Math.min(this.mouseX, 1), 0);
            this.mouseY = Math.max(Math.min(this.mouseY, 1), 0);
            if (this.isCreating) {
                const shape = this.tmpShape as PolygonShape;
                if (shape) {
                    if (!this.updated) {
                        this.updated = true;
                    }
                    shape.data.geometry.vertices[shape.data.geometry.vertices.length - 1] = this.mouseY;
                    shape.data.geometry.vertices[shape.data.geometry.vertices.length - 2] = this.mouseX;
                }
            }
        } else if (this.mode === 'update' && this.isMidNodeTranslating) {
            const newPos = evt.data.getLocalPosition(this.parent);
            let xN = newPos.x / this.renderer.imageWidth;
            let yN = newPos.y / this.renderer.imageHeight;
            xN = Math.max(0, Math.min(1, xN));
            yN = Math.max(0, Math.min(1, yN));
            const obj = this.targetShapes.values().next().value as ShapeData;
            if (!this.updated) {
                // insert a new polygon node
                this.updated = true;
                obj.geometry.vertices = insertMidNode(obj.geometry.vertices, this.activeNodeIdx);
                this.activeNodeIdx = (this.activeNodeIdx + 1) % (0.5 * obj.geometry.vertices.length);
            }
            if (obj) {
                obj.geometry.vertices[this.activeNodeIdx * 2] = xN;
                obj.geometry.vertices[this.activeNodeIdx * 2 + 1] = yN;
            }
        }
    }

    protected onRootUp() {
        super.onRootUp();
        if (this.isMidNodeTranslating) {
            this.isMidNodeTranslating = false;
            if (this.updated) {
                const obj = this.getFirstTargetObject() as PolygonShape;
                if (obj && !obj.isValid()) {
                    // cancel update;
                    console.warn('Invalid polygon. Node creation cancelled.');
                    obj.data.geometry.vertices = [...this.cachedShape!.geometry.vertices];
                } else if (obj) {
                    this.emit('update', [obj.data.id]);
                }
                this.updated = false;
            }
        }
    }

    public onNodeDown(evt: any) {
        const obj = this.getFirstTargetObject() as PolygonShape;
        if (evt.data.originalEvent.buttons !== 2) {
            this.activeNodeIdx = evt.nodeIdx;
            this.isNodeTranslating = true;
            const node = obj.nodes[this.activeNodeIdx];
            this.updated = false;
            node.removeAllListeners('pointermove');
            node.removeAllListeners('pointerupoutside');
            node.on('pointermove', this.onNodeMove.bind(this));
            node.on('pointerupoutside', this.onNodeUp.bind(this));
        } else {
            // remove node
            if (obj.data.geometry.vertices.length > 6) {
                obj.removeNode(evt.nodeIdx);
                this.emit('update', [obj.data.id]);
            }
        }
    }

    public onNodeMove(evt: any) {
        if (this.isNodeTranslating) {
            const newPos = evt.data.getLocalPosition(this.parent);
            let xN = newPos.x / this.renderer.imageWidth;
            let yN = newPos.y / this.renderer.imageHeight;
            xN = Math.max(0, Math.min(1, xN));
            yN = Math.max(0, Math.min(1, yN));
            const obj = this.targetShapes.values().next().value;
            if (!this.updated) {
                this.updated = true;
            }
            if (obj) {
                obj.geometry.vertices[this.activeNodeIdx * 2] = xN;
                obj.geometry.vertices[this.activeNodeIdx * 2 + 1] = yN;
            }
        }
    }

    public onNodeUp() {
        const obj = this.getFirstTargetObject() as PolygonShape;
        const node = obj.nodes[this.activeNodeIdx];
        node.removeAllListeners('pointermove');
        node.removeAllListeners('pointerupoutside');
        this.isNodeTranslating = false;
        if (this.updated) {
            if (obj && !obj.isValid()) {
                // cancel update;
                console.warn('Invalid polygon. Node creation cancelled.');
                obj.data.geometry.vertices = [...this.cachedShape!.geometry.vertices];
            } else {
                this.emit('update', [obj.data.id]);
            }
            this.updated = false;
        }
    }

    public onMidNodeDown(evt: any) {
        if (evt.data.originalEvent.buttons !== 2) {
            this.activeNodeIdx = evt.nodeIdx;
            this.isMidNodeTranslating = true;
        }
    }

    public createPolygon() {
        const shape = this.tmpShape as PolygonShape;
        shape.popNode();
        if (!shape.isValid()) {
            this.removeChild(shape);
            shape.destroy();
            this.tmpShape = null;
            return;
        }
        shape.data.id = Math.random().toString(36);
        this.shapes.add(shape.data);
        this.removeChild(shape);
        shape.destroy();
        this.tmpShape = null;
    }
}