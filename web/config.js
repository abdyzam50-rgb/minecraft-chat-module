// Public: the deployed Worker URL only, never an API key.
// Empty means no Worker — the page then uses the viewer's own Claude when it
// is running as an Artifact, and canned lines anywhere else.
// The deploy workflow overwrites this file with the real Worker URL.
window.MCCHAT_API_URL = '';
