import * as THREE from 'three';
import { lootDefinitions } from '../gameplay/inventory';
import type { GroundDrop } from '../gameplay/adventure';

/** Name-only labels track the displayed camera; simulation owns range and collection. */
export class LootLabels {
  private root = document.createElement('div');
  private labels = new Map<string, HTMLButtonElement>();
  private drops = new Map<string, GroundDrop>();
  private order: string[] = [];
  private placements = new WeakMap<HTMLButtonElement, { x: number; y: number }>();
  hovered: string | null = null;
  private position = new THREE.Vector3();
  constructor(private host: HTMLElement, private select: (id: string) => void) { this.root.id = 'loot-labels'; host.append(this.root); }
  sync(drops: GroundDrop[], camera: THREE.Camera, point: [number, number], hidden: boolean): void {
    if (this.root.hidden !== hidden) this.root.hidden = hidden;
    let changed = drops.length !== this.drops.size;
    // Rebuild membership in linear time; only changed membership needs sorting.
    for (const drop of drops) { if (!this.drops.has(drop.id)) changed = true; }
    this.drops.clear(); for (const drop of drops) this.drops.set(drop.id, drop);
    for (const [id, label] of this.labels) if (!this.drops.has(id)) { label.remove(); this.labels.delete(id); if (this.hovered === id) this.hovered = null; }
    if (changed) this.order = [...this.drops.keys()].sort((a, b) => a.localeCompare(b));
    if (!this.order.length) return;
    const rows: { left: number; right: number; top: number; bottom: number }[] = [];
    const width = this.host.clientWidth, height = this.host.clientHeight;
    const visible: { label: HTMLButtonElement; x: number; y: number }[] = [];
    for (const id of this.order) {
      const drop = this.drops.get(id)!;
      let label = this.labels.get(drop.id);
      if (!label) {
        label = document.createElement('button'); label.type = 'button'; label.className = 'loot-label'; label.dataset.drop = drop.id; label.textContent = lootDefinitions[drop.item].name;
        label.onpointerdown = event => { event.preventDefault(); event.stopPropagation(); this.select(drop.id); };
        label.onclick = event => { event.preventDefault(); event.stopPropagation(); if (event.detail === 0) this.select(drop.id); };
        label.onpointerenter = () => { this.hovered = drop.id; }; label.onpointerleave = () => { if (this.hovered === drop.id) this.hovered = null; };
        this.root.append(label); this.labels.set(drop.id, label);
      }
      if (hidden) { if (!label.hidden) label.hidden = true; continue; }
      this.position.set(drop.position[0], drop.height + .4, drop.position[1]).project(camera);
      const onScreen = this.position.z >= -1 && this.position.z <= 1 && Math.abs(this.position.x) <= 1 && Math.abs(this.position.y) <= 1;
      const invisible = !onScreen || Math.hypot(point[0] - drop.position[0], point[1] - drop.position[1]) > 12;
      if (label.hidden !== invisible) label.hidden = invisible;
      if (label.hidden) continue;
      visible.push({ label, x: (this.position.x + 1) * width / 2, y: (1 - this.position.y) * height / 2 });
    }
    // Finish DOM visibility writes before measuring, then batch all position writes.
    const measured = visible.map(row => ({ ...row, w: row.label.offsetWidth, h: row.label.offsetHeight }));
    const placements: { label: HTMLButtonElement; x: number; y: number }[] = [];
    for (const { label, x: screenX, y: screenY, w, h } of measured) {
      const x = Math.max(w / 2 + 2, Math.min(width - w / 2 - 2, screenX));
      const anchorY = Math.max(h + 2, Math.min(height - 2, screenY));
      let y = anchorY;
      // Try nearby rows on both sides of the anchor, including near the top edge.
      for (let attempt = 0; attempt <= rows.length * 2 + 2; attempt++) {
        const offset = Math.ceil(attempt / 2) * (h + 4) * (attempt % 2 ? -1 : 1);
        const candidate = anchorY + offset;
        if (candidate < h + 2 || candidate > height - 2) continue;
        const collision = rows.some(r => x - w / 2 < r.right + 3 && x + w / 2 > r.left - 3 && candidate - h < r.bottom + 3 && candidate > r.top - 3);
        if (!collision) { y = candidate; break; }
      }
      rows.push({ left: x - w / 2, right: x + w / 2, top: y - h, bottom: y });
      placements.push({ label, x, y });
    }
    for (const { label, x, y } of placements) {
      const previous = this.placements.get(label), hovered = this.hovered === label.dataset.drop;
      if (previous?.x !== x) label.style.left = `${x}px`;
      if (previous?.y !== y) label.style.top = `${y}px`;
      if (previous?.x !== x || previous?.y !== y) this.placements.set(label, { x, y });
      if (label.classList.contains('hovered') !== hovered) label.classList.toggle('hovered', hovered);
    }
  }
  dispose(): void { this.root.remove(); this.labels.clear(); this.drops.clear(); this.order.length = 0; }
}
