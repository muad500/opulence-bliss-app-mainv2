'use client';
import {useState} from 'react';
import {useRouter} from 'next/navigation';
import {CalendarDays,BriefcaseBusiness} from 'lucide-react';
import Link from 'next/link';

export default function AccountModeSwitch({mode,professionalApproved=false,hasProfessionalAccount=false}:{mode:'client'|'professional';professionalApproved?:boolean;hasProfessionalAccount?:boolean}){
 const router=useRouter();const[busy,setBusy]=useState(false);const[error,setError]=useState('');
 async function choose(next:'client'|'professional'){
  if(busy||(next==='professional'&&!professionalApproved))return;setBusy(true);setError('');
  try{
   const res=await fetch('/api/account/mode',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:next})});
   if(!res.ok){const body=await res.json().catch(()=>({}));throw new Error(body.error??'Your account mode could not be saved. Please try again.');}
   window.dispatchEvent(new Event('opulence-account-mode'));
   router.push(next==='professional'?'/worker':'/book');
  }catch(e){setError(e instanceof Error?e.message:'Please try again.');}finally{setBusy(false);}
 }
 return <div aria-label="Account mode" style={{display:'grid',gap:6,minWidth:0}}>
  {(['client','professional'] as const).filter(value=>value==='client'||professionalApproved).map(value=><button key={value} type="button" aria-label={value==='client'?'Book a clean':'My jobs'} title={value==='client'?'Book a clean':'My jobs'} disabled={busy} aria-pressed={mode===value} onClick={()=>void choose(value)} style={{display:'flex',alignItems:'center',gap:8,border:'1px solid var(--ob-border)',borderRadius:10,padding:'9px 12px',background:mode===value?'var(--ob-purple-soft)':'white',color:'var(--ob-purple)',fontWeight:800,textAlign:'left',cursor:'pointer'}}>{value==='client'?<CalendarDays size={18} style={{flexShrink:0}}/>:<BriefcaseBusiness size={18} style={{flexShrink:0}}/>}<span>{value==='client'?'Book a clean':'My jobs'}</span></button>)}
  {!professionalApproved&&<Link href={hasProfessionalAccount?'/worker/application':'/provider/join'} style={{display:'flex',alignItems:'center',gap:8,padding:'9px 12px',color:'var(--ob-purple)',fontWeight:800,textDecoration:'none'}}><BriefcaseBusiness size={18}/><span>{hasProfessionalAccount?'My application':'Apply as a professional'}</span></Link>}
  {error&&<small role="alert">{error}</small>}
 </div>;
}
