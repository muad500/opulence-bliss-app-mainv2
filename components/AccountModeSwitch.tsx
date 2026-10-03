'use client';
import {useState} from 'react';
import {useRouter} from 'next/navigation';

export default function AccountModeSwitch({mode}:{mode:'client'|'professional'}){
 const router=useRouter();const[busy,setBusy]=useState(false);const[error,setError]=useState('');
 async function choose(next:'client'|'professional'){
  if(busy)return;setBusy(true);setError('');
  try{
   const res=await fetch('/api/account/mode',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:next})});
   if(!res.ok)throw new Error('Your account mode could not be saved. Please try again.');
   window.dispatchEvent(new Event('opulence-account-mode'));
   router.push(next==='professional'?'/worker':'/book');
  }catch(e){setError(e instanceof Error?e.message:'Please try again.');}finally{setBusy(false);}
 }
 return <div aria-label="Account mode" style={{display:'grid',gap:6,minWidth:0}}>
  {(['client','professional'] as const).map(value=><button key={value} type="button" disabled={busy} aria-pressed={mode===value} onClick={()=>void choose(value)} style={{border:'1px solid var(--ob-border)',borderRadius:10,padding:'9px 12px',background:mode===value?'var(--ob-purple-soft)':'white',color:'var(--ob-purple)',fontWeight:800,textAlign:'left',cursor:'pointer'}}>{value==='client'?'Book a clean':'My jobs'}</button>)}
  {error&&<small role="alert">{error}</small>}
 </div>;
}
