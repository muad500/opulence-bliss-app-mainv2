type Env=Record<string,string|undefined>;
export type SmsConfig={account:string;token:string;service:string;monthlyBudgetPence:number;costCapPence:number};
export function bookingSmsConfig(env:Env):SmsConfig|null{
 if(env.BOOKING_SMS_ENABLED!=='true')return null;
 const budget=Number(env.TWILIO_MONTHLY_BUDGET_GBP),cost=Number(env.TWILIO_MAX_COST_PER_MESSAGE_GBP);
 if(!/^AC[0-9a-f]{32}$/i.test(env.TWILIO_ACCOUNT_SID??'')||!env.TWILIO_AUTH_TOKEN||!/^MG[0-9a-f]{32}$/i.test(env.TWILIO_MESSAGING_SERVICE_SID??'')||!Number.isFinite(budget)||budget<=0||budget>10000||!Number.isFinite(cost)||cost<=0||cost>budget)return null;
 return{account:env.TWILIO_ACCOUNT_SID!,token:env.TWILIO_AUTH_TOKEN!,service:env.TWILIO_MESSAGING_SERVICE_SID!,monthlyBudgetPence:Math.floor(budget*100),costCapPence:Math.ceil(cost*100)};
}
export function bookingSmsText(kind:string,bookingId:string,scheduledAt:string){
 const lead=({received:'Booking received',confirmed:'Booking confirmed',reminder_24h:'Your booking is in 24 hours',reminder_90m:'Your booking is in 1 hour 30 minutes'} as Record<string,string>)[kind];
 if(!lead)throw new Error('Unsupported SMS event');
 const time=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(scheduledAt));
 return `Opulence Bliss: ${lead}. ${time} (London time). Ref ${bookingId.slice(0,8)}. See My bookings for details.`;
}
/** Twilio has no create-message idempotency key: uncertain requests are never
 * retried automatically. "Submitted" is provider acceptance, not delivery. */
export async function submitBookingSms(config:SmsConfig,to:string,body:string,fetcher:typeof fetch=fetch):Promise<string>{
 if(!/^\+44\d{10}$/.test(to)||body.length>160||!/^[\x20-\x7e]+$/.test(body))throw new Error('Invalid SMS destination or message.');
 const response=await fetcher(`https://api.twilio.com/2010-04-01/Accounts/${config.account}/Messages.json`,{
  method:'POST',signal:AbortSignal.timeout(8000),headers:{Authorization:'Basic '+Buffer.from(config.account+':'+config.token).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},
  body:new URLSearchParams({To:to,MessagingServiceSid:config.service,Body:body,ValidityPeriod:'300'}).toString(),
 });
 if(!response.ok)throw new Error(`SMS provider returned ${response.status}; manual review required.`);
 const reply:unknown=await response.json();
 if(!reply||typeof reply!=='object'||!('sid'in reply)||typeof reply.sid!=='string'||!/^SM[0-9a-f]{32}$/i.test(reply.sid))throw new Error('SMS provider did not return a message reference; manual review required.');
 return reply.sid;
}
