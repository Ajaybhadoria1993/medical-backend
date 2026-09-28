/**
 * The event contract. One entry is the whole truth about an event — recipients,
 * copy, channels, click target — and will not compile without them, which makes
 * "define the recipient before sending" a type error rather than a review note.
 */

import type {
  notificationCategoryEnum,
  notificationKindEnum,
  notificationPriorityEnum,
} from '../models/notifications.model';
import type { DirectoryPort } from '../ports/directory.port';
import type { WhatsAppTemplateMessage } from '../types/whatsappTemplate.types';

/** Derived from the pgEnums so the code and the column can never drift apart. */
export type NotificationCategory =
  (typeof notificationCategoryEnum.enumValues)[number];
export type NotificationPriority =
  (typeof notificationPriorityEnum.enumValues)[number];
export type NotificationKind = (typeof notificationKindEnum.enumValues)[number];

export type NotificationChannel =
  'inApp' | 'push' | 'email' | 'sms' | 'whatsapp';

/** Only these two are user-configurable today; the settings screen renders them. */
export type ConfigurableChannel = Extract<
  NotificationChannel,
  'inApp' | 'push'
>;

export interface ClickAction {
  /** Route pattern, e.g. '/appointments/:id'. */
  route: string;
  params?: Record<string, string>;
}

export interface InAppMessage {
  title: string;
  body: string;
}

export interface EmailMessage {
  subject: string;
  /** Name of a template in src/htmltamplates — referenced, not authored here. */
  template: string;
  props: Record<string, unknown>;
}

export interface SmsMessage {
  text: string;
  /** DLT template id — SMS copy is registered with operators, not free text. */
  dltTemplateId?: string;
}

/**
 * A registered template plus its parameters. Reuses the outbox's discriminated
 * union rather than a loose {key, params}, so an entry whose params do not match
 * the template it names fails to compile instead of failing at Meta.
 */
export type WhatsAppMessage = WhatsAppTemplateMessage;

/** In-app/push are free text; the rest resolve to registered templates. */
export interface NotificationMessages<Ctx> {
  inApp?: (ctx: Ctx) => InAppMessage;
  push?: (ctx: Ctx) => InAppMessage;
  email?: (ctx: Ctx) => EmailMessage;
  sms?: (ctx: Ctx) => SmsMessage;
}

/** Patient WhatsApp, outside the audiences: bell prefs, the cross-audience
 *  de-dupe and the performer exclusion must not drop it (legacy parity). */
export interface WhatsAppDelivery<Ctx> {
  recipients: (ctx: Ctx, deps: RecipientDeps) => Promise<string[]> | string[];
  /** Null = not sent, mirroring the legacy sender's own early returns. */
  message: (ctx: Ctx) => WhatsAppMessage | null;
}

export interface TenantRef {
  type: 'clinic' | 'lab' | 'pharmacy';
  id: string;
}

/** Injected, so recipient rules never reach into another feature's tables. */
export interface RecipientDeps {
  directory: DirectoryPort;
}

export interface NotificationEventDefinition<Ctx = Record<string, unknown>> {
  /** Pre-rebuild keys. Saved preferences use them; renaming without an alias
   *  silently un-mutes everyone who had turned the event off. */
  aliases?: string[];

  /** Shown on the My Notifications screen. */
  label: string;
  description: string;

  category: NotificationCategory;
  priority: NotificationPriority;
  kind: NotificationKind;

  /** false renders the toggle locked: the user may not turn this off. */
  configurable: boolean;

  /** Default state per configurable channel, before any user override. */
  defaults: Record<ConfigurableChannel, boolean>;

  /** Per-role exceptions: reception does not want every reschedule pushed,
   *  the treating doctor does. */
  roleDefaults?: Record<string, Partial<Record<ConfigurableChannel, boolean>>>;

  /** Channels this event may use at all, before preferences and clinic settings. */
  channels: NotificationChannel[];

  /** Tenant the notification belongs to. Omit for platform-level events. */
  tenant?: (ctx: Ctx) => TenantRef | null;

  /**
   * Resolves ids to names at delivery time, so a reminder firing hours later
   * renders the doctor the appointment has now. Caller's own values win.
   */
  enrich?: (ctx: Ctx, deps: RecipientDeps) => Promise<Partial<Ctx>>;

  /**
   * Recipient groups, each with its own wording and permission rule. Staff and
   * patient read different copy, and a patient holds no clinic permission to
   * filter on — one shared string or one shared check breaks that.
   */
  audiences: NotificationAudience<Ctx>[];

  /** Groups repeat firings into one unread row. Omit to always append. */
  collapseKey?: (ctx: Ctx) => string;

  /** Default destination. An audience may override it. */
  clickAction: (ctx: Ctx) => ClickAction;

  /** Sent only for templates listed in WHATSAPP_VIA_REGISTRY; the legacy
   *  sender skips exactly those, so each template has one sender. */
  whatsapp?: WhatsAppDelivery<Ctx>;
}

export interface NotificationAudience<Ctx> {
  /** Stable identifier, e.g. 'staff' or 'patient'. Appears in logs. */
  key: string;

  /** Drives ROLE_DEFAULTS, so it also decides what the settings screen shows. */
  roles: string[];

  /** Makes "don't notify people who can't act" literal: the permission the
   *  click target already needs. */
  requiredPermission?: string;

  /**
   * Ids that skip `requiredPermission` entirely — mirrors the route-level
   * exemption (e.g. `requirePermission(APPOINTMENT_VIEW, ['Receptionist'])`
   * lets a Doctor through unchecked). Without this, a doctor with no granted
   * `appointment:view` permission silently loses notifications about their
   * own appointment, even though `recipients` already named them.
   */
  permissionExempt?: (ctx: Ctx) => (string | null | undefined)[];

  /** Resolved at send time: a reminder may outlive the doctor assignment. */
  recipients: (ctx: Ctx, deps: RecipientDeps) => Promise<string[]> | string[];

  /** Overrides the event default — routes are role-scoped (/lab/assigned vs
   *  /lab-tests), so one destination sends half the recipients nowhere. */
  clickAction?: (ctx: Ctx) => ClickAction;

  message: NotificationMessages<Ctx>;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/** `any` is confined here: entries hold unrelated ctx shapes but stay typed at
 *  their own definition sites. */
export type EventRegistry = Record<string, NotificationEventDefinition<any>>;
