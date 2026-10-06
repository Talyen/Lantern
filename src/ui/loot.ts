import * as THREE from 'three';
import { lootDefinitions } from '../gameplay/inventory';
import type { GroundDrop } from '../gameplay/ground-loot';

type LabelLayout = {
  label: HTMLButtonElement;
  x: number; y: number; w: number; h: number;
  left: number; right: number; top: number; bottom: number;
  placedX?: number; placedY?: number;
};

/** Name-only labels track the displayed camera; simulation owns range and collection. */
export class LootLabels {
  private root = document.createElement('div');
  private labels = new Map<string, LabelLayout>();
  private drops = new Map<string, GroundDrop>();
  private order: string[] = [];
  private visible: LabelLayout[] = [];
  hovered: string | null = null;
  private position = new THREE.Vector3();
  constructor(private host: HTMLElement, private select: (id: string) => void) { this.root.id = 'loot-labels'; host.append(this.root); }
  sync(drops: readonly GroundDrop[], camera: THREE.Camera, point: [number, number], hidden: boolean): void {
    if (this.root.hidden !== hidden) this.root.hidden = hidden;
    if (hidden) this.hovered = null;
    let changed = drops.length !== this.drops.size;
    // Rebuild membership in linear time; only changed membership needs sorting.
    for (const drop of drops) { if (!this.drops.has(drop.id)) changed = true; }
    this.drops.clear(); for (const drop of drops) this.drops.set(drop.id, drop);
    for (const [id, { label }] of this.labels) if (!this.drops.has(id)) { label.remove(); this.labels.delete(id); if (this.hovered === id) this.hovered = null; }
    if (changed) this.order = [...this.drops.keys()].sort((a, b) => a.localeCompare(b));
    this.visible.length = 0;
    if (!this.order.length) return;
    const width = this.host.clientWidth, height = this.host.clientHeight;
    const visible = this.visible;
    for (const id of this.order) {
      const drop = this.drops.get(id)!;
      let layout = this.labels.get(drop.id);
      if (!layout) {
        const label = document.createElement('button'); label.type = 'button'; label.className = 'loot-label'; label.dataset.drop = drop.id; label.textContent = drop.item === 'gold' ? 'Gold' : lootDefinitions[drop.item].name; label.classList.toggle('gold', drop.item === 'gold');
        label.onpointerdown = event => { if (event.button !== 0) return; event.preventDefault(); event.stopPropagation(); this.select(drop.id); };
        label.oncontextmenu = event => event.preventDefault();
        label.onclick = event => { event.preventDefault(); event.stopPropagation(); if (event.detail === 0) this.select(drop.id); };
        label.onpointerenter = () => { this.hovered = drop.id; }; label.onpointerleave = () => { if (this.hovered === drop.id) this.hovered = null; };
        this.root.append(label);
        layout = { label, x: 0, y: 0, w: 0, h: 0, left: 0, right: 0, top: 0, bottom: 0 };
        this.labels.set(drop.id, layout);
      }
      const { label } = layout;
      if (hidden) { if (!label.hidden) label.hidden = true; continue; }
      this.position.set(drop.position[0], drop.height + .4, drop.position[1]).project(camera);
      const onScreen = this.position.z >= -1 && this.position.z <= 1 && Math.abs(this.position.x) <= 1 && Math.abs(this.position.y) <= 1;
      const invisible = !onScreen || Math.hypot(point[0] - drop.position[0], point[1] - drop.position[1]) > 12;
      if (label.hidden !== invisible) label.hidden = invisible;
      if (label.hidden) { if (this.hovered === id) this.hovered = null; continue; }
      layout.x = (this.position.x + 1) * width / 2; layout.y = (1 - this.position.y) * height / 2;
      visible.push(layout);
    }
    // Finish DOM visibility writes before measuring, then batch all position writes.
    for (const row of visible) { row.w = row.label.offsetWidth; row.h = row.label.offsetHeight; }
    for (let index = 0; index < visible.length; index++) {
      const row = visible[index], { x: screenX, y: screenY, w, h } = row;
      const x = Math.max(w / 2 + 2, Math.min(width - w / 2 - 2, screenX));
      const anchorY = Math.max(h + 2, Math.min(height - 2, screenY));
      let y = anchorY;
      // Try nearby rows on both sides of the anchor, including near the top edge.
      for (let attempt = 0; attempt <= index * 2 + 2; attempt++) {
        const offset = Math.ceil(attempt / 2) * (h + 4) * (attempt % 2 ? -1 : 1);
        const candidate = anchorY + offset;
        if (candidate < h + 2 || candidate > height - 2) continue;
        let collision = false;
        for (let prior = 0; prior < index; prior++) {
          const r = visible[prior];
          if (x - w / 2 < r.right + 3 && x + w / 2 > r.left - 3 && candidate - h < r.bottom + 3 && candidate > r.top - 3) { collision = true; break; }
        }
        if (!collision) { y = candidate; break; }
      }
      row.x = x; row.y = y;
      row.left = x - w / 2; row.right = x + w / 2; row.top = y - h; row.bottom = y;
    }
    for (const row of visible) {
      const { label, x, y } = row, hovered = this.hovered === label.dataset.drop;
      if (row.placedX !== x) label.style.left = `${x}px`;
      if (row.placedY !== y) label.style.top = `${y}px`;
      row.placedX = x; row.placedY = y;
      if (label.classList.contains('hovered') !== hovered) label.classList.toggle('hovered', hovered);
    }
  }
  dispose(): void { this.root.remove(); this.labels.clear(); this.drops.clear(); this.order.length = 0; this.visible.length = 0; }
}
