/** Calendar anniversary, clamped for a certificate issued on 29 February. */
export function dbsRecheckDate(issueDate:string):string|null{
 if(!/^\d{4}-\d{2}-\d{2}$/.test(issueDate))return null;
 const start=new Date(issueDate+'T00:00:00Z');if(!Number.isFinite(start.getTime())||start.toISOString().slice(0,10)!==issueDate)return null;
 const year=start.getUTCFullYear()+1,month=start.getUTCMonth();
 const day=Math.min(start.getUTCDate(),new Date(Date.UTC(year,month+1,0)).getUTCDate());
 return new Date(Date.UTC(year,month,day)).toISOString().slice(0,10);
}
export function renewalState(dueDate:string|null,today:string):'missing'|'current'|'due_soon'|'expired'{
 if(!dueDate)return'missing';
 if(dueDate<today)return'expired';
 const days=(Date.parse(dueDate+'T00:00:00Z')-Date.parse(today+'T00:00:00Z'))/86400000;
 return days<=30?'due_soon':'current';
}
