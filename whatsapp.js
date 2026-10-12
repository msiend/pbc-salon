// Durable confirmations: HTTP acceptance is not proof of delivery to the phone.
export function whatsappConfig(env = process.env) {
  const config = {
    token: env.WHATSAPP_ACCESS_TOKEN,
    phoneId: env.WHATSAPP_PHONE_NUMBER_ID,
    template: env.WHATSAPP_TEMPLATE_NAME,
    language: env.WHATSAPP_TEMPLATE_LANGUAGE || 'en',
    version: env.WHATSAPP_API_VERSION || 'v23.0',
    baseUrl: env.PUBLIC_BASE_URL,
  };
  try {
    const url = new URL(config.baseUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') return null;
    config.baseUrl = url.origin;
  } catch { return null; }
  if (!config.token || !/^\d+$/.test(config.phoneId || '') || !/^[a-z0-9_]+$/.test(config.template || '') || !/^v\d+\.\d+$/.test(config.version) || !/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(config.language)) return null;
  return config;
}
export function templatePayload(lead, config) {
  const expiry = new Date(lead.expires_at).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric', timeZone:'Asia/Kolkata' });
  return {
    messaging_product: 'whatsapp', to: '91' + lead.mobile, type: 'template',
    template: { name: config.template, language: { code: config.language }, components: [{
      type: 'body', parameters: [lead.name, lead.code, String(lead.discount), expiry, config.baseUrl + '/coupon/' + lead.token]
        .map(text => ({ type: 'text', text: text.replace(/\s+/g, ' ').trim() }))
    }] }
  };
}
export function createWhatsAppWorker(db, {config = whatsappConfig(), fetchImpl = fetch, now = Date.now} = {}) {
  let busy = false;
  // A crash while sending is ambiguous: automatic replay could send twice.
  db.prepare("UPDATE whatsapp_messages SET status='unknown',error='Interrupted request; check Meta before sending again' WHERE status='sending'").run();
  async function processNext() {
    if (!config || busy) return;
    busy = true;
    try {
      const job = db.prepare("SELECT w.lead_id,w.attempts,l.* FROM whatsapp_messages w JOIN leads l ON l.id=w.lead_id WHERE w.status='pending' AND w.next_attempt<=? ORDER BY w.lead_id LIMIT 1").get(now());
      if (!job) return;
      if (job.expires_at <= now()) {
        db.prepare("UPDATE whatsapp_messages SET status='failed',error='Coupon expired; not sent' WHERE lead_id=?").run(job.lead_id);
        return;
      }
      const acquired = db.prepare("UPDATE whatsapp_messages SET status='sending',attempts=attempts+1 WHERE lead_id=? AND status='pending'").run(job.lead_id);
      if (!acquired.changes) return;
      let response, data;
      try {
        response = await fetchImpl(`https://graph.facebook.com/${config.version}/${config.phoneId}/messages`, {
          method:'POST', redirect:'error', signal:AbortSignal.timeout(10000),
          headers:{ Authorization:'Bearer ' + config.token, 'Content-Type':'application/json' },
          body:JSON.stringify(templatePayload(job, config))
        });
        data = await response.json();
      } catch {
        db.prepare("UPDATE whatsapp_messages SET status='unknown',error='Network timeout or unreadable response; check Meta before retrying' WHERE lead_id=?").run(job.lead_id);
        return;
      }
      if (response.ok && typeof data?.messages?.[0]?.id === 'string') {
        db.prepare("UPDATE whatsapp_messages SET status='accepted',message_id=?,error='',accepted_at=? WHERE lead_id=?").run(data.messages[0].id,now(),job.lead_id);
      } else if (response.status === 429 && job.attempts < 2) {
        db.prepare("UPDATE whatsapp_messages SET status='pending',next_attempt=?,error='Rate limited; retry scheduled' WHERE lead_id=?").run(now()+60000,job.lead_id);
      } else {
        // Do not store provider text: it can contain phone numbers or credentials.
        const code = Number.isInteger(data?.error?.code) ? '; Meta code ' + data.error.code : '';
        const status = response.status >= 500 || response.ok ? 'unknown' : 'failed';
        db.prepare('UPDATE whatsapp_messages SET status=?,error=? WHERE lead_id=?').run(status,'HTTP '+response.status+code,job.lead_id);
      }
    } finally { busy = false; }
  }
  return { configured:!!config, processNext };
}
