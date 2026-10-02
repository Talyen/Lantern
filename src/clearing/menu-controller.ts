import type { AdventureMenus } from '../ui/adventure';
import type { CombatUI } from '../ui/combat';
import type { KeybindingsMenu } from '../ui/keybindings';
import type { Options } from '../ui/options';

type Menus = {
  readonly adventure: Pick<AdventureMenus, 'paused' | 'close' | 'openInventory'>;
  readonly skills: Pick<CombatUI, 'paused' | 'close' | 'open'>;
  readonly bindings: Pick<KeybindingsMenu, 'paused' | 'close'>;
  readonly options: Pick<Options, 'paused' | 'close' | 'open'> | undefined;
};

/** Resolves menus lazily because input is wired before startup finishes creating them. */
export class MenuController {
  constructor(private readonly menus: Menus, private readonly canOpen: () => boolean) {}

  get paused(): boolean {
    const { adventure, skills, bindings, options } = this.menus;
    return Boolean(adventure.paused || skills.paused || bindings.paused || options?.paused);
  }

  close(): void {
    const { adventure, skills, bindings, options } = this.menus;
    if (bindings.paused) bindings.close();
    if (skills.paused) skills.close();
    if (adventure.paused) adventure.close();
    if (options?.paused) options.close();
  }

  toggleOptions(): void {
    if (this.paused) this.close();
    else this.menus.options?.open();
  }

  toggleInventory(): void {
    const { adventure } = this.menus;
    if (adventure.paused) { adventure.close(); return; }
    this.close();
    if (this.canOpen()) adventure.openInventory();
  }

  toggleSkills(): void {
    const { skills } = this.menus;
    if (skills.paused) { skills.close(); return; }
    this.close();
    if (this.canOpen()) skills.open();
  }
}
