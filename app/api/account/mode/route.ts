import {NextRequest,NextResponse} from 'next/server';
import {accountContext,accountError,isAccountError,readAccountBody} from '@/lib/accountApi';

export async function GET(request:NextRequest){
 const ctx=await accountContext(request); if(isAccountError(ctx))return ctx;
 const {data,error}=await ctx.admin.from('account_profile_details').select('last_account_mode').eq('user_id',ctx.user.id).maybeSingle();
 if(error)return accountError('Account mode could not be loaded.',503);
 return NextResponse.json({mode:ctx.providerId&&data?.last_account_mode==='professional'?'professional':'client',hasProfessionalAccount:!!ctx.providerId});
}
export async function POST(request:NextRequest){
 const ctx=await accountContext(request,{mutation:true}); if(isAccountError(ctx))return ctx;
 const body=await readAccountBody(request);if(body instanceof NextResponse)return body;
 if(!['client','professional'].includes(String(body.mode)))return accountError('Choose an account mode.');
 if(body.mode==='professional'&&!ctx.providerId)return accountError('Create your professional profile first.',403);
 const {error}=await ctx.admin.from('account_profile_details').upsert({user_id:ctx.user.id,last_account_mode:body.mode,updated_at:new Date().toISOString()},{onConflict:'user_id'});
 if(error)return accountError('Account mode could not be saved.',503);
 return NextResponse.json({mode:body.mode});
}
