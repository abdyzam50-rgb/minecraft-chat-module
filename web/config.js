// Public: the API origin only, never a key.
// The deploy workflow rewrites this file. Empty means no API — the page then
// uses the viewer's own Claude when it runs as an Artifact, and canned lines
// anywhere else.
window.MCCHAT_API_URL = '';
