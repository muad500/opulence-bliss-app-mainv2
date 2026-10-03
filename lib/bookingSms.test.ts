import {test} from 'node:test';import assert from 'node:assert/strict';
import {bookingSmsConfig,bookingSmsText,submitBookingSms} from './bookingSms';
const env={BOOKING_SMS_ENABLED:'true',TWILIO_ACCOUNT_SID:'AC'+'a'.repeat(32),TWILIO_AUTH_TOKEN:'fixture-only',TWILIO_MESSAGING_SERVICE_SID:'MG'+'b'.repeat(32),TWILIO_MONTHLY_BUDGET_GBP:'10',TWILIO_MAX_COST_PER_MESSAGE_GBP:'0.20'};
test('SMS stays off without explicit enablement, credentials and a budget',()=>{
 assert.equal(bookingSmsConfig({}),null);assert.equal(bookingSmsConfig({...env,BOOKING_SMS_ENABLED:'false'}),null);assert.equal(bookingSmsConfig({...env,TWILIO_MONTHLY_BUDGET_GBP:'0'}),null);assert.equal(bookingSmsConfig({...env,TWILIO_AUTH_TOKEN:''}),null);assert.equal(bookingSmsConfig(env)?.monthlyBudgetPence,1000);
});
test('SMS confirmations and both reminders fit one ASCII message with London time',()=>{
 for(const kind of['received','confirmed','reminder_24h','reminder_90m']){
  const text=bookingSmsText(kind,'12345678-fixture','2026-07-01T10:00:00Z');assert.ok(text.length<=160);assert.match(text,/11:00/);assert.match(text,/^[\x20-\x7e]+$/);
 }
});
test('Twilio request uses the messaging service and records provider acceptance',async()=>{
 let calls=0;
 const fake=(async(url,init)=>{calls++;assert.match(String(url),/api.twilio.com/);assert.equal(init?.method,'POST');const body=new URLSearchParams(String(init?.body));assert.equal(body.get('To'),'+447912345678');assert.equal(body.get('MessagingServiceSid'),env.TWILIO_MESSAGING_SERVICE_SID);assert.equal(body.get('ValidityPeriod'),'300');return new Response(JSON.stringify({sid:'SM'+'c'.repeat(32)}),{status:201});}) as typeof fetch;
 assert.equal(await submitBookingSms(bookingSmsConfig(env)!,'+447912345678','Booking fixture',fake),'SM'+'c'.repeat(32));assert.equal(calls,1);
});
test('an ambiguous SMS failure is returned without duplicate retries',async()=>{
 let calls=0;const fake=(async()=>{calls++;throw new Error('network timeout');}) as typeof fetch;
 await assert.rejects(submitBookingSms(bookingSmsConfig(env)!,'+447912345678','Fixture',fake));assert.equal(calls,1);
});
