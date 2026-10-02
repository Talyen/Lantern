import { generateDecoration } from './decoration';
import { treeDefinitions, type TreeDefinition } from './trees';
import type { AreaDefinition } from './types';
import { gathering, type GatheringSkill } from '../gameplay/skills';
export type ResourceKind = 'tree' | 'stone' | 'iron';
export type ResourceDefinition = TreeDefinition & { kind: ResourceKind; level: number; baseYield: number; contacts: number };
export const resourceSkill = (kind: ResourceKind): GatheringSkill => kind === 'tree' ? 'woodcutting' : 'mining';
export const resourceItem = (kind: ResourceKind) => kind === 'tree' ? 'wood' as const : kind;
export function resourceDefinitions(area: AreaDefinition): ResourceDefinition[] {
  const props=[...area.props,...generateDecoration(area)];
  const metadata = (id: string) => props.find(p => p.id === id)?.harvest;
  const rules = (harvest?: NonNullable<AreaDefinition['props'][number]['harvest']>) => ({ level: harvest?.level ?? gathering.resourceLevel, baseYield: harvest?.baseYield ?? gathering.baseYield, contacts: harvest?.contacts ?? gathering.contacts });
  return [...treeDefinitions(area).map(t => ({ ...t, kind: 'tree' as const, ...rules(metadata(t.id)) })),
    ...props.filter(p => p.harvest && p.harvest.kind !== 'tree').map(p => ({ id: p.id, position: p.position, radius: p.harvest!.radius ?? .65, kind: p.harvest!.kind, ...rules(p.harvest) }))];
}
