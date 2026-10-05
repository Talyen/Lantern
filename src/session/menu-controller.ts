type Menu = { readonly paused: boolean; close(): void };
type Menus = {
  readonly smithing: Menu;
  readonly shop: Menu;
  readonly adventure: Menu & { openInventory(): void };
  readonly skills: Menu & { open(): void };
  readonly bindings: Menu;
  readonly options: (Menu & { open(): void }) | undefined;
};
const menuOrder = ['smithing', 'bindings', 'skills', 'adventure', 'shop', 'options'] as const;

/** Resolves menus lazily because input is wired before startup finishes creating them. */
export class MenuController {
  constructor(private readonly menus: Menus, private readonly canOpen: () => boolean) {}

  get paused(): boolean {
    for (const name of menuOrder) if (this.menus[name]?.paused) return true;
    return false;
  }

  close(): void {
    for (const name of menuOrder) {
      const menu = this.menus[name];
      if (menu?.paused) menu.close();
    }
  }

  toggleOptions(): void {
    if (this.paused) this.close();
    else this.menus.options?.open();
  }

  toggleInventory(): void {
    const { adventure } = this.menus;
    if (adventure.paused || this.menus.shop.paused) { this.close(); return; }
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
