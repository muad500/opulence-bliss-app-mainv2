// Staging-only audit helper. Do not include this commit in a Production merge.
import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { createVisitBilling } from "@/lib/visitBillingServer";
import { regularVisitSlots } from "@/lib/regularBooking";
import { cleaningSeriesQuote } from "@/lib/cleaningExtras";
import { visitLineItems } from "@/lib/visitLineItems";

export const maxDuration = 60;
function checked<T>(result: { data: T; error: { message: string } | null }) {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}
function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function guarded(request: NextRequest) {
  const key =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const secret = process.env.CRON_SECRET ?? "";
  return (
    process.env.VERCEL_ENV === "preview" &&
    process.env.NEXT_PUBLIC_SUPABASE_URL ===
      "https://comwdjprdedmsnxtvuuk.supabase.co" &&
    process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_") &&
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.startsWith("pk_test_") &&
    secret &&
    Buffer.byteLength(secret) === Buffer.byteLength(key) &&
    timingSafeEqual(Buffer.from(secret), Buffer.from(key))
  );
}

export async function POST(request: NextRequest) {
  if (!guarded(request))
    return NextResponse.json(
      { error: "Staging test configuration or authorisation is missing." },
      { status: 403 },
    );
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const engine = createVisitBilling(admin, stripe);
  const runId = randomUUID();
  let fixtureIds: string[] = [];
  try {
    const body = await request.json();
    const name = String(body.case);
    const account = await stripe.accounts.retrieveCurrent();
    assert(
      account.id === "acct_1UKQ4A2NzINBHbzj",
      "Preview is not using the expected staging sandbox.",
    );
    const testAccount = process.env.PROVIDER_TEST_ACCOUNT;
    assert(testAccount, "A staging connected account is missing.");
    await stripe.accounts.retrieve(testAccount);
    if (name === "configuration")
      return NextResponse.json({
        accountId: account.id,
        mode: "test",
        database: "comwdjprdedmsnxtvuuk",
        webhookConfigured:
          process.env.STRIPE_WEBHOOK_SECRET?.startsWith("whsec_"),
        connectedAccountAccessibleWithTestKey: true,
        perVisitEnabled: process.env.CLEANING_PAY_PER_VISIT_ENABLED === "true",
      });
    assert(
      [
        "one_off",
        "regular",
        "failed_charge",
        "deadline",
        "paid_extras",
        "unpaid_extras",
        "unfilled",
        "lost_confirm",
        "lost_refund",
        "cancellation_full",
        "cancellation_75",
        "cancellation_50",
        "cancellation_same_day",
      ].includes(name),
      "Unknown fixed audit case.",
    );
    const email = `billing-audit-${runId}@example.invalid`;
    const createdResponse = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { full_name: "Staging billing audit fixture" },
    });
    if (createdResponse.error)
      throw new Error("Could not create the disposable staging customer.");
    const created = createdResponse.data;
    assert(created.user, "Could not create the disposable staging customer.");
    const user = created.user.id;
    const customer = await stripe.customers.create({
      email,
      metadata: { staging_audit: runId, opulence_user_id: user },
    });
    checked(
      await admin
        .from("account_billing_customers")
        .insert({ user_id: user, stripe_customer_id: customer.id }),
    );
    const card = await stripe.paymentMethods.create({
      type: "card",
      card: { token: "tok_visa" },
    });
    await stripe.paymentMethods.attach(card.id, { customer: customer.id });
    await stripe.customers.update(customer.id, {
      invoice_settings: { default_payment_method: card.id },
    });
    const regular = [
      "regular",
      "failed_charge",
      "deadline",
      "unpaid_extras",
      "lost_confirm",
    ].includes(name);
    const pkg = checked(
      await admin
        .from("packages")
        .select("id,name,price,duration_minutes,service_type")
        .eq("name", regular ? "Essential Clean" : "One-Time Essential Clean")
        .eq("active", true)
        .single(),
    );
    assert(pkg, "Required cleaning package is missing.");
    const first = new Date(Date.now() + 7 * 86_400_000);
    first.setUTCHours(10, 0, 0, 0);
    const slots = regular
      ? regularVisitSlots(first.toISOString(), "weekly", 120, Date.now(), 6)
      : [first.toISOString()];
    const initialExtras = name === "lost_refund" ? ["oven"] : [];
    const quotes = cleaningSeriesQuote(
      pkg,
      120,
      initialExtras,
      false,
      slots.length,
    ).quotes;
    const plan = quotes.map((quote) => ({
      baseMinutes: 120,
      basePricePence: quote.basePence,
      addons: quote.addons.map((addon) => addon.id),
      bringsProducts: false,
      petsAtHome: false,
      durationMinutes: quote.durationMinutes,
      grossPence: quote.totalPence,
      netPence: quote.totalPence,
      discountPence: 0,
      lineItems: visitLineItems(quote),
      billingModel: "per_visit",
      payRatePending: true,
      notes: "Disposable Stripe test fixture",
      cardConsentAt: new Date().toISOString(),
      cardConsentVersion: "visit-billing-v1",
    }));
    // Real automatic Stripe charge + the production finalization RPC. These
    // are API integration tests, not a claim that hosted Checkout was clicked.
    const intent = await stripe.paymentIntents.create({
      amount: plan[0].netPence,
      currency: "gbp",
      customer: customer.id,
      payment_method: card.id,
      payment_method_types: ["card"],
      capture_method: "automatic",
      confirm: true,
      setup_future_usage: "off_session",
      metadata: { kind: "staging_billing_audit", staging_audit: runId },
    });
    assert(
      !intent.livemode && intent.status === "succeeded",
      "Test charge was not captured.",
    );
    const sessionId = `cs_staging_audit_${runId}`;
    checked(
      await admin
        .from("booking_checkout_time_choices")
        .insert({
          checkout_session_id: sessionId,
          customer_id: user,
          preferred_scheduled_at: slots[0],
          optional_scheduled_at: [],
          regular_scheduled_at: regular ? slots : [],
          household_notes: "Disposable staging billing audit",
          cleaning_extras: plan,
        }),
    );
    fixtureIds = checked(
      await admin.rpc("finalize_per_visit_checkout", {
        p_customer: user,
        p_session: sessionId,
        p_intent: intent.id,
        p_package: pkg.id,
        p_address: "128 City Road, London, EC1V 2NX",
        p_notes: "Disposable staging billing audit",
        p_frequency: regular ? "weekly" : "one_time",
        p_slots: slots,
        p_optional: [],
        p_preferred_provider: null,
        p_stripe_customer: customer.id,
        p_method: card.id,
        p_first_amount: intent.amount,
        p_email: email,
      }),
    ) as string[];
    assert(fixtureIds.length === slots.length, "Wrong visit count.");
    let id = regular ? fixtureIds[1] : fixtureIds[0];
    let details = await engine.load(id, user);
    if (name === "one_off" || name === "regular") {
      assert(
        (await engine.load(fixtureIds[0], user)).charges.length === 1,
        "First visit charge missing.",
      );
      if (regular)
        assert(
          details.charges.length === 0 && details.bill.status === "unpaid",
          "Later visit charged upfront.",
        );
      const again = checked(
        await admin.rpc("finalize_per_visit_checkout", {
          p_customer: user,
          p_session: sessionId,
          p_intent: intent.id,
          p_package: pkg.id,
          p_address: "128 City Road, London, EC1V 2NX",
          p_notes: "Retry",
          p_frequency: regular ? "weekly" : "one_time",
          p_slots: slots,
          p_optional: [],
          p_preferred_provider: null,
          p_stripe_customer: customer.id,
          p_method: card.id,
          p_first_amount: intent.amount,
          p_email: email,
        }),
      ) as string[];
      assert(
        JSON.stringify(again) === JSON.stringify(fixtureIds),
        "Checkout retry duplicated bookings.",
      );
    }
    if (
      ["regular", "failed_charge", "deadline", "lost_confirm"].includes(name)
    ) {
      // Move only this disposable unpaid fixture to a valid daytime slot
      // 24–48h away, then exercise the actual due-charge scheduler.
      const dueSlot = new Date(Date.now() + 2 * 86_400_000);
      dueSlot.setUTCHours(8, 0, 0, 0);
      if (dueSlot.getTime() - Date.now() > 48 * 3_600_000)
        dueSlot.setUTCDate(dueSlot.getUTCDate() - 1);
      if (dueSlot.getTime() - Date.now() <= 24 * 3_600_000)
        dueSlot.setUTCHours(18, 0, 0, 0);
      checked(
        await admin
          .from("bookings")
          .update({ scheduled_at: dueSlot.toISOString() })
          .eq("id", id),
      );
      if (["failed_charge", "deadline"].includes(name)) {
        const failing = await stripe.paymentMethods.create({
          type: "card",
          card: { token: "tok_chargeCustomerFail" },
        });
        await stripe.paymentMethods.attach(failing.id, {
          customer: customer.id,
        });
        await stripe.customers.update(customer.id, {
          invoice_settings: { default_payment_method: failing.id },
        });
      }
      const confirm = stripe.paymentIntents.confirm.bind(stripe.paymentIntents);
      if (name === "lost_confirm")
        stripe.paymentIntents.confirm = (async (
          ...args: Parameters<typeof confirm>
        ) => {
          await confirm(...args);
          throw new Stripe.errors.StripeConnectionError({
            message: "Injected loss after real test charge",
          });
        }) as typeof stripe.paymentIntents.confirm;
      try {
        await engine.tick(20, fixtureIds);
      } finally {
        stripe.paymentIntents.confirm =
          confirm as typeof stripe.paymentIntents.confirm;
      }
      details = await engine.load(id, user);
      if (name === "lost_confirm") {
        assert(
          details.bill.active_operation_id,
          "Lost response did not remain recoverable.",
        );
        assert(
          (await engine.run(details.bill.active_operation_id)).status ===
            "succeeded",
          "Known test intent did not recover.",
        );
        details = await engine.load(id, user);
        assert(
          details.charges.length === 1,
          "Recovered charge duplicated payment.",
        );
      }
      if (name === "failed_charge") {
        assert(
          details.bill.status === "failed" && details.charges.length === 0,
          "Decline was not recorded safely.",
        );
        await stripe.customers.update(customer.id, {
          invoice_settings: { default_payment_method: card.id },
        });
        checked(
          await admin
            .from("booking_visit_billing")
            .update({ retry_after: new Date(0).toISOString() })
            .eq("booking_id", id),
        );
        await engine.tick(20, fixtureIds);
        details = await engine.load(id, user);
        assert(
          details.bill.status === "paid" && details.charges.length === 1,
          "Updated-card retry failed.",
        );
      } else if (name === "deadline") {
        assert(details.bill.status === "failed", "Initial failure missing.");
        // Insert an isolated unpaid visit already inside the deadline. Do
        // not weaken the application's customer rescheduling guard to do it.
        const target = new Date(Date.now() + 3 * 3_600_000);
        target.setUTCMinutes(0, 0, 0);
        const hour = Number(
          new Intl.DateTimeFormat("en-GB", {
            timeZone: "Europe/London",
            hour: "numeric",
            hourCycle: "h23",
          }).format(target),
        );
        if (hour < 8 || hour > 17) {
          target.setUTCDate(target.getUTCDate() + (hour > 17 ? 1 : 0));
          target.setUTCHours(9, 0, 0, 0);
        }
        assert(
          target.getTime() > Date.now() &&
            target.getTime() - Date.now() < 24 * 3_600_000,
          "Deadline fixture must be within 24 hours.",
        );
        const deadlineSession = `cs_staging_deadline_${runId}`;
        checked(
          await admin
            .from("booking_checkout_time_choices")
            .insert({
              checkout_session_id: deadlineSession,
              customer_id: user,
              preferred_scheduled_at: target.toISOString(),
              optional_scheduled_at: [],
              cleaning_extras: [plan[1]],
            }),
        );
        const deadline = checked(
          await admin
            .from("bookings")
            .insert({
              customer_id: user,
              package_id: pkg.id,
              checkout_session_id: deadlineSession,
              status: "offered",
              scheduled_at: target.toISOString(),
              preferred_scheduled_at: target.toISOString(),
              optional_scheduled_at: [],
              address: "128 City Road, London, EC1V 2NX",
              duration_minutes: 120,
              offer_expires_at: new Date(
                target.getTime() - 2 * 3_600_000,
              ).toISOString(),
              booking_frequency: "one_time",
            })
            .select("id")
            .single(),
        );
        assert(deadline, "Deadline fixture insert failed.");
        fixtureIds.push(deadline.id);
        checked(
          await admin
            .from("booking_visit_billing")
            .insert({
              booking_id: deadline.id,
              customer_id: user,
              stripe_customer_id: customer.id,
              stripe_payment_method_id: card.id,
              card_consent_at: new Date().toISOString(),
              card_consent_version: "visit-billing-v1",
              charge_due_at: new Date(
                target.getTime() - 48 * 3_600_000,
              ).toISOString(),
              amount_pence: plan[1].netPence,
              base_pence: plan[1].basePricePence,
              line_items: plan[1].lineItems,
              status: "failed",
            }),
        );
        await engine.tick(20, [deadline.id]);
        details = await engine.load(deadline.id, user);
        assert(
          details.booking.status === "cancelled" &&
            details.charges.length === 0,
          "24-hour scheduler did not cancel the unpaid visit safely.",
        );
      } else
        assert(
          details.bill.status === "paid" && details.charges.length === 1,
          "48-hour test charge failed.",
        );
    }
    if (["paid_extras", "unpaid_extras", "lost_refund"].includes(name)) {
      const quote = await engine.quoteExtras(id, user, {
        addons: ["fridge"],
        bringsProducts: true,
      });
      const refundCreate = stripe.refunds.create.bind(stripe.refunds);
      if (name === "lost_refund")
        stripe.refunds.create = (async (
          ...args: Parameters<typeof refundCreate>
        ) => {
          await refundCreate(...args);
          throw new Stripe.errors.StripeConnectionError({
            message: "Injected loss after real test refund",
          });
        }) as typeof stripe.refunds.create;
      let result;
      try {
        result = await engine.changeExtras(id, user, {
          addons: ["fridge"],
          bringsProducts: true,
          revision: quote.revision,
          chargePence: quote.chargePence,
          refundPence: quote.refundPence,
        });
      } finally {
        stripe.refunds.create = refundCreate as typeof stripe.refunds.create;
      }
      if (name === "lost_refund") {
        details = await engine.load(id, user);
        assert(
          details.bill.active_operation_id,
          "Lost refund was not recoverable.",
        );
        result = await engine.run(details.bill.active_operation_id);
      }
      assert(result.status === "succeeded", "Add-on update failed.");
      details = await engine.load(id, user);
      assert(
        details.bill.amount_pence ===
          plan[regular ? 1 : 0].basePricePence + 1500,
        "Add-on or per-visit products price wrong.",
      );
      const remove = await engine.quoteExtras(id, user, {
        addons: [],
        bringsProducts: false,
      });
      assert(
        (
          await engine.changeExtras(id, user, {
            addons: [],
            bringsProducts: false,
            revision: remove.revision,
            chargePence: remove.chargePence,
            refundPence: remove.refundPence,
          })
        ).status === "succeeded",
        "Removing add-ons failed.",
      );
      details = await engine.load(id, user);
      assert(
        details.bill.amount_pence === plan[0].basePricePence,
        "Base rate changed after removing extras.",
      );
      if (!regular)
        assert(
          details.charges.reduce(
            (sum, c) => sum + c.amount_pence - c.refunded_pence,
            0,
          ) === plan[0].basePricePence,
          "Paid removed extras were not refunded in full.",
        );
      else assert(details.charges.length === 0, "Unpaid extras charged early.");
    }
    if (name === "unfilled") {
      checked(
        await admin
          .from("bookings")
          .update({ offer_expires_at: new Date(0).toISOString() })
          .eq("id", id),
      );
      assert(
        (await engine.cancel(id, null, true)).status === "succeeded",
        "No-match refund failed.",
      );
      details = await engine.load(id, user);
      assert(
        details.charges[0].refunded_pence === details.charges[0].amount_pence,
        "No-match refund was partial.",
      );
    }
    if (name.startsWith("cancellation_")) {
      const hours =
        name === "cancellation_full"
          ? 72
          : name === "cancellation_75"
            ? 36
            : name === "cancellation_50"
              ? 18
              : 1;
      // Policy bands are covered by deterministic unit tests. API fixtures
      // use a valid daytime date when the current clock permits each band.
      const target = new Date(Date.now() + hours * 3_600_000);
      const londonHour = Number(
        new Intl.DateTimeFormat("en-GB", {
          timeZone: "Europe/London",
          hour: "numeric",
          hourCycle: "h23",
        }).format(target),
      );
      assert(
        londonHour >= 8 && londonHour <= 17,
        "This clock time cannot create the requested daytime cancellation-band fixture. Use deterministic tests or retry at a suitable time.",
      );
      checked(
        await admin
          .from("bookings")
          .update({ scheduled_at: target.toISOString() })
          .eq("id", id),
      );
      const result = await engine.cancel(id, user);
      assert(result.status === "succeeded", "Cancellation adjustment failed.");
      details = await engine.load(id, user);
      assert(
        details.charges[0].refunded_pence === result.policy.refundPence,
        "Cancellation refunded the wrong amount.",
      );
    }
    const { count } = await admin
      .from("payouts")
      .select("id", { count: "exact", head: true })
      .in("booking_id", fixtureIds);
    assert(count === 0, "Unconfirmed pay created a payout.");
    return NextResponse.json({
      case: name,
      passed: true,
      runId,
      bookingIds: fixtureIds,
      firstIntent: intent.id,
      testedThrough:
        "Stripe sandbox API + staging finalization RPC and billing engine",
      transfers: 0,
    });
  } catch (error) {
    const message =
      error instanceof Stripe.errors.StripeError
        ? `Stripe test API error: ${error.code ?? error.type}`
        : error instanceof Error
          ? error.message
          : "Staging test failed.";
    return NextResponse.json(
      { passed: false, runId, bookingIds: fixtureIds, error: message },
      { status: 500 },
    );
  }
}
