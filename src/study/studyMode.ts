/**
 * User-testing support (docs/USER-TESTING.md). Adding ?study=voice to the robot page swaps the robot for a plain
 * voice-chat indicator, so the SAME conversation, voice and AI can be compared with and without the robot body.
 * Nothing is recorded or sent: observations are written down by the person running the session.
 */
export type StudyMode = 'robot' | 'voice' | null;
export function studyMode(search: string = typeof location === 'undefined' ? '' : location.search): StudyMode {
  const v = new URLSearchParams(search).get('study');
  return v === 'voice' || v === 'robot' ? v : null;
}
