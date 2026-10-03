import 'server-only';
import Stripe from 'stripe';import {NextRequest,NextResponse} from 'next/server';import type {SupabaseClient} from '@supabase/supabase-js';
import {accountContext,accountError,isAccountError} from '@/lib/accountApi';import {handymanEnabled} from '@/lib/handymanMarketplace';import {getOrCreateBillingCustomer} from '@/lib/accountBilling';
export async function handymanContext(request:NextRequest,mutation=false){if(!handymanEnabled())return accountError('Not found.',404);return accountContext(request,{mutation});}
export const handymanStripe=()=>new Stripe(process.env.STRIPE_SECRET_KEY!);
export type HandymanJob={id:string;customer_id:string;provider_id:string;task_name:string;description:string;address:string;postcode:string;scheduled_at:string;estimated_minutes:number;hourly_rate_pence:number;vat_bps:number;materials_budget_pence:number;held_pence:number;status:string;checkout_session:string|null;payment_intent:string|null;previous_payment_intent:string|null;transfer_ref:string|null;started_at:string|null;ended_at:string|null;worked_minutes:number|null;bill:{gross:number;provider:number;platform:number;labour:number;vat:number;materials:number;billedMinutes:number}|null;approved_at:string|null};
export async function privateHandymanJob(admin:SupabaseClient,id:string,user:string,provider:string|null){const {data,error}=await admin.from('handyman_jobs').select('*').eq('id',id).maybeSingle();if(error||!data||(data.customer_id!==user&&data.provider_id!==provider))return null;return data as HandymanJob;}
export async function handymanCheckout(stripe:Stripe,admin:SupabaseClient,j:HandymanJob,user:{id:string;email?:string},site:string){
 const revision=j.status==='awaiting_authorization'?'final':'initial',amount=revision==='final'?j.bill?.gross:j.held_pence;if(!amount)throw new Error('No bill is ready.');
 const {data:p,error}=await admin.from('providers').select('stripe_account_id').eq('id',j.provider_id).single();if(error||!p?.stripe_account_id)throw new Error('Professional payout account is unavailable.');
 const account=await stripe.accounts.retrieve(p.stripe_account_id);if(account.deleted||account.capabilities?.transfers!=='active')throw new Error('Professional payout account is not ready.');
 const customer=await getOrCreateBillingCustomer(stripe,user);
 const session=await stripe.checkout.sessions.create({mode:'payment',customer,payment_method_types:['card'],client_reference_id:user.id,expires_at:Math.floor(Date.now()/1000)+3600,
  metadata:{kind:'handyman',job_id:j.id,revision},payment_intent_data:{capture_method:'manual',transfer_group:'handyman_'+j.id,metadata:{kind:'handyman',job_id:j.id,revision,customer_id:user.id}},
  line_items:[{price_data:{currency:'gbp',unit_amount:amount,product_data:{name:revision==='final'?'Handyman final bill authorisation':j.task_name,description:'Card hold. Payment is collected after the completed job and approved bill.'}},quantity:1}],
  success_url:site+'/handyman/jobs/'+j.id+'?checkout=complete',cancel_url:site+'/handyman/jobs/'+j.id,
 },{idempotencyKey:'handyman-checkout-'+j.id+'-'+revision});
 const {error:saveError}=await admin.from('handyman_jobs').update({checkout_session:session.id}).eq('id',j.id).eq('status',j.status);
 if(saveError)throw new Error('Checkout could not be saved.');return{url:session.url,jobId:j.id};
}
export async function finalizeHandymanCheckout(admin:SupabaseClient,stripe:Stripe,session:Stripe.Checkout.Session,pi:Stripe.PaymentIntent){
 if(!handymanEnabled())return;
 const id=session.metadata?.job_id;if(!id||pi.metadata.job_id!==id||pi.metadata.kind!=='handyman'||pi.transfer_data?.destination||pi.application_fee_amount||pi.capture_method!=='manual'||pi.status!=='requires_capture'||pi.amount_received!==0||session.status!=='complete')throw new Error('Invalid handyman card hold.');
 const {data:j,error}=await admin.from('handyman_jobs').select('*').eq('id',id).single();if(error||!j)throw new Error('Job not found.');
 if(j.payment_intent===pi.id)return;
 if(session.client_reference_id!==j.customer_id||j.checkout_session!==session.id||pi.metadata.customer_id!==j.customer_id||pi.amount_capturable!==pi.amount||pi.currency!=='gbp'||pi.amount!==(session.metadata?.revision==='final'?j.bill?.gross:j.held_pence))throw new Error('Hold does not match the job.');
 const {data:result,error:updateError}=await admin.rpc('finalize_handyman_hold',{p_job:id,p_session:session.id,p_intent:pi.id,p_amount:pi.amount,p_final:session.metadata?.revision==='final'});
 if(updateError)throw new Error('Card hold could not be recorded.');
 const prior=(result as HandymanJob).previous_payment_intent;
 if(prior&&prior!==pi.id){const old=await stripe.paymentIntents.retrieve(prior);if(old.metadata.job_id!==id||old.transfer_data?.destination||old.status!=='requires_capture')throw new Error('Previous hold needs support review.');await stripe.paymentIntents.cancel(prior,{}, {idempotencyKey:'handyman-release-replaced-'+id});await admin.from('handyman_jobs').update({previous_payment_intent:null}).eq('id',id).eq('previous_payment_intent',prior);}
}
export async function settleHandyman(admin:SupabaseClient,stripe:Stripe,j:HandymanJob){
 if(!j.bill||!j.payment_intent||j.status!=='payment_pending'||!j.approved_at)throw new Error('Customer approval is required.');
 const {data:p,error}=await admin.from('providers').select('stripe_account_id').eq('id',j.provider_id).single();if(error||!p?.stripe_account_id)throw new Error('Assigned professional has no payout account.');
 const account=await stripe.accounts.retrieve(p.stripe_account_id);if(account.deleted||account.capabilities?.transfers!=='active')throw new Error('Assigned professional account cannot receive transfers.');
 let pi=await stripe.paymentIntents.retrieve(j.payment_intent);
 if(pi.metadata.job_id!==j.id||pi.metadata.customer_id!==j.customer_id||pi.metadata.kind!=='handyman'||pi.transfer_data?.destination||pi.application_fee_amount||pi.currency!=='gbp')throw new Error('Payment does not match the job.');
 if(j.previous_payment_intent){const old=await stripe.paymentIntents.retrieve(j.previous_payment_intent);if(old.status==='requires_capture')await stripe.paymentIntents.cancel(old.id,{}, {idempotencyKey:'handyman-release-replaced-'+j.id});else if(old.status!=='canceled')throw new Error('Previous hold needs support review.');}
 if(pi.status==='requires_capture'){if(pi.amount_capturable<j.bill.gross)throw new Error('Additional authorisation is required.');pi=await stripe.paymentIntents.capture(pi.id,{amount_to_capture:j.bill.gross},{idempotencyKey:'handyman-capture-'+j.id});}
 if(pi.status!=='succeeded'||pi.amount_received!==j.bill.gross||!pi.latest_charge)throw new Error('Payment has not completed.');
 const transfer=await stripe.transfers.create({amount:j.bill.provider,currency:'gbp',destination:p.stripe_account_id,source_transaction:typeof pi.latest_charge==='string'?pi.latest_charge:pi.latest_charge.id,transfer_group:'handyman_'+j.id,metadata:{handyman_job_id:j.id,provider_id:j.provider_id}},{idempotencyKey:'handyman-payout-'+j.id});
 const {error:paidError}=await admin.from('handyman_jobs').update({status:'completed',transfer_ref:transfer.id,previous_payment_intent:null,last_payment_error:null,updated_at:new Date().toISOString()}).eq('id',j.id).eq('status','payment_pending');if(paidError)throw new Error('Payment was processed; record needs reconciliation.');return transfer.id;
}
export async function handymanFailure(message:string,status=400){return NextResponse.json({error:message},{status});}
export {isAccountError};
