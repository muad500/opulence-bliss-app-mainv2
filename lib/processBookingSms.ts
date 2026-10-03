import type {SupabaseClient} from '@supabase/supabase-js';
import {bookingSmsConfig,bookingSmsText,submitBookingSms} from './bookingSms';
type Delivery={id:string;claim_token:string;phone:string;kind:string;booking_id:string;scheduled_at:string};
export async function processBookingSms(admin:SupabaseClient){
 const config=bookingSmsConfig(process.env);if(!config)return{enabled:false,submitted:0,failed:0};
 const {data,error}=await admin.rpc('claim_booking_sms',{p_budget_pence:config.monthlyBudgetPence,p_cost_cap_pence:config.costCapPence});
 if(error)throw new Error('SMS queue could not be claimed.');
 let submitted=0,failed=0;
 for(const delivery of(data??[]) as Delivery[]){
  let sid:string|null=null;let failure:string|null=null;
  const {data:allowed,error:checkError}=await admin.rpc('booking_sms_allowed',{p_id:delivery.id,p_token:delivery.claim_token});
  if(checkError||allowed!==true){
   const {error:finishError}=await admin.rpc('finish_booking_sms',{p_id:delivery.id,p_token:delivery.claim_token,p_sid:null,p_error:'Preferences or booking state changed; not sent.'});
   if(finishError||checkError)failed++;continue;
  }
  try{sid=await submitBookingSms(config,delivery.phone,bookingSmsText(delivery.kind,delivery.booking_id,delivery.scheduled_at));}
  catch(e){failure=e instanceof Error?e.message:'SMS submission uncertain; manual review required.';}
  const {error:finishError}=await admin.rpc('finish_booking_sms',{p_id:delivery.id,p_token:delivery.claim_token,p_sid:sid,p_error:failure});
  if(finishError||!sid)failed++;else submitted++;
 }
 return{enabled:true,submitted,failed};
}
