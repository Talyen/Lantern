type Menu = { readonly paused: boolean; close(): void };
type Menus = {
  readonly smithing: Menu;
  readonly shop: Menu;
  readonly adventure: Menu & { openInventory(): void };
  readonly skills: Menu & { open(): void };
  readonly bindings: Menu;
  readonly options: (Menu & { open(): void }) | undefined;
};

/** Resolves menus lazily because input is wired before startup finishes creating them. */
export class MenuController {
  constructor(private readonly menus: Menus, private readonly canOpen: () => boolean) {}

  private all(): (Menu | undefined)[] {
    const { smithing, bindings, skills, adventure, shop, options } = this.menus;
    return [smithing, bindings, skills, adventure, shop, options];
  }

  get paused(): boolean { return this.all().some(menu => menu?.paused); }

  close(): void {
    for (const menu of this.all()) if (menu?.paused) menu.close();
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
