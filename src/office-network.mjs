// Office Wi-Fi for time in / time out. A website cannot read the Wi-Fi name, so the office is recognised by its
// internet (public IP) address: every device on the office Wi-Fi reaches the HR site from that address. Admins add
// the address while connected to the office Wi-Fi ("Add this network"). With no address saved, the check is off.
import { z } from 'zod';
import { AppError, permit } from './service.mjs';

const ensure = store => store.db.exec('CREATE TABLE IF NOT EXISTS office_networks(ip TEXT PRIMARY KEY, label TEXT NOT NULL, added_by TEXT NOT NULL, added_at TEXT NOT NULL)');
const clean = ip => String(ip || '').trim().replace(/^::ffff:/, '');

export function officeNetworks(store) {
  ensure(store);
  return store.db.prepare('SELECT ip, label, added_by AS addedBy, added_at AS addedAt FROM office_networks ORDER BY added_at').all();
}
// Is this device on an office network? configured=false means no address is saved yet (time in is not restricted).
// Office area: the device's GPS is within the office radius (Settings -> Company -> Office location). The office's
// internet address can change during the day, so a phone at the office counts as in the office even when its
// address does not match the saved Wi-Fi.
export function inOfficeArea(store, latitude, longitude, accuracy = 0) {
  const company = (() => { try { return JSON.parse(store.db.prepare('SELECT data FROM hr_settings LIMIT 1').get()?.data || '{}').company || {}; } catch { return {}; } })();
  if (latitude === null || latitude === undefined || company.officeLatitude === null || company.officeLatitude === undefined) return false;
  const r = Math.PI / 180, a = Math.sin((company.officeLatitude - latitude) * r / 2) ** 2 + Math.cos(latitude * r) * Math.cos(company.officeLatitude * r) * Math.sin((company.officeLongitude - longitude) * r / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(a)) - Math.min(Number(accuracy) || 0, 100) <= (company.officeRadius || 150);
}
export function networkStatus(store, ip) {
  const list = officeNetworks(store), address = clean(ip);
  return { configured: list.length > 0, office: list.some(n => n.ip === address) };
}
const changeSchema = z.object({ action: z.enum(['add-current', 'remove']), ip: z.string().trim().max(64).default(''), label: z.string().trim().max(80).default('') }).strict();
export function changeOfficeNetworks(store, actor, input, currentIp) {
  permit(actor, ['admin', 'hr']);
  const v = changeSchema.parse(input);
  return store.transaction(() => {
    ensure(store);
    if (v.action === 'add-current') {
      const ip = clean(currentIp);
      if (!ip || ip === 'unknown') throw new AppError('Your network address could not be read. Try again from the office Wi-Fi.');
      if (/^(127\.|::1$|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip)) throw new AppError('Open the HR site through its public address (hr.blkstone.site) while on the office Wi-Fi, then add the network.');
      store.db.prepare('INSERT INTO office_networks(ip,label,added_by,added_at) VALUES(?,?,?,?) ON CONFLICT(ip) DO UPDATE SET label=excluded.label').run(ip, v.label || 'Office Wi-Fi', actor.username, new Date().toISOString());
      store.log(actor, 'add', 'office-network', ip, null, { label: v.label || 'Office Wi-Fi' });
    } else {
      store.db.prepare('DELETE FROM office_networks WHERE ip=?').run(v.ip);
      store.log(actor, 'remove', 'office-network', v.ip, null, null);
    }
    return { networks: officeNetworks(store), current: clean(currentIp) };
  });
}
