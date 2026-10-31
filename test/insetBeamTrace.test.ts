import {expect,it} from 'vitest';
import {taggedBeamTrace} from '../src/build/insetBeamTrace';
const ink=(x1:number,y1:number,x2:number,y2:number)=>({x1,y1,x2,y2,width:1,color:'#000000',filled:false});
it.each([-1,1])('accepts tags on either side %i without treating the line as an envelope',side=>{
 expect(taggedBeamTrace({str:'G8',cx:50,cy:50+side*10,h:5},[ink(10,50,90,50)])).toEqual([[10,50],[90,50]]);
 expect(taggedBeamTrace({str:'G8',cx:50+side*10,cy:50,h:5,angle:Math.PI/2},[ink(50,10,50,90)])).toEqual([[50,10],[50,90]]);
});
it('withdraws ambiguous parallel ink, nonbeam ink and short annotation strokes',()=>{
 const tag={str:'G8',cx:50,cy:50,h:5};
 expect(taggedBeamTrace(tag,[ink(10,40,90,40),ink(10,60,90,60)])).toBeNull();
 expect(taggedBeamTrace(tag,[{...ink(10,40,90,40),color:'#ffffff'}])).toBeNull();
 expect(taggedBeamTrace(tag,[ink(45,40,55,40)])).toBeNull();
 expect(taggedBeamTrace({...tag,h:undefined},[ink(10,40,90,40)])).toBeNull();
});
