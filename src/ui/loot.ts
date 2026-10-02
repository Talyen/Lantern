import * as THREE from 'three';
import { lootDefinitions } from '../gameplay/inventory';
import type { GroundDrop } from '../gameplay/adventure';

/** Name-only labels track the displayed camera; simulation owns range and collection. */
export class LootLabels {
  private root = document.createElement('div');
  private labels = new Map<string, HTMLButtonElement>();
  hovered: string | null = null;
  private position = new THREE.Vector3();
  constructor(private host: HTMLElement, private select: (id: string) => void) { this.root.id = 'loot-labels'; host.append(this.root); }
  sync(drops: GroundDrop[], camera: THREE.Camera, point: [number, number], hidden: boolean): void {
    this.root.hidden = hidden;
    for (const [id, label] of this.labels) if (!drops.some(d => d.id === id)) { label.remove(); this.labels.delete(id); if (this.hovered === id) this.hovered = null; }
    const rows: { left: number; right: number; top: number; bottom: number }[] = [];
    const width = this.host.clientWidth, height = this.host.clientHeight;
    for (const drop of [...drops].sort((a, b) => a.id.localeCompare(b.id))) {
      let label = this.labels.get(drop.id);
      if (!label) {
        label = document.createElement('button'); label.type = 'button'; label.className = 'loot-label'; label.dataset.drop = drop.id; label.textContent = lootDefinitions[drop.item].name;
        label.onpointerdown = event => { event.preventDefault(); event.stopPropagation(); this.select(drop.id); };
        label.onclick = event => { event.preventDefault(); event.stopPropagation(); if (event.detail === 0) this.select(drop.id); };
        label.onpointerenter = () => { this.hovered = drop.id; }; label.onpointerleave = () => { if (this.hovered === drop.id) this.hovered = null; };
        this.root.append(label); this.labels.set(drop.id, label);
      }
      this.position.set(drop.position[0], drop.height + .4, drop.position[1]).project(camera);
      const onScreen = this.position.z >= -1 && this.position.z <= 1 && Math.abs(this.position.x) <= 1 && Math.abs(this.position.y) <= 1;
      label.hidden = hidden || !onScreen || Math.hypot(point[0] - drop.position[0], point[1] - drop.position[1]) > 12;
      if (label.hidden) continue;
      const w = label.offsetWidth, h = label.offsetHeight;
      const x = Math.max(w / 2 + 2, Math.min(width - w / 2 - 2, (this.position.x + 1) * width / 2));
      const anchorY = Math.max(h + 2, Math.min(height - 2, (1 - this.position.y) * height / 2));
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
      label.style.left = `${x}px`; label.style.top = `${y}px`; label.classList.toggle('hovered', this.hovered === drop.id);
    }
  }
  dispose(): void { this.root.remove(); this.labels.clear(); }
}
