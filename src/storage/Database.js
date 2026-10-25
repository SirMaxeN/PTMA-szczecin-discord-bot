import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

export class Database {
  constructor(path) {
    const existing = existsSync(path);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS settings(guild TEXT PRIMARY KEY, channel TEXT, baseline INTEGER, checked TEXT, error TEXT);
      CREATE TABLE IF NOT EXISTS deliveries(guild TEXT, post TEXT, nonce TEXT, sent TEXT, PRIMARY KEY(guild,post));
      CREATE TABLE IF NOT EXISTS locks(name TEXT PRIMARY KEY, owner TEXT, expires INTEGER);
      CREATE TABLE IF NOT EXISTS jobs(slot TEXT PRIMARY KEY, completed TEXT);`);
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS command_roles(guild TEXT,role TEXT,PRIMARY KEY(guild,role))',
    );
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS schedules(guild TEXT PRIMARY KEY,start INTEGER NOT NULL DEFAULT 10,end INTEGER NOT NULL DEFAULT 22,interval INTEGER NOT NULL DEFAULT 60)',
    );
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS notification_options(guild TEXT PRIMARY KEY,show_content INTEGER NOT NULL DEFAULT 0,content_limit INTEGER NOT NULL DEFAULT 500)',
    );
    if (
      !this.db
        .prepare('PRAGMA table_info(settings)')
        .all()
        .some((column) => column.name === 'paused')
    ) {
      if (existing)
        this.db.exec(
          `VACUUM INTO '${(path + '.before-pause-' + Date.now() + '.sqlite').replaceAll("'", "''")}'`,
        );
      this.db.exec('ALTER TABLE settings ADD COLUMN paused INTEGER NOT NULL DEFAULT 0');
    }
    if (
      !this.db
        .prepare('PRAGMA table_info(notification_options)')
        .all()
        .some((column) => column.name === 'content_limit')
    ) {
      if (existing)
        this.db.exec(
          `VACUUM INTO '${(path + '.before-content-limit-' + Date.now() + '.sqlite').replaceAll("'", "''")}'`,
        );
      this.db.exec(
        'ALTER TABLE notification_options ADD COLUMN content_limit INTEGER NOT NULL DEFAULT 500',
      );
    }
  }
  settings(guild) {
    return this.db.prepare('SELECT * FROM settings WHERE guild=?').get(guild);
  }
  showContent(guild) {
    return !!this.db
      .prepare('SELECT show_content FROM notification_options WHERE guild=?')
      .get(guild)?.show_content;
  }
  setShowContent(guild, enabled) {
    this.db
      .prepare(
        'INSERT INTO notification_options(guild,show_content) VALUES(?,?) ON CONFLICT(guild) DO UPDATE SET show_content=excluded.show_content',
      )
      .run(guild, enabled ? 1 : 0);
  }
  contentLimit(guild) {
    return (
      this.db.prepare('SELECT content_limit FROM notification_options WHERE guild=?').get(guild)
        ?.content_limit ?? 500
    );
  }
  setContentLimit(guild, limit) {
    if (!Number.isInteger(limit) || limit < 100 || limit > 1500 || limit % 100 !== 0)
      throw new Error('Wybierz limit od 100 do 1500 znaków, co 100.');
    this.db
      .prepare(
        'INSERT INTO notification_options(guild,content_limit) VALUES(?,?) ON CONFLICT(guild) DO UPDATE SET content_limit=excluded.content_limit',
      )
      .run(guild, limit);
  }
  schedule(guild) {
    return (
      this.db.prepare('SELECT start,end,interval FROM schedules WHERE guild=?').get(guild) || {
        start: 10,
        end: 22,
        interval: 60,
      }
    );
  }
  setSchedule(guild, key, value) {
    if (
      !['start', 'end', 'interval'].includes(key) ||
      !Number.isInteger(value) ||
      (key === 'interval' ? ![30, 60, 120, 240].includes(value) : value < 0 || value > 23)
    )
      throw new Error('Nieprawidłowy harmonogram.');
    const schedule = { ...this.schedule(guild), [key]: value };
    this.db
      .prepare(
        'INSERT INTO schedules VALUES(?,?,?,?) ON CONFLICT(guild) DO UPDATE SET start=excluded.start,end=excluded.end,interval=excluded.interval',
      )
      .run(guild, schedule.start, schedule.end, schedule.interval);
  }
  commandRoles(guild) {
    return this.db
      .prepare('SELECT role FROM command_roles WHERE guild=?')
      .all(guild)
      .map((row) => row.role);
  }
  setCommandRoles(guild, roles) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('DELETE FROM command_roles WHERE guild=?').run(guild);
      for (const role of new Set(roles))
        this.db.prepare('INSERT INTO command_roles VALUES(?,?)').run(guild, role);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  configure(guild, channel) {
    this.db
      .prepare(
        'INSERT INTO settings(guild,channel) VALUES(?,?) ON CONFLICT(guild) DO UPDATE SET channel=excluded.channel',
      )
      .run(guild, channel);
  }
  guilds() {
    return this.db.prepare('SELECT * FROM settings WHERE channel IS NOT NULL AND paused=0').all();
  }
  pause(guild, paused) {
    this.db.prepare('UPDATE settings SET paused=? WHERE guild=?').run(paused ? 1 : 0, guild);
  }
  clearChannel(guild) {
    this.db.prepare('UPDATE settings SET channel=NULL,paused=1 WHERE guild=?').run(guild);
  }
  baseline(guild, id) {
    this.db
      .prepare('UPDATE settings SET baseline=?,checked=?,error=NULL WHERE guild=?')
      .run(id, new Date().toISOString(), guild);
  }
  checked(guild, error = null) {
    this.db
      .prepare('UPDATE settings SET checked=?,error=? WHERE guild=?')
      .run(new Date().toISOString(), error, guild);
  }
  sent(guild, post) {
    return !!this.db
      .prepare('SELECT sent FROM deliveries WHERE guild=? AND post=? AND sent IS NOT NULL')
      .get(guild, String(post));
  }
  delivered(guild, post, nonce) {
    this.db
      .prepare(
        'INSERT INTO deliveries VALUES(?,?,?,?) ON CONFLICT(guild,post) DO UPDATE SET sent=excluded.sent',
      )
      .run(guild, String(post), nonce, new Date().toISOString());
  }
  acquire(name, owner, ttl = 900000) {
    const result = this.db
      .prepare(
        `INSERT INTO locks VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET owner=excluded.owner,expires=excluded.expires WHERE locks.expires<?`,
      )
      .run(name, owner, Date.now() + ttl, Date.now());
    return result.changes === 1;
  }
  release(name, owner) {
    this.db.prepare('DELETE FROM locks WHERE name=? AND owner=?').run(name, owner);
  }
  jobDone(slot) {
    return !!this.db.prepare('SELECT completed FROM jobs WHERE slot=?').get(slot);
  }
  completeJob(slot) {
    this.db.prepare('INSERT OR IGNORE INTO jobs VALUES(?,?)').run(slot, new Date().toISOString());
  }
  close() {
    this.db.close();
  }
}
