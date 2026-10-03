export const HANDYMAN_TASKS=['Mounting and hanging','Furniture assembly','Minor repairs','Curtains and blinds','Furniture moving','Minor decorating'] as const;
export function handymanEnabled(env:Record<string,string|undefined>=process.env){return env.HANDYMAN_MARKETPLACE_ENABLED==='true';}
export function validHandymanTask(task:unknown):task is typeof HANDYMAN_TASKS[number]{return typeof task==='string'&&(HANDYMAN_TASKS as readonly string[]).includes(task);}
export function regulatedHandymanDescription(text:string){return /\b(gas|boiler|electrical|electrics|wiring|rewir\w*|circuit\w*|socket\w*|consumer unit|asbestos|structural|load.bearing|plumbing installation)\b/i.test(text);}
/** Rates are exclusive of VAT. Commission applies only to net labour. */
export function handymanBill(rate:number,minutes:number,vatBps:number,materials:number){
 if(!Number.isInteger(rate)||rate<100||rate>100000||!Number.isInteger(minutes)||minutes<0||minutes>960||![0,2000].includes(vatBps)||!Number.isInteger(materials)||materials<0||materials>500000)throw new Error('Invalid handyman bill.');
 const billedMinutes=Math.max(60,minutes),labour=Math.round(rate*billedMinutes/60),vat=Math.round(labour*vatBps/10000),platform=Math.round(labour*.2),gross=labour+vat+materials;
 return{billedMinutes,labour,vat,materials,platform,gross,provider:gross-platform};
}
