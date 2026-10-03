import chrome from '../../assets/ui/hud/chrome-atlas.png';
import icons from '../../assets/ui/hud/icons-atlas.png';

const frames = { orb:[20,48,611,588], slot:[741,155,376,363], key:[66,850,486,135], utility:[779,676,305,430] } as const;
/** Atlas sampling keeps original bevels, glass and icon detail out of flattened UI text. */
export function hudFrame(kind:keyof typeof frames):string {
  const [x,y,w,h]=frames[kind];
  return `<span class="hud-frame hud-frame--${kind}" aria-hidden="true" style="background-image:url('${chrome}');background-size:${1254/w*100}% ${1254/h*100}%;background-position:${x/(1254-w)*100}% ${y/(1254-h)*100}%"></span>`;
}
export function hudIcon(kind:'sword'|'axe'|'bow'|'staff'|'shield'|'sweep'|'piercing-shot'|'potion'|'scroll'):string {
  const index={sword:0,axe:1,bow:2,staff:3,shield:4,sweep:5,'piercing-shot':6,potion:7,scroll:8}[kind];
  return `<span class="hud-icon" aria-hidden="true" style="background-image:url('${icons}');background-position:${index%3*50}% ${Math.floor(index/3)*50}%"></span>`;
}
