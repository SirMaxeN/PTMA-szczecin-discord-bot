export class ForumSchedule {
  static defaults = { start: 10, end: 22, interval: 60 };
  static slot(now, settings = this.defaults) {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Warsaw',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now);
    const minute =
      Number(parts.find((p) => p.type === 'hour').value) * 60 +
      Number(parts.find((p) => p.type === 'minute').value);
    const elapsed = (minute - settings.start * 60 + 1440) % 1440;
    const duration =
      settings.start === settings.end
        ? 1439
        : (settings.end * 60 - settings.start * 60 + 1440) % 1440;
    if (elapsed > duration) return null;
    // The closing hour is always its own slot, even between regular intervals.
    const isClosingMinute = settings.start !== settings.end && elapsed === duration;
    const remainder = isClosingMinute ? 0 : elapsed % settings.interval;
    const scheduled = new Date(now.getTime() - remainder * 60000);
    scheduled.setUTCSeconds(0, 0);
    return `${settings.start}:${settings.end}:${settings.interval}:${scheduled.toISOString().slice(0, 16)}`;
  }
}
