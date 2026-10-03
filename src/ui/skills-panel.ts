import { weaponFamily } from '../gameplay/equipment';
import { abilities, abilityIds, abilityUnlocked, type AbilityId } from '../gameplay/abilities';
import { skillCategories, skillDefinitions, skillLevel, earnsSkillXP, type Skill, type SkillCategory } from '../gameplay/skills';
import { nodesForSkill, type SkillNode } from '../gameplay/skill-nodes';
import type { CharacterSave } from '../gameplay/character';
import { skillIcon, skillNodeIcon } from './skill-icons';
import { abilityIcon } from './ability-icons';
import './skills.css';

type Context = {
  dialog: HTMLDialogElement;
  character(): CharacterSave;
  canEdit(): boolean;
  abilityInfo(id: AbilityId): string;
  beginDrag(id: AbilityId, event: PointerEvent): void;
  assignSlot(index: number, id: AbilityId): void;
  close(): void;
};
/** Screen presentation only; progression and assignments remain gameplay-owned. */
export class SkillsPanel {
  readonly panel = document.createElement('section');
  private tabs = document.createElement('nav');
  private heading = document.createElement('div');
  private tree = document.createElement('div');
  private track = document.createElement('div');
  private roots = document.createElement('nav');
  private notice = document.createElement('p');
  private tip = document.createElement('div');
  private picker = document.createElement('section');
  private pickerTarget: HTMLButtonElement | null = null;
  private tipTarget: HTMLElement | null = null;
  private category: SkillCategory = 'Combat';
  private skill: Skill = 'sword';
  private categorySelection: Partial<Record<SkillCategory, Skill>> = {};
  private displayedLevel = -1;
  constructor(private readonly ctx: Context) {
    const family = weaponFamily(ctx.character().loadout.main);
    this.skill = family === 'axe' ? 'axeCombat' : family ?? 'sword';
    this.panel.className = 'skills-sheet';
    const header = document.createElement('header');
    header.innerHTML = '<h2 id="skills-title">Skills</h2><button type="button" aria-label="Close Skills">×</button>';
    header.querySelector('button')!.onclick = () => ctx.close();
    this.tabs.className = 'skills-categories';
    this.tabs.setAttribute('role', 'tablist');
    this.tabs.setAttribute('aria-label', 'Skill categories');
    for (const category of skillCategories) {
      const button = document.createElement('button');
      button.type = 'button'; button.textContent = category; button.dataset.category = category;
      button.id = 'skills-tab-' + category; button.setAttribute('role', 'tab');
      button.setAttribute('aria-controls', 'skills-content');
      button.onclick = () => this.selectCategory(category);
      button.onkeydown = event => {
        const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
        if (!step && event.key !== 'Home' && event.key !== 'End') return;
        event.preventDefault();
        const index = event.key === 'Home' ? 0 : event.key === 'End' ? 3 : (skillCategories.indexOf(category) + step + 4) % 4;
        this.selectCategory(skillCategories[index]);
        this.tabs.querySelector<HTMLButtonElement>('[aria-selected="true"]')!.focus();
      };
      this.tabs.append(button);
    }
    const content = document.createElement('div');
    content.id = 'skills-content'; content.className = 'skills-content'; content.setAttribute('role', 'tabpanel');
    this.heading.className = 'skills-heading'; this.tree.className = 'skills-tree';
    this.tree.setAttribute('aria-label', 'Unlock nodes');
    this.track.className = 'skills-level-track'; this.track.setAttribute('role', 'img');
    this.roots.className = 'skills-roots'; this.roots.setAttribute('aria-label', 'Skills');
    this.notice.className = 'skills-notice'; this.notice.setAttribute('role', 'status');
    content.append(this.heading, this.tree, this.track, this.roots);
    this.panel.append(header, this.tabs, content, this.notice);
    this.tip.className = 'skills-tooltip'; this.tip.id = 'skills-node-tooltip'; this.tip.setAttribute('role', 'tooltip'); this.tip.hidden = true;
    this.picker.className = 'skills-picker'; this.picker.setAttribute('aria-label', 'Choose ability'); this.picker.hidden = true;
    ctx.dialog.append(this.panel, this.tip, this.picker);
    this.render();
  }
  private selectCategory(category: SkillCategory): void {
    this.categorySelection[this.category] = this.skill;
    this.category = category;
    this.skill = this.categorySelection[category] ?? skillDefinitions.find(skill => skill.category === category)!.id;
    this.render();
  }
  private render(): void {
    this.hideTooltip(); this.closePicker(false);
    this.ctx.dialog.querySelector('#skills-content')!.setAttribute('aria-labelledby', 'skills-tab-' + this.category);
    for (const tab of Array.from(this.tabs.querySelectorAll<HTMLButtonElement>('button'))) {
      const active = tab.dataset.category === this.category;
      tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1;
    }
    const definition = skillDefinitions.find(skill => skill.id === this.skill)!;
    this.heading.innerHTML = '<span class="skills-heading-icon">' + skillIcon(this.skill) + '</span><h3></h3><span class="skills-level"></span><span class="skills-progression-state"></span>';
    this.heading.querySelector('h3')!.textContent = definition.name;
    this.heading.querySelector('.skills-progression-state')!.textContent = earnsSkillXP(this.skill) ? '' : 'Progression not yet available';
    this.tree.replaceChildren();
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('skills-connections'); svg.setAttribute('viewBox', '0 0 1000 300'); svg.setAttribute('preserveAspectRatio', 'none'); svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    let line = 'M50 150H950';
    for (let gap = 0; gap < 5; gap++) line += ' M' + (140 + gap * 180) + ' 66V234';
    path.setAttribute('d', line); svg.append(path); this.tree.append(svg);
    const nodes = nodesForSkill(this.skill);
    nodes.major.forEach((node, index) => this.addNode(node, 5 + index * 18, 50));
    nodes.minor.forEach((node, index) => this.addNode(node, 14 + Math.floor(index / 2) * 18, index % 2 === 0 ? 22 : 78));
    this.roots.replaceChildren();
    const skills = skillDefinitions.filter(skill => skill.category === this.category);
    this.roots.style.setProperty('--skill-count', String(skills.length));
    for (const skill of skills) {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.skill = skill.id;
      button.innerHTML = '<span>' + skillIcon(skill.id) + '</span><span class="skills-root-name"></span>';
      button.querySelector('.skills-root-name')!.textContent = skill.name;
      button.setAttribute('aria-pressed', String(skill.id === this.skill));
      button.setAttribute('aria-label', skill.name + ', level ' + skillLevel(this.ctx.character().xp[skill.id]));
      button.onclick = () => { this.skill = skill.id; this.render(); this.roots.querySelector<HTMLButtonElement>('[aria-pressed="true"]')!.focus(); };
      this.roots.append(button);
    }
    this.displayedLevel = -1; this.update();
  }
  private addNode(node: SkillNode, x: number, y: number): void {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'skills-node ' + (node.kind === 'minor' ? 'minor' : 'major');
    button.dataset.node = node.id; button.dataset.kind = node.kind;
    button.style.left = x + '%'; button.style.top = y + '%';
    const unlocked = !node.ability || abilityUnlocked(node.ability, this.ctx.character().xp);
    button.classList.toggle('locked', !unlocked);
    button.innerHTML = '<span class="skills-node-art">' + skillNodeIcon(this.skill, node) + '</span>' +
      (node.ability && unlocked ? '' : '<span class="skills-lock" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M5 7V5a3 3 0 0 1 6 0v2M3 7h10v7H3zM8 10v2"/></svg></span>');
    button.classList.toggle('planned', !node.ability);
    if (node.kind !== 'minor') {
      const label = document.createElement('span'); label.className = 'skills-node-label';
      label.textContent = node.ability ? abilities[node.ability].name + (node.ability === 'berserking' ? ' · Lv ' + node.level : '') : node.role; button.append(label);
    }
    const info = () => node.ability ? [node.role, ...this.ctx.abilityInfo(node.ability).split(' · ').slice(1), node.ability === 'berserking' ? unlocked ? 'Unlocked at Axe level 2' : 'Requires Axe level 2 · 100 XP' : 'Available from the start'] :
      [node.role, 'Proposed level ' + node.level, node.kind === 'minor' ? 'Bonus not yet defined' : 'Not yet available'];
    button.setAttribute('aria-label', node.name + ', ' + info().join(', '));
    button.onmouseenter = button.onfocus = () => this.showTooltip(button, node.name, info());
    button.onmouseleave = () => { if (document.activeElement !== button) this.hideTooltip(); };
    button.onblur = () => this.hideTooltip();
    button.onclick = () => this.showTooltip(button, node.name, info());
    button.onpointerdown = event => {
      if (event.button === 0 && node.ability && abilityUnlocked(node.ability, this.ctx.character().xp) && this.ctx.canEdit()) { this.hideTooltip(); this.ctx.beginDrag(node.ability, event); }
    };
    this.tree.append(button);
  }
  private showTooltip(target: HTMLElement, name: string, lines: string[]): void {
    this.hideTooltip();
    const title = document.createElement('strong'); title.textContent = name; this.tip.replaceChildren(title);
    for (const line of lines) { const row = document.createElement('div'); row.textContent = line; this.tip.append(row); }
    this.tip.hidden = false; this.tipTarget = target; target.setAttribute('aria-describedby', this.tip.id);
    const rect = target.getBoundingClientRect(), size = this.tip.getBoundingClientRect();
    this.tip.style.left = Math.max(12, Math.min(window.innerWidth - size.width - 12, rect.right + 12)) + 'px';
    this.tip.style.top = Math.max(12, Math.min(window.innerHeight - size.height - 12, rect.top - size.height / 2)) + 'px';
  }
  hideTooltip(): void { this.tip.hidden = true; this.tipTarget?.removeAttribute('aria-describedby'); this.tipTarget = null; }
  showNotice(message: string): void { this.notice.textContent = message; }
  openPicker(target: HTMLButtonElement, slot: number): void {
    if (!this.ctx.canEdit()) { this.showNotice('Assignments unavailable in combat.'); return; }
    this.hideTooltip(); this.closePicker(false); this.pickerTarget = target;
    const heading = document.createElement('h3'); heading.textContent = 'Choose ability'; this.picker.replaceChildren(heading);
    for (const id of abilityIds.filter(id => abilityUnlocked(id, this.ctx.character().xp))) {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.ability = id;
      button.innerHTML = '<span>' + abilityIcon(id) + '</span><span></span>'; button.lastElementChild!.textContent = abilities[id].name;
      button.title = this.ctx.abilityInfo(id);
      button.onclick = () => {
        if (!this.ctx.canEdit()) { this.closePicker(); this.showNotice('Assignments unavailable in combat.'); return; }
        this.ctx.assignSlot(slot, id); this.closePicker();
      };
      this.picker.append(button);
    }
    this.picker.hidden = false;
    const rect = target.getBoundingClientRect(), size = this.picker.getBoundingClientRect();
    this.picker.style.left = Math.max(12, Math.min(window.innerWidth - size.width - 12, rect.left + rect.width / 2 - size.width / 2)) + 'px';
    this.picker.style.top = Math.max(12, rect.top - size.height - 12) + 'px';
    this.picker.querySelector('button')!.focus();
    this.picker.onkeydown = event => {
      if (!['ArrowDown','ArrowUp','Home','End'].includes(event.key)) return;
      event.preventDefault();
      const buttons = Array.from(this.picker.querySelectorAll('button')), index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length].focus();
    };
  }
  get pickerOpen(): boolean { return !this.picker.hidden; }
  closePicker(restore = true): void { this.picker.hidden = true; if (restore) this.pickerTarget?.focus(); this.pickerTarget = null; }
  prepare(): void { this.panel.hidden = false; this.showNotice(''); this.render(); }
  focusSelected(): void { this.roots.querySelector<HTMLButtonElement>('[aria-pressed="true"]')!.focus(); }
  update(): void {
    const level = skillLevel(this.ctx.character().xp[this.skill]);
    if (level === this.displayedLevel) return;
    if (this.displayedLevel >= 0) { this.render(); return; }
    this.displayedLevel = level; this.heading.querySelector('.skills-level')!.textContent = 'Level ' + level;
    this.track.replaceChildren(); this.track.setAttribute('aria-label', 'Level ' + level + '; milestones 10, 20, 30, 40, 50');
    for (const milestone of [10,20,30,40,50]) {
      const tick = document.createElement('span'); tick.className = 'skills-milestone'; tick.textContent = String(milestone);
      tick.style.left = (5 + (milestone - 1) / 49 * 90) + '%'; this.track.append(tick);
    }
    const marker = document.createElement('span'); marker.className = 'skills-level-marker';
    marker.style.left = (5 + Math.min(49, level - 1) / 49 * 90) + '%'; marker.title = 'Level ' + level; marker.setAttribute('aria-hidden','true'); this.track.append(marker);
  }
}
