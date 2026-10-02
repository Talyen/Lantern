import type { SurfaceMode } from '../assets/environment-surfaces';
import type { Spawn } from '../gameplay/area';

export type AreaAppearance = { lantern?: boolean; surfaces?: SurfaceMode; shelterRestored?: boolean };
export type AreaTravel = {
  kind: 'travel';
  area: string;
  arrivalId?: string;
  transition?: boolean;
  spawn?: Spawn & { height?: number };
  recover?: boolean;
  canCommit?: () => boolean;
};
export type AreaChange = AreaTravel | {
  kind: 'refresh';
  spawn?: Spawn;
  appearance?: AreaAppearance;
  canCommit?: () => boolean;
  onCommit?: () => void;
};
