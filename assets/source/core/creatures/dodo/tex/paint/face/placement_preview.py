"""Close baked-surface views for fitting the folds to the visible anatomy."""
import site
site.addsitedir(site.getusersitepackages())
import sys
sys.dont_write_bytecode=True
sys.path.insert(0,str(__import__('pathlib').Path(__file__).resolve().parent))
import preview as v
import numpy as np

def main():
    _,piece,p,ids,regions,_=v.paint.load_geometry()
    data=v.prepare(piece,p/1000,ids,regions)
    items=[]
    for title,camera,centre,width,height in [
        ('Side / lid and gape',[1,0,0],[.04,.568,.197],.092,.091),
        ('Eye-facing / lid and gape',[.70,0,.71],[.04,.568,.190],.085,.091),
        ('Front / both sides',[0,0,1],[0,.568,.200],.142,.091)]:
        im=v.render(data,camera,np.array(centre),width,height,ppm=9000,mirror=title.startswith('Front'))
        im.save(v.QA/('placement_'+title.split(' /')[0].lower()+'.png'))
        items.append((title,im))
    v.board(items,3,650,640).save(v.QA/'placement_views.png')
    print('Saved placement closeups',flush=True)
if __name__=='__main__':main()
