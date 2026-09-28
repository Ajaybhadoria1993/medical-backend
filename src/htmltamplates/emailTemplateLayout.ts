type SupportInfo = {
  email?: string;
  phone?: string;
};

type EmailLayoutParams = SupportInfo & {
  title: string;
  preview: string;
  greeting: string;
  headline: string;
  message: string;
  bodyHtml: string;
  helpText?: string;
};

type AlertTone = 'warning' | 'success' | 'info' | 'danger';

const toneStyles: Record<
  AlertTone,
  {
    bg: string;
    border: string;
    iconBg: string;
    iconBorder: string;
    icon: string;
    title: string;
    text: string;
    symbol: string;
  }
> = {
  warning: {
    bg: '#fff3eb',
    border: '#ffd9c1',
    iconBg: '#fff8f3',
    iconBorder: '#f4b98f',
    icon: '#b45309',
    title: '#9a4a07',
    text: '#874414',
    symbol: '!',
  },
  success: {
    bg: '#f1fffb',
    border: '#bdebd5',
    iconBg: '#e7fbf4',
    iconBorder: '#86efac',
    icon: '#047857',
    title: '#047857',
    text: '#356859',
    symbol: '&#10003;',
  },
  info: {
    bg: '#f3fbff',
    border: '#cde7f7',
    iconBg: '#ecf8ff',
    iconBorder: '#a8d8ef',
    icon: '#0f6c8f',
    title: '#0f6c8f',
    text: '#365f70',
    symbol: 'i',
  },
  danger: {
    bg: '#fff5f5',
    border: '#fecaca',
    iconBg: '#fef2f2',
    iconBorder: '#fca5a5',
    icon: '#b91c1c',
    title: '#b91c1c',
    text: '#7f1d1d',
    symbol: '!',
  },
};

const emailFont = "'Outfit', sans-serif";

const assetBaseUrl = () =>
  (
    process.env.EMAIL_ASSET_BASE_URL ||
    process.env.BACKEND_BASE_URL ||
    'http://localhost:5000'
  ).replace(/\/+$/, '');

export const getEmailImages = () => ({
  mailIcon: `${assetBaseUrl()}/Email-Image/mail-icon.png`,
  secure: `${assetBaseUrl()}/Email-Image/secure.png`,
  logo: `${assetBaseUrl()}/Email-Image/logoLight.png`,
});

export const getSupportInfo = (support?: SupportInfo) => ({
  email:
    support?.email ||
    process.env.SUPPORT_EMAIL ||
    'support@infinitymedisetu.com',
  phone: support?.phone || process.env.SUPPORT_PHONE || '+91 8770553894',
});

export const renderActionButton = (label: string, href: string) => `
  <table role="presentation" align="center" cellpadding="0" cellspacing="0" style="border-collapse:separate; margin:16px auto 18px;">
    <tr>
      <td align="center" bgcolor="#127c80" style="border-radius:8px; box-shadow:0 6px 13px rgba(18,124,128,0.22);">
        <a class="cta-link" href="${href}" target="_blank" style="display:inline-block; min-width:188px; padding:12px 24px; color:#ffffff !important; font-family:${emailFont}; font-size:12px; line-height:16px; font-weight:700; text-align:center; text-decoration:none; border-radius:8px;">
          ${label}
        </a>
      </td>
    </tr>
  </table>`;

export const renderValidityNotice = (text: string) => `
  <table role="presentation" align="center" cellpadding="0" cellspacing="0" style="border-collapse:collapse; margin:15px auto 12px;">
    <tr>
      <td valign="middle" style="padding:0 6px 0 0;">
        <span style="display:inline-block; background:#127c80; border-radius:50%; color:#ffffff; font-family:${emailFont}; font-size:9px; font-weight:700; height:15px; line-height:15px; text-align:center; width:15px;">i</span>
      </td>
      <td valign="middle" style="color:#41545b; font-family:${emailFont}; font-size:11px; font-weight:500; line-height:16px; text-align:left;">
        ${text}
      </td>
    </tr>
  </table>`;

