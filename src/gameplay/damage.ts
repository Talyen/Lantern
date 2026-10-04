/** Damage vocabulary is independent of delivery and statuses: Burn need not apply Burning. */
export const damageTypes = ['physical','burn','freeze','poison','bleed','nature'] as const;
export type DamageType = typeof damageTypes[number];
export const damageNames:Record<DamageType,string> = {physical:'Physical',burn:'Burn',freeze:'Freeze',poison:'Poison',bleed:'Bleed',nature:'Nature'};
/** Stun is loss of control. Its first applying attack will own duration and resistance. */
export type ControlEffect = 'stun';
export const isDamageType = (value:unknown):value is DamageType => damageTypes.some(type=>type===value);
