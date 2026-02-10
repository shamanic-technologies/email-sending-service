import type { EmailType } from "../schemas";

const UNSUBSCRIBE_LINKS: Record<EmailType, string> = {
  transactional: "{{{pm:unsubscribe}}}",
  broadcast: "{{unsubscribe_url}}",
};

export function buildSignature(type: EmailType, brandUrl?: string): string {
  const unsubscribeUrl = UNSUBSCRIBE_LINKS[type];
  const brandDisplay = brandUrl || "BRAND_URL";
  const brandHref = brandUrl || "BRAND_URL";

  return `
<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0 16px" />
<table cellpadding="0" cellspacing="0" style="font-family:system-ui,-apple-system,sans-serif;font-size:13px;color:#374151;line-height:1.4">
  <tr>
    <td style="padding-right:14px;vertical-align:top">
      <img src="https://media.licdn.com/dms/image/v2/D4E03AQExHRKHGkfXdA/profile-displayphoto-shrink_200_200/profile-displayphoto-shrink_200_200/0/1696248223118?e=2147483647&v=beta&t=B8ASFxYpZNDdcCSZ3NS_-OhnBgDYQPb4Z5HuIjsBrrE" alt="Kevin Lourd" width="56" height="56" style="border-radius:50%;display:block" />
    </td>
    <td style="vertical-align:top">
      <p style="margin:0;font-weight:600;color:#111827">Kevin Lourd</p>
      <p style="margin:2px 0 0;color:#6b7280">Growth Agency</p>
      <p style="margin:2px 0 0">
        <a href="https://growthagency.dev" style="color:#10b981;text-decoration:none;font-weight:500">GrowthAgency.dev</a>
      </p>
    </td>
  </tr>
</table>
<p style="margin:12px 0 0;font-size:11px;color:#9ca3af;font-style:italic">Email generated with AI on behalf of our client: <a href="${brandHref}" style="color:#9ca3af">${brandDisplay}</a></p>
<p style="margin:6px 0 0;font-size:11px;color:#b5b5b5">
  <a href="${unsubscribeUrl}" style="color:#b5b5b5;text-decoration:underline">Unsubscribe</a> to stop receiving sales cold emails from us
</p>`;
}

export function appendSignature(htmlBody: string | undefined, type: EmailType, brandUrl?: string): string | undefined {
  if (!htmlBody) return undefined;
  return htmlBody + buildSignature(type, brandUrl);
}
