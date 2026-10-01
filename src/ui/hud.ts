import * as THREE from 'three';
import { playerMaxHealth, enemyMaxHealth, playerMaxMana, type Encounter, type EncounterEvent } from '../gameplay/encounter';
import './orbs.css';

export function createHud(onRetry: () => void, onInspect: () => void) {
  const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const status = element<HTMLParagraphElement>('asset-status');
  const rockFocus = element<HTMLButtonElement>('rock-focus');
  const playerHealth = element<HTMLDivElement>('player-health');
  const playerMana = element<HTMLDivElement>('player-mana');
  const enemyHealth = element<HTMLDivElement>('enemy-health');
  const resultPanel = element<HTMLDivElement>('result-panel');
  const resultTitle = element<HTMLHeadingElement>('result-title');
  const resultCopy = element<HTMLParagraphElement>('result-copy');
  const retry = element<HTMLButtonElement>('retry');
  const anchor = new THREE.Vector3();
  let damagedFor = 0, safe = false;
  function resource(orb: HTMLElement, name: string, value: number, max: number): void {
    const count = Math.max(0, Math.min(max, value));
    orb.style.setProperty('--fill', String(count / max));
    orb.dataset.empty = String(count === 0);
    orb.setAttribute('aria-valuenow', String(count));
    orb.setAttribute('aria-valuetext', `${Math.ceil(count)} / ${max}`);
    orb.title = `${name} · ${Math.ceil(count)} / ${max}`;
  }
  function finish(won: boolean): void {
    resultTitle.textContent = won ? 'Victory' : 'Defeat'; resultCopy.textContent = '';
    retry.hidden = won; resultPanel.hidden = false;
  }
  retry.addEventListener('click', onRetry);
  rockFocus.addEventListener('click', onInspect);
  return {
    update(encounter: Encounter, events: EncounterEvent[]) {
      for (const event of events) {
        if (event.type === 'hit' && event.actor === 'enemy') damagedFor = 3;
        else if (event.type === 'outcome') finish(event.won);
      }
      resource(playerHealth, 'Health', encounter.player.hp, playerMaxHealth);
      resource(playerMana, 'Mana', encounter.playerMana, playerMaxMana);
      enemyHealth.setAttribute('aria-valuenow', String(Math.max(0, encounter.enemy.hp)));
      enemyHealth.firstElementChild!.setAttribute('style', `width:${Math.max(0, encounter.enemy.hp) / enemyMaxHealth * 100}%`);
      if (encounter.enemy.hp <= 0) { damagedFor = 0; enemyHealth.hidden = true; }
    },
    positionEnemy(encounter: Encounter, camera: THREE.Camera, mount: HTMLElement, dt: number, obscured: boolean) {
      damagedFor = Math.max(0, damagedFor - dt);
      anchor.set(encounter.enemy.x, encounter.enemy.y + 1.8, encounter.enemy.z).project(camera);
      enemyHealth.hidden = safe || obscured || encounter.enemy.hp <= 0 || damagedFor <= 0 || Math.abs(anchor.x) > 1 || Math.abs(anchor.y) > 1 || Math.abs(anchor.z) > 1;
      if (!enemyHealth.hidden) enemyHealth.style.transform = `translate(${(anchor.x + 1) * mount.clientWidth / 2}px, ${(1 - anchor.y) * mount.clientHeight / 2}px) translate(-50%, -100%)`;
    },
    setSafe(value: boolean) { safe = value; if (safe) enemyHealth.hidden = true; },
    dismissResult: () => { resultPanel.hidden = true; },
    reset: () => { resultPanel.hidden = true; damagedFor = 0; enemyHealth.hidden = true; },
    setRetryEnabled: (enabled: boolean) => { retry.disabled = !enabled; },
    setInspection: (active: boolean) => { rockFocus.hidden = !active; rockFocus.textContent = 'Return'; },
    environmentLoaded(count: number, rocks: boolean) { status.textContent = count === 3 ? '' : 'Missing environment art.'; rockFocus.disabled = !rocks; },
    characterUnavailable() { status.textContent = 'Character art unavailable. Run npm run assets:export-character to prepare playable art.'; },
    setAssetStatus: (message: string) => { status.textContent = message; },
  };
}
