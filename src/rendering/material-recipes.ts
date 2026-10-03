import recipes from '../../assets/material-recipes.json';
export { recipes as materialRecipes };
export type MaterialFamily = keyof typeof recipes.families;
export type CalibrationFamily = 'stone' | 'bark' | 'ground';
export const calibrationStrengths = [0, 1, 1.5, 2] as const;
export function calibrationFamily(family: MaterialFamily): CalibrationFamily | undefined {
  if (family === 'stone' || family === 'bark') return family;
  if (family === 'earth' || family === 'litter' || family === 'rocky-soil') return 'ground';
  return undefined;
}
