import * as THREE from 'three';
import { playerMaxHealth, enemyMaxHealth, playerMaxMana, enemyIds, type EnemyId, type Encounter, type EncounterEvent } from '../gameplay/encounter';
import './orbs.css';

export function createHud(onRetry: () => void) {
  const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const status = element<HTMLParagraphElement>('asset-status');
  const playerHealth = element<HTMLDivElement>('player-health');
  const playerMana = element<HTMLDivElement>('player-mana');
  const enemyHealth = element<HTMLDivElement>('enemy-health');
  const casterHealth = enemyHealth.cloneNode(true) as HTMLDivElement; casterHealth.id='caster-health'; casterHealth.setAttribute('aria-label','Caster health'); enemyHealth.after(casterHealth);
  const healthBars = {enemy:enemyHealth,caster:casterHealth};
  const resultPanel = element<HTMLDivElement>('result-panel');
  const resultTitle = element<HTMLHeadingElement>('result-title');
  const resultCopy = element<HTMLParagraphElement>('result-copy');
  const retry = element<HTMLButtonElement>('retry');
  const anchor = new THREE.Vector3();
  const damagedFor: Record<EnemyId,number> = {enemy:0,caster:0};
  let safe = false;
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
  return {
    update(encounter: Encounter, events: EncounterEvent[]) {
      for (const event of events) {
        if (event.type === 'hit' && event.actor !== 'player') damagedFor[event.actor] = 3;
        else if (event.type === 'outcome') finish(event.won);
      }
      resource(playerHealth, 'Health', encounter.player.hp, playerMaxHealth);
      resource(playerMana, 'Mana', encounter.playerMana, playerMaxMana);
      for (const id of enemyIds) {
        const enemy=encounter.enemies[id], bar=healthBars[id];
        bar.setAttribute('aria-valuenow', String(Math.max(0, enemy.hp)));
        bar.firstElementChild!.setAttribute('style', `width:${Math.max(0, enemy.hp) / enemyMaxHealth * 100}%`);
        if (enemy.hp <= 0) { damagedFor[id]=0; bar.hidden=true; }
      }
    },
    positionEnemy(encounter: Encounter, camera: THREE.Camera, mount: HTMLElement, dt: number, obscured: boolean) {
      for (const id of enemyIds) {
        const enemy=encounter.enemies[id], bar=healthBars[id];
        damagedFor[id] = Math.max(0, damagedFor[id] - dt);
        anchor.set(enemy.x, enemy.y + 1.8, enemy.z).project(camera);
        bar.hidden = safe || obscured || !enemy.home || enemy.hp <= 0 || damagedFor[id] <= 0 || Math.abs(anchor.x) > 1 || Math.abs(anchor.y) > 1 || Math.abs(anchor.z) > 1;
        if (!bar.hidden) bar.style.transform = `translate(${(anchor.x + 1) * mount.clientWidth / 2}px, ${(1 - anchor.y) * mount.clientHeight / 2}px) translate(-50%, -100%)`;
      }
    },
    setSafe(value: boolean) { safe = value; if (safe) for (const id of enemyIds) healthBars[id].hidden=true; },
    dismissResult: () => { resultPanel.hidden = true; },
    reset: () => { resultPanel.hidden = true; for (const id of enemyIds) {damagedFor[id]=0;healthBars[id].hidden=true;} },
    environmentLoaded(count: number) { status.textContent = count === 3 ? '' : 'Missing environment art.'; },
    characterUnavailable() { status.textContent = 'Character art unavailable. Run npm run assets:export-character to prepare playable art.'; },
    setAssetStatus: (message: string) => { status.textContent = message; },
  };
}
