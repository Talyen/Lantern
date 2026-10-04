import { hudFrame } from './hud-art';
import * as THREE from 'three';
import { enemyMaxHealth, type EnemyId, type Encounter, type EncounterEvent } from '../gameplay/encounter';
import './orbs.css';
import { CombatText } from './combat-text';
import type { CombatTextSettings } from './combat-text-settings';
import type { AdventureEvent } from '../gameplay/adventure';

export function createHud(onRetry: () => void) {
  const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const combatText = new CombatText(element<HTMLElement>('scene'));
  const status = element<HTMLParagraphElement>('asset-status');
  const playerHealth = element<HTMLDivElement>('player-health');
  const playerMana = element<HTMLDivElement>('player-mana');
  for (const orb of [playerHealth, playerMana]) {
    const number = document.createElement('span'); number.className = 'orb-number'; number.setAttribute('aria-hidden','true'); number.innerHTML='<strong></strong><small></small>'; orb.insertAdjacentHTML('afterbegin',hudFrame('orb')); orb.append(number);
  }
  const enemyHealth = element<HTMLDivElement>('enemy-health');
  const healthBars: Record<EnemyId, HTMLDivElement> = {};
  enemyHealth.hidden = true;
  const roster: EnemyId[] = [];
  const rosterMembers = new Set<EnemyId>();
  function bars(encounter: Encounter): void {
    const ids = encounter.enemyIds;
    // Compare values so in-place roster edits and reordered/replaced arrays work.
    let unchanged = roster.length === ids.length;
    for (let index = 0; unchanged && index < ids.length; index++) unchanged = roster[index] === ids[index];
    if (unchanged) return;
    rosterMembers.clear();
    for (const id of ids) rosterMembers.add(id);
    for (const id in healthBars) if (!rosterMembers.has(id)) { healthBars[id].remove(); delete healthBars[id]; delete enemyValues[id]; delete damagedFor[id]; delete enemyTransforms[id]; }
    for (const id of encounter.enemyIds) if (!healthBars[id]) {
      const bar = enemyHealth.cloneNode(true) as HTMLDivElement; bar.id = `health-${id}`;
      const enemy = encounter.enemies[id];
      bar.setAttribute('aria-label', `${enemy.rig === 'skeleton' ? enemy.kind === 'caster' ? 'Bone Caster' : 'Skeleton Warrior' : enemy.kind === 'caster' ? 'Caster' : 'Goblin'} health`);
      const condition=document.createElement('span'); condition.className='enemy-condition'; condition.textContent='Poison'; condition.hidden=true; bar.append(condition);
      enemyHealth.after(bar); healthBars[id] = bar; damagedFor[id] = 0;
    }
    roster.length = ids.length;
    for (let index = 0; index < ids.length; index++) roster[index] = ids[index];
  }
  const resultPanel = element<HTMLDivElement>('result-panel');
  const resultTitle = element<HTMLHeadingElement>('result-title');
  const resultCopy = element<HTMLParagraphElement>('result-copy');
  const retry = element<HTMLButtonElement>('retry');
  const anchor = new THREE.Vector3();
  const damagedFor: Record<EnemyId,number> = {};
  let safe = false;
  let showNumbers = true;
  const resources = new WeakMap<HTMLElement, { count: number; max: number }>();
  const enemyValues: Partial<Record<EnemyId, number>> = {};
  const enemyTransforms: Partial<Record<EnemyId, string>> = {};
  function resource(orb: HTMLElement, name: string, value: number, max: number): void {
    const count = Math.max(0, Math.min(max, value));
    const previous = resources.get(orb);
    if (previous?.count === count && previous.max === max) return;
    if (previous) { previous.count = count; previous.max = max; }
    else resources.set(orb, { count, max });
    orb.style.setProperty('--fill', String(count / max));
    orb.dataset.empty = String(count === 0);
    orb.setAttribute('aria-valuemax',String(max));
    orb.setAttribute('aria-valuenow', String(count));
    orb.setAttribute('aria-valuetext', `${Math.ceil(count)} / ${max}`);
    orb.title = showNumbers ? `${name} · ${Math.ceil(count)} / ${max}` : name;
    orb.querySelector('.orb-number strong')!.textContent = String(Math.ceil(count));
    orb.querySelector('.orb-number small')!.textContent = `/ ${max}`;
    orb.dataset.low = String(count > 0 && count / max <= .25);
  }
  function finish(won: boolean): void {
    resultTitle.textContent = won ? 'Victory' : 'Defeat'; resultCopy.textContent = '';
    retry.hidden = won; resultPanel.hidden = false;
  }
  retry.addEventListener('click', onRetry);
  return {
    resourceNumbers(visible: boolean): void {
      showNumbers=visible;
      document.documentElement.dataset.resourceNumbers=String(visible);
      for(const [orb,name] of [[playerHealth,'Health'],[playerMana,'Mana']] as const) orb.title=visible ? `${name} · ${orb.getAttribute('aria-valuetext') ?? ''}` : name;
    },
    update(encounter: Encounter, events: EncounterEvent[]) {
      bars(encounter);
      combatText.encounter(events);
      for (const event of events) {
        if ((event.type === 'hit' || event.type === 'impact') && event.actor !== 'player') damagedFor[event.actor] = 3;
        else if (event.type === 'outcome') finish(event.won);
      }
      resource(playerHealth, 'Health', encounter.player.hp, encounter.stats.maxHealth);
      resource(playerMana, 'Mana', encounter.playerMana, encounter.stats.maxMana);
      for (const id of encounter.enemyIds) {
        const enemy=encounter.enemies[id], bar=healthBars[id];
        bar.querySelector<HTMLElement>('.enemy-condition')!.hidden=!enemy.poison || enemy.hp<=0;
        if (enemyValues[id] !== enemy.hp) {
          enemyValues[id] = enemy.hp;
          bar.setAttribute('aria-valuenow', String(Math.max(0, enemy.hp)));
          bar.firstElementChild!.setAttribute('style', `width:${Math.max(0, enemy.hp) / enemyMaxHealth * 100}%`);
        }
        if (enemy.hp <= 0) { damagedFor[id]=0; if (!bar.hidden) bar.hidden=true; }
      }
    },
    positionEnemy(encounter: Encounter, camera: THREE.Camera, mount: HTMLElement, dt: number, obscured: boolean) {
      combatText.update(camera, dt, obscured);
      let width: number | undefined, height = 0;
      for (const id of encounter.enemyIds) {
        const enemy=encounter.enemies[id], bar=healthBars[id];
        bar.querySelector<HTMLElement>('.enemy-condition')!.hidden=!enemy.poison || enemy.hp<=0;
        damagedFor[id] = Math.max(0, damagedFor[id] - dt);
        if (safe || obscured || !enemy.home || enemy.hp <= 0 || damagedFor[id] <= 0) {
          if (!bar.hidden) bar.hidden = true;
          continue;
        }
        anchor.set(enemy.x, enemy.y + 1.8, enemy.z).project(camera);
        const hidden = Math.abs(anchor.x) > 1 || Math.abs(anchor.y) > 1 || Math.abs(anchor.z) > 1;
        if (bar.hidden !== hidden) bar.hidden = hidden;
        if (hidden) continue;
        if (width === undefined) { width = mount.clientWidth; height = mount.clientHeight; }
        const transform = `translate(${(anchor.x + 1) * width / 2}px, ${(1 - anchor.y) * height / 2}px) translate(-50%, -100%)`;
        if (enemyTransforms[id] !== transform) { bar.style.transform = transform; enemyTransforms[id] = transform; }
      }
    },
    setSafe(value: boolean) { safe = value; if (safe) for (const bar of Object.values(healthBars)) bar.hidden=true; },
    dismissResult: () => { resultPanel.hidden = true; },
    reset: () => { combatText.clear(); resultPanel.hidden = true; for (const id of Object.keys(healthBars)) {damagedFor[id]=0;healthBars[id].hidden=true;} },
    adventure: (events: AdventureEvent[]) => combatText.adventure(events),
    applyCombatText: (settings: CombatTextSettings) => combatText.apply(settings),
    clearCombatText: () => combatText.clear(),
    dispose: () => { retry.removeEventListener('click', onRetry); combatText.dispose(); },
    environmentLoaded(count: number) { status.textContent = count === 3 ? '' : 'Missing environment art.'; },
    characterUnavailable() { status.textContent = 'Character art unavailable. Run npm run assets:export-character to prepare playable art.'; },
    setAssetStatus: (message: string) => { status.textContent = message; },
  };
}
