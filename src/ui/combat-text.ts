import * as THREE from 'three';
import type { AdventureEvent } from '../gameplay/adventure';
import type { ActorId, EncounterEvent } from '../gameplay/encounter';
import { readCombatTextSettings, type CombatTextSettings } from './combat-text-settings';
import './combat-text.css';

type Category = 'outgoing' | 'incoming' | 'healing';
type Position = { x: number; y: number; z: number };
type Group = {
  root: HTMLDivElement; value: HTMLSpanElement; caption: HTMLSpanElement;
  actor: ActorId; category: Category; position: Position; age: number; lane: number; blocked: boolean;
};
const formatAmount = (amount: number): string => amount < .05 ? '<0.1' : String(Math.round(amount * 10) / 10);

/** Committed outcome text: fixed world anchors, bounded DOM nodes and gameplay-time motion. */
export class CombatText {
  private root = document.createElement('div');
  private groups: Group[] = [];
  private spare: Group[] = [];
  private lanes = new Map<ActorId, number>();
  private projected = new THREE.Vector3();
  private settings = readCombatTextSettings();
  private reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  private campfire = { amount: 0, elapsed: 0 };
  constructor(private mount: HTMLElement) {
    this.root.className = 'combat-text'; this.root.setAttribute('aria-hidden', 'true');
    this.root.dataset.size = this.settings.size; mount.append(this.root);
  }
  apply(settings: CombatTextSettings): void {
    this.settings = { ...settings }; this.root.dataset.size = settings.size;
    for (const group of [...this.groups]) {
      if (!settings[group.category] && !(group.blocked && settings.blocks)) this.retire(group);
      else this.label(group);
    }
    if (!settings.healing) this.campfire = { amount: 0, elapsed: 0 };
  }
  encounter(events: EncounterEvent[]): void {
    for (const event of events) if (event.type === 'impact' && event.damage > 0) {
      this.spawn(event.actor, event.actor === 'player' ? 'incoming' : 'outgoing', event.damage, event.position, event.blocked);
    }
  }
  adventure(events: AdventureEvent[]): void {
    for (const event of events) if (event.type === 'healthRecovered') {
      if (!this.settings.healing) continue;
      if (event.source === 'potion') this.spawn('player', 'healing', event.amount, event.position);
      else {
        this.campfire.amount += event.amount; this.campfire.elapsed += event.elapsed;
        if (this.campfire.elapsed >= 1 || event.finished) {
          this.spawn('player', 'healing', this.campfire.amount, event.position);
          this.campfire = { amount: 0, elapsed: 0 };
        }
      }
    }
  }
  private label(group: Group): void {
    group.value.hidden = !this.settings[group.category];
    group.caption.hidden = !group.blocked || !this.settings.blocks;
  }
  private spawn(actor: ActorId, category: Category, amount: number, position: Position, blocked = false): void {
    if (!Number.isFinite(amount) || amount <= 0 || !this.settings[category] && !(blocked && this.settings.blocks)) return;
    const sameActor = this.groups.filter(group => group.actor === actor);
    if (sameActor.length >= 4) this.retire(sameActor[0]);
    if (this.groups.length >= 32) this.retire(this.groups.find(group => group.category === 'outgoing') ?? this.groups[0]);
    let group = this.spare.pop();
    if (!group) {
      const root = document.createElement('div'), value = document.createElement('span'), caption = document.createElement('span');
      root.className = 'combat-text-group'; value.className = 'combat-text-value'; caption.className = 'combat-text-caption'; caption.textContent = 'Blocked';
      root.append(value, caption); this.root.append(root);
      group = { root, value, caption, actor, category, position, age: 0, lane: 0, blocked };
    }
    const lane = this.lanes.get(actor) ?? 0; this.lanes.set(actor, (lane + 1) % 3);
    Object.assign(group, { actor, category, position: { ...position }, age: 0, lane, blocked });
    group.root.dataset.category = category;
    group.value.textContent = `${category === 'incoming' ? '−' : category === 'healing' ? '+' : ''}${formatAmount(amount)}`;
    group.root.hidden = true; this.label(group); this.groups.push(group);
  }
  private retire(group: Group): void {
    group.root.hidden = true; this.groups.splice(this.groups.indexOf(group), 1); this.spare.push(group);
  }
  update(camera: THREE.Camera, dt: number, obscured: boolean): void {
    this.root.hidden = obscured;
    const width = this.mount.clientWidth, height = this.mount.clientHeight;
    for (const group of [...this.groups]) {
      group.age += dt;
      const duration = group.category === 'healing' ? .9 : .8;
      if (group.age >= duration) { this.retire(group); continue; }
      const incoming = group.category === 'incoming';
      // Outgoing lanes begin above the 1.8m enemy bar and drift away from it.
      this.projected.set(group.position.x, group.position.y + (group.category === 'outgoing' ? 1.8 : 1.5), group.position.z).project(camera);
      group.root.hidden = Math.abs(this.projected.x) > 1 || Math.abs(this.projected.y) > 1 || Math.abs(this.projected.z) > 1;
      if (group.root.hidden || obscured) continue;
      const progress = group.age / duration;
      const laneX = [-34, 34, 0][group.lane];
      const laneY = (group.category === 'outgoing' ? -32 : 0) + [0, -8, -18][group.lane];
      const driftX = this.reducedMotion.matches ? 0 : (incoming ? (group.lane === 0 ? -12 : 12) * progress : 0);
      const driftY = this.reducedMotion.matches ? 0 : (incoming ? 24 : -36) * progress;
      const pop = this.reducedMotion.matches || group.category === 'healing' ? 1 : 1 + .12 * Math.max(0, 1 - Math.abs(group.age - .08) / .08);
      const x = (this.projected.x + 1) * width / 2 + laneX + driftX;
      const y = (1 - this.projected.y) * height / 2 + laneY + driftY;
      group.root.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${pop})`;
      group.root.style.opacity = String(group.age <= .5 ? 1 : Math.max(0, (duration - group.age) / (duration - .5)));
    }
  }
  clear(): void {
    for (const group of [...this.groups]) this.retire(group);
    this.lanes.clear(); this.campfire = { amount: 0, elapsed: 0 };
  }
  dispose(): void { this.clear(); this.root.remove(); this.spare.length = 0; }
}
