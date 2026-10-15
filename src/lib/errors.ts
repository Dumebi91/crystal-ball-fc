/** Turn a database error into words a member can act on. */
export function friendly(message: string | undefined): string {
  const m = message ?? '';
  const known: Record<string, string> = {
    must_be_18: 'Crystal Ball FC is for people aged 18 and over.',
    bad_handle: 'Handles are 3 to 20 letters, numbers or underscores.',
    handle_taken: 'That handle is taken. Try another.',
    kb_closed: "Know Ball isn't open right now. It opens at 9am.",
    kb_prize_window_closed: "Today's prize quiz window has closed.",
    kb_not_ready: "Today's quiz isn't ready yet. Try again in a few minutes.",
    call_locked: 'This game has kicked off, so calls are locked.',
    slow_mode: 'Slow mode is on. Try again in a few seconds.',
    poll_closed: 'This poll has closed.',
    not_found: "We couldn't find that.",
    not_allowed: "You can't do that.",
    too_many_leagues: 'You can run up to 10 leagues.',
    league_full: 'This league is full.',
  };
  const key = Object.keys(known).find((k) => m.includes(k));
  return key ? known[key] : 'Something went wrong. Please try again.';
}
