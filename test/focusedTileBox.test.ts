import {expect,it} from 'vitest';
import {focusedTileBox} from '../src/explore/focusedTileBox';
import type {BuildElement} from '../src/build/types';
import type {Sheet} from '../src/model';
const frame={a:0,b:1,tx:5,ty:-2,residual:0};
const source={id:'s',docId:'d',page:21} as Sheet;
const element={shape:{type:'point',at:[-45,148],size:[1,1,1],z:0},sources:[
 {kind:'spec',id:'d',page:21,label:'parent datum',box:[20,20,30,30]},
 {kind:'spec',id:'d',page:21,label:'own footprint',box:[140,40,160,60]},
 {kind:'spec',id:'d',page:19,label:'schedule',box:[145,45,155,55]},
]} as BuildElement;
it('uses the actual member footprint instead of smaller dependency evidence',()=>{
 expect(focusedTileBox(element,[-45,148],frame,source)).toEqual([140,40,160,60]);
});
it('clears detail when focus belongs to a previous selection or the page differs',()=>{
 expect(focusedTileBox(element,[-44,148],frame,source)).toBeNull();
 expect(focusedTileBox(element,[-45,148],frame,{...source,page:23})).toBeNull();
});

import {focusedPlanBox} from '../src/explore/focusedTileBox';
it('registers original plan evidence for a room without inventing a physical shape',()=>{
 const room={sources:[{kind:'sheet',id:'s',box:[140,40,160,60]}]} as BuildElement;
 expect(focusedPlanBox(room,[-45,148],frame,source)).toEqual([140,40,160,60]);
 expect(focusedPlanBox(room,[-44,148],frame,source)).toBeNull();
 expect(focusedPlanBox(room,[-45,148],frame,{...source,id:'other'})).toBeNull();
});
it('rejects malformed plan evidence rather than rendering an arbitrary crop',()=>{
 for(const box of [[160,40,140,60],[140,60,160,40],[140,40,NaN,60]])
  expect(focusedPlanBox({sources:[{kind:'sheet',id:'s',box}]} as BuildElement,[-45,148],frame,source)).toBeNull();
});
