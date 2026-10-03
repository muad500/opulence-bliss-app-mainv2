import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

const source = await readFile(
  new URL('../lib/handymanServer.ts', import.meta.url), 'utf8'
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    esModuleInterop: true
  }
}).outputText;

function harness(overrides = {}) {
  let now = Date.UTC(2026, 9, 3, 12);
  const j = {
    id: 'job', customer_id: 'customer', provider_id: 'provider',
    payout_account_id: 'acct_own', task_name: 'Furniture assembly',
    held_pence: 5000, status: 'payment_pending', checkout_session: 'cs_new',
    payment_intent: 'pi_new', previous_payment_intent: null,
    transfer_ref: null, approved_at: '2026-10-03T12:00:00Z',
    bill: { gross: 5000, provider: 4000, platform: 1000 }, ...overrides
  };
  const intent = (id, fields = {}) => ({
    id, amount: 5000, amount_capturable: 5000, amount_received: 0,
    currency: 'gbp', status: 'requires_capture', capture_method: 'manual',
    latest_charge: null,
    metadata: { job_id: j.id, customer_id: j.customer_id, kind: 'handyman', revision: 'final' },
    ...fields
  });
  const a = {
    id: 'attempt_new', job_id: j.id, revision: 'final', amount_pence: 5000,
    parameters: null, session_id: 'cs_new', payment_intent: 'pi_new',
    status: 'attached', legacy: false
  };
  const tables = {
    handyman_jobs: [j],
    providers: [{ id: 'provider', stripe_account_id: 'acct_own' }],
    handyman_payment_attempts: [a]
  };
  const calls = { create: [], cancel: [], capture: [], transfer: [], rpc: [] };
  const sessions = new Map(), transfers = [];
  const intents = new Map([['pi_new', intent('pi_new')]]);
  let cancelHook = null, rpcHook = null, captureHook = null;
  class Query {
    constructor(table) {
      this.table = table; this.filters = []; this.change = null;
    }
    select() { return this; }
    eq(key, value) {
      this.filters.push(row => row[key] === value); return this;
    }
    in(key, values) {
      this.filters.push(row => values.includes(row[key])); return this;
    }
    order() { return this; }
    limit() { return this; }
    update(fields) { this.change = fields; return this; }
    rows() {
      const rows = this.table.filter(row =>
        this.filters.every(filter => filter(row)));
      if (this.change) for (const row of rows) Object.assign(row, this.change);
      return rows;
    }
    async single() {
      const rows = this.rows();
      return { data: rows.length === 1 ? rows[0] : null,
        error: rows.length === 1 ? null : new Error('Not a single row') };
    }
    async maybeSingle() {
      const rows = this.rows();
      return { data: rows[0] ?? null, error: rows.length > 1 ? Error() : null };
    }
    then(resolve, reject) {
      return Promise.resolve({ data: this.rows(), error: null })
        .then(resolve, reject);
    }
  }
  const admin = {
    from: name => new Query(tables[name] ?? []),
    async rpc(name, p) {
      calls.rpc.push({ name, p });
      if (rpcHook) {
        const result = await rpcHook(name, p);
        if (result !== undefined) return result;
      }
      if (name === 'finish_handyman_hold_release') {
        const row = tables.handyman_payment_attempts
          .find(x => x.id === p.p_attempt);
        row.status = 'released';
        if (j.previous_payment_intent === p.p_intent)
          j.previous_payment_intent = null;
        return { data: null, error: null };
      }
      if (name === 'reauthorise_handyman_bill') {
        j.status = 'awaiting_authorization';
        return { data: j, error: null };
      }
      if (name === 'record_handyman_session') {
        const row = tables.handyman_payment_attempts
          .find(x => x.id === p.p_attempt);
        row.session_id = p.p_session;
        if (row.status === 'creating') row.status = 'open';
        j.checkout_session = p.p_session;
        return { data: row, error: null };
      }
      throw new Error('Unexpected RPC ' + name);
    }
  };
  const stripe = {
    accounts: { async retrieve(id) {
      assert.equal(id, 'acct_own');
      return { capabilities: { transfers: 'active' } };
    } },
    checkout: { sessions: {
      async retrieve(id) { return sessions.get(id); },
      async *list() { yield* sessions.values(); },
      async create(parameters, options) {
        calls.create.push({ parameters: structuredClone(parameters), options });
        const row = {
          id: 'cs_' + calls.create.length, status: 'open',
          url: 'https://checkout.test', mode: 'payment',
          client_reference_id: j.customer_id, metadata: parameters.metadata,
          payment_intent: null
        };
        sessions.set(row.id, row); return row;
      }
    } },
    charges: { async retrieve() {
      return {
        payment_method_details: { card: { capture_before: now / 1000 + 3600 } }
      };
    } },
    paymentIntents: {
      async retrieve(id) { return intents.get(id); },
      async cancel(id) {
        calls.cancel.push(id);
        if (cancelHook) await cancelHook(id);
        const pi = intents.get(id);
        pi.status = 'canceled'; pi.amount_capturable = 0; return pi;
      },
      async capture(id, p) {
        calls.capture.push(id);
        if (captureHook) await captureHook(id);
        const pi = intents.get(id);
        pi.status = 'succeeded'; pi.amount_received = p.amount_to_capture;
        pi.amount_capturable = 0; pi.latest_charge = 'ch_paid'; return pi;
      }
    },
    transfers: {
      async list() { return { data: transfers, has_more: false }; },
      async create(p) {
        calls.transfer.push(p);
        const row = { id: 'tr_own', ...p, reversed: false, amount_reversed: 0 };
        transfers.push(row); return row;
      }
    }
  };
  const exports = {}, ActualDate = Date;
  class TestDate extends ActualDate {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const require = name => {
    if (name === 'server-only') return {};
    if (name === 'stripe') return class {};
    if (name === 'next/server') return { NextResponse: {} };
    if (name === '@/lib/accountApi') return {};
    if (name === '@/lib/handymanMarketplace')
      return { handymanEnabled: () => true };
    if (name === '@/lib/accountBilling')
      return { getOrCreateBillingCustomer: async () => 'cus_owned' };
    throw new Error('Unexpected import ' + name);
  };
  vm.runInNewContext(compiled, { exports, require, Date: TestDate });
  function session(row = a, pi = intents.get('pi_new')) {
    return {
      id: row.session_id, mode: 'payment', status: 'complete',
      client_reference_id: j.customer_id, payment_intent: pi.id,
      metadata: {
        kind: 'handyman', job_id: j.id, revision: row.revision, attempt_id: row.id
      }
    };
  }
  return {
    api: exports, j, a, tables, calls, stripe, admin, intents,
    intent, session, sessions,
    setNow: value => { now = value; },
    setRpc: fn => { rpcHook = fn; },
    setCancel: fn => { cancelHook = fn; },
    setCapture: fn => { captureHook = fn; }
  };
}

test('105: checkout retry reuses its open session and immutable parameters', async () => {
  const h = harness({
    status: 'checkout_pending', payment_intent: null, bill: null
  });
  Object.assign(h.a, {
    status: 'creating', payment_intent: null, session_id: null,
    revision: 'initial', parameters: {
      customer: 'cus_owned', client_reference_id: 'customer',
      expires_at: Date.UTC(2026, 9, 3, 13) / 1000,
      metadata: { kind: 'handyman', job_id: 'job', attempt_id: h.a.id }
    }
  });
  h.setRpc(name => name === 'begin_handyman_checkout'
    ? { data: h.a, error: null } : undefined);
  const first = await h.api.handymanCheckout(
    h.stripe, h.admin, h.j, { id: 'customer' }, 'https://preview.test'
  );
  h.setNow(Date.UTC(2026, 9, 3, 12, 1));
  const second = await h.api.handymanCheckout(
    h.stripe, h.admin, h.j, { id: 'customer' }, 'https://other-preview.test'
  );
  assert.equal(first.url, second.url);
  assert.equal(h.calls.create.length, 1);
  assert.equal(h.calls.create[0].options.idempotencyKey,
    'handyman-checkout-attempt_new');
});

test('105: unknown session-create outcome is reconciled before another create', async () => {
  const h = harness({
    status: 'checkout_pending', payment_intent: null, bill: null
  });
  Object.assign(h.a, {
    status: 'creating', session_id: null, payment_intent: null,
    revision: 'initial', parameters: {
      customer: 'cus_owned', expires_at: Date.UTC(2026, 9, 3, 13) / 1000
    }
  });
  h.sessions.set('cs_existing', {
    id: 'cs_existing', status: 'open', url: 'https://checkout.existing',
    metadata: { attempt_id: h.a.id }
  });
  h.setRpc(name => name === 'begin_handyman_checkout'
    ? { data: h.a, error: null } : undefined);
  const result = await h.api.handymanCheckout(
    h.stripe, h.admin, h.j, { id: 'customer' }, 'https://preview.test'
  );
  assert.equal(result.url, 'https://checkout.existing');
  assert.equal(h.calls.create.length, 0);
  assert.equal(h.a.session_id, 'cs_existing');
});

test('106: expired hold requests authorisation without capture or transfer', async () => {
  const h = harness();
  h.intents.get('pi_new').status = 'canceled';
  const bill = JSON.stringify(h.j.bill);
  await assert.rejects(
    h.api.settleHandyman(h.admin, h.stripe, h.j), /earlier card hold expired/
  );
  assert.equal(h.j.status, 'awaiting_authorization');
  assert.equal(JSON.stringify(h.j.bill), bill);
  assert.equal(h.calls.capture.length + h.calls.transfer.length, 0);
});

test('106: expiry during capture is recovered from the actual Stripe status', async () => {
  const h = harness();
  h.setCapture(() => {
    h.intents.get('pi_new').status = 'canceled';
    throw new Error('Authorisation expired during capture');
  });
  await assert.rejects(
    h.api.settleHandyman(h.admin, h.stripe, h.j), /hold expired/
  );
  assert.equal(h.j.status, 'awaiting_authorization');
  assert.equal(h.calls.transfer.length, 0);
});

test('107: rejected reservation persists release work and later delivery retries it', async () => {
  const h = harness({
    payment_intent: null, status: 'checkout_pending'
  });
  h.a.payment_intent = null; h.a.status = 'open';
  const pi = h.intents.get('pi_new'), session = h.session(h.a, pi);
  h.setRpc(name => {
    if (name !== 'finalize_handyman_attempt') return undefined;
    h.a.payment_intent = pi.id; h.a.status = 'release_pending';
    return {
      data: { decision: 'release', job: h.j, attempt: h.a }, error: null
    };
  });
  h.setCancel(() => { throw new Error('Stripe temporarily unavailable'); });
  await assert.rejects(h.api.finalizeHandymanCheckout(
    h.admin, h.stripe, session, pi
  ), /Stripe temporarily unavailable/);
  assert.equal(h.a.payment_intent, pi.id);
  assert.equal(h.a.status, 'release_pending');
  h.setCancel(null);
  await h.api.finalizeHandymanCheckout(h.admin, h.stripe, session, pi);
  assert.equal(h.a.status, 'released');
  assert.equal(pi.status, 'canceled');
  assert.equal(h.calls.capture.length, 0);
});

test('107: lost successful finalisation response never cancels attached hold', async () => {
  const h = harness({
    payment_intent: null, status: 'checkout_pending'
  });
  h.a.payment_intent = null; h.a.status = 'open';
  const pi = h.intents.get('pi_new'), session = h.session(h.a, pi);
  h.setRpc(name => {
    if (name !== 'finalize_handyman_attempt') return undefined;
    h.a.payment_intent = pi.id; h.a.status = 'attached';
    h.j.payment_intent = pi.id; h.j.status = 'scheduled';
    return { data: null, error: new Error('Connection lost after commit') };
  });
  await assert.rejects(h.api.finalizeHandymanCheckout(
    h.admin, h.stripe, session, pi
  ), /Payment record needs a retry/);
  await h.api.finalizeHandymanCheckout(h.admin, h.stripe, session, pi);
  assert.equal(h.calls.cancel.length, 0);
});

test('108: known-current retry resumes failed previous-hold cleanup', async () => {
  const h = harness({ previous_payment_intent: 'pi_old' });
  const old = {
    ...h.a, id: 'attempt_old', session_id: 'cs_old',
    payment_intent: 'pi_old', status: 'release_pending'
  };
  h.tables.handyman_payment_attempts.push(old);
  h.intents.set('pi_old', h.intent('pi_old'));
  h.setCancel(() => { throw Error('Release failed'); });
  const pi = h.intents.get('pi_new');
  await assert.rejects(h.api.finalizeHandymanCheckout(
    h.admin, h.stripe, h.session(), pi
  ), /Release failed/);
  h.setCancel(null);
  await h.api.finalizeHandymanCheckout(h.admin, h.stripe, h.session(), pi);
  assert.equal(h.j.previous_payment_intent, null);
  assert.equal(old.status, 'released');
  assert.equal(h.intents.get('pi_new').status, 'requires_capture');
});

test('108: cancelled prior hold survives failed database acknowledgement', async () => {
  const h = harness({ previous_payment_intent: 'pi_old' });
  const old = {
    ...h.a, id: 'attempt_old', session_id: 'cs_old',
    payment_intent: 'pi_old', status: 'release_pending'
  };
  h.tables.handyman_payment_attempts.push(old);
  h.intents.set('pi_old', h.intent('pi_old', { status: 'canceled' }));
  h.setRpc(name => name === 'finish_handyman_hold_release'
    ? { data: null, error: Error('Database unavailable') } : undefined);
  await assert.rejects(h.api.finalizeHandymanCheckout(
    h.admin, h.stripe, h.session(), h.intents.get('pi_new')
  ), /Payment record needs a retry/);
  h.setRpc(null);
  await h.api.finalizeHandymanCheckout(
    h.admin, h.stripe, h.session(), h.intents.get('pi_new')
  );
  assert.equal(h.calls.cancel.length, 0);
  assert.equal(h.j.previous_payment_intent, null);
});

test('109: delayed checkout after capture acknowledges without moving money', async () => {
  const h = harness({ status: 'completed', transfer_ref: 'tr_own' });
  Object.assign(h.intents.get('pi_new'), {
    status: 'succeeded', amount_received: 5000, amount_capturable: 0
  });
  await h.api.finalizeHandymanCheckout(
    h.admin, h.stripe, h.session(), h.intents.get('pi_new')
  );
  assert.equal(h.calls.rpc.length, 0);
  assert.equal(
    h.calls.cancel.length + h.calls.capture.length + h.calls.transfer.length, 0
  );
});

test('109: delayed event for released replaced intent is harmless', async () => {
  const h = harness({ status: 'completed', transfer_ref: 'tr_own' });
  const old = {
    ...h.a, id: 'attempt_old', session_id: 'cs_old',
    payment_intent: 'pi_old', status: 'released'
  };
  h.tables.handyman_payment_attempts.push(old);
  const pi = h.intent('pi_old', {
    status: 'canceled', amount_capturable: 0
  });
  h.intents.set(pi.id, pi);
  await h.api.finalizeHandymanCheckout(
    h.admin, h.stripe, h.session(old, pi), pi
  );
  assert.equal(
    h.calls.cancel.length + h.calls.capture.length + h.calls.transfer.length, 0
  );
});

test('109: known intent cannot bypass checkout ownership validation', async () => {
  const h = harness(), session = h.session();
  session.client_reference_id = 'another_customer';
  await assert.rejects(h.api.finalizeHandymanCheckout(
    h.admin, h.stripe, session, h.intents.get('pi_new')
  ), /Checkout owner does not match/);
});

test('settlement retry reconciles earlier transfer instead of creating another', async () => {
  const h = harness();
  await h.api.settleHandyman(h.admin, h.stripe, h.j);
  h.j.status = 'payment_pending'; h.j.transfer_ref = null;
  await h.api.settleHandyman(h.admin, h.stripe, h.j);
  assert.equal(h.calls.capture.length, 1);
  assert.equal(h.calls.transfer.length, 1);
  assert.equal(h.calls.transfer[0].destination, 'acct_own');
});

test('recovery cannot release current payment', async () => {
  const h = harness(); h.a.status = 'release_pending';
  await assert.rejects(
    h.api.releaseHandymanAttempt(h.admin, h.stripe, h.a),
    /Current payment cannot be released/
  );
  assert.equal(h.calls.cancel.length, 0);
});
