import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.es2020,
      },
    },
    rules: {
      'no-console': ['error', { allow: ['warn', 'error', 'debug', 'info'] }],
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    /**
     * The notification module boundary.
     *
     * Everything outside src/main/notifications talks to it through notify()
     * and nothing else. The old helpers still exist as shims while the cutover
     * runs, but they are the path being retired — a new caller reaching for
     * them adds work to the migration instead of finishing it.
     *
     * The module's own files are exempted below, since they legitimately
     * import each other.
     */
    files: ['src/**/*.ts'],
    ignores: [
      'src/main/notifications/**',
      'src/utils/notificationHelpers.ts',
      'src/utils/notification.utils.ts',
    ],
    rules: {
      /**
       * A warning, not an error, until Phase 9.
       *
       * Every existing caller still imports these helpers — that is what the
       * migration is — so making it an error turns `npm run lint` red for the
       * entire cutover and trains everyone to ignore it. As a warning it still
       * shows up in CI output and review for anyone adding a *new* caller,
       * which is the case worth catching. Promote to 'error' when Phase 9
       * deletes the helpers and the count should be zero.
       */
      'no-restricted-imports': [
        'warn',
        {
          patterns: [
            {
              group: ['**/utils/notificationHelpers', '**/notificationHelpers'],
              message:
                'notificationHelpers is being retired. Use notify() from main/notifications/queues/notification.queue instead.',
            },
            {
              group: ['**/utils/notification.utils', '**/notification.utils'],
              message:
                'Use notify() from main/notifications/queues/notification.queue. sendNotificationToUser is the legacy path.',
            },
            {
              /**
               * Dispatch internals only. `services/sns.service` and
               * `services/whatsapp.service` are deliberately absent: they are
               * shared transport clients that happen to live under this module,
               * not part of the decision path, and smsClient legitimately uses
               * both. Blocking them was over-reach, not boundary enforcement.
               */
              group: [
                '**/main/notifications/registry/**',
                '**/main/notifications/preferences/**',
                '**/main/notifications/ports/**',
                '**/main/notifications/services/dispatch.service',
                '**/main/notifications/services/retention.service',
              ],
              message:
                'Reach the notification module through notify(), not its internals.',
            },
          ],
        },
      ],
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**', 'drizzle/**'],
  }
);
