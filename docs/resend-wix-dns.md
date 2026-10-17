# Resend DNS records for opulencebliss.com

Read directly from the client's Resend domain on 18 October 2026:
https://resend.com/domains/f5dadd53-b441-41ac-a966-f9677b24ce1c

Status: **Not Started**. Sending is on; receiving is off. Region: Ireland.
No Wix records were changed and verification was not started by this audit.

In Wix, enter the host labels below without appending `opulencebliss.com` a second
time. Use the default TTL (30 minutes is fine); Resend displays Auto.

Required for sending:

1. **TXT** — host `resend._domainkey`, value:

   ```text
   p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDoWA8w/pvrBW+lsMl9Tl7amkUTClg+fuOsk3rHSBVFBactvALhoZ1gQUCjdDMc+KnJsaZ4sCAjzzGVNL4M90VEfXZexMXIK8OLm917UcdsSwVXEP2QhxDE3W0c8j7KbuBglhzdav6mSWC6driqgmvX0KHkqduSNk4m5Pss57Q2pwIDAQAB
   ```

   This is a public DKIM verification record, not a private API key.

2. **CNAME** — host `rsend`, value `rsend-euw1.forge.rmta.net`.
3. **CNAME** — host `send`, value `send.forge.rmta.net`.

Also displayed by this domain's Resend dashboard:

- Optional **TXT** — host `_dmarc`, value `v=DMARC1; p=none;`.
  If DMARC already exists, retain/reconcile that policy; do not add a second record.
- Tracking **CNAME** — host `links`, value `links2.resend-dns.com`, if email
  tracking is to be enabled. This is not a requirement for sending ordinary emails.

Keep the website A record, `www` and `admin` records, and any existing mailbox MX
records. This Resend configuration does not ask for an MX record for sending.

After the client adds the records, verify the domain in Resend. Then configure a
separate restricted staging sender key and approved sender in the staging worker
secrets, and test a real warning/cancellation email. Queued notices are not proof
of email delivery. Do not reuse or read the Production key for staging.
