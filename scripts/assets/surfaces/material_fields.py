"""Locally authored relief fields matching original painted surface marks.
Color is retained. Material-specific broad contrast and form fields describe
shallow relief, not a physical reconstruction of image brightness.
"""
import bpy, numpy as np, json
from pathlib import Path

ROUGH={'stone':.92,'bark':.95,'timber':.88,'foliage':.94,'cloth':.96,'leather':.82,'earth':.97,'litter':.94,'rocky-soil':.93}
RECIPES=json.loads((Path(__file__).resolve().parents[3]/'assets/material-recipes.json').read_text())
DEPTH={family:recipe['heightMetres'] for family,recipe in RECIPES['families'].items()}

def pixels(image):
    values=np.empty(len(image.pixels),dtype=np.float32);image.pixels.foreach_get(values)
    return values.reshape((image.size[1],image.size[0],4))

def blur(field,radius):
    fy=np.fft.fftfreq(field.shape[0])[:,None];fx=np.fft.rfftfreq(field.shape[1])[None,:]
    kernel=np.exp(-2*np.pi*np.pi*radius*radius*(fx*fx+fy*fy))
    return np.fft.irfft2(np.fft.rfft2(field)*kernel,s=field.shape).astype(np.float32)

def field_image(name,values,path=None):
    image=bpy.data.images.new(name,values.shape[1],values.shape[0],alpha=True)
    image.colorspace_settings.name='Non-Color';image.pixels.foreach_set(np.clip(values,0,1).ravel());image.update()
    if path:
        path=Path(path);path.parent.mkdir(parents=True,exist_ok=True);image.filepath_raw=str(path.resolve());image.file_format='PNG';image.save()
    return image

def author_fields(source,family,recipe=None):
    rgb=pixels(source)[:,:,:3];h,w=rgb.shape[:2]
    luma=rgb@np.array([.2126,.7152,.0722],dtype=np.float32)
    smooth=blur(luma,max(2,w*.003));broad=blur(luma,w*.022)
    contrast=(smooth-broad)/max(float(np.std(smooth-broad))*3,.02)
    form=(broad-float(np.mean(broad)))/max(float(np.std(broad))*3,.025)
    height=.5+np.clip(contrast,-1,1)*.19+np.clip(form,-1,1)*.1
    if family in ['bark','timber']:
        # Directional grain is structural; broad ridges supplement the painted flakes.
        x=np.arange(w,dtype=np.float32)[None,:]/w
        grain=np.sin(x*np.pi*16+blur(contrast,w*.015)*.7)
        height=height*.82+(.5+grain*.13)*.18
    elif family=='litter':
        # Warm leaf regions sit above exposed soil; hue alone never becomes a crease.
        leaf=np.clip((rgb[:,:,0]-rgb[:,:,1])/.12,0,1)
        height=height*.78+blur(leaf,max(2,w*.002))*.22
    height=np.clip(blur(height,max(1,w*.001)),.08,.92).astype(np.float32)
    dx=(np.roll(height,-1,1)-np.roll(height,1,1))*w*.5
    dy=(np.roll(height,-1,0)-np.roll(height,1,0))*h*.5
    # Broad weathering changes roughness and indirect cavity response, not base color.
    slope=np.sqrt(dx*dx+dy*dy)
    rough=np.clip(ROUGH[family]-.045*np.clip(slope/18,0,1)+np.clip(form,-1,1)*.018,.65,.99)
    cavity=1-.13*np.clip((blur(height,w*.01)-height)*6,0,1)
    if recipe:
        # Broad painted regions define worn/open material versus crevices. These
        # controls are opt-in per asset; existing prepared families stay intact.
        lo,hi=recipe.get('roughness',[ROUGH[family]-.04,ROUGH[family]+.02])
        open_surface=np.clip(.5+form*.3+contrast*.15,0,1)
        if family=='stone':
            # Select actual dark fissures relative to their surrounding plane;
            # broad bright mineral stains must not become embossed ridges.
            cracks=np.clip((broad-smooth-.01)/.07,0,1)
            height=.54-cracks*.23+np.clip(form,-1,1)*.06
            open_surface=1-blur(cracks,max(1,w*.002))
        elif family in ['bark','timber']:
            # Structural grain carries relief; paint only modulates the ridges.
            height=height*.4+(.5+grain*.12)*.6
        elif family=='cloth':
            height=.5+np.clip(contrast,-1,1)*.035
        elif family=='foliage':
            height=.5+np.clip(form,-1,1)*.12+np.clip(contrast,-1,1)*.06
        rough=hi-(hi-lo)*open_surface
        if family=='leather': rough=lo+(hi-lo)*open_surface
        height=np.clip(.5+(height-.5)*recipe.get('relief',1),.08,.92)
        cavity=1-.13*np.clip((blur(height,w*.01)-height)*6,0,1)
        cavity=np.clip(1-(1-cavity)*recipe.get('cavity',1),.76,1)
    data=np.stack([height,rough,cavity,np.ones_like(height)],axis=-1).astype(np.float32)
    return field_image('Relief '+family,data)

def ground_fields(root):
    root=Path(root);out=root/'assets/textures/environment/ground';out.mkdir(parents=True,exist_ok=True)
    scales=RECIPES['groundBakeScales'];stone=RECIPES['stoneProjection']
    recipes=[('earth','earth-v2.png',scales['earth'],'earth'),('litter','litter-v2.png',scales['litter'],'litter'),('rocky-soil','rocky-soil-v2.png',scales['rocky-soil'],'rocky-soil'),('stone-v1','../stone-v1.png',stone['bakeScale'],'stone'),('stone-v2','stone-v2.png',stone['bakeScale'],'stone')]
    for family,filename,scale,material in recipes:
        source=bpy.data.images.load(str(root/'assets/textures/environment/showcase'/filename));source.colorspace_settings.name='Non-Color'
        recipe=stone['fields'] if material=='stone' else None
        source.scale(2048,2048);field=author_fields(source,material,recipe);data=pixels(field);height=data[:,:,0]
        dx=(np.roll(height,-1,1)-np.roll(height,1,1))*2048*.5*DEPTH[material]*scale
        dy=(np.roll(height,-1,0)-np.roll(height,1,0))*2048*.5*DEPTH[material]*scale
        dx=np.clip(dx,-.65,.65);dy=np.clip(dy,-.65,.65)
        normal=np.stack([-dx,-dy,np.ones_like(dx)],axis=-1);normal/=np.linalg.norm(normal,axis=-1,keepdims=True)
        rgba=np.concatenate([normal*.5+.5,np.ones_like(height)[:,:,None]],axis=-1).astype(np.float32)
        field_image(family+' normal',rgba,out/(family+'-normal.png'))
        field.filepath_raw=str((out/(family+'-surface.png')).resolve());field.file_format='PNG';field.save()
        print('GROUND_FIELDS',family,'2048')
    snapshot={'heights':{f:DEPTH[f] for f in ['earth','litter','rocky-soil','stone']},'scales':RECIPES['groundBakeScales'],'stoneScale':stone['bakeScale'],'stoneFields':stone['fields']}
    (out/'recipe.json').write_text(json.dumps(snapshot,indent=2)+'\n')
