// Temporary, authenticated staging-only integration runner. Remove after tests.
import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { createHash } from 'node:crypto';
import {
  handymanCheckout, finalizeHandymanCheckout, settleHandyman,
  HandymanAuthorisationRequired, type HandymanJob,
} from '@/lib/handymanServer';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const customer = 'a087c8e8-98b7-4cd1-a876-ae2d5848c1cc';
const provider = 'ebd7f459-8d78-4249-9bbb-bfc81e56c1fd';
const worker = 'c890b769-f658-404e-bc99-b0ab8cf4c245';
const account = 'acct_1UMAl3RuvVT7baK3';
const site = 'https://opulence-bliss-app-mainv2-git-codex-staging-muad500s-projects.vercel.app';
const prefix = 'SYNTHETIC RECOVERY 20261004 ';
const labels = ['retry', 'expiry', 'reject', 'cleanup', 'lost'];
function check(value: unknown, message: string): asserts value {
  if (!value) throw Error(message);
}
async function unwrap<T>(query: PromiseLike<{ data: T; error: { message: string } | null }>) {
  const r = await query; if (r.error) throw Error('Database: '+r.error.message); return r.data!;
}
export async function POST(req: NextRequest) {
  if (process.env.VERCEL_ENV !== 'preview' || process.env.VERCEL_GIT_COMMIT_REF !== 'codex/staging' ||
      process.env.NEXT_PUBLIC_SUPABASE_URL !== 'https://comwdjprdedmsnxtvuuk.supabase.co')
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  if (!process.env.CRON_SECRET || req.headers.get('authorization') !== 'Bearer '+process.env.CRON_SECRET)
    return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
  try {
    check(process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_'), 'Test secret required');
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
    const ownResponse = await fetch('https://api.stripe.com/v1/account', {headers:{authorization:'Bearer '+process.env.STRIPE_SECRET_KEY}});
    check(ownResponse.ok && (await ownResponse.json()).id === 'acct_1UKQ4A2NzINBHbzj', 'Wrong Stripe sandbox');
    check(!(await stripe.balance.retrieve()).livemode, 'Live Stripe prohibited');
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const user = await unwrap(db.from('profiles').select('id,email').eq('id', customer).single());
    check(user.email === 'deployed_item68_1790964033937.customer@example.com', 'Wrong fixture');
    const p = await unwrap(db.from('providers').select('stripe_account_id,profile_id').eq('id', provider).single());
    check(p.profile_id === worker && p.stripe_account_id === account, 'Wrong professional fixture');
    const b = await req.json(); const action = String(b.action), label = String(b.label ?? 'retry');
    if (action === 'schedule') {
      check(typeof b.bypass === 'string' && b.bypass.length>=16,'Staging protection access missing');
      const jobId = await unwrap(db.rpc('configure_staging_handyman_recovery',{p_cron:process.env.CRON_SECRET,p_bypass:b.bypass}));
      return NextResponse.json({jobId,schedule:'*/2 * * * *',stagingOnly:true});
    }
    if (action === 'preflight') {
      const webhook = await stripe.webhookEndpoints.retrieve('we_1UKQ7H2NzINBHbzjIuy73dhP');
      check(!webhook.livemode && new URL(webhook.url).hostname === new URL(site).hostname, 'Wrong webhook');
      const checks = await unwrap(db.from('provider_verification_items').select('*').eq('provider_id', provider));
      const dbs = await unwrap(db.from('provider_dbs_checks').select('*').eq('provider_id', provider));
      const profiles = await unwrap(db.from('profiles').select('*').in('id', [customer,worker]));
      return NextResponse.json({ database:'comwdjprdedmsnxtvuuk',stripeAccount:'acct_1UKQ4A2NzINBHbzj',secretKeyMode:'test',publicKeyMode:process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.startsWith('pk_test_')?'test':'invalid',webhookTestMode:!webhook.livemode,webhookSecretConfigured:!!process.env.STRIPE_WEBHOOK_SECRET,fallbackAccount:process.env.PROVIDER_TEST_ACCOUNT,ownConnectedAccount:account,fixtureHash:createHash('sha256').update(JSON.stringify({checks,dbs,profiles})).digest('hex') });
    }
    check(process.env.HANDYMAN_MARKETPLACE_ENABLED === 'true', 'Staging marketplace disabled');
    check(labels.includes(label), 'Unknown fixture label');
    const load = async () => await unwrap(db.from('handyman_jobs').select('*').eq('customer_id',customer).eq('provider_id',provider).eq('description',prefix+label).single()) as HandymanJob;
    if (action === 'prepare') {
      const existing = await unwrap(db.from('handyman_jobs').select('id').eq('customer_id',customer).eq('description',prefix+label).maybeSingle());
      let j: HandymanJob;
      if (existing) j = await load();
      else {
        const i = labels.indexOf(label), date = new Date(Date.now()+86400000*(i === 4?2:1));
        date.setUTCHours(i === 4?11:11+i*2,0,0,0);
        j = await unwrap(db.rpc('reserve_handyman_job',{p_customer:customer,p_provider:provider,p_task:'Mounting and hanging',p_description:prefix+label,p_address:'SYNTHETIC STAGING TEST ADDRESS',p_postcode:'SW3 1AA',p_slot:date.toISOString(),p_minutes:60,p_materials:0})) as HandymanJob;
      }
      const result = await handymanCheckout(stripe,db,j,user,site);
      if(label === 'reject') await unwrap(db.from('handyman_jobs').update({created_at:new Date(Date.now()-7200000).toISOString()}).eq('id',j.id));
      return NextResponse.json({...result,label});
    }
    let j = await load();
    check(j.customer_id === customer && j.provider_id === provider && j.description === prefix+label,'Unowned job');
    const session = async () => { check(j.checkout_session,'No checkout');return stripe.checkout.sessions.retrieve(j.checkout_session); };
    if (action === 'retry') {
      const before = await session(), result = await handymanCheckout(stripe,db,j,user,site);
      const current = await load();check(current.checkout_session === before.id,'Duplicate checkout');
      const attempts = await unwrap(db.from('handyman_payment_attempts').select('id').eq('job_id',j.id));
      check(attempts.length === 1,'Duplicate attempt');
      return NextResponse.json({...result,sessionId:before.id,attempts:attempts.length,sessionCreated:before.created,checkedAt:Math.floor(Date.now()/1000)});
    }
    if (action === 'sync') {
      const s = await session();check(s.status === 'complete' && typeof s.payment_intent === 'string','Checkout incomplete');
      const pi = await stripe.paymentIntents.retrieve(s.payment_intent);
      check(!pi.livemode && !pi.transfer_data?.destination,'Unsafe hold');
      await finalizeHandymanCheckout(db,stripe,s,pi);j=await load();
      const current = await stripe.paymentIntents.retrieve(pi.id);
      if(label === 'reject') check(j.status === 'cancelled' && current.status === 'canceled' && current.amount_received === 0,'Rejected hold not released');
      else check(j.status === 'scheduled' && current.status === 'requires_capture' && current.amount_received === 0,'Hold not scheduled');
      return NextResponse.json({jobId:j.id,status:j.status,paymentIntent:pi.id,stripeStatus:current.status,held:current.amount_capturable,received:current.amount_received});
    }
    if (action === 'approve') {
      check(j.status === 'scheduled','Job not ready to start');
      await unwrap(db.from('handyman_jobs').update({scheduled_at:new Date(Date.now()-300000).toISOString()}).eq('id',j.id));
      await unwrap(db.rpc('handyman_action',{p_job:j.id,p_user:worker,p_action:'start'}));
      await unwrap(db.from('handyman_jobs').update({started_at:new Date(Date.now()-59.5*60000).toISOString()}).eq('id',j.id));
      await unwrap(db.rpc('handyman_action',{p_job:j.id,p_user:worker,p_action:'finish'}));
      await unwrap(db.rpc('handyman_action',{p_job:j.id,p_user:customer,p_action:'approve_bill'}));
      j=await load();check(j.status==='payment_pending' && j.approved_at,'Bill not approved');
      return NextResponse.json({jobId:j.id,status:j.status,bill:j.bill,workTimeSimulated:true});
    }
    if (action === 'expire') {
      check(label === 'expiry' && j.status === 'payment_pending' && j.payment_intent,'Expiry fixture unavailable');
      const pi = await stripe.paymentIntents.retrieve(j.payment_intent);check(pi.status==='requires_capture' && !pi.livemode,'Wrong hold');
      await stripe.paymentIntents.cancel(pi.id,{cancellation_reason:'abandoned'});
      let required=false;try{await settleHandyman(db,stripe,j);}catch(e){if(e instanceof HandymanAuthorisationRequired)required=true;else throw e;}
      check(required,'Did not request reauthorisation');j=await load();check(j.status==='awaiting_authorization' && j.approved_at && j.bill,'Approved bill lost');
      const result = await handymanCheckout(stripe,db,j,user,site);
      return NextResponse.json({...result,oldPaymentIntent:pi.id,status:j.status,bill:j.bill,expirySimulation:'Controlled Stripe test cancellation; not elapsed network expiry'});
    }
    if (action === 'cleanup') {
      check(label==='cleanup' && j.payment_intent && j.status==='scheduled','Wrong cleanup fixture');
      const current = await stripe.paymentIntents.retrieve(j.payment_intent), s=await session();
      const old = await stripe.paymentIntents.create({amount:j.held_pence,currency:'gbp',capture_method:'manual',payment_method:'pm_card_visa',confirm:true,payment_method_types:['card'],transfer_group:'handyman_'+j.id,metadata:{kind:'handyman',job_id:j.id,customer_id:customer,revision:'initial'}},{idempotencyKey:'recovery-audit-old-hold-'+j.id});
      check(old.status==='requires_capture' && !old.livemode,'Old fixture hold unavailable');
      await unwrap(db.from('handyman_payment_attempts').upsert({job_id:j.id,revision:'initial',amount_pence:old.amount,payment_intent:old.id,legacy:true,status:'release_pending'},{onConflict:'payment_intent'}));
      await unwrap(db.from('handyman_jobs').update({previous_payment_intent:old.id}).eq('id',j.id));
      const failingStripe = new Proxy(stripe,{get(target,key){if(key!=='paymentIntents')return Reflect.get(target,key);return new Proxy(target.paymentIntents,{get(t,k){if(k==='cancel')return async()=>{throw Error('Injected cancel network failure');};return Reflect.get(t,k);}});}});
      let failed=false;try{await finalizeHandymanCheckout(db,failingStripe,s,current);}catch{failed=true;}
      check(failed && (await stripe.paymentIntents.retrieve(old.id)).status==='requires_capture','Cleanup failure not retained');
      const failingDb = new Proxy(db,{get(target,key){if(key!=='rpc')return Reflect.get(target,key);return (name:string,args:Record<string,unknown>)=>name==='finish_handyman_hold_release'?Promise.resolve({data:null,error:{message:'Injected acknowledgement failure'}}):target.rpc(name,args);}}) as SupabaseClient;
      failed=false;try{await finalizeHandymanCheckout(failingDb,stripe,s,current);}catch{failed=true;}
      check(failed && (await stripe.paymentIntents.retrieve(old.id)).status==='canceled','Cancellation not performed before ack failure');
      await finalizeHandymanCheckout(db,stripe,s,current);j=await load();
      check(j.previous_payment_intent===null && (await stripe.paymentIntents.retrieve(current.id)).status==='requires_capture','Retry affected current hold');
      return NextResponse.json({jobId:j.id,currentPaymentIntent:current.id,oldPaymentIntent:old.id,oldStatus:'canceled',currentStatus:'requires_capture',cancelFailureRecovered:true,ackFailureRecovered:true,failureInjection:true});
    }
    if (action === 'settle') {
      check(j.status==='payment_pending','Bill not ready');
      await settleHandyman(db,stripe,j);j=await load();
      check(j.status==='completed' && j.payment_intent && j.transfer_ref,'Settlement incomplete');
      const pi = await stripe.paymentIntents.retrieve(j.payment_intent), transfers=await stripe.transfers.list({transfer_group:'handyman_'+j.id});
      check(pi.amount_received===j.bill?.gross && transfers.data.length===1 && transfers.data[0].destination===account,'Incorrect capture or payout');
      return NextResponse.json({jobId:j.id,paymentIntent:pi.id,received:pi.amount_received,transferId:j.transfer_ref,transferCount:1,destination:account,provider:j.bill?.provider,platform:j.bill?.platform});
    }
    if (action === 'replacement-sync') {
      const s=await session();check(s.status==='complete' && typeof s.payment_intent==='string','Replacement incomplete');
      await finalizeHandymanCheckout(db,stripe,s,await stripe.paymentIntents.retrieve(s.payment_intent));j=await load();
      check(j.status==='payment_pending' && j.previous_payment_intent===null,'Replacement not recorded or cleaned');
      return NextResponse.json({jobId:j.id,paymentIntent:j.payment_intent,status:j.status,bill:j.bill});
    }
    if (action === 'delayed') {
      check(j.status==='completed','Delayed event fixture must be paid');
      const s=await session(), events=await stripe.events.list({type:'checkout.session.completed',limit:100});
      const event=events.data.find(e=>(e.data.object as Stripe.Checkout.Session).id===s.id);
      check(event && process.env.STRIPE_WEBHOOK_SECRET,'Actual Stripe checkout event unavailable');
      const payload=JSON.stringify(event), signature=stripe.webhooks.generateTestHeaderString({payload,secret:process.env.STRIPE_WEBHOOK_SECRET});
      return NextResponse.json({jobId:j.id,eventId:event.id,paymentIntent:j.payment_intent,webhookReplay:{payload,signature},transferCount:(await stripe.transfers.list({transfer_group:'handyman_'+j.id})).data.length});
    }
    return NextResponse.json({error:'Unknown action'},{status:400});
  } catch(e) {
    return NextResponse.json({error:e instanceof Error?e.message:'Audit failed'},{status:500});
  }
}
