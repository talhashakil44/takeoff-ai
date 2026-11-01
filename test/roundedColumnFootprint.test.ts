import {expect,it} from 'vitest';
import {roundedColumnFootprint} from '../src/build/roundedColumnFootprint';
import type {Pt} from '../src/model';
const scale=1.27/72;
const points:Pt[]=[[1.08,0],[6.12,0],[6.84,.36],[7.2,1.08],[7.2,6.12],[6.84,6.96],[6.12,7.2],[1.08,7.2],[.36,6.96],[0,6.12],[0,1.08],[.36,.36]];
const loop=(ps=points)=>ps.map((p,i)=>({x1:p[0],y1:p[1],x2:ps[(i+1)%ps.length][0],y2:ps[(i+1)%ps.length][1],width:.6,filled:false,color:'#000000'}));
it('recognizes the closed rounded HSS outside dimensions rather than shortened straight faces',()=>{
 const p=roundedColumnFootprint(loop(),[-8,10],scale,.127,.127)!;
 expect(p.box).toEqual([0,0,7.2,7.2]);expect(p.at).toEqual([3.6,3.6]);
});
it('rejects missing corners, branches, white knockout boxes and wrong sections',()=>{
 expect(roundedColumnFootprint(loop().slice(1),[3,3],scale,.127,.127)).toBeNull();
 expect(roundedColumnFootprint([...loop(),{x1:0,y1:1.08,x2:-3,y2:1.08,width:.6,filled:false,color:'#000000'}],[3,3],scale,.127,.127)).toBeNull();
 expect(roundedColumnFootprint(loop().map(l=>({...l,filled:true,color:'#ffffff'})),[3,3],scale,.127,.127)).toBeNull();
 expect(roundedColumnFootprint(loop(),[3,3],scale,.2,.2)).toBeNull();
});
it('rejects multiple qualifying outlines instead of selecting the nearest tag',()=>{
 const shifted=loop().map(l=>({...l,x1:l.x1+15,x2:l.x2+15}));
 expect(roundedColumnFootprint([...loop(),...shifted],[10,3],scale,.127,.127)).toBeNull();
});
it('requires a closed concentric inside face when scheduled HSS wall thickness is supplied',()=>{
 const inside=loop(points.map(([x,y])=>[3.6+(x-3.6)*108/127,3.6+(y-3.6)*108/127]));
 expect(roundedColumnFootprint([...loop(),...inside],[3,3],scale,.127,.127,.0095)).not.toBeNull();
 expect(roundedColumnFootprint(loop(),[3,3],scale,.127,.127,.0095)).toBeNull();
 expect(roundedColumnFootprint([...loop(),...inside.slice(1)],[3,3],scale,.127,.127,.0095)).toBeNull();
 expect(roundedColumnFootprint([...loop(),...inside.map(l=>({...l,x1:l.x1+.2,x2:l.x2+.2}))],[3,3],scale,.127,.127,.0095)).toBeNull();
});
