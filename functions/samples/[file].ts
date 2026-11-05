// Cloudflare Pages Function at /samples/<file>.takeoff: the sample projects from the GitHub release. See worker/samples.ts.
import { sample } from '../../worker/samples';

export const onRequestGet = (context: { params: { file: string | string[] } }) => sample(String(context.params.file));