export const renderLinkFallback = (label: string, href: string) => `
  <p style="margin:11px 0 7px; color:#6b7b82; font-family:${emailFont}; font-size:10px; font-weight:500; line-height:15px; text-align:center;">${label}</p>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5fffe; border:1px solid #ccece9; border-collapse:separate; border-radius:6px; margin:0 0 14px;">
    <tr>
      <td style="color:#0b777a; font-family:${emailFont}; font-size:10px; font-weight:500; line-height:15px; padding:9px 10px; text-align:center; word-break:break-all; overflow-wrap:anywhere;">
        ${href}
      </td>
    </tr>
  </table>`;

export const renderAlertBox = (
  title: string,
  text: string,
  tone: AlertTone = 'warning'
) => {
  const styles = toneStyles[tone];

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${styles.bg}; border:0; border-collapse:separate; border-radius:7px; margin:0 0 14px;">
      <tr>
        <td width="34" valign="top" style="padding:11px 0 11px 12px;">
          <span style="display:inline-block; background:${styles.iconBg}; border:1px solid ${styles.iconBorder}; border-radius:50%; color:${styles.icon}; font-family:${emailFont}; font-size:11px; font-weight:700; height:20px; line-height:20px; text-align:center; width:20px;">${styles.symbol}</span>
        </td>
        <td valign="top" style="padding:11px 12px 11px 7px;">
          <p style="margin:0; color:${styles.text}; font-family:${emailFont}; font-size:10px; font-weight:500; line-height:15px;">
            <strong style="color:${styles.title};">${title}:</strong> ${text}
          </p>
        </td>
      </tr>
    </table>`;
};

export const renderDetailsCard = (
  title: string,
  rows: Array<{ label: string; value: string }>
) => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fbfffe; border:1px solid #d8e9ec; border-collapse:separate; border-radius:7px; margin:0 0 14px;">
    <tr>
      <td colspan="2" style="padding:11px 13px 5px; color:#0d696d; font-family:${emailFont}; font-size:12px; font-weight:700; line-height:17px;">
        ${title}
      </td>
    </tr>
    ${rows
      .map(
        (row) => `
          <tr>
            <td class="details-label" style="padding:7px 10px 7px 13px; color:#263b40; font-family:${emailFont}; font-size:11px; line-height:16px; font-weight:700; width:120px;">
              ${row.label}
            </td>
            <td class="details-value" style="padding:7px 13px 7px 0; color:#52646e; font-family:${emailFont}; font-size:11px; font-weight:500; line-height:16px;">
              ${row.value}
            </td>
          </tr>`
      )
      .join('')}
  </table>`;

export const renderDivider = () => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse; margin:17px 0 13px;">
    <tr>
      <td style="border-top:1px solid #e4efed; font-size:0; line-height:0;">&nbsp;</td>
    </tr>
  </table>`;

export const renderEmailLayout = ({
  title,
  preview,
  greeting,
  headline,
  message,
  bodyHtml,
  email,
  phone,
  helpText = "If you didn't request this email or need assistance,<br />please contact our support team.",
}: EmailLayoutParams) => {
  const images = getEmailImages();
  const support = getSupportInfo({ email, phone });

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&display=swap" rel="stylesheet" />

  <style>
    img {
      border: 0;
      outline: none;
      text-decoration: none;
      -ms-interpolation-mode: bicubic;
    }

    a {
      text-decoration: none;
    }

    a[x-apple-data-detectors] {
      color: inherit !important;
      text-decoration: none !important;
    }

    @media only screen and (max-width: 430px) {
      .outer-pad {
        padding: 0 !important;
      }

      .email-shell {
        width: 100% !important;
        max-width: 100% !important;
        border-left: 0 !important;
        border-right: 0 !important;
        border-radius: 0 !important;
      }

      .top-pad,
      .main-pad {
        padding-left: 18px !important;
        padding-right: 18px !important;
      }

      .brand-logo {
        width: 112px !important;
        max-width: 112px !important;
      }

      .mail-hero {
        width: 158px !important;
        max-width: 158px !important;
      }

      .hero-copy {
        width: 68% !important;
        padding-right: 8px !important;
      }

      .secure-cell {
        width: 32% !important;
        text-align: right !important;
      }

      .secure-img {
        width: 62px !important;
        max-width: 62px !important;
        margin-left: auto !important;
      }

      .cta-link {
        min-width: 174px !important;
        padding-left: 20px !important;
        padding-right: 20px !important;
      }

      .details-label,
      .details-value {
        display: block !important;
        width: auto !important;
        padding-left: 13px !important;
        padding-right: 13px !important;
      }

      .details-value {
        padding-top: 0 !important;
      }
    }
  </style>
</head>

<body style="margin:0; padding:0; background:#eef8f6; font-family:${emailFont}; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%;">
  <div style="display:none; max-height:0; overflow:hidden; opacity:0; color:transparent;">
    ${preview}
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef8f6; border-collapse:collapse;">
    <tr>
      <td class="outer-pad" align="center" style="padding:0 10px 24px;">
        <table class="email-shell" role="presentation" width="550" cellpadding="0" cellspacing="0" style="background:#ffffff; border:1px solid #dcefed; border-collapse:separate; border-radius:9px; max-width:550px; overflow:hidden; width:550px;">

          <tr>
            <td class="top-pad" style="border-bottom:1px solid #eef4f3; padding:0 24px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                <tr>
                  <td align="left" valign="middle" style="padding:24px 0 21px;">
                    <img class="brand-logo" src="${images.logo}" alt="Infinity Medisetu" width="124" style="display:block; height:auto; max-width:124px; width:124px;" />
                  </td>

                  <td align="right" valign="middle" style="padding:0; font-size:0; line-height:0;">
                    <img class="mail-hero" src="${images.mailIcon}" alt="" width="178" style="display:block; height:auto; margin-left:auto; max-width:178px; width:178px;" />
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td class="main-pad" style="padding:16px 24px 0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                <tr>
                  <td class="hero-copy" valign="middle" width="68%" style="padding:0 10px 0 0; vertical-align:middle;">
                    <h1 style="color:#25383b; font-family:${emailFont}; font-size:12px; line-height:16px; margin:0 0 5px; font-weight:700;">
                      ${greeting}
                    </h1>

                    <p style="color:#0d6f73; font-family:${emailFont}; font-size:13px; line-height:17px; margin:0 0 9px; font-weight:700;">
                      ${headline}
                    </p>

                    <p style="color:#596872; font-family:${emailFont}; font-size:10px; font-weight:500; line-height:16px; margin:0;">
                      ${message}
                    </p>
                  </td>

                  <td class="secure-cell" align="right" valign="middle" width="32%" style="padding:0 12px 0 0; text-align:right; vertical-align:middle;">
                    <img class="secure-img" src="${images.secure}" alt="" width="70" style="display:block; height:auto; margin:0 0 0 auto; max-width:70px; width:70px;" />
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td class="main-pad" style="padding:0 24px 20px;">
              ${bodyHtml}

              <div style="text-align:center; margin:14px 0 14px;">
                <p style="color:#0d6f73; font-family:${emailFont}; font-size:13px; line-height:17px; margin:0 0 6px; font-weight:700;">
                  Need help?
                </p>

                <p style="color:#6f7d84; font-family:${emailFont}; font-size:11px; font-weight:500; line-height:16px; margin:0;">
                  ${helpText}
                </p>

                <p style="color:#0d6f73; font-family:${emailFont}; font-size:11px; font-weight:500; line-height:16px; margin:11px 0 0;">
                  <a class="contact-link" href="tel:${support.phone.replace(/\s/g, '')}" style="color:#0d6f73; text-decoration:none;">
                    ${support.phone}
                  </a>

                  <span style="color:#aab6bd; padding:0 9px;">|</span>

                  <a class="contact-link" href="mailto:${support.email}" style="color:#0d6f73; text-decoration:none;">
                    ${support.email}
                  </a>
                </p>
              </div>
            </td>
          </tr>

          <tr>
            <td style="border-top:1px solid #e4efed; padding:16px 24px 18px; text-align:center;">
              <p style="color:#8a969c; font-family:${emailFont}; font-size:9px; line-height:13px; margin:0 0 4px;">
                Powered By
              </p>

              <p style="color:#243033; font-family:${emailFont}; font-size:10px; line-height:14px; margin:0; font-weight:700;">
                Infinity Genesis Techso Pvt. Ltd.
              </p>

              <p style="color:#8a969c; font-family:${emailFont}; font-size:9px; line-height:13px; margin:5px 0 0;">
                &copy; ${new Date().getFullYear()} Infinity Medisetu. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
};
