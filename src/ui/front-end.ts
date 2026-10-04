import { readPreference, savePreference } from '../data/preferences';
import { validAdventureName, slotIds, type AdventureSlot, type SlotId } from '../gameplay/adventure-store';
import { areas } from '../levels/registry';
import { bindMenuDismissal } from './menu';
import './front-end.css';

type Context = { slots(): AdventureSlot[]; continue(slot: SlotId): void; create(slot: SlotId, name: string): void; delete(slot: SlotId): void; options(): void; sound(): void };
const selectedKey = 'lantern.adventures.selected.v1';

/** Selection/confirmation presentation only; the application owns slot and session changes. */
export class FrontEnd {
  private root = document.getElementById('front-end')!;
  private selected: SlotId = 1;
  private screen: 'title' | 'play' = 'title';
  private rows: HTMLButtonElement[] = [];
  private title: HTMLElement;
  private play: HTMLElement;
  private detailName: HTMLElement;
  private campfire: HTMLElement;
  private primary: HTMLButtonElement;
  private deleteButton: HTMLButtonElement;
  private loadError: HTMLElement;
  private naming: HTMLDialogElement;
  private deletion: HTMLDialogElement;
  private name: HTMLInputElement;
  private begin: HTMLButtonElement;
  private confirming: SlotId = 1;
  constructor(private ctx: Context) {
    const remembered = readPreference(selectedKey);
    if (slotIds.includes(remembered as SlotId)) this.selected = remembered as SlotId;
    this.root.innerHTML = `<section class="title-composition" aria-labelledby="title-heading">
      <img class="title-lantern" src="/assets/ui/loading/lantern.png" alt="" aria-hidden="true" />
      <h1 id="title-heading">Lantern</h1><div class="front-rule" aria-hidden="true"></div>
      <nav aria-label="Title"><button id="title-play" class="front-button front-primary" type="button">Play</button><button id="title-options" class="front-button" type="button">Options</button></nav>
      </section>
      <section class="play-composition front-frame" aria-labelledby="play-heading" hidden>
        <span class="front-corner" aria-hidden="true"></span><span class="front-corner" aria-hidden="true"></span><span class="front-corner" aria-hidden="true"></span><span class="front-corner" aria-hidden="true"></span>
        <header><h1 id="play-heading">Play</h1><button id="play-back" class="front-button" type="button">Back</button></header>
        <div class="front-rule" aria-hidden="true"></div><div class="play-columns"><div class="adventure-slots" role="listbox" aria-label="Adventures"></div>
          <section class="adventure-detail" aria-labelledby="adventure-name"><h2 id="adventure-name"></h2><div class="adventure-campfire"><span>Campfire</span><p></p></div>
            <p id="adventure-load-error" role="alert" hidden></p>
            <button id="adventure-primary" class="front-button front-primary" type="button"></button><button id="adventure-delete" class="front-button" type="button">Delete</button>
          </section></div></section>
      <dialog class="front-dialog front-frame" id="new-adventure-dialog" aria-labelledby="new-adventure-heading">
        <h2 id="new-adventure-heading">New Adventure</h2><div class="front-rule" aria-hidden="true"></div>
        <form><label for="adventure-name-input">Name</label><input id="adventure-name-input" name="name" maxlength="48" autocomplete="off" spellcheck="false" required />
        <p class="front-name-error" role="status" hidden></p><footer><button class="front-button" type="button" data-cancel>Cancel</button><button class="front-button front-primary" type="submit">Begin Adventure</button></footer></form>
      </dialog>
      <dialog class="front-dialog front-frame" id="delete-adventure-dialog" aria-labelledby="delete-adventure-heading" aria-describedby="delete-adventure-copy">
        <h2 id="delete-adventure-heading"></h2><div class="front-rule" aria-hidden="true"></div><p id="delete-adventure-copy">This removes all progress for this adventure.</p>
        <footer><button class="front-button" type="button" data-cancel>Cancel</button><button class="front-button front-delete" type="button" data-delete>Delete</button></footer>
      </dialog>`;
    const element = <T extends HTMLElement>(selector: string) => this.root.querySelector<T>(selector)!;
    this.title = element('.title-composition'); this.play = element('.play-composition');
    this.detailName = element('#adventure-name'); this.campfire = element('.adventure-campfire');
    this.primary = element('#adventure-primary'); this.deleteButton = element('#adventure-delete');
    this.loadError = element('#adventure-load-error');
    this.naming = element('#new-adventure-dialog'); this.deletion = element('#delete-adventure-dialog');
    this.name = element('#adventure-name-input'); this.begin = element('#new-adventure-dialog [type=submit]');
    for (const slot of slotIds) {
      const row = document.createElement('button'); row.type = 'button'; row.className = 'adventure-slot'; row.dataset.slot = String(slot); row.setAttribute('role', 'option');
      row.innerHTML = `<span class="slot-number">${slot}</span><span class="slot-name"></span><span class="slot-marker" aria-hidden="true">◆</span>`;
      row.onclick = () => { this.ctx.sound(); this.select(slot); };
      row.onkeydown = event => {
        const next = event.key === 'ArrowDown' ? (slot % 4) + 1 : event.key === 'ArrowUp' ? ((slot + 2) % 4) + 1 : event.key === 'Home' ? 1 : event.key === 'End' ? 4 : null;
        if (next !== null) { event.preventDefault(); this.select(next as SlotId); this.rows[next - 1].focus(); }
      };
      this.rows.push(row); element('.adventure-slots').append(row);
    }
    element('#title-play').onclick = () => { this.ctx.sound(); this.showPlay(); };
    element('#title-options').onclick = () => this.ctx.options();
    element('#play-back').onclick = () => { this.ctx.sound(); this.showTitle(); };
    this.primary.onclick = () => {
      this.ctx.sound();
      if (this.current().state !== 'empty') this.ctx.continue(this.selected);
      else { this.confirming = this.selected; this.name.value = ''; this.begin.disabled = true; element('.front-name-error').hidden = true; this.naming.showModal(); this.name.focus(); }
    };
    this.deleteButton.onclick = () => {
      this.ctx.sound(); this.confirming = this.selected;
      element('#delete-adventure-heading').textContent = `Delete ${this.current().name}?`;
      this.deletion.showModal(); element('#delete-adventure-dialog [data-cancel]').focus();
    };
    const cancelName = () => { this.naming.close(); this.primary.focus(); };
    const cancelDelete = () => { this.deletion.close(); this.deleteButton.focus(); };
    element('#new-adventure-dialog [data-cancel]').onclick = cancelName;
    element('#delete-adventure-dialog [data-cancel]').onclick = cancelDelete;
    bindMenuDismissal(this.naming, cancelName); bindMenuDismissal(this.deletion, cancelDelete);
    this.name.oninput = () => {
      const value = this.name.value.trim(); this.begin.disabled = !validAdventureName(value);
      const error = element('.front-name-error');
      error.hidden = !this.name.value || !this.begin.disabled;
      error.textContent = !value ? 'Enter a name.' : Array.from(value).length > 24 ? 'Use up to 24 characters.' : 'Use letters, numbers or punctuation.';
    };
    element<HTMLFormElement>('#new-adventure-dialog form').onsubmit = event => {
      event.preventDefault(); const name = this.name.value.trim();
      if (!validAdventureName(name)) return;
      this.naming.close(); this.ctx.sound(); this.ctx.create(this.confirming, name);
    };
    element('#delete-adventure-dialog [data-delete]').onclick = () => {
      this.deletion.close(); this.ctx.sound(); this.ctx.delete(this.confirming); this.refresh(); this.primary.focus();
    };
    this.root.addEventListener('keydown', event => {
      if (event.key === 'Escape' && this.screen === 'play' && !document.querySelector('dialog[open]')) { event.preventDefault(); this.showTitle(); }
    });
    this.refresh();
  }
  private current(): AdventureSlot { return this.ctx.slots().find(value => value.slot === this.selected)!; }
  private select(slot: SlotId): void { this.loadError.hidden = true; this.selected = slot; savePreference(selectedKey, slot); this.refresh(); }
  showLoadError(): void {
    this.showPlay();
    this.loadError.textContent = 'Saved progress could not be read. Try Continue again. Your saved files have been kept.';
    this.loadError.hidden = false;
    this.primary.focus();
  }
  refresh(): void {
    const slots = this.ctx.slots();
    this.rows.forEach((row, index) => {
      const value = slots[index], selected = value.slot === this.selected;
      row.querySelector('.slot-name')!.textContent = value.state === 'empty' ? 'Empty' : value.name;
      row.setAttribute('aria-selected', String(selected)); row.tabIndex = selected ? 0 : -1;
      row.querySelector<HTMLElement>('.slot-marker')!.hidden = !selected;
    });
    const current = this.current(), empty = current.state === 'empty';
    this.detailName.textContent = empty ? 'New Adventure' : current.name;
    this.primary.textContent = empty ? 'New Adventure' : 'Continue'; this.deleteButton.hidden = empty;
    this.campfire.hidden = empty || !current.checkpoint;
    if (current.checkpoint) {
      const fire = Object.values(areas).flatMap(area => (area.campfires ?? []).map(fire => ({ key: `${area.id}/${fire.id}`, name: fire.name }))).find(fire => fire.key === current.checkpoint);
      this.campfire.querySelector('p')!.textContent = fire?.name ?? 'Homestead';
    }
  }
  showTitle(): void { this.screen = 'title'; this.root.hidden = false; this.title.hidden = false; this.play.hidden = true; this.focus(); }
  showPlay(): void { this.screen = 'play'; this.loadError.hidden = true; this.root.hidden = false; this.title.hidden = true; this.play.hidden = false; this.refresh(); this.focus(); }
  hide(): void { this.root.hidden = true; }
  focus(): void { if (!this.root.hidden) (this.screen === 'title' ? this.root.querySelector<HTMLButtonElement>('#title-play')! : this.rows[this.selected - 1]).focus(); }
  focusOptions(): void { if (!this.root.hidden) this.root.querySelector<HTMLButtonElement>('#title-options')!.focus(); }
}
