import {NextRequest,NextResponse} from 'next/server';import {handymanContext,isAccountError,privateHandymanJob,handymanStripe,handymanCheckout,finalizeHandymanCheckout,settleHandyman} from '@/lib/handymanServer';import {readAccountBody} from '@/lib/accountApi';
type Params={params:Promise<{id:string}>};
export async function GET(req:NextRequest,{params}:Params){const ctx=await handymanContext(req);if(isAccountError(ctx))return ctx;const {id}=await params;const j=await privateHandymanJob(ctx.admin,id,ctx.user.id,ctx.providerId);if(!j)return NextResponse.json({error:'Job not found.'},{status:404});
 const [{data:files,error},{data:p},{data:review}]=await Promise.all([ctx.admin.from('handyman_files').select('*').eq('job_id',id).order('created_at'),ctx.admin.from('providers').select('display_name').eq('id',j.provider_id).single(),ctx.admin.from('handyman_reviews').select('*').eq('job_id',id).maybeSingle()]);if(error)return NextResponse.json({error:'Job files could not be loaded.'},{status:503});
 const signed=await Promise.all((files??[]).map(async f=>({...f,url:(await ctx.admin.storage.from('handyman-job-files').createSignedUrl(f.storage_path,600)).data?.signedUrl??null})));
 return NextResponse.json({job:j,files:signed,review,professionalName:p?.display_name,role:j.customer_id===ctx.user.id?'customer':'professional'},{headers:{'Cache-Control':'private, no-store'}});
}
export async function POST(req:NextRequest,{params}:Params){
 const ctx=await handymanContext(req,true);if(isAccountError(ctx))return ctx;const {id}=await params;let j=await privateHandymanJob(ctx.admin,id,ctx.user.id,ctx.providerId);if(!j)return NextResponse.json({error:'Job not found.'},{status:404});const b=await readAccountBody(req);if(b instanceof NextResponse)return b;
 const customer=j.customer_id===ctx.user.id,action=String(b.action);try{
  if(action==='sync'){
   if(!j.checkout_session||!customer)return NextResponse.json({error:'Checkout is private.'},{status:403});const stripe=handymanStripe(),session=await stripe.checkout.sessions.retrieve(j.checkout_session);if(!session.payment_intent||session.status!=='complete')return NextResponse.json({error:'Card authorisation has not completed.'},{status:409});const pi=await stripe.paymentIntents.retrieve(typeof session.payment_intent==='string'?session.payment_intent:session.payment_intent.id);await finalizeHandymanCheckout(ctx.admin,stripe,session,pi);return NextResponse.json({ok:true});
  }
  if(action==='authorise'){
   if(!customer||!['checkout_pending','awaiting_authorization'].includes(j.status))return NextResponse.json({error:'Authorisation is not available.'},{status:409});return NextResponse.json(await handymanCheckout(handymanStripe(),ctx.admin,j,ctx.user,req.nextUrl.origin));
  }
  if(action==='review'){
   if(!customer||j.status!=='completed'||!Number.isInteger(b.rating)||Number(b.rating)<1||Number(b.rating)>5||typeof b.comment!=='string'||b.comment.length>2000||typeof b.isPublic!=='boolean')return NextResponse.json({error:'A completed job and valid rating are required.'},{status:400});const {error}=await ctx.admin.from('handyman_reviews').upsert({job_id:id,rating:b.rating,comment:b.comment.trim()||null,is_public:b.isPublic,reviewed_at:new Date().toISOString()},{onConflict:'job_id'});if(error)throw Error();return NextResponse.json({ok:true});
  }
  if(action==='receipt'&&(!customer||typeof b.approve!=='boolean'||typeof b.fileId!=='string'))return NextResponse.json({error:'Receipt approval belongs to the customer.'},{status:403});
  const {data:changed,error}=await ctx.admin.rpc('handyman_action',{p_job:id,p_user:ctx.user.id,p_action:action,p_file:action==='receipt'?b.fileId:null,p_approve:action==='receipt'?b.approve:null});if(error)return NextResponse.json({error:'That action is not available. Refresh the job and check its status.'},{status:409});j=changed;
  if((action==='approve_bill'&&j?.status==='payment_pending')||action==='claim_payment'){
   if(action!=='claim_payment'){const {data:claimed,error:claimError}=await ctx.admin.rpc('handyman_action',{p_job:id,p_user:ctx.user.id,p_action:'claim_payment'});if(claimError)throw Error();j=claimed;}
   try{await settleHandyman(ctx.admin,handymanStripe(),j!);}catch{await ctx.admin.from('handyman_jobs').update({last_payment_error:'Payment needs a retry or support review.'}).eq('id',id);return NextResponse.json({error:'Your approved payment needs a retry. Refresh after two minutes or contact support; it will not be charged twice.'},{status:503});}
  }
  if(action==='cancel'){const stripe=handymanStripe();if(j?.payment_intent){const pi=await stripe.paymentIntents.retrieve(j.payment_intent);if(pi.metadata.job_id!==id||pi.metadata.kind!=='handyman'||pi.transfer_data?.destination||!['requires_capture','canceled'].includes(pi.status))throw Error();if(pi.status!=='canceled')await stripe.paymentIntents.cancel(pi.id,{}, {idempotencyKey:'handyman-cancel-'+id});}else if(j?.checkout_session){const session=await stripe.checkout.sessions.retrieve(j.checkout_session);if(session.status==='open')await stripe.checkout.sessions.expire(session.id);else if(session.status==='complete')throw Error('A completed hold needs reconciliation before cancellation');}const {error:cancelError}=await ctx.admin.from('handyman_jobs').update({status:'cancelled'}).eq('id',id).eq('status','cancel_pending');if(cancelError)throw Error();}
  return NextResponse.json({ok:true,status:j?.status});
 }catch{return NextResponse.json({error:'The job could not be updated. Contact support if a card hold needs review.'},{status:503});}
}
