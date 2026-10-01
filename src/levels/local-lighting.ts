/** Shared amber flame color; strength and reach distinguish sources, never temperature. */
const flameColor = '#ffad55';

/** Flame-light recipes shared by all areas. Placement and models remain area-owned. */
export const localLightRecipes = {
  campfire: { color: flameColor, intensity: 18, distance: 10, emitterHeight: .45, shadow: true, shadowRadius: 5, shadowIntensity: .95, flicker: .025 },
  torch: { color: flameColor, intensity: 12, distance: 8, emitterHeight: 1.6, shadow: true, shadowRadius: 4, shadowIntensity: .95, flicker: .035 },
  lantern: { color: flameColor, intensity: 7, distance: 7, emitterHeight: 1.2, shadow: false, shadowRadius: 4, shadowIntensity: .8, flicker: .008 },
} as const;
export type LocalLightRole = keyof typeof localLightRecipes;
export type LocalLightDefinition = { role?: LocalLightRole; color?: string; intensity?: number; distance?: number; emitterHeight?: number; shadow?: boolean };
export function resolveLocalLight(definition: LocalLightDefinition) {
  const recipe = localLightRecipes[definition.role ?? 'campfire'];
  if (!recipe) throw new Error(`Unknown local light role: ${definition.role}`);
  return { ...recipe, color: definition.color ?? recipe.color, intensity: definition.intensity ?? recipe.intensity,
    distance: definition.distance ?? recipe.distance, emitterHeight: definition.emitterHeight ?? recipe.emitterHeight,
    shadow: definition.shadow ?? recipe.shadow };
}
