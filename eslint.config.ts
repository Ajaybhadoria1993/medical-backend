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
            {
              group: [
                '**/superadminAnalytics/*',
                '**/superadminAnalytics/*/**',
              ],
              message:
                'Import the Super Admin analytics module from main/superadminAnalytics (its index.ts) only.',
            },
            {
              group: ['**/credits/*', '**/credits/*/**'],
              message:
                'Import the credits module from main/credits (its index.ts) only.',
            },
          ],
        },
      ],
    },
  },
  {
    // Email HTML is rendered by the notification dispatcher only; everything else sends through notify().
    files: ['src/**/*.ts'],
    ignores: ['src/main/notifications/**'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '**/main/notifications/templates',
                '**/main/notifications/templates/**',
                '**/notifications/templates/**',
              ],
              message:
                'Email templates are rendered by the notification dispatcher. Send through notify() instead.',
            },
          ],
        },
      ],
    },
  },
  {
    /**
     * Super Admin analytics boundary: it reads other features only through its
     * ports, so it can move to its own service without a rewrite.
     */
    files: ['src/main/superadminAnalytics/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/models/**', '!../models/**', '!./models/**'],
              message:
                'Read other features through ports/ (implemented in src/adapters/superadminAnalytics), never their models.',
            },
          ],
        },
      ],
    },
  },
  {
    /** Credits boundary: other features are read through ports/ only (src/adapters/credits). */
    files: ['src/main/credits/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '**/models/**',
                '!../models/**',
                '!./models/**',
                '!../../models/**',
              ],
              message:
                'Read other features through ports/ (implemented in src/adapters/credits), never their models.',
            },
          ],
        },
      ],
    },
  },
  {
    /**
     * Subscription boundary: other features are read through ports/ (src/adapters/subscription).
     * A warning while the existing reads move; switch to error once none remain.
     */
    files: ['src/main/subscription/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'warn',
        {
          patterns: [
            {
              group: [
                '**/models/**',
                '!../models/**',
                '!./models/**',
                '!../../models/**',
              ],
              message:
                'Read other features through ports/ (implemented in src/adapters/subscription), never their models.',
            },
            {
              group: ['../../*/services/**', '../../../*/services/**'],
              message:
                'Call other features through ports/ (implemented in src/adapters/subscription), never their services.',
            },
            {
              // Kept here: this block replaces the global setting of the same rule for these files.
              group: [
                '**/main/notifications/templates',
                '**/main/notifications/templates/**',
                '**/notifications/templates/**',
              ],
              message:
                'Email templates are rendered by the notification dispatcher. Send through notify() instead.',
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
