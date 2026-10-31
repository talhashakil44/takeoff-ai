import {expect,it} from 'vitest';
import {gridAxes} from '../src/build/building';

it.each([0.5,1,4])('keeps offset glyph centres in one grid family at scale %s', scale=>{
 const text=['A','B','C','D'].map((str,i)=>({str,cx:(40+(i===1?4:0))*scale,cy:(100+i*150)*scale,h:10*scale}));
 // A separate interior label is not part of the margin family.
 text.push({str:'E',cx:70*scale,cy:350*scale,h:10*scale});
 const axes=gridAxes(text,800*scale,800*scale);
 expect(Object.keys(axes).sort()).toEqual(['A','B','C','D']);
 expect(axes.B.axis).toBe('y');expect(axes.B.at).toBe(250*scale);
});
it('uses the smaller glyph height so oversized callouts cannot absorb a grid family',()=>{
 const text=['A','B','C'].map((str,i)=>({str,cx:40,cy:100+i*200,h:10}));
 text.push({str:'D',cx:70,cy:500,h:100});
 expect(gridAxes(text,800,800).D).toBeUndefined();
});
it('prefers a coherent grid family over repeated section numbers inside the plan',()=>{
 const text=['1','2','3','4'].map((str,i)=>({str,cx:100+i*160,cy:40,h:12}));
 text.push(...[20,740].map(cy=>({str:'1',cx:350,cy,h:6})));
 text.push(...['A','B','C'].map((str,i)=>({str,cx:40,cy:100+i*200,h:12})));
 const axes=gridAxes(text,800,800);
 expect(axes['1']).toEqual({axis:'x',at:100});
});
it('does not let a longer one-direction legend become the registration reference',async()=>{
 const {registerSheets}=await import('../src/build/building');
 const grid=['1','2','3'].map((str,i)=>({str,cx:100+i*150,cy:40,h:10}))
 .concat(['A','B','C'].map((str,i)=>({str,cx:40,cy:100+i*150,h:10})));
 const legend=['1','2','3','4','5','6','7','8','A','B','C'].map((str,i)=>({str,cx:40,cy:50+i*60,h:10}));
 const project={sheets:['legend','plan'].map(id=>({id,title:'Floor plan',width:800,height:800,metersPerPoint:.02})),measurements:[]} as any;
 expect(registerSheets(project,{legend,plan:grid}).plan?.grids.sort()).toEqual(['1','2','3','A','B','C']);
 expect(registerSheets(project,{legend,plan:grid}).legend).toBeUndefined();
});
