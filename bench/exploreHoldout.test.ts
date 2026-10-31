/** Read-only, report-only geometry evaluation. No project-specific expected counts.
 * EXPLORE_HOLDOUT=/job/whole.json EXPLORE_HOLDOUT_OUTPUT=/separate/output
 * npx vitest run -c bench/vitest.config.ts bench/exploreHoldout.test.ts
 */
import {it,expect} from 'vitest';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname,join,relative,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import type {Project} from '../src/model';
import {openDoc} from './nodeSet';
import {pageTexts} from '../src/pageText';
import {segmentsOf} from '../src/fill/sheetWalls';
import {loadDrawingSources,needsText} from '../src/build/sources';
import {titleBlockWords,extractModel} from '../src/build/extract';
import {buildAll} from '../src/build/run';
import {gridAxes,registerSheets} from '../src/build/building';
import {nearestGridIntersection} from '../src/build/gridCounts';

const input=process.env.EXPLORE_HOLDOUT;
it.skipIf(!input)('reports held-out Explore geometry without tuning or modifying source data',async()=>{
 const file=resolve(input!),base=dirname(file),output=resolve(process.env.EXPLORE_HOLDOUT_OUTPUT??'diag/explore-holdout');
 const rel=relative(base,output);
 if(!rel||(!rel.startsWith('..')&&!isAbsolute(rel)))throw Error('Output must be outside the input project directory');
 const before=readFileSync(file),data=JSON.parse(before.toString()),project:Project=data.project;
 const original=JSON.stringify(project),errors:{docId:string;message:string}[]=[];
 const files=new Map<string,string>((data.files??[]).map((d:{id:string;file:string})=>[d.id,resolve(base,d.file)]));
 const docs=new Map<string,ReturnType<typeof openDoc>>();
 const getDoc=(id:string)=>{
  if(!docs.has(id))docs.set(id,openDoc(files.get(id)??join(base,'drawings',`${id}.pdf`)).catch(e=>{errors.push({docId:id,message:String(e)});throw e;}));
  return docs.get(id)!;
 };
 const page=async(id:string,n:number)=>(await getDoc(id)).pdf.getPage(n);
 const read=async<T>(id:string,phase:string,op:()=>Promise<T>):Promise<T>=>{try{return await op();}catch(e){errors.push({docId:id,message:`${phase}: ${String(e)}`});throw e;}};
 const sheet=(id:string)=>{const s=project.sheets.find(s=>s.id===id);if(!s)throw Error(`Missing sheet ${id}`);return s;};
 const sources=await loadDrawingSources({project,cache:false,titleWords:titleBlockWords,
  sheetText:async id=>{const s=sheet(id);return read(s.docId,`sheet text ${s.id}`,async()=>pageTexts(await page(s.docId,s.page)));},
  sheetLines:async id=>{const s=sheet(id);return read(s.docId,`sheet lines ${s.id}`,async()=>segmentsOf(await page(s.docId,s.page)));},
  revisions:{pages:async id=>(await getDoc(id)).pdf.numPages,size:async(id,n)=>{const p=await page(id,n),v=p.getViewport({scale:1});return {width:v.width,height:v.height};},text:async(id,n)=>pageTexts(await page(id,n)),lines:async(id,n)=>segmentsOf(await page(id,n))},
 });
 const sections=project.specs?.flatMap(s=>s.book?.sections??[])??[];
 // This geometry-only audit intentionally does not score schedule or spec-fact completeness.
 const args={project,sections,facts:[],drawingTexts:sources.texts,drawingLines:sources.lines,levelHints:sources.hints,today:'2026-11-02'};
 const model=buildAll(args).model,baseline=extractModel({...args,floorToFloor:4});
 const tuple=(e:typeof model.elements[number])=>[e.id,e.quantity,e.unit,e.typeId,e.measurementId];
 expect(model.elements.filter(e=>e.origin==='takeoff').map(tuple)).toEqual(baseline.elements.filter(e=>e.origin==='takeoff').map(tuple));
 expect(JSON.stringify(project)).toBe(original);expect(readFileSync(file).equals(before)).toBe(true);
 const structural=model.elements.filter(e=>e.origin==='takeoff'&&(e.trade==='structure'||e.measurementSource==='foundations'));
 const registrations=registerSheets(project,sources.texts);
 const gridDiagnostics=project.sheets.filter(s=>!s.superseded).map(s=>{
   const measurements=project.measurements.filter(m=>m.sheetId===s.id),points=measurements.flatMap(m=>m.points);
   const median=(axis:number)=>points.map(p=>p[axis]).sort((a,b)=>a-b)[Math.floor(points.length/2)];
   const axes=gridAxes(sources.texts[s.id]??[],s.width,s.height,points.length?[median(0),median(1)]:undefined),registration=registrations[s.id]??null;
   const pointItems=structural.filter(e=>e.sheetId===s.id).flatMap(e=>{
     const m=measurements.find(m=>m.id===e.measurementId),type=project.types.find(t=>t.id===e.typeId);
     if(!m?.points.length||type?.kind!=='count')return [];
     // Unbounded distance is diagnostic only: never passed to extraction or rendered as geometry.
     const nearest=registration&&s.metersPerPoint?nearestGridIntersection(axes,registration.grids,m.points[0],s.metersPerPoint,Infinity):null;
     const qualified=registration&&s.metersPerPoint?nearestGridIntersection(axes,registration.grids,m.points[0],s.metersPerPoint):null;
     return [{id:e.id,tagPoint:m.points[0],status:!s.metersPerPoint?'missing_scale':!registration?'unregistered_sheet':!nearest?'missing_registered_axis_family':!qualified?'outside_existing_snap_limit':'within_existing_snap_limit',nearestDiagnosticOnly:nearest,existingSnap:qualified,modelShape:e.shape?.type??null}];
   });
   return {sheetId:s.id,name:s.name,title:s.title,metersPerPoint:s.metersPerPoint,axes,registration,pointItems};
 }).filter(s=>s.pointItems.length);
 const records=structural.map(e=>({id:e.id,sheetId:e.sheetId,type:e.typeName,quantity:e.quantity,unit:e.unit,shapeType:e.shape?.type??null,placement:e.placement,planFootprint:!!e.planFootprint,sources:e.sources,issues:e.issues}));
 const solid=(e:typeof records[number])=>e.shapeType!==null&&!['axis','locator'].includes(e.shapeType);
 const report={modelVersion:model.version,inputSha256:createHash('sha256').update(before).digest('hex'),mode:'report-only; no accuracy or visual acceptance inferred from counts',specFacts:'not evaluated',gridDiagnostics,sourceReadErrors:errors,sourceSheetCount:Object.keys(sources.texts).length,missingRequiredTextSheets:project.sheets.filter(s=>!s.superseded&&needsText(s,new Set(project.measurements.map(m=>m.sheetId)))&&!sources.texts[s.id]).map(s=>s.id),structural:{total:records.length,solid:records.filter(solid).length,unresolved:records.filter(e=>!solid(e)).length},records};
 mkdirSync(output,{recursive:true});
 writeFileSync(join(output,'report.json'),JSON.stringify(report,null,2));
 writeFileSync(join(output,'snapshot.json'),JSON.stringify({project,model,drawingTexts:sources.texts,drawingLines:sources.lines}));
 writeFileSync(join(output,'pdf-manifest.json'),JSON.stringify([...new Set([...project.docs.map(d=>d.id),...(project.specs??[]).map(d=>d.id)])].map(id=>({id,path:files.get(id)??join(base,'drawings',`${id}.pdf`)})),null,2));
 console.log(JSON.stringify({output,structural:report.structural,sourceReadErrors:errors}));
},180000);
