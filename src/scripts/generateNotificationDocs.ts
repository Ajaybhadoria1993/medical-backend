/**
 * Generates the notification event matrix from the registry.
 *
 * The client's brief asks for a table defining, per event: what happened, who
 * receives it, why, whether it is a notification or an activity, where clicking
 * takes them, and what updates. Maintaining that by hand is how the three
 * copies of the event list this registry replaced drifted apart in the first
 * place — so it is generated from the code that actually runs, and regenerating
 * it is the only way to change it.
 *
 *   npm run notifications:docs
 */

import { writeFileSync } from 'fs';
import { join } from 'path';
import { listEvents } from '../main/notifications/registry';

const OUTPUT = join(process.cwd(), 'docs', 'NOTIFICATION_EVENTS.md');

function escape(value: string): string {
  return value.replace(/\|/g, '\\|');
}

/**
 * The route pattern a click action produces, without a real event to feed it.
 *
 * Click actions are functions of context, so the only way to read the
 * destination out of one is to call it. A proxy stands in for the context and
 * answers every property with a placeholder, which is enough for the route
 * string — the point of the column is "where does this land", not "with which
 * id".
 */
function resolveRoute(action: (ctx: never) => { route: string }): string {
  try {
    const placeholder = new Proxy(
      {},
      { get: (_target, prop) => `{${String(prop)}}` }
    );
    return `\`${action(placeholder as never).route}\``;
  } catch {
    return '(dynamic)';
  }
}

function main(): void {
  const events = Object.entries(listEvents()).sort(([a], [b]) =>
    a.localeCompare(b)
  );

  const lines: string[] = [
    '# Notification Events',
    '',
    '<!-- GENERATED FILE — do not edit by hand.',
    '     Run `npm run notifications:docs` after changing the registry. -->',
    '',
    `${events.length} events, generated from \`src/main/notifications/registry\`.`,
    '',
    '| Event | Category | Type | Priority | Who receives it | Permission | Opens | Mutable |',
    '|---|---|---|---|---|---|---|---|',
  ];

  for (const [key, event] of events) {
    // One row per audience: the same event genuinely reaches different people,
    // for different reasons, at different destinations.
    const audiences = event.audiences
      .map((a) => `**${a.key}** (${a.roles.join(', ')})`)
      .join('<br>');

    const permissions = event.audiences
      .map((a) => a.requiredPermission ?? '—')
      .join('<br>');

    const routes = event.audiences
      .map((a) => resolveRoute(a.clickAction ?? event.clickAction))
      .join('<br>');

    lines.push(
      `| \`${key}\` | ${event.category} | ${event.kind} | ${event.priority} | ` +
        `${audiences} | ${permissions} | ${routes} | ` +
        `${event.configurable ? 'yes' : 'no'} |`
    );
  }

  lines.push(
    '',
    '## Aliases',
    '',
    'Preference keys these events were known by before the rebuild. Saved user',
    'preferences are stored under the old names, so these keep resolving.',
    '',
    '| Event | Aliases |',
    '|---|---|'
  );

  for (const [key, event] of events) {
    if (!event.aliases?.length) continue;
    lines.push(
      `| \`${key}\` | ${event.aliases.map((a) => `\`${a}\``).join(', ')} |`
    );
  }

  lines.push('', '## Descriptions', '');
  for (const [key, event] of events) {
    lines.push(
      `- **${escape(event.label)}** (\`${key}\`) — ${escape(event.description)}`
    );
  }
  lines.push('');

  writeFileSync(OUTPUT, lines.join('\n'));
  console.log(`Wrote ${OUTPUT} (${events.length} events)`);
}

main();
