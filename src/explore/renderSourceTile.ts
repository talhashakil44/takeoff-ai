import type { PDFPageProxy } from 'pdfjs-dist';
import { sourceRegion, type SourceBox, type SourceTile } from './sourceRegion';

export async function renderSourceTile(page: PDFPageProxy, box: SourceBox): Promise<SourceTile> {
  const original=page.getViewport({scale:1});
  const region=sourceRegion(box,original.width,original.height);
  if(!region)throw new Error('The evidence region is outside this original page.');
  const canvas=document.createElement('canvas');
  canvas.width=Math.ceil(region.width*region.scale);
  canvas.height=Math.ceil(region.height*region.scale);
  // Map the exact source bounds to the allocated pixel edges, including rounded
  // raster dimensions, so a tile never shifts adjacent ink at its boundary.
  const sx=canvas.width/region.width,sy=canvas.height/region.height;
  await page.render({canvas,viewport:original,
    transform:[sx,0,0,sy,-region.left*sx,-region.top*sy]}).promise;
  return {page:canvas,box:[region.left,region.top,region.left+region.width,region.top+region.height],
    pageWidth:original.width,pageHeight:original.height};
}
