import type { Session } from './types';

/**
 * The line the panel hands over for Claude Code. Everything an agent reads
 * beyond it — report.md, MANIFEST.txt, recording.json, the contact sheets — is
 * built by @dested/video-to-prompt's builders in `bundle.ts` (since Recorder
 * 1.12.0; this file used to be a format-1 port of them), and the server
 * rebuilds the brief from recording.json anyway.
 */

/** How much the gripe holds, said in as few words as the prompt can afford. */
function contents(session: Session, parts: number): string {
  if (!parts) return `a walkthrough called ${session.name}`;
  return `${parts} recording${parts === 1 ? '' : 's'} on one timeline`;
}

/**
 * The line you paste into Claude Code. The gripe is in the cloud, so this is a
 * pointer plus the one tool call that fetches it — `report.md` inside was authored
 * for the model that pulls it, which is why the prompt stays this short.
 */
export function agentPrompt(session: Session, url?: string, parts = session.recCount): string {
  const what = contents(session, parts);
  const evidence = parts
    ? 'The images are the evidence — read the contact sheets first, then the timeline, look at every screenshot, and where the words and the frames disagree, believe the frames.'
    : 'Look at every image, then fix what it describes.';
  if (url) {
    return `The walkthrough is at ${url} — pull the full brief with the handback MCP tool \`get_walkthrough\`, then fix what it describes. I recorded it against the running app: ${what}, in the order they happened. Its \`report.md\` is authored for you. ${evidence}`;
  }
  return `Pull my newest walkthrough with the handback MCP tools (\`list_walkthroughs\`, then \`get_walkthrough\`) and fix what it describes — "${session.name}", recorded against the running app: ${what}, in the order they happened. Its \`report.md\` is authored for you. ${evidence}`;
}
