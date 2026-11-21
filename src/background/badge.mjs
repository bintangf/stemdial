const MODE_LABEL = {1: 'INST', '-1': 'VOX', 0: 'ON'};

export function createBadge(action) {
  return async function badge(tabId, mix) {
    if (!mix) {
      await action.setBadgeText({tabId, text: ''});
      await action.setTitle({tabId, title: 'Open StemDial'});
      return;
    }
    const semitones = mix.semitones;
    const text = semitones
      ? (semitones > 0 ? `+${semitones}` : `${semitones}`)
      : MODE_LABEL[mix.mode] || 'ON';
    await action.setBadgeText({tabId, text});
    await action.setTitle({tabId, title: `StemDial active: ${semitones} semitones`});
  };
}
