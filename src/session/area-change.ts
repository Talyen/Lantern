import type { SurfaceMode } from '../assets/environment-surfaces';
import type { Spawn } from '../gameplay/area';
import type { PortalLink } from '../gameplay/adventure';

export type AreaAppearance = { lantern?: boolean; surfaces?: SurfaceMode; shelterRestored?: boolean };
export type AreaTravel = {
  kind: 'travel';
  area: string;
  arrivalId?: string;
  transition?: boolean;
  spawn?: Spawn & { height?: number };
  recover?: boolean;
  consumePortal?: PortalLink;
  canCommit?: () => boolean;
};
export type AreaChange = AreaTravel | {
  kind: 'refresh';
  /** Rebuild the committed destination without entering or saving it again. */
  presentationOnly?: true;
  spawn?: Spawn;
  appearance?: AreaAppearance;
  canCommit?: () => boolean;
  onCommit?: () => void;
};

export type AreaChangeResult =
  | { status: 'cancelled' }
  | { status: 'failed'; error: unknown }
  | { status: 'committed'; readiness: 'ready' | 'superseded' }
  | { status: 'committed'; readiness: 'failed'; error: unknown };
