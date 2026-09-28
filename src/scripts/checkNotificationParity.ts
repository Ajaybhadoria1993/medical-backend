/**
 * Proves the registry still reproduces the hand-written notification defaults.
 *
 *   npm run notifications:parity
 *
 * Exits 1 on any mismatch. `missing` means a role lost an event — an audience
 * silently stopped being notified. Deliberate drops go in INTENTIONAL_DROPS.
 */

import { checkRoleDefaultsParity } from '../main/notifications/preferences/generateRoleDefaults';
import { ROLE_DEFAULTS } from '../main/notifications/preferences/notificationPreferences.constants';

function main(): void {
  const mismatches = checkRoleDefaultsParity(ROLE_DEFAULTS);

  if (!mismatches.length) {
    console.info(
      '[notifications:parity] 0 mismatches — the registry reproduces ROLE_DEFAULTS.'
    );
    return;
  }

  console.error(`[notifications:parity] ${mismatches.length} mismatch(es):\n`);

  const describe = (
    value: { enabled: boolean; configurable: boolean } | undefined,
    absent: string
  ): string =>
    value
      ? `enabled=${value.enabled} configurable=${value.configurable}`
      : absent;

  for (const m of mismatches) {
    const legacy = describe(m.legacy, 'ABSENT — the old map had no entry');
    const generated = describe(
      m.generated,
      'ABSENT — this role no longer receives the event'
    );

    console.error(
      `  ${m.kind.padEnd(7)} ${m.role}/${m.channel}/${m.event}\n` +
        `          legacy:    ${legacy}\n` +
        `          registry:  ${generated}`
    );
  }

  console.error(
    '\nFix the registry entry, or declare a deliberate change in INTENTIONAL_DROPS.'
  );

  process.exitCode = 1;
}

main();
